// lib/restaurant/prep-yield.ts
//
// Is a preparation's batch output MEASURED? (#407 follow-up.) The default 1 unit
// that an import or a creation writes is not a measurement: it stays «assumed»
// (⚑ falta rendimiento) until a person enters the real batch output. Saving a
// recipe without touching the output never makes it measured. Pure.

export const DEFAULT_OUTPUT_QUANTITY = 1;

export interface ParsedYield {
  value: number;
  unit: string;
  confirmed: boolean;
  source: string | null;
}

/**
 * What a draft's evidence says about the batch output, or null when it has no
 * USABLE reading (no yield object, or a value that is not a number above 0).
 * The ONE place that reads it: the editor, the preparation graph and the
 * Preparaciones list all go through here.
 */
export function parseYield(
  evidence: Record<string, unknown> | null | undefined
): ParsedYield | null {
  const raw = evidence?.yield;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const value = typeof row.value === "number" ? row.value : Number(row.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    value,
    unit: typeof row.unit === "string" ? row.unit : "unit",
    confirmed: row.confirmed !== false && row.source !== "assumed",
    source: typeof row.source === "string" ? row.source : null,
  };
}

/** The reading as `isMeasuredOutput` takes it: null = fall back to the version. */
export function yieldEvidenceOf(
  evidence: Record<string, unknown> | null | undefined
): { confirmed: boolean } | null {
  const y = parseYield(evidence);
  return y ? { confirmed: y.confirmed } : null;
}

export interface PrepOutput {
  quantity: number | null | undefined;
  /** The version's status: «approved» needed a confirmed yield to be approved. */
  status: string | null | undefined;
  /** What the open draft says about the yield, when there is one. */
  evidence: { confirmed: boolean } | null;
}

export function isMeasuredOutput(i: PrepOutput): boolean {
  // An explicit reading wins: «assumed» / unconfirmed is NOT measured.
  if (i.evidence) return i.evidence.confirmed;
  const q = Number(i.quantity);
  if (!(q > 0)) return false;
  // Approving a preparation required a confirmed yield.
  if (i.status === "approved") return true;
  // Not approved and nobody confirmed it: the default 1 is only a placeholder.
  return q !== DEFAULT_OUTPUT_QUANTITY;
}

/** The «Falta rendimiento» filter: exactly the flagged preparations, or all of them. */
export function filterMissingYield<T extends { yield_to_confirm: boolean }>(
  rows: readonly T[],
  onlyMissing: boolean
): T[] {
  return onlyMissing ? rows.filter((r) => r.yield_to_confirm) : [...rows];
}

// ---------------------------------------------------------------------------
// «Confirmar 1 unidad»: a person says the default 1 unit IS the real output.
// It is stored in the draft's own yield reading (no new table) with who and
// when, and every confirm / undo is appended to a history. Reversible.
// ---------------------------------------------------------------------------

/** The `source` a confirmed default carries. */
export const CONFIRMED_DEFAULT_SOURCE = "confirmed_default";
const YIELD_HISTORY_MAX = 50;

export interface YieldHistoryEntry {
  at: string;
  by: string | null;
  byName: string | null;
  action: "confirm" | "revoke";
  value: number;
  unit: string;
}

/** The history kept in the yield reading; malformed entries are dropped. */
export function readYieldHistory(
  evidence: Record<string, unknown> | null | undefined
): YieldHistoryEntry[] {
  const y = evidence?.yield;
  const raw =
    y && typeof y === "object" ? (y as Record<string, unknown>).history : null;
  if (!Array.isArray(raw)) return [];
  const out: YieldHistoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (
      typeof r.at !== "string" ||
      (r.action !== "confirm" && r.action !== "revoke")
    )
      continue;
    out.push({
      at: r.at,
      by: typeof r.by === "string" ? r.by : null,
      byName: typeof r.byName === "string" ? r.byName : null,
      action: r.action,
      value: Number(r.value),
      unit: typeof r.unit === "string" ? r.unit : "unit",
    });
  }
  return out;
}

/** Is the yield in force a person's «confirm the default»? (so «Deshacer» applies) */
export function isConfirmedDefault(
  evidence: Record<string, unknown> | null | undefined
): boolean {
  const y = parseYield(evidence);
  return y !== null && y.confirmed && y.source === CONFIRMED_DEFAULT_SOURCE;
}

/**
 * The next yield reading after «Confirmar 1 unidad» (confirm = true) or
 * «Deshacer confirmación» (false). Keeps the reading's other fields and appends
 * to the history; nothing is overwritten.
 */
export function nextYieldReading(
  evidence: Record<string, unknown>,
  input: {
    confirm: boolean;
    value: number;
    unit: string;
    by: string | null;
    byName: string | null;
    at: string;
  }
): Record<string, unknown> {
  const prev =
    evidence.yield &&
    typeof evidence.yield === "object" &&
    !Array.isArray(evidence.yield)
      ? (evidence.yield as Record<string, unknown>)
      : {};
  const history = [
    ...readYieldHistory(evidence),
    {
      at: input.at,
      by: input.by,
      byName: input.byName,
      action: input.confirm ? "confirm" : "revoke",
      value: input.value,
      unit: input.unit,
    },
  ].slice(-YIELD_HISTORY_MAX);
  return {
    ...prev,
    value: input.value,
    unit: input.unit,
    confirmed: input.confirm,
    source: input.confirm ? CONFIRMED_DEFAULT_SOURCE : "assumed",
    confirmed_by: input.confirm ? input.by : null,
    confirmed_at: input.confirm ? input.at : null,
    history,
  };
}
