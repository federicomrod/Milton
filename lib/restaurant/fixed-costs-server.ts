// lib/restaurant/fixed-costs-server.ts
//
// Rentabilidad + Costos fijos. READ side of the fixed-cost data layer: monthly
// lines per restaurant or for the whole group, canonical items, the history, the
// group split and the view the Costos › Costos fijos tab renders. Nothing in this
// file writes: every change goes through lib/restaurant/fixed-cost-commands.ts
// (migration 079). Rendering a month never creates a row or a history event.
// Missing is `null`, never 0.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  computeFixedFigures,
  type FixedFigures,
} from "@/lib/restaurant/fixed-cost-engine";
import {
  previewCopy,
  type CopyPreview,
} from "@/lib/restaurant/fixed-cost-commands";
import {
  fetchAllRows,
  succeededRows,
  type OrderableQuery,
} from "@/lib/restaurant/paginated-read";
import {
  effectiveFixedCosts,
  fixedCostCompleteness,
  isFixedCostCategory,
  nextMonthStart,
  openDaysInMonth,
  previousMonthStart,
  splitGroupAmount,
  type AmountCategory,
  type EffectiveFixedCosts,
  type FixedCostCategory,
  type FixedCostCompleteness,
  type FixedCostLine,
  type FixedCostSource,
  type MarginInputs,
  type SplitRule,
} from "@/lib/restaurant/fixed-costs";

const LINE_COLUMNS =
  "id, location_id, month, category, label, amount, pct_of_sales, currency, source, status, repeats, split_rule, version, detail_state, copy_source";

interface LineRow {
  id: string;
  location_id: string | null;
  month: string;
  category: string;
  label: string | null;
  amount: number | string | null;
  pct_of_sales: number | string | null;
  currency: string;
  source: FixedCostSource;
  status: "draft" | "confirmed";
  repeats: boolean;
  split_rule: SplitRule | null;
  version?: number;
  detail_state?: "legacy_total" | "itemized";
  copy_source?: { month?: string; aggregate_version?: number } | null;
}

const num = (v: number | string | null): number | null =>
  v === null || v === undefined
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;

function toLine(r: LineRow): FixedCostLine | null {
  if (!isFixedCostCategory(r.category)) return null;
  return {
    id: r.id,
    location_id: r.location_id,
    month: String(r.month).slice(0, 10),
    category: r.category,
    label: r.label,
    amount: num(r.amount),
    pct_of_sales: num(r.pct_of_sales),
    currency: r.currency,
    source: r.source,
    status: r.status,
    repeats: r.repeats,
    split_rule: r.split_rule,
    version: r.version ?? 0,
    detail_state: r.detail_state ?? "legacy_total",
    copy_source: r.copy_source ?? null,
  };
}

export interface FixedCostsContext {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
}

/** Lines of one month for one scope: a restaurant (id) or the group (null). */
export async function listFixedCosts(
  supabase: SupabaseClient,
  companyId: string,
  month: string,
  locationId: string | null
): Promise<FixedCostLine[]> {
  let q = supabase
    .from("restaurant_fixed_costs")
    .select(LINE_COLUMNS)
    .eq("company_id", companyId)
    .eq("month", month);
  q = locationId ? q.eq("location_id", locationId) : q.is("location_id", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as LineRow[])
    .map(toLine)
    .filter((l): l is FixedCostLine => l !== null);
}

export interface FixedCostHistoryItem {
  id: string;
  created_at: string;
  actor: string | null;
  action: string;
  category: FixedCostCategory;
  month: string;
  location_id: string | null;
  old_value: { amount: number | null; pct_of_sales: number | null } | null;
  /** `from_month` / `items` are written by a repeat (the month it was copied from). */
  new_value: {
    amount: number | null;
    pct_of_sales: number | null;
    from_month?: string;
  } | null;
  source: FixedCostSource;
}

export async function listFixedCostHistory(
  supabase: SupabaseClient,
  companyId: string,
  opts: { locationId?: string | null; month?: string; limit?: number } = {}
): Promise<FixedCostHistoryItem[]> {
  let q = supabase
    .from("restaurant_fixed_costs_log")
    .select(
      "id, created_at, actor, action, category, month, location_id, old_value, new_value, source"
    )
    .eq("company_id", companyId);
  if (opts.month) q = q.eq("month", opts.month);
  if (opts.locationId !== undefined)
    q = opts.locationId
      ? q.eq("location_id", opts.locationId)
      : q.is("location_id", null);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 30, 1), 200));
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FixedCostHistoryItem[];
}

// ---------------------------------------------------------------------------
// Group split
// ---------------------------------------------------------------------------

