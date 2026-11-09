// app/api/restaurant/fixed-costs/copy/route.ts
//
// Explicit copy between months (replaces the render-time «repeat»).
//
// GET  ?month=YYYY-MM[&from=YYYY-MM][&location=<uuid>]
//        → the PREVIEW of copying `from` (default: the month before) into
//          `month`. Pure read: it never writes, however often it is called.
// POST { month, from?, location_id?, categories: [..], decisions?: {cat:
//        "replace"|"skip"}, expected: {"<destination key>": version},
//        commandKey } → { status, copied } or 409 { conflicts } /
//        409 { error, stale: true }. One transaction in the database.
//
// Only owner, admin and manager (costs.fixed). The company comes from the
// session; the database re-checks the writer role of both months and scopes.

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import {
  copyMonth,
  previewCopy,
  type CommandFailure,
} from "@/lib/restaurant/fixed-cost-commands";
import {
  isFixedCostCategory,
  monthStartOf,
  previousMonthStart,
  type FixedCostCategory,
} from "@/lib/restaurant/fixed-costs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<CommandFailure, number> = {
  stale: 409,
  conflict: 409,
  busy: 503,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  failed: 500,
};

type Auth = Extract<
  Awaited<ReturnType<typeof authorizeFixedCosts>>,
  { ok: true }
>;
type Gate =
  | { response: NextResponse; dict?: undefined; auth?: undefined }
  | {
      response?: undefined;
      dict: ReturnType<typeof getDictionary>;
      auth: Auth;
    };

async function gate(): Promise<Gate> {
  const lang = await apiLanguage();
  const dict = getDictionary(lang);
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return { response: auth.response };
  const denied = requireCapability(auth.actor, "costs.fixed", {
    message: dict.costs.fixed.roleDenied,
  });
  if (denied) return { response: denied };
  return { dict, auth };
}

async function scope(
  auth: Extract<Awaited<ReturnType<typeof authorizeFixedCosts>>, { ok: true }>,
  wanted: string | null
): Promise<{ ok: true; locationId: string | null } | { ok: false }> {
  if (!wanted) return { ok: true, locationId: null };
  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    wanted
  );
  return context.selected
    ? { ok: true, locationId: context.selected.locationId }
    : { ok: false };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await gate();
  if (g.response) return g.response;
  const { dict, auth } = g;
  const to = monthStartOf(req.nextUrl.searchParams.get("month") ?? "");
  if (!to)
    return NextResponse.json(
      { error: dict.costs.fixedErrors.month },
      { status: 400 }
    );
  const from =
    monthStartOf(req.nextUrl.searchParams.get("from") ?? "") ??
    previousMonthStart(to);
  const sc = await scope(auth, req.nextUrl.searchParams.get("location"));
  if (!sc.ok)
    return NextResponse.json(
      { error: dict.costs.fixedErrors.restaurant },
      { status: 400 }
    );
  const preview = await previewCopy(
    {
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
    },
    { from, to, locationId: sc.locationId }
  );
  if (!preview.ok)
    return NextResponse.json(
      {
        error:
          preview.failure === "forbidden"
            ? dict.costs.fixed.roleDenied
            : dict.costs.fixedErrors.readFailed,
      },
      { status: STATUS[preview.failure] }
    );
  return NextResponse.json(preview.value);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await gate();
  if (g.response) return g.response;
  const { dict, auth } = g;
  const fe = dict.costs.fixedErrors;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = typeof body.month === "string" ? monthStartOf(body.month) : null;
  if (!to) return NextResponse.json({ error: fe.month }, { status: 400 });
  const from =
    (typeof body.from === "string" ? monthStartOf(body.from) : null) ??
    previousMonthStart(to);
  const categories = (Array.isArray(body.categories) ? body.categories : [])
    .filter(isFixedCostCategory)
    .slice(0, 5) as FixedCostCategory[];
  if (categories.length === 0 || typeof body.commandKey !== "string")
    return NextResponse.json({ error: fe.invalidBody }, { status: 400 });
  const sc = await scope(
    auth,
    typeof body.location_id === "string" ? body.location_id : null
  );
  if (!sc.ok)
    return NextResponse.json({ error: fe.restaurant }, { status: 400 });
  const expected: Record<string, number> = {};
  for (const [k, v] of Object.entries(
    (body.expected as Record<string, unknown>) ?? {}
  ))
    if (typeof v === "number" && Number.isInteger(v)) expected[k] = v;
  const decisions: Partial<Record<FixedCostCategory, "replace" | "skip">> = {};
  for (const [k, v] of Object.entries(
    (body.decisions as Record<string, unknown>) ?? {}
  ))
    if (isFixedCostCategory(k) && (v === "replace" || v === "skip"))
      decisions[k] = v;

  const res = await copyMonth(
    {
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
    },
    {
      commandKey: body.commandKey,
      from,
      to,
      locationId: sc.locationId,
      categories,
      decisions,
      expected,
    }
  );
  if (!res.ok) {
    const error =
      res.failure === "forbidden"
        ? dict.costs.fixed.roleDenied
        : res.failure === "stale"
          ? dict.costs.fixed.staleReload
          : fe.saveFailed;
    return NextResponse.json(
      { error, stale: res.failure === "stale" || undefined },
      { status: STATUS[res.failure] }
    );
  }
  if (res.value.status === "needs_decision")
    return NextResponse.json(
      { conflicts: res.value.conflicts },
      { status: 409 }
    );
  return NextResponse.json(res.value);
}
