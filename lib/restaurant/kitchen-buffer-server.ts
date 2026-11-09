// lib/restaurant/kitchen-buffer-server.ts
//
// «Merma de cocina» (kitchen buffer) of each restaurant: what Costos shows and
// the one write path. The value is a history (kitchen_buffer_settings,
// migration 075): the row with the latest effective_from <= the date. With no
// row in force the read-time default applies (lib/restaurant/yield-buffer.ts);
// this file never inserts a row to express a default.
//
// History is APPEND-ONLY (#406): nothing is ever updated or deleted. The value
// on a date is the most recently created row with effective_from <= that date.
//   «Solo desde hoy»            a row with effective_from = today. Past months
//                               keep the value they had.
//   «También meses anteriores»  a row with effective_from = the restaurant's
//                               first data date: being the newest row, it wins
//                               for every date, so the past months now read
//                               the new value. A later «desde hoy» row wins
//                               from its own date.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBusinessDayConfig } from "@/lib/restaurant/business-day-server";
import { cutoffFor } from "@/lib/restaurant/business-day";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { businessToday } from "@/lib/restaurant/rentabilidad";
import { loadSalesDetailCached } from "@/lib/restaurant/sales-detail-server";
import {
  MAX_BUFFER_PCT,
  MAX_YIELD_LOSS_PCT,
  buildHistory,
  defaultBufferPct,
  loadResolvedBufferAt,
  type HistoryEntry,
  type ResolvedBuffer,
} from "@/lib/restaurant/yield-buffer";
import { createAdminClient } from "@/lib/supabase/admin";

export type BufferScope = "today" | "all";

export interface RestaurantBuffer extends ResolvedBuffer {
  locationId: string;
  name: string;
}

/** The restaurant's business date today. */
export async function loadBusinessToday(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  now: Date = new Date()
): Promise<string> {
  const [timezone, config] = await Promise.all([
    resolvePosTimezone(supabase, companyId),
    loadBusinessDayConfig(supabase, companyId),
  ]);
  return businessToday(now, timezone, cutoffFor(config, locationId));
}

/** The first date the restaurant has sales for; null when it has none yet. */
export async function loadFirstDataDate(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string
): Promise<string | null> {
  const { cube } = await loadSalesDetailCached(supabase, companyId, locationId);
  const dates = cube.dates.filter((d): d is string => typeof d === "string");
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Each restaurant's buffer on `today`, saved or default. */
export async function loadRestaurantBuffers(
  supabase: SupabaseClient,
  companyId: string,
  locations: ReadonlyArray<{ id: string; name: string }>,
  today: string
): Promise<RestaurantBuffer[]> {
  return Promise.all(
    locations.map(async (l) => ({
      locationId: l.id,
      name: l.name,
      ...(await loadResolvedBufferAt(supabase, companyId, l.id, today)),
    }))
  );
}

export function isValidBufferPct(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_BUFFER_PCT
  );
}

export type SaveBufferResult =
  | { ok: true; effectiveFrom: string }
  | { ok: false; error: "invalid" | "write_failed"; message?: string };

/**
 * Writes the new buffer. The caller has already checked the capability
 * (costs.buffer) and that `locationId` belongs to the company; the database
 * checks both again (RLS, migration 075).
 */
export async function saveKitchenBuffer(args: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  locationId: string;
  bufferPct: number;
  scope: BufferScope;
  /** The restaurant's business date today (YYYY-MM-DD). */
  today: string;
  /** The restaurant's first data date; null when it has no data yet. */
  firstDataDate: string | null;
}): Promise<SaveBufferResult> {
  const { supabase, companyId, locationId, today, scope } = args;
  if (!isValidBufferPct(args.bufferPct)) return { ok: false, error: "invalid" };
  const effectiveFrom =
    scope === "all" && args.firstDataDate && args.firstDataDate < today
      ? args.firstDataDate
      : today;
  const ins = await supabase
    .from("kitchen_buffer_settings")
    .insert({
      company_id: companyId,
      location_id: locationId,
      buffer_pct: args.bufferPct,
      effective_from: effectiveFrom,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data)
    return { ok: false, error: "write_failed", message: ins.error?.message };
  return { ok: true, effectiveFrom };
}

// ---------------------------------------------------------------------------
// Ingredient yield (Merma): same two choices, same append-only history.
// ---------------------------------------------------------------------------

export function isValidYieldLossPct(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= 0 &&
    v <= MAX_YIELD_LOSS_PCT
  );
}

