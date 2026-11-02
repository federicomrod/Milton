// lib/restaurant/prep-yield.ts
//
// Is a preparation's batch output MEASURED? (#407 follow-up.) The default 1 unit
// that an import or a creation writes is not a measurement: it stays «assumed»
// (⚑ falta rendimiento) until a person enters the real batch output. Saving a
// recipe without touching the output never makes it measured. Pure.

export const DEFAULT_OUTPUT_QUANTITY = 1;

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
