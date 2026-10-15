// Reventa in one step: a product sold as it is bought gets a one-line
// recipe (what you buy, how much goes into one sale). It is a draft like any
// other: the link is a suggestion and the recipe still needs approval, so
// premise 9 is unchanged. The cost comes from the catalog, never typed here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecipeActor } from "./approval";
import { actorCanSubmitForApproval } from "./approval";
import { applyEdit, type EditorState } from "./editor-service";
import { createSupabaseEditorStore } from "./editor-store";
import {
  createRecipeAndLink,
  loadPosProductLink,
  setPosProductTreatments,
} from "./link-actions-server";

export const RESALE_HAS_RECIPE_ERROR =
  "Este producto ya tiene receta. Cámbiala en Plato por plato.";

export async function startResaleRecipe(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  odooProductId: number;
  odooName: string;
  ingredientId: string;
  quantity: number;
  unit: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; menu_item_id: string; state: EditorState }
  | { ok: false; error: string; status?: number }
> {
  if (!actorCanSubmitForApproval(input.actor)) {
    return { ok: false, error: "Tu rol no puede crear recetas.", status: 403 };
  }
  if (!(input.quantity > 0)) {
    return { ok: false, error: "Indica cuánto lleva una venta." };
  }
  const { data: ingredient, error } = await input.supabase
    .from("ingredients")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("id", input.ingredientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ingredient) {
    return { ok: false, error: "Ese producto no está en tu lista." };
  }

  const existing = await loadPosProductLink(
    input.supabase,
    input.companyId,
    input.odooProductId,
    input.locationId
  );
  if (existing?.menu_item_id) {
    return { ok: false, error: RESALE_HAS_RECIPE_ERROR, status: 409 };
  }

  const treatment = await setPosProductTreatments({
    supabase: input.supabase,
    companyId: input.companyId,
    actor: input.actor,
    items: [
      {
        odoo_product_id: input.odooProductId,
        odoo_name: input.odooName,
        treatment: "reventa",
      },
    ],
    locationId: input.locationId,
    source: "manual",
  });
  if (!treatment.ok) return treatment;

  const created = await createRecipeAndLink({
    supabase: input.supabase,
    companyId: input.companyId,
    actor: input.actor,
    odooProductId: input.odooProductId,
    odooName: input.odooName,
    locationId: input.locationId,
  });
  if (!created.ok) return created;

  const edited = await applyEdit(
    {
      store: createSupabaseEditorStore(input.supabase),
      companyId: input.companyId,
      odooProductId: input.odooProductId,
      locationId: input.locationId ?? null,
      userId: input.actor.user_id,
    },
    {
      action: "add",
      kind: "ingredient",
      id: input.ingredientId,
      quantity: input.quantity,
      unit: input.unit,
    }
  );
  if (!edited.ok) return edited;
  return { ok: true, menu_item_id: created.menu_item_id, state: edited.state };
}
