// app/api/restaurant/targets/route.ts
//
// GET  /api/restaurant/targets
//        → { targets: { revenue?, orders?, units_sold?, avg_ticket? },   // daily, whole company (Ventas lines)
//            rows, available, default_comparison }                       // Objetivos (migration 052)
// POST /api/restaurant/targets
//
// Body shapes accepted on POST:
//   { version: 2, location_id: uuid | null,                       // Configuración › Objetivos
//     revenue_monthly?, food_cost_pct?, gross_margin_pct?, avg_ticket?: number | null,
//     weekday_weights?: number[7] | null, default_comparison?: string }
//     (a number sets the target from the first day of this month; null clears it from then on;
//      saved in ONE transaction by kpi_targets_save, migration 052)
//   { metric_key: "revenue", target_value: 20000 }                 // single (old, daily)
//   { targets: { revenue: 20000, orders: 50, ... } }               // batch (old, daily)
//
// Auth: requires an authenticated Supabase user; the company is resolved
// from the user via the same four-step fallback chain as the POS upload
// route. We never accept a `company_id` from the client — that would be a
// trivial tenancy bypass.
//
// RLS does the heavy lifting: even if the resolved company_id were wrong,
// the row-level policies on restaurant_kpi_targets would refuse the write.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  getRestaurantKpiTargets,
  upsertRestaurantKpiTarget,
  TARGET_METRIC_KEYS,
  type TargetMetricKey,
  type TargetMap,
} from "@/lib/restaurant/supabase-targets";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  loadDefaultComparison,
  loadTargetsConfig,
} from "@/lib/restaurant/supabase-targets";
import { monthStartOf, roundWeights } from "@/lib/restaurant/objetivos";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { COMPARISONS } from "@/lib/restaurant/cockpit-comparison";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolves auth + company. Returns either {supabase, companyId} or an
 *  early NextResponse with the appropriate error status. */
async function authAndCompany(): Promise<
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      companyId: string;
    }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const companyId = await resolveCompanyIdForUser(supabase, user.id);
  if (!companyId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No company resolved for user", user_id: user.id },
        { status: 404 }
      ),
    };
  }
  return { ok: true, supabase, companyId };
}

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const [targets, config, defaultComparison] = await Promise.all([
    getRestaurantKpiTargets(auth.supabase, auth.companyId),
    loadTargetsConfig(auth.supabase, auth.companyId),
    loadDefaultComparison(auth.supabase, auth.companyId),
  ]);
  return NextResponse.json({
    targets,
    rows: config.rows,
    available: config.available,
    default_comparison: defaultComparison,
    company_id: auth.companyId,
  });
}

interface FormBody {
  version?: number;
  location_id?: string | null;
  revenue_monthly?: number | null;
  food_cost_pct?: number | null;
  gross_margin_pct?: number | null;
  avg_ticket?: number | null;
  weekday_weights?: number[] | null;
  default_comparison?: string;
  /** First of a month, or 1900-01-01 («desde siempre»). Default: the first of this month. */
  effective_from?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Objetivos: one transaction in the database (kpi_targets_save, 052). */
async function saveForm(
  auth: {
    supabase: Awaited<ReturnType<typeof createClient>>;
    companyId: string;
  },
  body: FormBody
) {
  const location =
    typeof body.location_id === "string" && UUID.test(body.location_id)
      ? body.location_id
      : body.location_id == null
        ? null
        : undefined;
  if (location === undefined) {
    return NextResponse.json(
      { error: "Restaurante no válido." },
      { status: 400 }
    );
  }
  const rows: Array<{
    metric_key: string;
    target_period: string;
    target_value: number | null;
  }> = [];
  const add = (
    key: keyof FormBody,
    metric: string,
    period: string,
    max: number
  ) => {
    const v = body[key];
    if (v === undefined) return null;
    if (v === null) {
      rows.push({
        metric_key: metric,
        target_period: period,
        target_value: null,
      });
      return null;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) {
      return NextResponse.json(
        { error: `Valor no válido para ${metric}.` },
        { status: 400 }
      );
    }
    rows.push({ metric_key: metric, target_period: period, target_value: v });
    return null;
  };
  for (const bad of [
    add("revenue_monthly", "revenue", "monthly", 1e9),
    add("food_cost_pct", "food_cost_pct", "monthly", 100),
    add("gross_margin_pct", "gross_margin_pct", "monthly", 100),
    add("avg_ticket", "avg_ticket", "monthly", 1e6),
  ]) {
    if (bad) return bad;
  }
  if (rows.length === 0 && body.default_comparison === undefined) {
    return NextResponse.json(
      { error: "No hay nada que guardar." },
      { status: 400 }
    );
  }
  if (
    body.default_comparison !== undefined &&
    !COMPARISONS.includes(body.default_comparison as never)
  ) {
    return NextResponse.json(
      { error: "Comparación no válida." },
      { status: 400 }
    );
  }
  let weights: number[] | null = null;
  if (Array.isArray(body.weekday_weights)) {
    const w = body.weekday_weights.map(Number);
    if (w.length !== 7 || w.some((x) => !Number.isFinite(x) || x < 0)) {
      return NextResponse.json(
        { error: "El reparto por día no es válido." },
        { status: 400 }
      );
    }
    const total = w.reduce((a, b) => a + b, 0);
    if (!(total > 0)) {
      return NextResponse.json(
        { error: "El reparto por día no es válido." },
        { status: 400 }
      );
    }
    weights = roundWeights(w.map((x) => x / total));
  }
  const [timezone, currency] = await Promise.all([
    resolvePosTimezone(auth.supabase, auth.companyId),
    resolveCompanyCurrency(auth.supabase, auth.companyId),
  ]);
  // A target applies from the first day of a month: earlier months keep theirs.
  // The form offers a few starts (the month of the latest data, this month,
  // the first month of data, always); the default is this month.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date()
  );
  let effectiveFrom = monthStartOf(today);
  if (body.effective_from !== undefined) {
    const f = body.effective_from;
    const ok =
      typeof f === "string" &&
      /^\d{4}-\d{2}-01$/.test(f) &&
      f >= "2000-01-01" &&
      f <= today;
    if (!(ok || f === "1900-01-01")) {
      return NextResponse.json(
        { error: "La fecha «Vigente desde» no es válida." },
        { status: 400 }
      );
    }
    effectiveFrom = f as string;
  }
  const { data, error } = await auth.supabase.rpc("kpi_targets_save", {
    p_company_id: auth.companyId,
    p_location_id: location,
    p_effective_from: effectiveFrom,
    p_rows: rows,
    p_weekday_weights: weights,
    p_default_comparison: body.default_comparison ?? null,
    p_currency: currency,
  });
  if (error) {
    const code = error.code;
    if (
      code === "PGRST202" ||
      code === "42883" ||
      code === "42703" ||
      code === "42P01"
    ) {
      return NextResponse.json(
        {
          unavailable: true,
          error: "Falta aplicar la migración 052 en este ambiente.",
        },
        { status: 409 }
      );
    }
    if (code === "42501") {
      return NextResponse.json(
        { error: "No tienes permiso para cambiar los objetivos." },
        { status: 403 }
      );
    }
    if (code === "22023") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[targets POST] save failed:", error.message);
    return NextResponse.json(
      { error: "No pude guardar los objetivos." },
      { status: 500 }
    );
  }
  const config = await loadTargetsConfig(auth.supabase, auth.companyId);
  return NextResponse.json({
    ok: true,
    saved: (data as { saved?: number } | null)?.saved ?? rows.length,
    effective_from: effectiveFrom,
    rows: config.rows,
  });
}

