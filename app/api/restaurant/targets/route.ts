// app/api/restaurant/targets/route.ts
//
// GET  /api/restaurant/targets        → { targets: { revenue?, orders?, units_sold?, avg_ticket? } }
// POST /api/restaurant/targets        → upsert one or more daily targets
//
// Body shapes accepted on POST:
//   { metric_key: "revenue", target_value: 20000 }                 // single
//   { targets: { revenue: 20000, orders: 50, ... } }               // batch
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
  const targets = await getRestaurantKpiTargets(auth.supabase, auth.companyId);
  return NextResponse.json({ targets, company_id: auth.companyId });
}

interface BatchBody {
  targets?: Partial<Record<TargetMetricKey, number | null | "">>;
  metric_key?: string;
  target_value?: number;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: BatchBody;
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

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
  const updated: TargetMap = {};
  try {
    for (const op of ops) {
      const row = await upsertRestaurantKpiTarget(auth.supabase, {
        company_id: auth.companyId,
        metric_key: op.metric_key,
        target_value: op.target_value,
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
