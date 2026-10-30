import { getDictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import {
  classificationFromStored,
  confirmPosProductLink,
  confirmPosProductLinkError,
  suggestPosProductLink,
  type LinkConfirmation,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import {
  UNDO_EVIDENCE_KEY,
  canConfirmSuggestedLink,
  evidenceWithoutUndo,
  parseSuggestionEvidence,
  readUndoSnapshot,
} from "./evidence";

export const CONFIRM_LINK_ERROR =
  "Solo una persona puede marcar el vínculo como Confirmado. Indica quién, cuándo y cómo.";

export const UNDO_NOT_CONFIRMED_ERROR =
  "Este vínculo no está Confirmado, no hay nada que deshacer.";

export const UNBOUND_CONFIRM_ERROR =
  "Esta sugerencia no trae la receta. Elige otra o créala antes de confirmar.";

export interface LinkUndoSnapshot {
  classification: PosProductLinkRecord["classification"];
  menu_item_id: string | null;
  link_state: PosProductLinkRecord["link_state"];
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmed_how: string | null;
  evidence: Record<string, unknown>;
}

export function snapshotLinkForUndo(
  link: PosProductLinkRecord
): LinkUndoSnapshot {
  return {
    classification: link.classification,
    menu_item_id: link.menu_item_id,
    link_state: link.link_state,
    confirmed_by: link.confirmed_by,
    confirmed_at: link.confirmed_at,
    confirmed_how: link.confirmed_how,
    evidence: evidenceWithoutUndo(link.evidence),
  };
}

export function attachUndoSnapshot(
  evidence: Record<string, unknown>,
  previous: LinkUndoSnapshot
): Record<string, unknown> {
  return {
    ...evidenceWithoutUndo(evidence),
    [UNDO_EVIDENCE_KEY]: previous,
  };
}

export function confirmLinkResult(
  base: PosProductLinkRecord,
  confirmation: Partial<LinkConfirmation> | null | undefined,
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): { ok: true; link: PosProductLinkRecord } | { ok: false; error: string } {
  const s = getDictionary(lang).menu.workspace.server;
  const error = confirmPosProductLinkError(confirmation);
  if (error || !confirmation) {
    return { ok: false, error: error ?? s.confirmLink };
  }
  if (!canConfirmSuggestedLink(parseSuggestionEvidence(base.evidence))) {
    return { ok: false, error: s.unboundConfirm };
  }
  const confirmed = confirmPosProductLink(base, {
    confirmed_by: confirmation.confirmed_by!.trim(),
    confirmed_at: confirmation.confirmed_at!.trim(),
    confirmed_how: confirmation.confirmed_how!.trim(),
  });
  return {
    ok: true,
    link: {
      ...confirmed,
      evidence: attachUndoSnapshot(base.evidence, snapshotLinkForUndo(base)),
    },
  };
}

export function changeLinkResult(
  base: PosProductLinkRecord,
  input: {
    menu_item_id: string;
    evidence?: Record<string, unknown>;
    classification?: PosProductLinkRecord["classification"];
  },
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): { ok: true; link: PosProductLinkRecord } | { ok: false; error: string } {
  const menuItemId = input.menu_item_id.trim();
  if (!menuItemId) {
    return {
      ok: false,
      error: getDictionary(lang).menu.workspace.server.chooseOtherRecipe,
    };
  }
  const suggested = suggestPosProductLink(base, {
    menu_item_id: menuItemId,
    classification: input.classification,
    evidence: {
      source: "manual_pick",
      ...(input.evidence ?? {}),
    },
  });
  return {
    ok: true,
    link: {
      ...suggested,
      evidence: attachUndoSnapshot(
        suggested.evidence,
        snapshotLinkForUndo(base)
      ),
    },
  };
}

function restoreFromSnapshot(
  base: PosProductLinkRecord,
  snap: LinkUndoSnapshot
): PosProductLinkRecord {
  return {
    ...base,
    classification: snap.classification,
    menu_item_id: snap.menu_item_id,
    link_state: snap.link_state,
    confirmed_by: snap.confirmed_by,
    confirmed_at: snap.confirmed_at,
    confirmed_how: snap.confirmed_how,
    evidence: evidenceWithoutUndo(snap.evidence),
  };
}

export function undoConfirmedLinkResult(
  base: PosProductLinkRecord,
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): { ok: true; link: PosProductLinkRecord } | { ok: false; error: string } {
  if (base.link_state !== "confirmado") {
    return {
      ok: false,
      error: getDictionary(lang).menu.workspace.server.undoNotConfirmed,
    };
  }
  const stored = readUndoSnapshot(base.evidence);
  if (stored) {
    const snap: LinkUndoSnapshot = {
      classification:
        stored.classification === undefined
          ? base.classification
          : classificationFromStored(stored.classification),
      menu_item_id:
        typeof stored.menu_item_id === "string" ? stored.menu_item_id : null,
      link_state:
        stored.link_state === "sugerido" || stored.link_state === "sin_vincular"
          ? stored.link_state
          : "sugerido",
      confirmed_by:
        typeof stored.confirmed_by === "string" ? stored.confirmed_by : null,
      confirmed_at:
        typeof stored.confirmed_at === "string" ? stored.confirmed_at : null,
      confirmed_how:
        typeof stored.confirmed_how === "string" ? stored.confirmed_how : null,
      evidence:
        stored.evidence &&
        typeof stored.evidence === "object" &&
        !Array.isArray(stored.evidence)
          ? (stored.evidence as Record<string, unknown>)
          : {},
    };
    return { ok: true, link: restoreFromSnapshot(base, snap) };
  }
  return {
    ok: true,
    link: {
      ...base,
      link_state: base.menu_item_id ? "sugerido" : "sin_vincular",
      confirmed_by: null,
      confirmed_at: null,
      confirmed_how: null,
      evidence: evidenceWithoutUndo(base.evidence),
    },
  };
}
