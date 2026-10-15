// Platos: what the one primary button says and does for this person and
// this dish (R1-09b, C7: "Aprobar"; the list on the left replaces
// "siguiente" and "saltar"). Pure, so the rule lives outside React.

import type { RecipeCostingWorkspace, RecipeEditorView } from "./workspace";

/** Who approves (B9): shown in the button's tooltip, not on the page. */
export const WHO_APPROVES_TIP =
  "Aprueba el dueño o un admin. Al aprobar, el plato cuenta en los márgenes.";

/** What the main button does for this person and this dish. */
export function primaryAction(
  actor: RecipeCostingWorkspace["actor"],
  editor: RecipeEditorView,
  hasRecipe: boolean
): {
  label: string;
  enabled: boolean;
  /** Tooltip: what blocks it, or who approves. */
  hint: string | null;
} | null {
  if (!actor.can_submit) return null;
  const linked = editor.link_state === "confirmado";
  if (editor.recipe_status === "aprobada") {
    return linked
      ? null
      : {
          label: "Aprobar",
          enabled: hasRecipe,
          hint: "La receta ya está aprobada; confirma que es este producto del POS.",
        };
  }
  if (actor.can_approve) {
    return {
      label: "Aprobar",
      enabled: hasRecipe && editor.checklist.ready,
      hint: editor.checklist.ready
        ? WHO_APPROVES_TIP
        : editor.checklist.blockers.join(" · ") || WHO_APPROVES_TIP,
    };
  }
  if (editor.recipe_status === "por_aprobar") return null;
  return {
    label: "Enviar a aprobación",
    enabled: hasRecipe,
    hint: WHO_APPROVES_TIP,
  };
}
