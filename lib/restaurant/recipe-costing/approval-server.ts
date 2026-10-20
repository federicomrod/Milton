import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveDateForNewApprovedVersion } from "@/lib/restaurant/recipe-versions";
import {
  actorCanApprove,
  actorCanSubmitForApproval,
  type RecipeActor,
} from "./approval";
import { approvalRecord, updateWithApprovalAudit } from "./approval-audit";
import { liveApproval } from "./approval-live";
import { loadEditor } from "./editor-service";
import { createSupabaseEditorStore } from "./editor-store";
import type { EditorLine } from "./editor";
import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import { loadInReviewVersion, type InReviewVersionRow } from "./version-read";

export async function submitRecipeForApproval(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  recipeVersionId: string;
  /** Already read by the caller (R1-12): skips a second read. */
  version?: InReviewVersionRow | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!actorCanSubmitForApproval(input.actor)) {
    return {
      ok: false,
      error: "No puedes enviar esta receta a aprobación.",
    };
  }
  const version =
    input.version ??
    (await loadInReviewVersion(
      input.supabase,
      input.companyId,
      input.recipeVersionId
    ));
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

export const APPROVE_VERSION_MISMATCH_ERROR =
  "Esa versión no es la que muestra el plato. Recarga la página.";

/** The lines the editor shows for the dish: what Aprobar is checked on. */
export type LiveLinesLoad = () => Promise<
  | { ok: true; version_id: string | null; lines: EditorLine[] }
  | { ok: false; error: string }
>;

export async function approveRecipeVersion(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  recipeVersionId: string;
  odooProductId?: number;
  locationId?: string | null;
  confirmedHow?: string | null;
  yieldConfirmed?: boolean;
  /**
   * R1-12: what the caller already read, so approving does not read the
   * same version and link again. `link: undefined` = not read.
   */
  version?: InReviewVersionRow | null;
  link?: PosProductLinkRecord | null;
  /**
   * R1-12: a step that must succeed before anything is written (the POS
   * link confirmation). The reads below run while it is in flight.
   */
  gate?: Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * The live lines of the dish (the same ones the screen totals). Default:
   * the editor service on this client. Tests inject their own.
   */
  loadLiveLines?: LiveLinesLoad;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const confirmation = {
    confirmed_by: input.actor.user_id,
    confirmed_at: new Date().toISOString(),
    confirmed_how: input.confirmedHow?.trim() || "en_pantalla",
  };
  const allowed = actorCanApprove(input.actor, confirmation);
  if (!allowed.ok) return allowed;

  const version =
    input.version === undefined
      ? await loadInReviewVersion(
          input.supabase,
          input.companyId,
          input.recipeVersionId
        )
      : input.version;
  if (!version) return { ok: false, error: "No encontré esa versión." };
  if (version.status === "approved") {
    return { ok: false, error: "Esta receta ya está Aprobada." };
  }

  // The live lines, the line count and the sibling versions do not depend on
  // each other: one wave.
  const loadLive: LiveLinesLoad | null =
    input.loadLiveLines ??
    (input.odooProductId != null
      ? async () => {
          const result = await loadEditor({
            store: createSupabaseEditorStore(input.supabase),
            companyId: input.companyId,
            odooProductId: input.odooProductId as number,
            locationId: input.locationId ?? null,
            userId: input.actor.user_id,
            omitOptions: true,
          });
          return result.ok
            ? {
                ok: true as const,
                version_id: result.state.version_id,
                lines: result.state.lines,
              }
            : { ok: false as const, error: result.error };
        }
      : null);
  const [live, inputCountRead, siblings] = await Promise.all([
    loadLive ? loadLive() : Promise.resolve(null),
    input.supabase
      .from("recipe_version_inputs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", input.companyId)
      .eq("recipe_version_id", input.recipeVersionId),
    input.supabase
      .from("recipe_versions")
      .select("id, status, version_number, effective_date")
      .eq("company_id", input.companyId)
      .eq("recipe_id", version.recipe_id),
  ]);
  const { count: inputCount, error: inputError } = inputCountRead;
  if (inputError) throw new Error(inputError.message);
  if (live) {
    if (!live.ok) return { ok: false, error: live.error };
    if (live.version_id !== input.recipeVersionId) {
      return { ok: false, error: APPROVE_VERSION_MISMATCH_ERROR };
    }
    // The same rule the Aprobar button uses (approval-live.ts).
    const approval = liveApproval({ lines: live.lines });
    if (!approval.ready) {
      return {
        ok: false,
        error:
          approval.first?.text ?? "La receta todavía no pasa el checklist.",
      };
    }
  } else if ((inputCount ?? 0) === 0) {
    return {
      ok: false,
      error: "La receta no tiene ingredientes.",
    };
  }

  if (siblings.error) throw new Error(siblings.error.message);

  // Nothing is written until the link step (if any) has succeeded.
  if (input.gate) {
    const gated = await input.gate;
    if (!gated.ok) return gated;
  }

  const note = input.actor.is_milton_staff
    ? `Aprobada. El cliente confirmó por ${confirmation.confirmed_how} el ${confirmation.confirmed_at.slice(0, 10)}.`
    : "Aprobada";

  await updateWithApprovalAudit(
    (payload) =>
      input.supabase
        .from("recipe_versions")
        .update(payload)
        .eq("company_id", input.companyId)
        .eq("id", input.recipeVersionId),
    {
      status: "approved",
      notes: note,
      effective_date: effectiveDateForNewApprovedVersion(siblings.data ?? []),
    },
    approvalRecord({
      userId: input.actor.user_id,
      how: confirmation.confirmed_how,
      at: confirmation.confirmed_at,
    })
  );
  return { ok: true };
}
