// lib/restaurant/fixed-costs-server.ts
//
// Rentabilidad + Costos fijos, Fase 1a (#397). Server functions over the
// migration 064 tables: monthly lines per restaurant or for the whole group,
// the idempotent monthly repeat, the history, the group split and the view the
// Costos › Costos fijos tab renders. The company and currency always come from
// the caller's company (`resolveCompanyCurrency`), never from the request.
// Missing is `null`, never 0.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  fetchAllRows,
  succeededRows,
  type OrderableQuery,
} from "@/lib/restaurant/paginated-read";
import { fetchProfitabilityData } from "@/lib/restaurant/profitability-server";
import {
  breakEvenPerDay,
  effectiveFixedCosts,
  fixedCostCompleteness,
  isFixedCostCategory,
  monthStartOf,
  nextMonthStart,
  openDaysInMonth,
  planRepeat,
  previousMonthStart,
  splitGroupAmount,
  validateLine,
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
  "id, location_id, month, category, label, amount, pct_of_sales, currency, source, status, repeats, split_rule";

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

async function writeLog(
  ctx: FixedCostsContext,
  rows: Array<{
    fixed_cost_id: string | null;
    location_id: string | null;
    month: string;
    category: FixedCostCategory;
    action: "create" | "update" | "delete" | "repeat";
    old_value: unknown;
    new_value: unknown;
    source: FixedCostSource;
  }>
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await ctx.supabase
    .from("restaurant_fixed_costs_log")
    .insert(
      rows.map((r) => ({ ...r, company_id: ctx.companyId, actor: ctx.userId }))
    );
  if (error) throw new Error(error.message);
}

const valueOf = (
  l: Pick<FixedCostLine, "amount" | "pct_of_sales"> | undefined
) => (l ? { amount: l.amount, pct_of_sales: l.pct_of_sales } : null);

export interface SaveEntry {
  category: FixedCostCategory;
  /** null / "" = an empty field: no row (an existing row is removed). */
  value: number | string | null;
  label?: string | null;
  repeats?: boolean;
  split_rule?: SplitRule | null;
}

/**
 * Saves the form of one month and scope. A value (a typed 0 included) is
 * stored; an empty field deletes the row — it is never stored as 0. Every
 * change writes the history.
 */
export async function saveFixedCosts(
  ctx: FixedCostsContext,
  args: { month: string; locationId: string | null; entries: SaveEntry[] }
): Promise<
  { ok: true; lines: FixedCostLine[] } | { ok: false; error: string }
> {
  const month = monthStartOf(args.month);
  if (!month) return { ok: false, error: "Mes no válido." };
  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  const existing = await listFixedCosts(
    ctx.supabase,
    ctx.companyId,
    month,
    args.locationId
  );
  const byCategory = new Map(existing.map((l) => [l.category, l]));
  const logs: Parameters<typeof writeLog>[1] = [];

  for (const entry of args.entries) {
    const prev = byCategory.get(entry.category);
    const empty =
      entry.value === null || entry.value === undefined || entry.value === "";
    if (empty) {
      if (!prev?.id) continue;
      const { error } = await ctx.supabase
        .from("restaurant_fixed_costs")
        .delete()
        .eq("company_id", ctx.companyId)
        .eq("id", prev.id);
      if (error) return { ok: false, error: error.message };
      logs.push({
        fixed_cost_id: prev.id,
        location_id: args.locationId,
        month,
        category: entry.category,
        action: "delete",
        old_value: valueOf(prev),
        new_value: null,
        source: "manual",
      });
      continue;
    }
    const checked = validateLine({
      location_id: args.locationId,
      month,
      category: entry.category,
      label: entry.label,
      value: entry.value,
      repeats: entry.repeats,
      split_rule: entry.split_rule,
    });
    if (!checked.ok) return { ok: false, error: checked.error };
    const v = checked.value;
    const unchanged =
      prev &&
      prev.amount === v.amount &&
      prev.pct_of_sales === v.pct_of_sales &&
      prev.repeats === v.repeats &&
      prev.split_rule === v.split_rule &&
      (prev.label ?? null) === v.label;
    if (unchanged) continue;
    const row = {
      company_id: ctx.companyId,
      location_id: v.location_id,
      month: v.month,
      category: v.category,
      label: v.label,
      amount: v.amount,
      pct_of_sales: v.pct_of_sales,
      currency,
      source: "manual" as const,
      status: "confirmed" as const,
      repeats: v.repeats,
      split_rule: v.split_rule,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    };
    const result = prev?.id
      ? await ctx.supabase
          .from("restaurant_fixed_costs")
          .update(row)
          .eq("company_id", ctx.companyId)
          .eq("id", prev.id)
          .select("id")
          .single()
      : await ctx.supabase
          .from("restaurant_fixed_costs")
          .insert({ ...row, created_by: ctx.userId })
          .select("id")
          .single();
    if (result.error) return { ok: false, error: result.error.message };
    logs.push({
      fixed_cost_id: (result.data as { id: string }).id,
      location_id: args.locationId,
      month,
      category: v.category,
      action: prev ? "update" : "create",
      old_value: valueOf(prev),
      new_value: { amount: v.amount, pct_of_sales: v.pct_of_sales },
      source: "manual",
    });
  }
  await writeLog(ctx, logs);
  return {
    ok: true,
    lines: await listFixedCosts(
      ctx.supabase,
      ctx.companyId,
      month,
      args.locationId
    ),
  };
}

/**
 * Copies the previous month's `repeats = true` lines into `month`. Idempotent:
 * a (scope, category) that already has a row in `month` is skipped, so running
 * it twice equals running it once and an existing value is never overwritten
 * (the insert also ignores a unique-key conflict from a concurrent run).
 * Returns the lines it created.
 */
export async function repeatFixedCosts(
  ctx: FixedCostsContext,
  monthInput: string
): Promise<FixedCostLine[]> {
  const month = monthStartOf(monthInput);
  if (!month) return [];
  const [source, target] = await Promise.all([
    listMonthLines(ctx, previousMonthStart(month)),
    listMonthLines(ctx, month),
  ]);
  const planned = planRepeat(source, target, month);
  if (planned.length === 0) return [];
  const currency = await resolveCompanyCurrency(ctx.supabase, ctx.companyId);
  // One insert per line: the unique index is on an expression (a NULL
  // location is the group), so PostgREST cannot upsert on it. A unique
  // violation (23505) means the value already exists — keep it, never overwrite.
  const created: FixedCostLine[] = [];
  for (const l of planned) {
    const { data, error } = await ctx.supabase
      .from("restaurant_fixed_costs")
      .insert({
        company_id: ctx.companyId,
        location_id: l.location_id,
        month: l.month,
        category: l.category,
        label: l.label,
        amount: l.amount,
        pct_of_sales: l.pct_of_sales,
        currency,
        source: "repeat",
        status: "confirmed",
        repeats: true,
        split_rule: l.split_rule,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select(LINE_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") continue;
      throw new Error(error.message);
    }
    const line = toLine(data as unknown as LineRow);
    if (line) created.push(line);
  }
  await writeLog(
    ctx,
    created.map((l) => ({
      fixed_cost_id: l.id ?? null,
      location_id: l.location_id,
      month: l.month,
      category: l.category,
      action: "repeat" as const,
      old_value: null,
      new_value: { amount: l.amount, pct_of_sales: l.pct_of_sales },
      source: "repeat" as const,
    }))
  );
  return created;
}

async function listMonthLines(
  ctx: FixedCostsContext,
  month: string
): Promise<FixedCostLine[]> {
  const { data, error } = await ctx.supabase
    .from("restaurant_fixed_costs")
    .select(LINE_COLUMNS)
    .eq("company_id", ctx.companyId)
    .eq("month", month);
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
  new_value: { amount: number | null; pct_of_sales: number | null } | null;
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
async function monthSalesByLocation(
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
 * restaurant add up to the group total to the cent) plus a group Impuestos %.
 */
export async function groupSharesFor(
  supabase: SupabaseClient,
  companyId: string,
  month: string,
  locationId: string,
  restaurantIds: string[]
): Promise<{
  shares: Partial<Record<AmountCategory, number>>;
  impuestosPct: number | null;
}> {
  const groupLines = await listFixedCosts(supabase, companyId, month, null);
  const shares: Partial<Record<AmountCategory, number>> = {};
  let impuestosPct: number | null = null;
  if (groupLines.length === 0 || !restaurantIds.includes(locationId))
    return { shares, impuestosPct };
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
  return { shares, impuestosPct };
}

// ---------------------------------------------------------------------------
// Margin and the view for the tab
// ---------------------------------------------------------------------------

export type MarginRead =
  | { ok: true; margin: MarginInputs }
  | { ok: false; reason: string };

/**
 * Sales and food cost from the existing gross-margin logic
 * (profitability-server): covered dishes only, so a dish with no cost never
 * counts as $0 food cost. No margin → «—» with a reason, never a number.
 */
export async function loadMarginInputs(
  supabase: SupabaseClient,
  companyId: string,
  selected: { locationId: string; brandId: string | null } | null
): Promise<MarginRead> {
  try {
    const data = await fetchProfitabilityData(supabase, companyId, selected);
    const k = data.kpis;
    if (!(k.revenue_with_known_cost > 0))
      return {
        ok: false,
        reason:
          "Aún no hay ventas de platos con costo de ingredientes para calcular el margen.",
      };
    return {
      ok: true,
      margin: { sales: k.revenue_with_known_cost, foodCost: k.estimated_cogs },
    };
  } catch (err) {
    console.error("[fixed-costs] margin load failed:", err);
    return { ok: false, reason: "No se pudo leer el margen en este momento." };
  }
}

export interface FixedCostsView {
  month: string;
  currency: string;
  /** null = the group lines. */
  locationId: string | null;
  lines: FixedCostLine[];
  /** This restaurant's share of the group lines (restaurant scope only). */
  groupShares: Partial<Record<AmountCategory, number>>;
  groupImpuestosPct: number | null;
  costs: EffectiveFixedCosts;
  completeness: FixedCostCompleteness;
  openDays: number;
  margin: MarginInputs | null;
  marginReason: string | null;
  /** null = no number (a category is missing, or no margin). */
  breakEven: number | null;
}

export async function loadFixedCostsView(
  ctx: FixedCostsContext,
  args: {
    month: string;
    locationId: string | null;
    brandId: string | null;
    restaurantIds: string[];
  }
): Promise<FixedCostsView> {
  const { supabase, companyId } = ctx;
  const [currency, lines, shiftRows, marginRead, group] = await Promise.all([
    resolveCompanyCurrency(supabase, companyId),
    listFixedCosts(supabase, companyId, args.month, args.locationId),
    args.locationId
      ? supabase
          .from("restaurant_shifts")
          .select("weekdays, active")
          .eq("company_id", companyId)
          .eq("restaurant_id", args.locationId)
      : Promise.resolve({ data: null }),
    loadMarginInputs(
      supabase,
      companyId,
      args.locationId
        ? { locationId: args.locationId, brandId: args.brandId }
        : null
    ),
    args.locationId
      ? groupSharesFor(
          supabase,
          companyId,
          args.month,
          args.locationId,
          args.restaurantIds
        )
      : Promise.resolve({ shares: {}, impuestosPct: null }),
  ]);
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
  const costs = effectiveFixedCosts(lines, group.shares, group.impuestosPct);
  const margin = marginRead.ok ? marginRead.margin : null;
  return {
    month: args.month,
    currency,
    locationId: args.locationId,
    lines,
    groupShares: group.shares,
    groupImpuestosPct: group.impuestosPct,
    costs,
    completeness: fixedCostCompleteness(costs),
    openDays,
    margin,
    marginReason: marginRead.ok ? null : marginRead.reason,
    breakEven: breakEvenPerDay({
      amounts: costs.amounts,
      impuestosPct: costs.impuestosPct,
      margin,
      openDays,
    }),
  };
}
