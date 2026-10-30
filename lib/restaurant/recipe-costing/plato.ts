// Platos: what the one primary button says and does for this person and
// this dish (R1-09b, C7: "Aprobar"; the list on the left replaces
// "siguiente" and "saltar"). Pure, so the rule lives outside React.

import { getDictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { liveApproval, type ApprovalBlocker } from "./approval-live";
import type { EditorLine } from "./editor";
import type { RecipeCostingWorkspace, RecipeEditorView } from "./workspace";

/** What the screen knows live about the open dish (from the editor). */
export interface LiveDish {
  lines: readonly EditorLine[];
  classification_unsaved?: boolean;
}

/** Who approves (B9): shown in the button's tooltip, not on the page. */
export const WHO_APPROVES_TIP =
  "Aprueba el dueño o un admin. Al aprobar, el plato cuenta en los márgenes.";

/** What the main button does for this person and this dish. */
export function primaryAction(
  actor: RecipeCostingWorkspace["actor"],
  editor: RecipeEditorView,
  hasRecipe: boolean,
  /** The editor's live lines; null while the editor has not reported yet. */
  live: LiveDish | null = null,
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): {
  label: string;
  enabled: boolean;
  /** Tooltip: what blocks it, or who approves. */
  hint: string | null;
  /** The first rule that blocks Aprobar, with its fix (shown as text). */
  blocker: ApprovalBlocker | null;
} | null {
  const p = getDictionary(lang).menu.workspace.plato;
  const whoTip = p.whoApprovesTip;
  if (!actor.can_submit) return null;
  const linked = editor.link_state === "confirmado";
  if (editor.recipe_status === "aprobada") {
    return linked
      ? null
      : {
          label: p.approve,
          enabled: hasRecipe,
          hint: p.approvedConfirmLink,
          blocker: null,
        };
  }
  if (actor.can_approve) {
    // The LIVE lines, never the stored evidence of import time.
    const approval = live ? liveApproval(live, lang) : null;
    const blocker = approval?.first ?? null;
    return {
      label: p.approve,
      enabled: hasRecipe && approval !== null && approval.ready,
      hint: blocker ? blocker.text : whoTip,
      blocker,
    };
  }
  if (editor.recipe_status === "por_aprobar") return null;
  return {
    label: p.submit,
    enabled: hasRecipe,
    hint: whoTip,
    blocker: null,
  };
}
