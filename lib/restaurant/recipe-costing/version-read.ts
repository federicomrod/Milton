// The recipe version row that Aprobar y siguiente reads once and hands to
// the link step and the approval (R1-12), instead of each reading it.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadInReviewVersion(
  supabase: SupabaseClient,
  companyId: string,
  recipeVersionId: string
) {
  const { data, error } = await supabase
    .from("recipe_versions")
    .select(
      "id, recipe_id, menu_item_id, version_number, status, effective_date, source_type, notes"
    )
    .eq("company_id", companyId)
    .eq("id", recipeVersionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** The recipe version row both approval paths read. */
export type InReviewVersionRow = NonNullable<
  Awaited<ReturnType<typeof loadInReviewVersion>>
>;
