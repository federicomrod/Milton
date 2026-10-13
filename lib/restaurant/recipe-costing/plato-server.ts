// Plato por plato: one click for the person, two separate steps underneath.
//
// 1. Confirm the POS link (pos_product_links → confirmado, with who / when /
//    how), unless it is already confirmed.
// 2. Approve the recipe version (owner / admin; Milton staff with the
//    client's confirmation), or send it for approval (manager).
//
// The link and the recipe version keep their own states: a recipe can get
// a new version later without losing the confirmed link, and a confirmed
// link never approves a recipe by itself. Nothing here writes a cost.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actorCanApprove,
  actorCanSubmitForApproval,
  type RecipeActor,
} from "./approval";
import {
  approveRecipeVersion,
  submitRecipeForApproval,
} from "./approval-server";
import {
  confirmPosLinkForCompany,
  loadPosProductLink,
} from "./link-actions-server";

export const PLATO_ROLE_ERROR =
  "Tu rol puede ver los platos, pero no confirmarlos ni enviarlos a aprobación.";
export const PLATO_NO_RECIPE_ERROR =
  "Este plato todavía no tiene receta. Créala o elige la de otro plato.";
export const PLATO_VERSION_MISMATCH_ERROR =
  "Esa versión no es la receta de este plato. Recarga la página.";

export type PlatoConfirmResult =
  | {
      ok: true;
      link: "confirmado" | "ya_confirmado";
      recipe: "aprobada" | "enviada" | "ya_aprobada";
    }
  | { ok: false; error: string; status: number; link_confirmed?: boolean };

export async function confirmPlato(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  odooProductId: number;
  odooName?: string;
  recipeVersionId: string | null;
  locationId?: string | null;
  confirmedHow?: string | null;
  yieldConfirmed?: boolean;
}): Promise<PlatoConfirmResult> {
  if (!actorCanSubmitForApproval(input.actor)) {
    return { ok: false, error: PLATO_ROLE_ERROR, status: 403 };
  }
  const link = await loadPosProductLink(
    input.supabase,
    input.companyId,
    input.odooProductId,
    input.locationId
  );
  if (!link?.menu_item_id) {
    return { ok: false, error: PLATO_NO_RECIPE_ERROR, status: 400 };
  }

  let versionStatus: string | null = null;
  if (input.recipeVersionId) {
    const { data, error } = await input.supabase
      .from("recipe_versions")
      .select("id, menu_item_id, status")
      .eq("company_id", input.companyId)
      .eq("id", input.recipeVersionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.menu_item_id !== link.menu_item_id) {
      return { ok: false, error: PLATO_VERSION_MISMATCH_ERROR, status: 400 };
    }
    versionStatus = String(data.status);
  }

  const how = input.confirmedHow?.trim() || null;
  const approving = actorCanApprove(input.actor, {
    confirmed_by: input.actor.user_id,
    confirmed_at: new Date().toISOString(),
    confirmed_how:
      how ?? (input.actor.is_milton_staff ? undefined : "en_pantalla"),
  });
  // Milton staff without the client's confirmation: stop before writing.
  if (!approving.ok && input.actor.is_milton_staff) {
    return { ok: false, error: approving.error, status: 403 };
  }
  if (approving.ok && versionStatus !== "approved" && !input.recipeVersionId) {
    return { ok: false, error: PLATO_NO_RECIPE_ERROR, status: 400 };
  }

  // Step 1: the POS link, its own state and audit.
  let linkResult: "confirmado" | "ya_confirmado" = "ya_confirmado";
  if (link.link_state !== "confirmado") {
    const confirmed = await confirmPosLinkForCompany({
      supabase: input.supabase,
      companyId: input.companyId,
      actor: input.actor,
      odooProductId: input.odooProductId,
      odooName: input.odooName,
      locationId: input.locationId,
      confirmedHow: how ?? "en_pantalla",
      menuItemId: link.menu_item_id,
    });
    if (!confirmed.ok) {
      return { ok: false, error: confirmed.error, status: 400 };
    }
    linkResult = "confirmado";
  }

  // Step 2: the recipe version, its own state and audit.
  if (versionStatus === "approved") {
    return { ok: true, link: linkResult, recipe: "ya_aprobada" };
  }
  if (approving.ok) {
    const approved = await approveRecipeVersion({
      supabase: input.supabase,
      companyId: input.companyId,
      actor: input.actor,
      recipeVersionId: input.recipeVersionId!,
      odooProductId: input.odooProductId,
      locationId: input.locationId,
      confirmedHow: how,
      yieldConfirmed: input.yieldConfirmed,
    });
    if (!approved.ok) {
      return {
        ok: false,
        error:
          linkResult === "confirmado"
            ? `${approved.error} El vínculo con el POS sí quedó confirmado.`
            : approved.error,
        status: 400,
        link_confirmed: linkResult === "confirmado",
      };
    }
    return { ok: true, link: linkResult, recipe: "aprobada" };
  }

  // Manager: prepares, the owner or an admin approves.
  if (!input.recipeVersionId) {
    return { ok: false, error: PLATO_NO_RECIPE_ERROR, status: 400 };
  }
  const submitted = await submitRecipeForApproval({
    supabase: input.supabase,
    companyId: input.companyId,
    actor: input.actor,
    recipeVersionId: input.recipeVersionId,
  });
  if (!submitted.ok) {
    return {
      ok: false,
      error: submitted.error,
      status: 400,
      link_confirmed: linkResult === "confirmado",
    };
  }
  return { ok: true, link: linkResult, recipe: "enviada" };
}
