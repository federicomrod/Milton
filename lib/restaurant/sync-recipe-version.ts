import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecipeInputSnapshot } from "@/lib/restaurant/cost-workbook/types";
import {
  effectiveDateForNewApprovedVersion,
  nextVersionNumber,
} from "@/lib/restaurant/recipe-versions";

export const RECIPE_VERSIONS_READ_ERROR_ES =
  "No pude leer las versiones de la receta. Avísale al equipo técnico.";
export const COMPONENT_RECIPE_VERSIONS_READ_ERROR_ES =
  "No pude leer las versiones de la sub-receta. Avísale al equipo técnico.";
export const RECIPE_VERSIONS_WRITE_ERROR_ES =
  "No pude guardar la versión de la receta. Avísale al equipo técnico.";
export const COMPONENT_RECIPE_VERSIONS_WRITE_ERROR_ES =
  "No pude guardar la versión de la sub-receta. Avísale al equipo técnico.";

type VersionRow = {
  id: string;
  version_number: number;
  status: string;
  effective_date: string | null;
};

function isSoleFirstApproved(versions: VersionRow[]): boolean {
  return (
    versions.length === 1 &&
    versions[0].status === "approved" &&
    versions[0].effective_date == null
  );
}

function throwReadError(kind: "recipe" | "component", message?: string): never {
  const base =
    kind === "recipe"
      ? RECIPE_VERSIONS_READ_ERROR_ES
      : COMPONENT_RECIPE_VERSIONS_READ_ERROR_ES;
  throw new Error(message ? `${base} (${message})` : base);
}

function throwWriteError(
  kind: "recipe" | "component",
  message?: string
): never {
  const base =
    kind === "recipe"
      ? RECIPE_VERSIONS_WRITE_ERROR_ES
      : COMPONENT_RECIPE_VERSIONS_WRITE_ERROR_ES;
  throw new Error(message ? `${base} (${message})` : base);
}

/**
 * Hand save: recorded as approved for now. Today, hand-entered recipes
 * already count. The Aprobar gate for hand edits comes in #164.
 *
 * When no approved version exists yet, the first approved version gets
 * a NULL effective_date so it covers all loaded history. Later approved
 * versions get today's date and never rewrite earlier periods.
 */
export async function syncApprovedMenuRecipeVersion(input: {
  supabase: SupabaseClient;
  companyId: string;
  recipeId: string;
  menuItemId: string;
  sourceType?: string | null;
  inputs: RecipeInputSnapshot[];
}): Promise<void> {
  const listed = await input.supabase
    .from("recipe_versions")
    .select("id, version_number, status, effective_date")
    .eq("company_id", input.companyId)
    .eq("recipe_id", input.recipeId)
    .order("version_number", { ascending: true });
  if (listed.error) {
    throwReadError("recipe", listed.error.message);
  }
  const versions = (listed.data ?? []) as VersionRow[];
  if (isSoleFirstApproved(versions) && versions[0]) {
    await replaceVersionInputs(
      input.supabase,
      "recipe_version_inputs",
      "recipe_version_id",
      versions[0].id,
      input.companyId,
      input.inputs
    );
    return;
  }
  const created = await input.supabase
    .from("recipe_versions")
    .insert({
      company_id: input.companyId,
      recipe_id: input.recipeId,
      menu_item_id: input.menuItemId,
      version_number: versions.length === 0 ? 1 : nextVersionNumber(versions),
      status: "approved",
      effective_date: effectiveDateForNewApprovedVersion(versions),
      source_type: input.sourceType ?? "manual",
    })
    .select("id")
    .single();
  if (created.error || !created.data) {
    throwWriteError("recipe", created.error?.message);
  }
  await insertVersionInputs(
    input.supabase,
    "recipe_version_inputs",
    "recipe_version_id",
    created.data.id,
    input.companyId,
    input.inputs
  );
}

/**
 * Hand save: recorded as approved for now. Today, hand-entered recipes
 * already count. The Aprobar gate for hand edits comes in #164.
 */
export async function syncApprovedComponentRecipeVersion(input: {
  supabase: SupabaseClient;
  companyId: string;
  componentRecipeId: string;
  componentId: string;
  outputQuantity: number;
  outputUnit: string;
  sourceType?: string | null;
  inputs: RecipeInputSnapshot[];
}): Promise<void> {
  const listed = await input.supabase
    .from("component_recipe_versions")
    .select("id, version_number, status, effective_date")
    .eq("company_id", input.companyId)
    .eq("component_recipe_id", input.componentRecipeId)
    .order("version_number", { ascending: true });
  if (listed.error) {
    throwReadError("component", listed.error.message);
  }
  const versions = (listed.data ?? []) as VersionRow[];
  if (isSoleFirstApproved(versions) && versions[0]) {
    await input.supabase
      .from("component_recipe_versions")
      .update({
        output_quantity: input.outputQuantity,
        output_unit: input.outputUnit,
        source_type: input.sourceType ?? "manual",
      })
      .eq("id", versions[0].id);
    await replaceVersionInputs(
      input.supabase,
      "component_recipe_version_inputs",
      "component_recipe_version_id",
      versions[0].id,
      input.companyId,
      input.inputs
    );
    return;
  }
  const created = await input.supabase
    .from("component_recipe_versions")
    .insert({
      company_id: input.companyId,
      component_recipe_id: input.componentRecipeId,
      component_id: input.componentId,
      version_number: versions.length === 0 ? 1 : nextVersionNumber(versions),
      status: "approved",
      effective_date: effectiveDateForNewApprovedVersion(versions),
      output_quantity: input.outputQuantity,
      output_unit: input.outputUnit,
      source_type: input.sourceType ?? "manual",
    })
    .select("id")
    .single();
  if (created.error || !created.data) {
    throwWriteError("component", created.error?.message);
  }
  await insertVersionInputs(
    input.supabase,
    "component_recipe_version_inputs",
    "component_recipe_version_id",
    created.data.id,
    input.companyId,
    input.inputs
  );
}

async function replaceVersionInputs(
  supabase: SupabaseClient,
  table: string,
  fk: string,
  versionId: string,
  companyId: string,
  inputs: RecipeInputSnapshot[]
) {
  await supabase.from(table).delete().eq(fk, versionId);
  await insertVersionInputs(supabase, table, fk, versionId, companyId, inputs);
}

async function insertVersionInputs(
  supabase: SupabaseClient,
  table: string,
  fk: string,
  versionId: string,
  companyId: string,
  inputs: RecipeInputSnapshot[]
) {
  if (inputs.length === 0) return;
  await supabase.from(table).insert(
    inputs.map((row) => ({
      company_id: companyId,
      [fk]: versionId,
      input_type: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      quantity: row.quantity,
      unit: row.unit,
      notes: row.notes,
    }))
  );
}
