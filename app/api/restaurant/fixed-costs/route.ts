// app/api/restaurant/fixed-costs/route.ts
//
// GET  /api/restaurant/fixed-costs?month=YYYY-MM[&location=<uuid>]
//        → the month's view of one restaurant (or the group lines when no
//          location): lines, group shares, completeness, break-even.
// PUT  /api/restaurant/fixed-costs
//        { month, location_id: uuid | null, entries: [{ category, value,
//          label?, repeats?, split_rule? }] } → { lines }
//        A value (a typed 0 included) is stored; an empty value removes the
//        line. Impuestos stores a tax rate (in pct_of_sales), the rest an amount.
//
// Auth: signed-in owner, admin or manager (costs.fixed). The company is
// resolved from the user, never taken from the client; the location must
// belong to that company.

import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import {
  loadFixedCostsView,
  saveFixedCosts,
  type SaveEntry,
} from "@/lib/restaurant/fixed-costs-server";
import { loadMonthMargin } from "@/lib/restaurant/rentabilidad-server";
import {
  isFixedCostCategory,
  isRlsDenied,
  monthStartOf,
} from "@/lib/restaurant/fixed-costs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const lang = await apiLanguage();
  const fe = getDictionary(lang).costs.fixedErrors;
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed", {
    message: getDictionary(lang).costs.fixed.roleDenied,
  });
  if (denied) return denied;
  const month = monthStartOf(req.nextUrl.searchParams.get("month") ?? "");
  if (!month) return NextResponse.json({ error: fe.month }, { status: 400 });
  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    req.nextUrl.searchParams.get("location")
  );
  try {
    const view = await loadFixedCostsView(
      {
        supabase: auth.supabase,
        companyId: auth.companyId,
        userId: auth.userId,
      },
      {
        month,
        locationId: context.selected?.locationId ?? null,
        brandId: context.selected?.brandId ?? null,
        restaurantIds: context.locations.map((l) => l.id),
        marginRead: await loadMonthMargin({
          supabase: auth.supabase,
          companyId: auth.companyId,
          locationId: context.selected?.locationId ?? null,
          restaurantIds: context.locations.map((l) => l.id),
          month,
          lang,
        }),
      }
    );
    return NextResponse.json(view);
  } catch (err) {
    console.error("[fixed-costs] GET failed:", err);
    return NextResponse.json({ error: fe.readFailed }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const lang = await apiLanguage();
  const fe = getDictionary(lang).costs.fixedErrors;
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed", {
    message: getDictionary(lang).costs.fixed.roleDenied,
  });
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: fe.invalidBody }, { status: 400 });
  }
  const month =
    typeof body.month === "string" ? monthStartOf(body.month) : null;
  if (!month) return NextResponse.json({ error: fe.month }, { status: 400 });
  if (!Array.isArray(body.entries))
    return NextResponse.json({ error: fe.missingEntries }, { status: 400 });

  let locationId: string | null = null;
  if (body.location_id) {
    const context = await resolveRestaurantContext(
      auth.supabase,
      auth.companyId,
      String(body.location_id)
    );
    if (!context.selected)
      return NextResponse.json({ error: fe.restaurant }, { status: 400 });
    locationId = context.selected.locationId;
  }

  const entries: SaveEntry[] = [];
  for (const raw of body.entries as Array<Record<string, unknown>>) {
    if (!raw || !isFixedCostCategory(raw.category))
      return NextResponse.json({ error: fe.category }, { status: 400 });
    entries.push({
      category: raw.category,
      value:
        typeof raw.value === "number" || typeof raw.value === "string"
          ? raw.value
          : null,
      label: typeof raw.label === "string" ? raw.label : null,
      repeats: raw.repeats === true,
      split_rule:
        raw.split_rule === "sales" || raw.split_rule === "equal"
          ? raw.split_rule
          : null,
    });
  }

  try {
    const saved = await saveFixedCosts(
      {
        supabase: auth.supabase,
        companyId: auth.companyId,
        userId: auth.userId,
      },
      { month, locationId, entries, lang }
    );
    if (!saved.ok)
      return NextResponse.json(
        { error: saved.error },
        { status: saved.forbidden ? 403 : 400 }
      );
    return NextResponse.json({ lines: saved.lines });
  } catch (err) {
    if (isRlsDenied(err))
      return NextResponse.json(
        { error: getDictionary(lang).costs.fixed.roleDenied },
        { status: 403 }
      );
    console.error("[fixed-costs] PUT failed:", err);
    return NextResponse.json({ error: fe.saveFailed }, { status: 500 });
  }
}
