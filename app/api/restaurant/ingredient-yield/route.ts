// app/api/restaurant/ingredient-yield/route.ts
//
// PUT /api/restaurant/ingredient-yield  { ingredientId, lossPct (0 to < 100), scope: "today" | "all" }
//   «Merma» of one ingredient. Appends an APPROVED yield row (never updates or
//   deletes one). Only owner, admin and manager (and Milton staff); the company
//   comes from the session and the ingredient must be the company's.

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import {
  isValidYieldLossPct,
  loadBusinessToday,
  loadCompanyFirstDataDate,
  saveIngredientYield,
} from "@/lib/restaurant/kitchen-buffer-server";
import { listAllCompanyRestaurants } from "@/lib/restaurant/restaurant-context-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const lang = await apiLanguage();
  const y = getDictionary(lang).menu.screens.ingredientes.yield;
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "ingredients.manage", {
    message: y.roleDenied,
  });
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    ingredientId?: unknown;
    lossPct?: unknown;
    scope?: unknown;
  };
  const scope =
    body.scope === "all" ? "all" : body.scope === "today" ? "today" : null;
  if (
    typeof body.ingredientId !== "string" ||
    !isValidYieldLossPct(body.lossPct) ||
    !scope
  )
    return NextResponse.json({ error: y.invalid }, { status: 400 });

  const found = await auth.supabase
    .from("ingredients")
    .select("id")
    .eq("id", body.ingredientId)
    .eq("company_id", auth.companyId)
    .maybeSingle();
  if (!found.data)
    return NextResponse.json({ error: y.invalid }, { status: 404 });

  try {
    const { locations } = await listAllCompanyRestaurants(
      auth.supabase,
      auth.companyId
    );
    const ids = locations.map((l) => l.id);
    if (ids.length === 0)
      return NextResponse.json({ error: y.saveFailed }, { status: 409 });
    const [today, firstDataDate] = await Promise.all([
      loadBusinessToday(auth.supabase, auth.companyId, ids[0]),
      scope === "all"
        ? loadCompanyFirstDataDate(auth.supabase, auth.companyId, ids)
        : Promise.resolve(null),
    ]);
    const res = await saveIngredientYield({
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
      ingredientId: body.ingredientId,
      lossPct: body.lossPct,
      scope,
      today,
      firstDataDate,
    });
    if (!res.ok) {
      const rls = /row-level security|permission denied/i.test(
        res.message ?? ""
      );
      if (!rls) console.error("[ingredient-yield] save failed:", res.message);
      return NextResponse.json(
        {
          error: rls
            ? y.roleDenied
            : res.error === "invalid"
              ? y.invalid
              : y.saveFailed,
        },
        { status: rls ? 403 : res.error === "invalid" ? 400 : 500 }
      );
    }
    return NextResponse.json({ ok: true, effectiveFrom: res.effectiveFrom });
  } catch (err) {
    console.error("[ingredient-yield] save failed:", err);
    return NextResponse.json({ error: y.saveFailed }, { status: 500 });
  }
}