interface BatchBody {
  targets?: Partial<Record<TargetMetricKey, number | null | "">>;
  metric_key?: string;
  target_value?: number;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: BatchBody & FormBody;
  try {
    body = (await req.json()) as BatchBody & FormBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (body.version === 2) return saveForm(auth, body);

  // Normalize the input into a flat list of { metric_key, target_value }
  // operations. We accept both the single-row shape and the batch shape.
  const ops: { metric_key: TargetMetricKey; target_value: number }[] = [];

  if (body.targets && typeof body.targets === "object") {
    for (const [k, v] of Object.entries(body.targets)) {
      if (!TARGET_METRIC_KEYS.includes(k as TargetMetricKey)) {
        return NextResponse.json(
          { error: `Unknown metric_key: ${k}` },
          { status: 400 }
        );
      }
      if (v === null || v === undefined || v === "") {
        // Skipping null lets the client send a partial update without
        // clearing existing targets it didn't touch. Use a separate
        // "deactivate" endpoint (not in this milestone) to truly remove
        // a target.
        continue;
      }
      const num = Number(v);
      if (!Number.isFinite(num) || num < 0) {
        return NextResponse.json(
          {
            error: `Invalid target_value for ${k}: must be a non-negative number`,
          },
          { status: 400 }
        );
      }
      ops.push({ metric_key: k as TargetMetricKey, target_value: num });
    }
  } else if (body.metric_key) {
    if (!TARGET_METRIC_KEYS.includes(body.metric_key as TargetMetricKey)) {
      return NextResponse.json(
        { error: `Unknown metric_key: ${body.metric_key}` },
        { status: 400 }
      );
    }
    if (
      typeof body.target_value !== "number" ||
      !Number.isFinite(body.target_value) ||
      body.target_value < 0
    ) {
      return NextResponse.json(
        { error: "Invalid target_value: must be a non-negative number" },
        { status: 400 }
      );
    }
    ops.push({
      metric_key: body.metric_key as TargetMetricKey,
      target_value: body.target_value,
    });
  } else {
    return NextResponse.json(
      {
        error:
          "Provide either `{targets: {...}}` or `{metric_key, target_value}`",
      },
      { status: 400 }
    );
  }

  if (ops.length === 0) {
    return NextResponse.json(
      { error: "No targets provided to update" },
      { status: 400 }
    );
  }

  // Sequential upserts. The set is at most 4 rows, so simplicity wins over
  // batching gymnastics. First failure short-circuits so the client gets a
  // clear error instead of a partial-success surprise.
  const companyCurrency = await resolveCompanyCurrency(
    auth.supabase,
    auth.companyId
  );
  const updated: TargetMap = {};
  try {
    for (const op of ops) {
      const row = await upsertRestaurantKpiTarget(auth.supabase, {
        company_id: auth.companyId,
        metric_key: op.metric_key,
        target_value: op.target_value,
        currency: companyCurrency,
      });
      updated[row.metric_key] = Number(row.target_value);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[targets POST] upsert failed:", message);
    return NextResponse.json(
      { error: "Upsert failed", details: message },
      { status: 500 }
    );
  }

  // Return the full resolved target set so the client can update its
  // local state in one pass instead of merging diffs.
  const full = await getRestaurantKpiTargets(auth.supabase, auth.companyId);
  return NextResponse.json({ targets: full, updated });
}
