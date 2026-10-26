// GET  /api/restaurant/recipes/copy?exclude_menu_item_id=
//        -> { candidates: [{ menu_item_id, name, status, line_count }] }
//        platos of THIS company whose recipe has lines (approved first).
// POST /api/restaurant/recipes/copy
//        { odoo_product_id, odoo_name?, location_id?, source_menu_item_id,
//          mode?: "replace" | "append" }
//        -> { lines_copied, version_id, created_recipe, created_draft }
//        or 409 { needs_mode: true, draft_line_count } when the current draft
//        already has lines (the person chooses replace / append / cancel).
//
// «Copiar receta de…»: the lines go into a NEW in-review draft of this
// product's own recipe. The source and any approved version are never changed.

import { NextRequest, NextResponse } from "next/server";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { toRecipeActor } from "@/lib/restaurant/recipe-costing/approval";
import {
  copyRecipeLinesForCompany,
  listCopyCandidates,
  loadCopySource,
} from "@/lib/restaurant/recipe-costing/copy-recipe-server";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import { createRecipeAndLink } from "@/lib/restaurant/recipe-costing/link-actions-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "recipes.edit");
  if (denied) return denied;
  try {
    const exclude = req.nextUrl.searchParams.get("exclude_menu_item_id");
    const candidates = await listCopyCandidates(auth.supabase, auth.companyId, {
      excludeMenuItemId: exclude && exclude.trim() ? exclude.trim() : null,
    });
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[recipes/copy GET]", err);
    return NextResponse.json(
      { error: "No pude cargar las recetas para copiar." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const odooProductId = Number(body.odoo_product_id);
  const sourceMenuItemId =
    typeof body.source_menu_item_id === "string"
      ? body.source_menu_item_id.trim()
      : "";
  if (
    !Number.isInteger(odooProductId) ||
    odooProductId <= 0 ||
    !sourceMenuItemId
  ) {
    return NextResponse.json(
      { error: "Indica el producto y la receta que quieres copiar." },
      { status: 400 }
    );
  }
  const mode =
    body.mode === "replace" || body.mode === "append" ? body.mode : null;
  if (body.mode != null && !mode) {
    return NextResponse.json(
      { error: "Elige reemplazar las líneas o agregar al final." },
      { status: 400 }
    );
  }

  const permission = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied =
    requireCapability(permission, "recipes.edit") ??
    // A product with no recipe gets one first, like «Crear receta».
    requireCapability(permission, "links.confirm");
  if (denied) return denied;
  const actor = toRecipeActor(permission);

  const odooName =
    typeof body.odoo_name === "string" ? body.odoo_name.trim() : "";
  const locationId =
    typeof body.location_id === "string" ? body.location_id : null;
  const store = createSupabaseEditorStore(auth.supabase);

  try {
    const result = await copyRecipeLinesForCompany({
      store,
      loadSource: (menuItemId) =>
        loadCopySource(auth.supabase, store, auth.companyId, menuItemId),
      createRecipe: async () => {
        if (!odooName) {
          return { ok: false, error: "Falta el nombre del producto." };
        }
        const created = await createRecipeAndLink({
          supabase: auth.supabase,
          companyId: auth.companyId,
          actor,
          odooProductId,
          odooName,
          locationId,
        });
        return created.ok ? { ok: true } : created;
      },
      companyId: auth.companyId,
      odooProductId,
      locationId,
      sourceMenuItemId,
      mode,
    });
    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[recipes/copy POST]", err);
    return NextResponse.json(
      { error: "No pude copiar la receta." },
      { status: 500 }
    );
  }
}
