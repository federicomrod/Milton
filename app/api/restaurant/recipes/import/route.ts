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

import { NextRequest, NextResponse, after } from "next/server";
import { actionableError } from "@/lib/restaurant/actionable-error";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { actorCanSubmitForApproval } from "@/lib/restaurant/recipe-costing/approval";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { saveMenuGroupingQuietly } from "@/lib/restaurant/menu-dishes/save-grouping";
import { MAX_CATALOG_FILE_BYTES } from "@/lib/restaurant/price-catalog/server";
import {
  loadUploadDraftFile,
  updateUploadDraft,
} from "@/lib/restaurant/price-catalog/draft";
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
  // The file comes with the request, or from the saved draft (draft=1).
  const fromDraft = form.get("draft") === "1";
  let buffer: Buffer;
  let filename: string;
  if (fromDraft) {
    const stored = await loadUploadDraftFile(auth.supabase, auth.companyId);
    if (!stored) {
      return NextResponse.json(
        { error: "Ya no tengo tu archivo. Elígelo de nuevo." },
        { status: 400 }
      );
    }
    buffer = stored.buffer;
    filename = stored.filename;
  } else {
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
    buffer = Buffer.from(await file.arrayBuffer());
    filename = file.name || "archivo de costos";
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
    const result = await applyRecipeImport(auth.supabase, {
      companyId: auth.companyId,
      currency: currency || "USD",
      buffer,
      filename,
      createdBy: auth.userId,
      locationId,
    });
    // New recipes can group new variants: save Milton's grouping once,
    // after the response.
    after(() =>
      saveMenuGroupingQuietly(auth.supabase, auth.companyId, "after-import")
    );
    if (fromDraft) {
      await updateUploadDraft(auth.supabase, {
        companyId: auth.companyId,
        userId: auth.userId,
        recipes_result: result as unknown as Record<string, unknown>,
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RecipeImportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const failure = actionableError(
      err,
      "No pude leer las recetas del archivo.",
      "recipes-import"
    );
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
}
