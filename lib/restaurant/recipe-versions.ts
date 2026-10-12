import type { CostingRecipeInput } from "@/lib/restaurant/costing";

export type RecipeVersionStatus = "approved" | "in_review";

export interface RecipeVersionRecord {
  id: string;
  recipe_id: string;
  menu_item_id: string;
  version_number: number;
  status: RecipeVersionStatus;
  /** NULL = first approved version, applies to all loaded history. */
  effective_date: string | null;
  source_type?: string | null;
}

export interface ComponentRecipeVersionRecord {
  id: string;
  component_recipe_id: string;
  component_id: string;
  version_number: number;
  status: RecipeVersionStatus;
  effective_date: string | null;
  output_quantity: number;
  output_unit: string;
  source_type?: string | null;
}

export interface RecipeVersionSnapshot<T extends { status: string }> {
  version: T;
  inputs: CostingRecipeInput[];
}

/**
 * Approved version in force on `asOfDate`.
 * First approved version (NULL effective_date) covers all history.
 * A later approved version wins from its effective_date forward.
 * Versions still in review never replace an approved one.
 */
export function pickApprovedVersion<
  T extends {
    status: string;
    effective_date: string | null;
    version_number: number;
  },
>(versions: T[], asOfDate?: string | null): T | null {
  const approved = versions.filter((row) => row.status === "approved");
  if (approved.length === 0) return null;
  const asOf = (asOfDate ?? todayUtcDate()).slice(0, 10);
  const first =
    approved.find((row) => row.effective_date == null) ??
    approved.slice().sort((a, b) => a.version_number - b.version_number)[0];
  const later = approved.filter(
    (row) => row.effective_date != null && row.effective_date <= asOf
  );
  if (later.length === 0) return first ?? null;
  later.sort((a, b) => {
    const dateCmp = (a.effective_date ?? "").localeCompare(
      b.effective_date ?? ""
    );
    if (dateCmp !== 0) return dateCmp;
    return a.version_number - b.version_number;
  });
  return later[later.length - 1] ?? first ?? null;
}

export function nextVersionNumber(
  versions: Array<{ version_number: number }>
): number {
  return (
    versions.reduce(
      (max, row) => (row.version_number > max ? row.version_number : max),
      0
    ) + 1
  );
}

export function hasApprovedVersion(
  versions: Array<{ status: string }>
): boolean {
  return versions.some((row) => row.status === "approved");
}

/**
 * First approved version covers all loaded history (NULL date).
 * Later approved versions start today and never rewrite earlier periods.
 */
export function effectiveDateForNewApprovedVersion(
  versions: Array<{ status: string }>
): string | null {
  return hasApprovedVersion(versions) ? todayUtcDate() : null;
}

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}
