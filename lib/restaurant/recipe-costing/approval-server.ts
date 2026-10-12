import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveDateForNewApprovedVersion } from "@/lib/restaurant/recipe-versions";
import {
  actorCanApprove,
  actorCanSubmitForApproval,
  buildApprovalChecklist,
  type RecipeActor,
} from "./approval";
import { parseSuggestionEvidence } from "./evidence";
import { loadPosProductLink } from "./link-actions-server";

async function loadInReviewVersion(
  supabase: SupabaseClient,
  companyId: string,
  recipeVersionId: string
) {
  const { data, error } = await supabase
    .from("recipe_versions")
    .select(
      "id, recipe_id, menu_item_id, version_number, status, effective_date, source_type, notes"
    )
    .eq("company_id", companyId)
    .eq("id", recipeVersionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function submitRecipeForApproval(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  recipeVersionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!actorCanSubmitForApproval(input.actor)) {
    return {
      ok: false,
      error: "No puedes enviar esta receta a aprobación.",
    };
  }
  const version = await loadInReviewVersion(
    input.supabase,
    input.companyId,
    input.recipeVersionId
  );
  if (!version) return { ok: false, error: "No encontré esa versión." };
  if (version.status === "approved") {
    return { ok: false, error: "Esta receta ya está Aprobada." };
  }
  const { error } = await input.supabase
    .from("recipe_versions")
    .update({ notes: "Lista para aprobar" })
    .eq("company_id", input.companyId)
    .eq("id", input.recipeVersionId)
    .eq("status", "in_review");
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function approveRecipeVersion(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  recipeVersionId: string;
  odooProductId?: number;
  locationId?: string | null;
  confirmedHow?: string | null;
  yieldConfirmed?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const confirmation = {
    confirmed_by: input.actor.user_id,
    confirmed_at: new Date().toISOString(),
    confirmed_how: input.confirmedHow?.trim() || "en_pantalla",
  };
  const allowed = actorCanApprove(input.actor, confirmation);
  if (!allowed.ok) return allowed;

  const version = await loadInReviewVersion(
    input.supabase,
    input.companyId,
    input.recipeVersionId
  );
  if (!version) return { ok: false, error: "No encontré esa versión." };
  if (version.status === "approved") {
    return { ok: false, error: "Esta receta ya está Aprobada." };
  }

  let evidence = parseSuggestionEvidence({});
  if (input.odooProductId != null) {
    const link = await loadPosProductLink(
      input.supabase,
      input.companyId,
      input.odooProductId,
      input.locationId
    );
    evidence = parseSuggestionEvidence(link?.evidence);
  }
  const checklist = buildApprovalChecklist({
    link_state: input.odooProductId != null ? "confirmado" : "sugerido",
    evidence,
    yield_confirmed: input.yieldConfirmed,
  });
  if (!checklist.ready) {
    return {
      ok: false,
      error: checklist.blockers[0] ?? "La receta todavía no pasa el checklist.",
    };
  }

  const siblings = await input.supabase
    .from("recipe_versions")
    .select("id, status, version_number, effective_date")
    .eq("company_id", input.companyId)
    .eq("recipe_id", version.recipe_id);
  if (siblings.error) throw new Error(siblings.error.message);

  const note = input.actor.is_milton_staff
    ? `Aprobada. El cliente confirmó por ${confirmation.confirmed_how} el ${confirmation.confirmed_at.slice(0, 10)}.`
    : "Aprobada";

  const { error } = await input.supabase
    .from("recipe_versions")
    .update({
      status: "approved",
      notes: note,
      effective_date: effectiveDateForNewApprovedVersion(siblings.data ?? []),
    })
    .eq("company_id", input.companyId)
    .eq("id", input.recipeVersionId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
