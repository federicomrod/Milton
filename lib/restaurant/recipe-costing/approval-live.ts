// Aprobar, from the LIVE lines (the ones the editor shows and totals), never
// from the evidence snapshot saved at import time. ONE pure function used by
// the screen (plato.ts primaryAction) and by the server (approval-server.ts),
// so both always refuse for the same reason.
//
// A dish is one plate: it needs no yield. It can be approved when it has
// at least one line, every line has a cost, nothing is unresolved or waiting
// for a unit, and every preparation it uses is approved.

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

function nameOf(line: EditorLine): string {
  return (line.name ?? line.raw_name).trim() || "este ingrediente";
}

export function liveApproval(input: LiveApprovalInput): LiveApproval {
  const blockers: ApprovalBlocker[] = [];
  const { lines } = input;

  if (lines.length === 0) {
    blockers.push({
      kind: "no_lines",
      text: "La receta no tiene ingredientes.",
      fix: null,
      fix_label: null,
    });
  }
  for (const line of lines) {
    if (line.kind !== "unresolved") continue;
    blockers.push({
      kind: "unresolved",
      text: `Falta elegir el ingrediente de ${nameOf(line)}`,
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
      text: `Primero aprueba la preparación ${nameOf(line)}`,
      fix: "open_preparation",
      fix_label: "Abrir la preparación",
      line_key: line.key,
      ...(line.component_id ? { component_id: line.component_id } : {}),
    });
  }
  for (const line of lines) {
    if (line.kind === "unresolved") continue;
    if (!line.flags.includes(FLAG_PENDING_UNIT)) continue;
    const priceUnit = line.price?.unit ?? "unidades";
    blockers.push({
      kind: "unit",
      text: `Falta decir cuántas ${priceUnit} lleva 1 ${line.unit} de ${nameOf(line)}`,
      fix: "unit_question",
      fix_label: "Decirlo ahora",
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
      text: `Falta el precio de ${nameOf(line)}`,
      fix: "price",
      fix_label: "Poner el precio",
      line_key: line.key,
    });
  }
  if (input.classification_unsaved) {
    blockers.push({
      kind: "classification",
      text: "Guarda el tipo de plato primero",
      fix: "classification",
      fix_label: "Ir al tipo de plato",
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
