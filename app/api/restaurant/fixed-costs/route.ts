// app/api/restaurant/fixed-costs/route.ts
//
// GET  /api/restaurant/fixed-costs?month=YYYY-MM[&location=<uuid>]
//        → the month's view of one restaurant (or the group lines when no
//          location): lines, group shares, completeness, break-even.
// PUT  /api/restaurant/fixed-costs
//        { month, location_id: uuid | null, commandKey, entries: [{ category,
//          value, expectedVersion, label?, repeats?, split_rule?,
//          replaceItems? }] } → { lines, versions }
//        One transaction in the database (migration 079). A value (a typed 0
//        included) is stored; an empty value removes the category. Impuestos
//        stores a tax rate (in pct_of_sales), the rest an amount. A stale
//        expectedVersion is a 409, never a silent overwrite.
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
  listFixedCosts,
  loadFixedCostsView,
} from "@/lib/restaurant/fixed-costs-server";
import {
  saveTotals,
  type CommandFailure,
  type SaveEntry,
} from "@/lib/restaurant/fixed-cost-commands";
import { loadMonthMargin } from "@/lib/restaurant/rentabilidad-server";
import {
  isFixedCostCategory,
  monthStartOf,
} from "@/lib/restaurant/fixed-costs";

const STATUS: Record<CommandFailure, number> = {
  stale: 409,
  conflict: 409,
  busy: 503,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  failed: 500,
};

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

  if (typeof body.commandKey !== "string")
    return NextResponse.json({ error: fe.invalidBody }, { status: 400 });
  const entries: SaveEntry[] = [];
  for (const raw of body.entries as Array<Record<string, unknown>>) {
    if (!raw || !isFixedCostCategory(raw.category))
      return NextResponse.json({ error: fe.category }, { status: 400 });
    const value =
      typeof raw.value === "number"
        ? raw.value
        : typeof raw.value === "string" && raw.value.trim() !== ""
          ? Number(raw.value)
          : null;
    if (value !== null && !Number.isFinite(value))
      return NextResponse.json({ error: fe.negative }, { status: 400 });
    if (
      typeof raw.expectedVersion !== "number" ||
      !Number.isInteger(raw.expectedVersion)
    )
      return NextResponse.json({ error: fe.invalidBody }, { status: 400 });
    entries.push({
      category: raw.category,
      value,
      label: typeof raw.label === "string" ? raw.label : null,
      repeats: raw.repeats === true,
      replaceItems: raw.replaceItems === true,
      expectedVersion: raw.expectedVersion,
      split_rule:
        raw.split_rule === "sales" || raw.split_rule === "equal"
          ? raw.split_rule
          : null,
    });
  }

  const ctx = {
    supabase: auth.supabase,
    companyId: auth.companyId,
    userId: auth.userId,
  };
  try {
    const saved = await saveTotals(ctx, {
      commandKey: body.commandKey,
      month,
      locationId,
      entries,
    });
    if (!saved.ok) {
      const error =
        saved.failure === "forbidden"
          ? getDictionary(lang).costs.fixed.roleDenied
          : saved.failure === "stale"
            ? getDictionary(lang).costs.fixed.staleReload
            : saved.reason === "has_items"
              ? getDictionary(lang).costs.fixed.hasItems
              : fe.saveFailed;
      return NextResponse.json(
        {
          error,
          stale: saved.failure === "stale" || undefined,
          hasItems: saved.reason === "has_items" || undefined,
        },
        { status: STATUS[saved.failure] }
      );
    }
    const lines = await listFixedCosts(
      auth.supabase,
      auth.companyId,
      month,
      locationId
    );
    const versions = Object.fromEntries(
      lines.map((l) => [l.category, l.version ?? 0])
    );
    return NextResponse.json({
      lines,
      versions,
      commandId: saved.value.command_id ?? null,
    });
  } catch (err) {
    console.error("[fixed-costs] PUT failed:", err);
    return NextResponse.json({ error: fe.saveFailed }, { status: 500 });
  }
}
