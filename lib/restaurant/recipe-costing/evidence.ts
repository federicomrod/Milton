export const UNDO_EVIDENCE_KEY = "__undo";

export interface SuggestionLineView {
  source_row: number | null;
  raw_name: string;
  ingredient_match: string | null;
  sub_recipe_match: string | null;
  qty: number;
  unit: string;
  unit_cost: number | null;
  flags: string[];
  pending: boolean;
  reasons: string[];
}

export interface SuggestionYieldView {
  value: number | null;
  unit: string | null;
  source: string | null;
}

export interface SuggestionEvidenceView {
  tab: string | null;
  block_name: string | null;
  confidence: number | null;
  evidence_text: string | null;
  source: string | null;
  yield: SuggestionYieldView;
  excel_total: number | null;
  milton_cost: number | null;
  excel_match: "match" | "mismatch" | null;
  variance_amount: number | null;
  variance_pct: number | null;
  status: "borrador" | "lista_para_aprobar" | null;
  pending: boolean;
  reasons: string[];
  lines: SuggestionLineView[];
  recipe_version_id: string | null;
  filename: string | null;
}

/** True only when the suggestion is tied to a parsed workbook block with lines. */
export function isBoundSuggestion(evidence: SuggestionEvidenceView): boolean {
  return Boolean(
    evidence.tab && evidence.block_name && evidence.lines.length > 0
  );
}

/**
 * Confirmar is for a parsed workbook recipe, or for a person who picked
 * / created one on purpose. A name-only leftover (exact-name onto an
 * empty draft) is not a suggestion.
 */
export function canConfirmSuggestedLink(
  evidence: SuggestionEvidenceView
): boolean {
  if (isBoundSuggestion(evidence)) return true;
  return (
    evidence.source === "manual_pick" || evidence.source === "create_recipe"
  );
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseSuggestionLine(raw: unknown): SuggestionLineView | null {
  const row = asRecord(raw);
  if (!row) return null;
  const name = asString(row.raw_name);
  if (!name) return null;
  const flags = Array.isArray(row.flags)
    ? row.flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const reasons = Array.isArray(row.reasons)
    ? row.reasons.filter(
        (reason): reason is string => typeof reason === "string"
      )
    : [];
  const pending =
    row.pending === true || flags.some((flag) => flag.startsWith("pendiente_"));
  const unitCost = asNumber(row.unit_cost ?? row.resolved_unit_cost);
  return {
    source_row: asNumber(row.source_row),
    raw_name: name,
    ingredient_match: asString(row.ingredient_match),
    sub_recipe_match: asString(row.sub_recipe_match),
    qty: asNumber(row.qty) ?? 0,
    unit: asString(row.unit ?? row.resolved_unit) ?? "",
    unit_cost: pending ? null : unitCost,
    flags,
    pending,
    reasons,
  };
}

export function parseSuggestionEvidence(
  raw: Record<string, unknown> | null | undefined
): SuggestionEvidenceView {
  const ev = raw ?? {};
  const nested = asRecord(ev.evidence);
  const evidenceText =
    asString(ev.evidence) ??
    asString(nested?.text) ??
    asString(nested?.summary) ??
    null;
  const yieldRaw = asRecord(ev.yield);
  const lines = Array.isArray(ev.lines)
    ? ev.lines
        .map(parseSuggestionLine)
        .filter((line): line is SuggestionLineView => line !== null)
    : [];
  const status =
    ev.status === "lista_para_aprobar" || ev.status === "borrador"
      ? ev.status
      : null;
  const excelMatch =
    ev.excel_match === "match" || ev.excel_match === "mismatch"
      ? ev.excel_match
      : null;
  return {
    tab: asString(ev.tab),
    block_name: asString(ev.block_name),
    confidence: asNumber(ev.confidence),
    evidence_text: evidenceText,
    source: asString(ev.source),
    yield: {
      value: asNumber(yieldRaw?.value),
      unit: asString(yieldRaw?.unit),
      source: asString(yieldRaw?.source),
    },
    excel_total: asNumber(ev.excel_total),
    milton_cost: asNumber(ev.milton_cost),
    excel_match: excelMatch,
    variance_amount: asNumber(ev.variance_amount),
    variance_pct: asNumber(ev.variance_pct),
    status,
    pending: ev.pending === true || lines.some((line) => line.pending),
    reasons: Array.isArray(ev.reasons)
      ? ev.reasons.filter(
          (reason): reason is string => typeof reason === "string"
        )
      : [],
    lines,
    recipe_version_id: asString(ev.recipe_version_id),
    filename: asString(ev.filename),
  };
}

export function evidenceWithoutUndo(
  evidence: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...evidence };
  delete next[UNDO_EVIDENCE_KEY];
  return next;
}

export function readUndoSnapshot(
  evidence: Record<string, unknown>
): Record<string, unknown> | null {
  return asRecord(evidence[UNDO_EVIDENCE_KEY]);
}
