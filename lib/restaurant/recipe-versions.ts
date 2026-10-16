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
  notes?: string | null;
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
 * Among the approved versions that have STARTED (no effective date, or one on
 * or before the day), the HIGHEST version number wins, whatever the order of
 * the array. A future-dated version only counts once its date arrives.
 * If none has started (every approved version is dated in the future) the
 * lowest-numbered one is the base that covers the history before them.
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
  const started = approved.filter(
    (row) => row.effective_date == null || row.effective_date <= asOf
  );
  if (started.length > 0) {
    return started.reduce((best, row) =>
      row.version_number > best.version_number ? row : best
    );
  }
  return approved.reduce((best, row) =>
    row.version_number < best.version_number ? row : best
  );
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