/** The first date the company has sales for (any restaurant); null when none. */
export async function loadCompanyFirstDataDate(
  supabase: SupabaseClient,
  companyId: string,
  locationIds: readonly string[]
): Promise<string | null> {
  const all = await Promise.all(
    locationIds.map((id) => loadFirstDataDate(supabase, companyId, id))
  );
  const dates = all.filter((d): d is string => !!d);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/**
 * Writes an APPROVED yield row for one ingredient (0 <= loss < 100). The
 * caller has checked the capability and that the ingredient is the company's;
 * RLS checks both again (075).
 */
export async function saveIngredientYield(args: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  ingredientId: string;
  lossPct: number;
  scope: BufferScope;
  today: string;
  firstDataDate: string | null;
}): Promise<SaveBufferResult> {
  if (!isValidYieldLossPct(args.lossPct))
    return { ok: false, error: "invalid" };
  const effectiveFrom =
    args.scope === "all" &&
    args.firstDataDate &&
    args.firstDataDate < args.today
      ? args.firstDataDate
      : args.today;
  const ins = await args.supabase
    .from("ingredient_yields")
    .insert({
      company_id: args.companyId,
      ingredient_id: args.ingredientId,
      loss_pct: args.lossPct,
      source: "manual",
      status: "approved",
      effective_from: effectiveFrom,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data)
    return { ok: false, error: "write_failed", message: ins.error?.message };
  return { ok: true, effectiveFrom };
}

// ---------------------------------------------------------------------------
// History for the UI: who, old → new, «desde hoy» / «retroactivo».
// ---------------------------------------------------------------------------

export interface HistoryLine extends Omit<HistoryEntry, "userId"> {
  /** Display name; null for Milton support (never sent) or an unknown user. */
  who: string | null;
  /** A Milton support / staff member: the UI says «Equipo Milton». */
  isSupport: boolean;
}

/** Who made each change, from the rows' created_by, with the admin client. */
export async function nameHistory(
  companyId: string,
  entries: readonly HistoryEntry[]
): Promise<HistoryLine[]> {
  const ids = [
    ...new Set(entries.map((e) => e.userId).filter((u): u is string => !!u)),
  ];
  const names = new Map<string, string | null>();
  const support = new Set<string>();
  if (ids.length) {
    const admin = createAdminClient();
    try {
      const [members, staff] = await Promise.all([
        admin
          .from("company_memberships")
          .select("user_id, is_support")
          .eq("company_id", companyId)
          .in("user_id", ids),
        admin.from("milton_admins").select("user_id").in("user_id", ids),
      ]);
      for (const m of (members.data ?? []) as Array<{
        user_id: string;
        is_support?: boolean | null;
      }>)
        if (m.is_support === true) support.add(m.user_id);
      for (const a of (staff.data ?? []) as Array<{ user_id: string }>)
        support.add(a.user_id);
    } catch {
      // Names are decoration: a failed read shows the rows without them.
    }
    await Promise.all(
      ids
        .filter((id) => !support.has(id))
        .map(async (id) => {
          try {
            const { data } = await admin.auth.admin.getUserById(id);
            const u = data?.user;
            const pick = (v: unknown) =>
              typeof v === "string" && v.trim() ? v.trim() : null;
            names.set(
              id,
              pick(u?.user_metadata?.full_name) ??
                pick(u?.user_metadata?.name) ??
                pick(u?.email)
            );
          } catch {
            names.set(id, null);
          }
        })
    );
  }
  return entries.map(({ userId, ...rest }) => ({
    ...rest,
    isSupport: userId !== null && support.has(userId),
    who: userId && !support.has(userId) ? (names.get(userId) ?? null) : null,
  }));
}

/** The kitchen-buffer history of one restaurant (default included as «old»). */
export async function loadBufferHistory(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string
): Promise<HistoryLine[]> {
  const { data } = await supabase
    .from("kitchen_buffer_settings")
    .select("id, buffer_pct, effective_from, created_at, created_by")
    .eq("company_id", companyId)
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (
    (data ?? []) as Array<{
      id: string;
      buffer_pct: number;
      effective_from: string;
      created_at: string;
      created_by: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    pct: Number(r.buffer_pct),
    effective_from: r.effective_from,
    created_at: r.created_at,
    created_by: r.created_by,
  }));
  return nameHistory(companyId, buildHistory(rows, defaultBufferPct));
}

/** The yield histories of the company's ingredients (approved rows), by ingredient id. */
export async function loadYieldHistories(
  supabase: SupabaseClient,
  companyId: string
): Promise<Map<string, HistoryLine[]>> {
  const { data } = await supabase
    .from("ingredient_yields")
    .select(
      "id, ingredient_id, loss_pct, effective_from, created_at, created_by"
    )
    .eq("company_id", companyId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(5000);
  const byIngredient = new Map<
    string,
    Array<{
      id: string;
      pct: number;
      effective_from: string;
      created_at: string;
      created_by: string | null;
    }>
  >();
  for (const r of (data ?? []) as Array<{
    id: string;
    ingredient_id: string;
    loss_pct: number;
    effective_from: string;
    created_at: string;
    created_by: string | null;
  }>) {
    const list = byIngredient.get(r.ingredient_id) ?? [];
    list.push({
      id: r.id,
      pct: Number(r.loss_pct),
      effective_from: r.effective_from,
      created_at: r.created_at,
      created_by: r.created_by,
    });
    byIngredient.set(r.ingredient_id, list);
  }
  const entries = new Map<string, HistoryEntry[]>();
  for (const [id, rows] of byIngredient) entries.set(id, buildHistory(rows));
  const all = [...entries.values()].flat();
  const named = await nameHistory(companyId, all);
  const byId = new Map(named.map((n) => [n.id, n]));
  const out = new Map<string, HistoryLine[]>();
  for (const [ingredientId, list] of entries)
    out.set(
      ingredientId,
      list.map((e) => byId.get(e.id)!)
    );
  return out;
}
