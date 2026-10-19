// /api/restaurant/recipes/last-file
//
//   GET  ?odoo_product_id=&location_id=  → this dish in the last uploaded
//        cost file (saved upload, no re-upload) next to the recipe it has now.
//   POST { odoo_product_id, location_id?, recipe_key } → «Usar esta receta»:
//        a NEW draft version from the file (old versions untouched), one
//        undoable batch. Owner, admin, manager or Milton staff.
// Company comes from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { actionableError } from "@/lib/restaurant/actionable-error";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import {
  applyDishFromLastFile,
  lookupDishInLastFile,
} from "@/lib/restaurant/recipe-import/last-file";
import { RecipeImportError } from "@/lib/restaurant/recipe-import/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function productId(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

function locationOf(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const odooProductId = productId(
    req.nextUrl.searchParams.get("odoo_product_id")
  );
  if (odooProductId === null) {
    return NextResponse.json({ error: "Falta el plato." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await lookupDishInLastFile(auth.supabase, {
        companyId: auth.companyId,
        odooProductId,
        locationId: locationOf(req.nextUrl.searchParams.get("location_id")),
      })
    );
  } catch (err) {
    if (err instanceof RecipeImportError) {
      // A file without dish recipes: nothing to bring.
      return NextResponse.json({ available: false, reason: "not_in_file" });
    }
    const failure = actionableError(
      err,
      "No pude leer el último archivo.",
      "recipes-last-file"
    );
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const odooProductId = productId(body?.odoo_product_id);
  const recipeKey = typeof body?.recipe_key === "string" ? body.recipe_key : "";
  if (odooProductId === null || !recipeKey) {
    return NextResponse.json({ error: "Falta el plato." }, { status: 400 });
  }
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "imports.run", {
    message: "Tu rol no puede importar recetas.",
  });
  if (denied) return denied;
  try {
    const currency = await resolveCompanyCurrency(
      auth.supabase,
      auth.companyId
    );
    const result = await applyDishFromLastFile(auth.supabase, {
      companyId: auth.companyId,
      currency: currency || "USD",
      odooProductId,
      locationId: locationOf(body?.location_id),
      recipeKey,
      createdBy: auth.userId,
    });
    if (!result) {
      return NextResponse.json(
        { error: "Ya no encuentro este plato en el último archivo." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RecipeImportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const failure = actionableError(
      err,
      "No pude traer la receta del archivo.",
      "recipes-last-file"
    );
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
}
