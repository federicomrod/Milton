// POST /api/restaurant/recipes/import
//
// Multipart: file (xlsx), mode = "preview" (default) | "apply",
// location_id (optional).
//
// Reads every recipe block of the cost file into the canonical recipe
// table. Preview never writes: it returns one row per dish (our cost,
// the Excel's COSTO TOTAL, match, flags, POS link). Apply re-reads the
// same file and creates the ingredients, preparations and draft recipes
// (in_review) as one batch. Nothing is approved. Owner, admin, manager or
// Milton staff. Company comes from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { actorCanSubmitForApproval } from "@/lib/restaurant/recipe-costing/approval";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { MAX_CATALOG_FILE_BYTES } from "@/lib/restaurant/price-catalog/server";
import {
  RecipeImportError,
  applyRecipeImport,
  previewRecipeImport,
} from "@/lib/restaurant/recipe-import/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Sube el archivo de costos (.xlsx)." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Sube el archivo de costos (.xlsx)." },
      { status: 400 }
    );
  }
  if (file.size > MAX_CATALOG_FILE_BYTES) {
    return NextResponse.json(
      { error: "El archivo pesa más de 15 MB." },
      { status: 400 }
    );
  }
  const mode = form.get("mode") === "apply" ? "apply" : "preview";
  const rawLocation = form.get("location_id");
  const locationId =
    typeof rawLocation === "string" && rawLocation.trim()
      ? rawLocation.trim()
      : null;

  if (mode === "apply") {
    const actor = await loadRecipeActor(
      auth.supabase,
      auth.companyId,
      auth.userId
    );
    if (!actorCanSubmitForApproval(actor)) {
      return NextResponse.json(
        { error: "Tu rol no puede importar recetas." },
        { status: 403 }
      );
    }
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (mode === "preview") {
      return NextResponse.json(
        await previewRecipeImport(auth.supabase, {
          companyId: auth.companyId,
          buffer,
          locationId,
        })
      );
    }
    const currency = await resolveCompanyCurrency(
      auth.supabase,
      auth.companyId
    );
    return NextResponse.json(
      await applyRecipeImport(auth.supabase, {
        companyId: auth.companyId,
        currency: currency || "USD",
        buffer,
        filename: file.name || "archivo de costos",
        createdBy: auth.userId,
        locationId,
      })
    );
  } catch (err) {
    if (err instanceof RecipeImportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[recipes-import]", err);
    return NextResponse.json(
      { error: "No pude leer las recetas del archivo." },
      { status: 500 }
    );
  }
}
