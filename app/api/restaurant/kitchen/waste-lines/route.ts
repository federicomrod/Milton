// app/api/restaurant/kitchen/waste-lines/route.ts
//
// PATCH /api/restaurant/kitchen/waste-lines
//   { id, action: "confirm", quantity?, unit?, ingredientId? }  or  { id, action: "discard" }
//   A manager confirms (or edits and confirms) a DRAFT waste line from Cocina,
//   or discards it. Only owner, admin and manager (kitchen.drafts) can; the
//   company comes from the session. A confirmed line is valued at the
//   purchase price per as-bought unit on the report's day; with no quantity or no price it stays
//   without a value (counted, «⚑ Falta»), never $0. → { ok }

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  isMissingTable,
  valueIngredientWaste,
} from "@/lib/restaurant/unplanned-waste-server";
import { mapKitchenUnit } from "@/lib/restaurant/kitchen-units";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  const lang = await apiLanguage();
  const w = getDictionary(lang).rentabilidad.waste;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "kitchen.drafts", {
    message: w.roleDenied,
  });
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    action?: unknown;
    quantity?: unknown;
    unit?: unknown;
    ingredientId?: unknown;
  };
  if (
    typeof body.id !== "string" ||
    (body.action !== "confirm" && body.action !== "discard")
  )
    return NextResponse.json({ error: w.invalid }, { status: 400 });

  const { supabase, companyId } = auth;
  const found = await supabase
    .from("kitchen_waste_lines")
    .select(
      "id, status, location_id, ingredient_id, quantity, unit, report_date"
    )
    .eq("id", body.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (found.error)
    return NextResponse.json(
      { error: isMissingTable(found.error) ? w.notFound : w.saveFailed },
      { status: isMissingTable(found.error) ? 404 : 500 }
    );
  if (!found.data)
    return NextResponse.json({ error: w.notFound }, { status: 404 });
  const line = found.data as {
    status: string;
    location_id: string;
    ingredient_id: string | null;
    quantity: number | string | null;
    unit: string | null;
    report_date: string;
  };

  if (body.action === "discard") {
    if (line.status !== "draft")
      return NextResponse.json({ error: w.invalid }, { status: 409 });
    const del = await supabase
      .from("kitchen_waste_lines")
      .delete()
      .eq("id", body.id)
      .eq("company_id", companyId);
    if (del.error)
      return NextResponse.json({ error: w.saveFailed }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (line.status === "confirmed") return NextResponse.json({ ok: true });

  // Edits: the quantity must be a positive number or left empty; the unit one we know.
  let quantity = line.quantity === null ? null : Number(line.quantity);
  if (body.quantity !== undefined) {
    if (body.quantity === null || body.quantity === "") quantity = null;
    else {
      const q = Number(body.quantity);
      if (!Number.isFinite(q) || q <= 0)
        return NextResponse.json({ error: w.invalid }, { status: 400 });
      quantity = q;
    }
  }
  let unit = line.unit;
  if (body.unit !== undefined) {
    unit =
      body.unit === null || body.unit === ""
        ? null
        : mapKitchenUnit(String(body.unit));
    if (body.unit && unit === null)
      return NextResponse.json({ error: w.invalid }, { status: 400 });
  }
  let ingredientId = line.ingredient_id;
  // null clears the ingredient (the line then has no cost: «Sin costo»).
  if (body.ingredientId === null) ingredientId = null;
  else if (typeof body.ingredientId === "string" && body.ingredientId) {
    const ok = await supabase
      .from("ingredients")
      .select("id")
      .eq("id", body.ingredientId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!ok.data)
      return NextResponse.json({ error: w.invalid }, { status: 400 });
    ingredientId = body.ingredientId;
  }

  const valued = ingredientId
    ? await valueIngredientWaste(
        supabase,
        companyId,
        ingredientId,
        line.report_date,
        quantity,
        unit
      ).catch(() => null)
    : null;
  const currency = valued
    ? await resolveCompanyCurrency(supabase, companyId).catch(() => null)
    : null;

  const upd = await supabase
    .from("kitchen_waste_lines")
    .update({
      status: "confirmed",
      quantity,
      unit,
      ingredient_id: ingredientId,
      unit_cost: valued ? valued.unitCost : null,
      value: valued ? Math.round(valued.value * 100) / 100 : null,
      currency,
      confirmed_by: auth.userId,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("company_id", companyId);
  if (upd.error)
    return NextResponse.json({ error: w.saveFailed }, { status: 500 });
  return NextResponse.json({ ok: true });
}
