// lib/restaurant/odoo/company-selection.ts
//
// Pure rules for choosing which Odoo companies a Milton tenant syncs from.
// IDs come from Odoo discovery (accessible), never typed by hand. With
// several accessible companies Milton NEVER guesses: nothing is selected
// until someone explicitly chooses.

export interface OdooCompanyRef {
  id: number;
  name: string;
}

export type OdooCompanySelectionResult =
  | { ok: true; selected: number[] | null; selectionRequired: boolean }
  | {
      ok: false;
      error: string;
      accessible: OdooCompanyRef[];
      /** Suggested HTTP status for the caller. */
      status: 400 | 409;
    };

export function resolveOdooCompanySelection(input: {
  requested?: unknown;
  accessible: OdooCompanyRef[];
  existing: number[] | null | undefined;
}): OdooCompanySelectionResult {
  const { requested, accessible, existing } = input;
  const accessibleIds = new Set(accessible.map((c) => c.id));

  if (accessible.length === 0) {
    return {
      ok: false,
      error: "Odoo user has no accessible companies",
      accessible,
      status: 409,
    };
  }

  if (requested !== undefined && requested !== null) {
    if (!Array.isArray(requested) || requested.length === 0) {
      return {
        ok: false,
        error: "odoo_company_ids must be a non-empty array of company IDs",
        accessible,
        status: 400,
      };
    }
    const invalid = requested.some(
      (id) => typeof id !== "number" || !accessibleIds.has(id)
    );
    if (invalid) {
      return {
        ok: false,
        error:
          "odoo_company_ids contains a company this Odoo user cannot access",
        accessible,
        status: 400,
      };
    }
    return {
      ok: true,
      selected: Array.from(new Set(requested as number[])),
      selectionRequired: false,
    };
  }

  if (accessible.length === 1) {
    return { ok: true, selected: [accessible[0].id], selectionRequired: false };
  }

  if (
    Array.isArray(existing) &&
    existing.length > 0 &&
    existing.every((id) => accessibleIds.has(id))
  ) {
    return { ok: true, selected: existing, selectionRequired: false };
  }
  return { ok: true, selected: null, selectionRequired: true };
}