/** Sales per restaurant in a month (tips excluded). Only the `sales` split reads it. */
export async function monthSalesByLocation(
  supabase: SupabaseClient,
  companyId: string,
  month: string
): Promise<Map<string, number>> {
  const result = await fetchAllRows<{
    location_id: string | null;
    gross_revenue: number | null;
    is_tip: boolean | null;
  }>(
    () =>
      supabase
        .from("pos_sales_items")
        .select("location_id, gross_revenue, is_tip")
        .eq("company_id", companyId)
        .gte("sale_date", month)
        .lt("sale_date", nextMonthStart(month)) as unknown as OrderableQuery
  );
  const out = new Map<string, number>();
  for (const r of succeededRows(result)) {
    if (!r.location_id || r.is_tip) continue;
    out.set(
      r.location_id,
      (out.get(r.location_id) ?? 0) + Number(r.gross_revenue ?? 0)
    );
  }
  return out;
}

/**
 * This restaurant's share of the group lines of a month: category → amount
 * (largest remainder across the active restaurants, so the shares of every
 * restaurant add up to the group total to the cent) plus a group tax rate.
 */
export async function groupSharesFor(
  supabase: SupabaseClient,
  companyId: string,
  month: string,
  locationId: string,
  restaurantIds: string[],
  opts: { confirmedOnly?: boolean } = {}
): Promise<{
  shares: Partial<Record<AmountCategory, number>>;
  impuestosPct: number | null;
  /** A group line used here is a Milton estimate. */
  hasEstimate: boolean;
}> {
  const groupLines = (
    await listFixedCosts(supabase, companyId, month, null)
  ).filter((l) => !opts.confirmedOnly || l.status === "confirmed");
  const shares: Partial<Record<AmountCategory, number>> = {};
  let impuestosPct: number | null = null;
  const hasEstimate = groupLines.some((l) => l.source === "estimate");
  if (groupLines.length === 0 || !restaurantIds.includes(locationId))
    return { shares, impuestosPct, hasEstimate: false };
  const needsSales = groupLines.some(
    (l) => l.category !== "impuestos" && l.split_rule !== "equal"
  );
  const sales = needsSales
    ? await monthSalesByLocation(supabase, companyId, month)
    : new Map<string, number>();
  const targets = restaurantIds.map((id) => ({
    location_id: id,
    sales: sales.get(id) ?? null,
  }));
  for (const line of groupLines) {
    if (line.category === "impuestos") {
      impuestosPct = line.pct_of_sales;
      continue;
    }
    if (line.amount === null) continue;
    const mine = splitGroupAmount(
      line.amount,
      line.split_rule ?? "sales",
      targets
    ).find((s) => s.location_id === locationId);
    if (mine) shares[line.category as AmountCategory] = mine.amount;
  }
  return { shares, impuestosPct, hasEstimate };
}

// ---------------------------------------------------------------------------
// Canonical items
// ---------------------------------------------------------------------------

export interface ItemView {
  id: string;
  label: string | null;
  /** Integer minor units: the exact amount. */
  cents: number;
  /** 'legacy_base' = a total whose detail is unknown (shown as such). */
  kind: "item" | "legacy_base";
  version: number;
  /** Where it is known to come from: the file name for an upload, the month for a copy. */
  origin: { fileName?: string; copiedFrom?: string; manual?: boolean };
}

