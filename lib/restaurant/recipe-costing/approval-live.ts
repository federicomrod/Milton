// Aprobar, from the LIVE lines (the ones the editor shows and totals), never
// from the evidence snapshot saved at import time. ONE pure function used by
// the screen (plato.ts primaryAction) and by the server (approval-server.ts),
// so both always refuse for the same reason.
//
// A dish is one plate: it needs no yield. It can be approved when it has
// at least one line, every line has a cost, nothing is unresolved or waiting
// for a unit, and every preparation it uses is approved.

import { getDictionary, fmt } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { FLAG_PENDING_UNIT, type EditorLine } from "./editor";

export type ApprovalFix =
  | "open_preparation"
  | "price"
  | "unit_question"
  | "classification";

export interface ApprovalBlocker {
  kind:
    | "no_lines"
    | "unresolved"
    | "sub_preparation"
    | "unit"
    | "price"
    | "classification";
  /** Spanish, shown as gray text next to the button and as the server error. */
  text: string;
  /** The blue link that fixes it (null: nothing to open). */
  fix: ApprovalFix | null;
  fix_label: string | null;
  /** The line it is about. */
  line_key?: string;
  /** The preparation to open (fix `open_preparation`). */
  component_id?: string;
}

export interface LiveApproval {
  ready: boolean;
  blockers: ApprovalBlocker[];
  /** The first blocker: the one reason shown. */
  first: ApprovalBlocker | null;
}

export interface LiveApprovalInput {
  lines: readonly EditorLine[];
  /** The dish's tipo / treatment has changes not saved yet. */
  classification_unsaved?: boolean;
}

function nameOf(line: EditorLine, fallback: string): string {
  return (line.name ?? line.raw_name).trim() || fallback;
}

export function liveApproval(
  input: LiveApprovalInput,
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): LiveApproval {
  const dict = getDictionary(lang).menu.workspace;
  const l = dict.approval.live;
  const nameOfLine = (line: EditorLine) => nameOf(line, l.thisIngredient);
  const blockers: ApprovalBlocker[] = [];
  const { lines } = input;

  if (lines.length === 0) {
    blockers.push({
      kind: "no_lines",
      text: dict.approval.blocker.noIngredients,
      fix: null,
      fix_label: null,
    });
  }
  for (const line of lines) {
    if (line.kind !== "unresolved") continue;
    blockers.push({
      kind: "unresolved",
      text: fmt(l.unresolved, { name: nameOfLine(line) }),
      fix: null,
      fix_label: null,
      line_key: line.key,
    });
  }
  for (const line of lines) {
    if (line.kind !== "component" || line.component_approved !== false) {
      continue;
    }
    blockers.push({
      kind: "sub_preparation",
      text: fmt(l.prepFirst, { name: nameOfLine(line) }),
      fix: "open_preparation",
      fix_label: l.openPrep,
      line_key: line.key,
      ...(line.component_id ? { component_id: line.component_id } : {}),
    });
  }
  for (const line of lines) {
    if (line.kind === "unresolved") continue;
    if (!line.flags.includes(FLAG_PENDING_UNIT)) continue;
    const priceUnit = line.price?.unit ?? l.defaultUnits;
    blockers.push({
      kind: "unit",
      text: fmt(l.unitMissing, {
        priceUnit,
        unit: line.unit,
        name: nameOfLine(line),
      }),
      fix: "unit_question",
      fix_label: l.sayNow,
      line_key: line.key,
    });
  }
  for (const line of lines) {
    if (line.kind === "unresolved" || line.amount !== null) continue;
    if (line.flags.includes(FLAG_PENDING_UNIT)) continue;
    // A preparation that is not approved is already named above.
    if (line.kind === "component" && line.component_approved === false) {
      continue;
    }
    blockers.push({
      kind: "price",
      text: fmt(l.priceMissing, { name: nameOfLine(line) }),
      fix: "price",
      fix_label: l.setPrice,
      line_key: line.key,
    });
  }
  if (input.classification_unsaved) {
    blockers.push({
      kind: "classification",
      text: l.saveClassification,
      fix: "classification",
      fix_label: l.goClassification,
    });
  }

  return { ready: blockers.length === 0, blockers, first: blockers[0] ?? null };
}

export interface FocusRequest {
  lineKey: string;
  what: "price" | "unit_question";
  nonce: number;
}

/** What clicking the blue link of a blocker does (pure; the screen runs it). */
export type FixStep =
  | { do: "open_preparation"; componentId: string }
  | { do: "focus_line"; request: FocusRequest }
  | { do: "focus_classification" };

export function fixStepFor(
  blocker: ApprovalBlocker,
  previousNonce: number
): FixStep | null {
  if (blocker.fix === "open_preparation" && blocker.component_id) {
    return { do: "open_preparation", componentId: blocker.component_id };
  }
  if (
    (blocker.fix === "price" || blocker.fix === "unit_question") &&
    blocker.line_key
  ) {
    return {
      do: "focus_line",
      request: {
        lineKey: blocker.line_key,
        what: blocker.fix,
        nonce: previousNonce + 1,
      },
    };
  }
  if (blocker.fix === "classification") return { do: "focus_classification" };
  return null;
}
