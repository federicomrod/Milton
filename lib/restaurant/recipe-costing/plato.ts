// Plato por plato: what the main button says and does for this person and
// this dish. Pure, so the rule lives outside React.

import type { RecipeCostingWorkspace, RecipeEditorView } from "./workspace";

/** What the main button does for this person and this dish. */
export function primaryAction(
  actor: RecipeCostingWorkspace["actor"],
  editor: RecipeEditorView,
  hasRecipe: boolean
): {
  label: string;
  enabled: boolean;
  navigateOnly: boolean;
  hint: string | null;
} | null {
  if (!actor.can_submit) return null;
  const linked = editor.link_state === "confirmado";
  if (editor.recipe_status === "aprobada") {
    return linked
      ? {
          label: "Siguiente",
          enabled: true,
          navigateOnly: true,
          hint: "Este plato ya está aprobado.",
        }
      : {
          label: "Confirmar vínculo y siguiente",
          enabled: hasRecipe,
          navigateOnly: false,
          hint: "La receta ya está aprobada; falta confirmar que es este producto del POS.",
        };
  }
  if (actor.can_approve) {
    return {
      label: "Aprobar y siguiente",
      enabled: hasRecipe && editor.checklist.ready,
      navigateOnly: false,
      hint: editor.checklist.ready
        ? null
        : (editor.checklist.blockers[0] ?? null),
    };
  }
  if (editor.recipe_status === "por_aprobar") {
    return {
      label: "Siguiente",
      enabled: true,
      navigateOnly: true,
      hint: "Ya la enviaste a aprobación. El dueño o un admin la aprueba.",
    };
  }
  return {
    label: "Enviar a aprobación y siguiente",
    enabled: hasRecipe,
    navigateOnly: false,
    hint: "Tú la preparas; el dueño o un admin la aprueba.",
  };
}
