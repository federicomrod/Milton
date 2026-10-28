// app/api/restaurant/fixed-costs/route.ts
//
// GET  /api/restaurant/fixed-costs?month=YYYY-MM[&location=<uuid>]
//        → the month's view of one restaurant (or the group lines when no
//          location): lines, group shares, completeness, break-even.
// PUT  /api/restaurant/fixed-costs
//        { month, location_id: uuid | null, entries: [{ category, value,
//          label?, repeats?, split_rule? }] } → { lines }
//        A value (a typed 0 included) is stored; an empty value removes the
//        line. Impuestos stores a % of sales, the rest an amount.
//
// Auth: signed-in owner, admin or manager (costs.fixed). The company is
// resolved from the user, never taken from the client; the location must
// belong to that company.

import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import {
  loadFixedCostsView,
  saveFixedCosts,
  type SaveEntry,
} from "@/lib/restaurant/fixed-costs-server";
import {
  isFixedCostCategory,
  monthStartOf,
} from "@/lib/restaurant/fixed-costs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed");
  if (denied) return denied;
  const month = monthStartOf(req.nextUrl.searchParams.get("month") ?? "");
  if (!month)
    return NextResponse.json({ error: "Mes no válido." }, { status: 400 });
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
      }
    );
    return NextResponse.json(view);
  } catch (err) {
    console.error("[fixed-costs] GET failed:", err);
    return NextResponse.json(
      { error: "No se pudieron leer los costos fijos." },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed");
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 });
  }
  const month =
    typeof body.month === "string" ? monthStartOf(body.month) : null;
  if (!month)
    return NextResponse.json({ error: "Mes no válido." }, { status: 400 });
  if (!Array.isArray(body.entries))
    return NextResponse.json({ error: "Faltan los costos." }, { status: 400 });

  let locationId: string | null = null;
  if (body.location_id) {
    const context = await resolveRestaurantContext(
      auth.supabase,
      auth.companyId,
      String(body.location_id)
    );
    if (!context.selected)
      return NextResponse.json(
        { error: "Restaurante no válido." },
        { status: 400 }
      );
    locationId = context.selected.locationId;
  }

  const entries: SaveEntry[] = [];
  for (const raw of body.entries as Array<Record<string, unknown>>) {
    if (!raw || !isFixedCostCategory(raw.category))
      return NextResponse.json(
        { error: "Categoría no válida." },
        { status: 400 }
      );
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
      { month, locationId, entries }
    );
    if (!saved.ok)
      return NextResponse.json({ error: saved.error }, { status: 400 });
    return NextResponse.json({ lines: saved.lines });
  } catch (err) {
    console.error("[fixed-costs] PUT failed:", err);
    return NextResponse.json(
      { error: "No se pudieron guardar los costos fijos." },
      { status: 500 }
    );
  }
}
