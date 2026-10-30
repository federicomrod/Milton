import { fmt, getDictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
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
import { loadInReviewVersion } from "./version-read";
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
  /** A promise is accepted (R1-12): the role is read with the link. */
  actor: RecipeActor | Promise<RecipeActor>;
  odooProductId: number;
  odooName?: string;
  recipeVersionId: string | null;
  locationId?: string | null;
  confirmedHow?: string | null;
  yieldConfirmed?: boolean;
  /** Language of the error messages (default Spanish). */
  lang?: PreferredLanguage;
}): Promise<PlatoConfirmResult> {
  const lang = input.lang ?? RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
  const s = getDictionary(lang).menu.workspace.server;
  // R1-12: the role, the link and the version are independent reads: one
  // wave (they were three, one after another).
  const [actor, link, versionRow] = await Promise.all([
    input.actor,
    loadPosProductLink(
      input.supabase,
      input.companyId,
      input.odooProductId,
      input.locationId
    ),
    input.recipeVersionId
      ? loadInReviewVersion(
          input.supabase,
          input.companyId,
          input.recipeVersionId
        )
      : Promise.resolve(null),
  ]);
  if (!actorCanSubmitForApproval(actor)) {
    return { ok: false, error: s.platoRole, status: 403 };
  }
  if (!link?.menu_item_id) {
    return { ok: false, error: s.platoNoRecipe, status: 400 };
  }

  let versionStatus: string | null = null;
  if (input.recipeVersionId) {
    if (!versionRow || versionRow.menu_item_id !== link.menu_item_id) {
      return { ok: false, error: s.platoVersionMismatch, status: 400 };
    }
    versionStatus = String(versionRow.status);
  }

  const how = input.confirmedHow?.trim() || null;
  const approving = actorCanApprove(
    actor,
    {
      confirmed_by: actor.user_id,
      confirmed_at: new Date().toISOString(),
      confirmed_how: how ?? (actor.is_milton_staff ? undefined : "en_pantalla"),
    },
    lang
  );
  // Milton staff without the client's confirmation: stop before writing.
  if (!approving.ok && actor.is_milton_staff) {
    return { ok: false, error: approving.error, status: 403 };
  }
  if (approving.ok && versionStatus !== "approved" && !input.recipeVersionId) {
    return { ok: false, error: s.platoNoRecipe, status: 400 };
  }

  // Step 1: the POS link, its own state and audit. It starts now; the
  // approval's reads (R1-12) run while it is saved, and the approval is
  // written only after it succeeded.
  const linkStep: Promise<
    | { ok: true; link: "confirmado" | "ya_confirmado" }
    | { ok: false; error: string }
  > =
    link.link_state !== "confirmado"
      ? confirmPosLinkForCompany({
          supabase: input.supabase,
          companyId: input.companyId,
          actor,
          odooProductId: input.odooProductId,
          odooName: input.odooName,
          locationId: input.locationId,
          confirmedHow: how ?? "en_pantalla",
          lang,
          menuItemId: link.menu_item_id,
          existingLink: link,
        }).then((confirmed) =>
          confirmed.ok
            ? { ok: true as const, link: "confirmado" as const }
            : { ok: false as const, error: confirmed.error }
        )
      : Promise.resolve({ ok: true as const, link: "ya_confirmado" as const });

  // Step 2: the recipe version, its own state and audit.
  if (versionStatus === "approved") {
    const confirmed = await linkStep;
    if (!confirmed.ok)
      return { ok: false, error: confirmed.error, status: 400 };
    return { ok: true, link: confirmed.link, recipe: "ya_aprobada" };
  }
  if (approving.ok) {
    const approving$ = approveRecipeVersion({
      supabase: input.supabase,
      companyId: input.companyId,
      actor,
      recipeVersionId: input.recipeVersionId!,
      odooProductId: input.odooProductId,
      locationId: input.locationId,
      confirmedHow: how,
      yieldConfirmed: input.yieldConfirmed,
      lang,
      version: versionRow,
      link,
      gate: linkStep,
    });
    // If the link step throws, the approval would reject too: handle it
    // here and let the link error win below.
    approving$.catch(() => undefined);
    const confirmed = await linkStep;
    if (!confirmed.ok)
      return { ok: false, error: confirmed.error, status: 400 };
    const approved = await approving$;
    if (!approved.ok) {
      return {
        ok: false,
        error:
          confirmed.link === "confirmado"
            ? fmt(s.linkStillConfirmed, { error: approved.error })
            : approved.error,
        status: 400,
        link_confirmed: confirmed.link === "confirmado",
      };
    }
    return { ok: true, link: confirmed.link, recipe: "aprobada" };
  }

  // Manager: prepares, the owner or an admin approves.
  if (!input.recipeVersionId) {
    await linkStep.catch(() => undefined);
    return { ok: false, error: s.platoNoRecipe, status: 400 };
  }
  const confirmed = await linkStep;
  if (!confirmed.ok) return { ok: false, error: confirmed.error, status: 400 };
  const submitted = await submitRecipeForApproval({
    supabase: input.supabase,
    companyId: input.companyId,
    actor,
    recipeVersionId: input.recipeVersionId,
    version: versionRow,
    lang,
  });
  if (!submitted.ok) {
    return {
      ok: false,
      error: submitted.error,
      status: 400,
      link_confirmed: confirmed.link === "confirmado",
    };
  }
  return { ok: true, link: confirmed.link, recipe: "enviada" };
}