/** Active items of a month and scope, per cash category. Read-only. */
export async function loadMonthItems(
  supabase: SupabaseClient,
  companyId: string,
  month: string,
  locationId: string | null
): Promise<Partial<Record<AmountCategory, ItemView[]>>> {
  let q = supabase
    .from("fixed_cost_items")
    .select("id, category, kind, label, amount_cents, version, origin, seq")
    .eq("company_id", companyId)
    .eq("month", month)
    .eq("status", "active");
  q = locationId ? q.eq("location_id", locationId) : q.is("location_id", null);
  const { data, error } = await q.order("seq", { ascending: true });
  if (error) return {};
  const out: Partial<Record<AmountCategory, ItemView[]>> = {};
  for (const r of (data ?? []) as Array<{
    id: string;
    category: AmountCategory;
    kind: "item" | "legacy_base";
    label: string | null;
    amount_cents: number | string;
    version: number;
    origin: Record<string, unknown> | null;
  }>) {
    const o = r.origin ?? {};
    (out[r.category] ??= []).push({
      id: r.id,
      label: r.label,
      cents: Number(r.amount_cents),
      kind: r.kind,
      version: r.version,
      origin: {
        ...(typeof o.file_name === "string" ? { fileName: o.file_name } : {}),
        ...(typeof o.source_month === "string"
          ? { copiedFrom: o.source_month.slice(0, 10) }
          : {}),
        ...(o.manual === true ? { manual: true } : {}),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Margin and the view for the tab
// ---------------------------------------------------------------------------

export type MarginRead =
  | { ok: true; margin: MarginInputs; month?: string }
  | { ok: false; reason: string };

export interface FixedCostsView {
  month: string;
  currency: string;
  /** null = the group lines. */
  locationId: string | null;
  lines: FixedCostLine[];
  /** Canonical items per cash category (empty = no known detail). */
  items: Partial<Record<AmountCategory, ItemView[]>>;
  /** Aggregate version per category of this month and scope (0 = none): sent back on every save. */
  versions: Partial<Record<FixedCostCategory, number>>;
  /** This restaurant's share of the group lines (restaurant scope only). */
  groupShares: Partial<Record<AmountCategory, number>>;
  groupImpuestosPct: number | null;
  costs: EffectiveFixedCosts;
  completeness: FixedCostCompleteness;
  openDays: number;
  margin: MarginInputs | null;
  marginReason: string | null;
  /** null = no number (see `figures.missing`). A partial number is labelled by `figures.status`. */
  breakEven: number | null;
  /** The shared engine's result: the same function Rentabilidad calls. */
  figures: FixedFigures;
  /** The previous month's value per category in the same scope (small grey text, ±20% flag). */
  lastMonth: Partial<Record<FixedCostCategory, number>>;
  /** What «Copiar de {mes anterior}» would do. Read-only; null when the person cannot copy. */
  copy: CopyPreview | null;
}

export async function loadFixedCostsView(
  ctx: FixedCostsContext,
  args: {
    month: string;
    locationId: string | null;
    brandId: string | null;
    restaurantIds: string[];
    /** The month's margin from Rentabilidad (`loadMonthMargin`): one break-even on both screens. */
    marginRead: MarginRead;
  }
): Promise<FixedCostsView> {
  const { supabase, companyId } = ctx;
  const marginRead = args.marginRead;
  const [currency, lines, items, shiftRows, group, lastLines, copy] =
    await Promise.all([
      resolveCompanyCurrency(supabase, companyId),
      listFixedCosts(supabase, companyId, args.month, args.locationId),
      loadMonthItems(supabase, companyId, args.month, args.locationId),
      args.locationId
        ? supabase
            .from("restaurant_shifts")
            .select("weekdays, active")
            .eq("company_id", companyId)
            .eq("restaurant_id", args.locationId)
        : Promise.resolve({ data: null }),
      args.locationId
        ? groupSharesFor(
            supabase,
            companyId,
            args.month,
            args.locationId,
            args.restaurantIds,
            { confirmedOnly: true }
          )
        : Promise.resolve({
            shares: {},
            impuestosPct: null,
            hasEstimate: false,
          }),
      // A hiccup here only hides the small grey «Mes pasado» text.
      listFixedCosts(
        supabase,
        companyId,
        previousMonthStart(args.month),
        args.locationId
      ).catch(() => [] as FixedCostLine[]),
      // Read-only preview. A failure (for example a read-only role) just hides the button.
      previewCopy(ctx, {
        from: previousMonthStart(args.month),
        to: args.month,
        locationId: args.locationId,
      }).then((r) => (r.ok ? r.value : null)),
    ]);
  const lastMonth: Partial<Record<FixedCostCategory, number>> = {};
  for (const l of lastLines) {
    const v = l.category === "impuestos" ? l.pct_of_sales : l.amount;
    if (v !== null) lastMonth[l.category] = v;
  }
  const versions: Partial<Record<FixedCostCategory, number>> = {};
  for (const l of lines) versions[l.category] = l.version ?? 0;
  // Before migration 054 the table is missing: no shifts → every day is open.
  const weekdays = (
    (shiftRows.data ?? []) as Array<{ weekdays: number[]; active: boolean }>
  )
    .filter((s) => s.active !== false)
    .map((s) => s.weekdays ?? []);
  const openDays = openDaysInMonth(
    args.month,
    weekdays.length ? weekdays : null
  );
  // Only CONFIRMED lines count, here and in Rentabilidad: the same inputs.
  const confirmed = lines.filter((l) => l.status === "confirmed");
  const costs = effectiveFixedCosts(
    confirmed,
    group.shares,
    group.impuestosPct
  );
  const margin = marginRead.ok ? marginRead.margin : null;
  const localTax = confirmed.some(
    (l) => l.category === "impuestos" && l.pct_of_sales !== null
  );
  const figures = computeFixedFigures({
    month: args.month,
    costs,
    taxSource: localTax
      ? "local"
      : group.impuestosPct !== null
        ? "group"
        : null,
    margin,
    marginMonth: marginRead.ok ? (marginRead.month ?? args.month) : null,
    openDays,
  });
  return {
    month: args.month,
    currency,
    locationId: args.locationId,
    lines,
    items,
    versions,
    groupShares: group.shares,
    groupImpuestosPct: group.impuestosPct,
    costs,
    completeness: fixedCostCompleteness(costs),
    openDays,
    margin,
    marginReason: marginRead.ok ? null : marginRead.reason,
    breakEven: figures.breakEven,
    figures,
    lastMonth,
    copy,
  };
}
