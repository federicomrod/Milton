// Supabase implementation of EditorStore. Every query is scoped by the
// company that came from auth; ids from the client are only ever matched
// inside that company.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CostingComponentRecipe,
  CostingData,
  CostingRecipeInput,
} from "@/lib/restaurant/costing";
import { fetchCostingRecipeVersions } from "@/lib/restaurant/costing-versions";
import { buildIngredientCostEntryInsert } from "@/lib/restaurant/cost-import";
import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { fetchAllRowsRetryingWithoutColumns } from "@/lib/restaurant/missing-schema-column";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { loadPosProductLink } from "./link-actions-server";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import type {
  CostingLoad,
  EditorStore,
  LinkRef,
  NewCostEntry,
  VersionRef,
} from "./editor-service";
import type { VersionInput } from "./editor";

const ENTRY_SELECT =
  "id, ingredient_id, supplier_id, source_type, source_id, cost_date, effective_date, date_source, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at";

function sourceLabel(entry: IngredientCostEntry | undefined): string {
  if (!entry) return "lista";
  if (entry.source_type === "manual") return "manual";
  if (entry.source_type === "invoice_line") return "factura";
  if (typeof entry.notes === "string" && entry.notes.startsWith("Receta"))
    return "recetas";
  return "lista";
}

export function createSupabaseEditorStore(
  supabase: SupabaseClient
): EditorStore {
  return {
    async loadCosting(companyId): Promise<CostingLoad> {
      const [
        ingredients,
        entries,
        components,
        componentRecipes,
        componentInputs,
        versions,
      ] = await Promise.all([
        fetchAllRows<{ id: string; name: string; default_unit: string | null }>(
          () =>
            supabase
              .from("ingredients")
              .select("id, name, default_unit")
              .eq("company_id", companyId)
        ),
        fetchAllRowsRetryingWithoutColumns<IngredientCostEntry>(
          ["effective_date", "date_source"],
          (select) =>
            supabase
              .from("ingredient_cost_entries")
              .select(select)
              .eq("company_id", companyId),
          ENTRY_SELECT
        ),
        fetchAllRows<{
          id: string;
          name: string;
          output_unit: string | null;
          status: string | null;
        }>(() =>
          supabase
            .from("prepared_components")
            .select("id, name, output_unit, status")
            .eq("company_id", companyId)
        ),
        fetchAllRows<CostingComponentRecipe>(() =>
          supabase
            .from("component_recipes")
            .select("id, component_id, output_quantity, output_unit, status")
            .eq("company_id", companyId)
        ),
        fetchAllRows<{
          component_recipe_id: string;
          input_type: "ingredient" | "component";
          ingredient_id: string | null;
          component_id: string | null;
          quantity: number;
          unit: string;
        }>(() =>
          supabase
            .from("component_recipe_inputs")
            .select(
              "component_recipe_id, input_type, ingredient_id, component_id, quantity, unit"
            )
            .eq("company_id", companyId)
        ),
        fetchCostingRecipeVersions(supabase, companyId),
      ]);
      for (const res of [ingredients, entries, components]) {
        if (res.error) throw new Error(res.error.message);
      }

      const costEntriesByIngredientId = new Map<
        string,
        IngredientCostEntry[]
      >();
      const entryById = new Map<string, IngredientCostEntry>();
      for (const entry of entries.rows) {
        const list = costEntriesByIngredientId.get(entry.ingredient_id) ?? [];
        list.push(entry);
        costEntriesByIngredientId.set(entry.ingredient_id, list);
        entryById.set(entry.id, entry);
      }
      const inputsByRecipe = new Map<string, CostingRecipeInput[]>();
      for (const row of componentInputs.rows) {
        const list = inputsByRecipe.get(row.component_recipe_id) ?? [];
        list.push({
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
        });
        inputsByRecipe.set(row.component_recipe_id, list);
      }
      const data: CostingData = {
        ingredientsById: new Map(ingredients.rows.map((r) => [r.id, r])),
        componentsById: new Map(
          components.rows.map((c) => [
            c.id,
            {
              id: c.id,
              name: c.name,
              status: c.status ?? "draft",
              output_unit: c.output_unit ?? "",
            },
          ])
        ),
        componentRecipesByComponentId: new Map(
          componentRecipes.rows.map((r) => [
            r.component_id,
            { ...r, status: r.status ?? "draft" },
          ])
        ),
        componentRecipeInputsByRecipeId: inputsByRecipe,
        menuItemsById: new Map(),
        menuRecipesByMenuItemId: new Map(),
        menuRecipeInputsByRecipeId: new Map(),
        costEntriesByIngredientId,
        menuRecipeVersionsByMenuItemId: versions.menuRecipeVersionsByMenuItemId,
        menuRecipeVersionInputsByVersionId:
          versions.menuRecipeVersionInputsByVersionId,
        componentRecipeVersionsByComponentId:
          versions.componentRecipeVersionsByComponentId,
        componentRecipeVersionInputsByVersionId:
          versions.componentRecipeVersionInputsByVersionId,
      };
      return {
        data,
        sourceOf: (entryId) =>
          sourceLabel(entryId ? entryById.get(entryId) : undefined),
      };
    },

    async loadLink(
      companyId,
      odooProductId,
      locationId
    ): Promise<LinkRef | null> {
      const link = await loadPosProductLink(
        supabase,
        companyId,
        odooProductId,
        locationId
      );
      if (!link || !link.id) return null;
      return {
        id: link.id,
        menu_item_id: link.menu_item_id,
        evidence: link.evidence,
      };
    },

    async saveEvidence(companyId, linkId, evidence) {
      const { error } = await supabase
        .from("pos_product_links")
        .update({ evidence, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", linkId);
      if (error) throw new Error(error.message);
    },

    async latestVersion(companyId, menuItemId): Promise<VersionRef | null> {
      const { data, error } = await supabase
        .from("recipe_versions")
        .select("id, status, menu_item_id, version_number")
        .eq("company_id", companyId)
        .eq("menu_item_id", menuItemId)
        .order("version_number", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const row = data?.[0];
      return row
        ? {
            id: String(row.id),
            status: String(row.status),
            menu_item_id: String(row.menu_item_id),
          }
        : null;
    },

    async listInputs(companyId, versionId): Promise<VersionInput[]> {
      const { data, error } = await supabase
        .from("recipe_version_inputs")
        .select("id, input_type, ingredient_id, component_id, quantity, unit")
        .eq("company_id", companyId)
        .eq("recipe_version_id", versionId)
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        input_type: row.input_type === "component" ? "component" : "ingredient",
        ingredient_id:
          typeof row.ingredient_id === "string" ? row.ingredient_id : null,
        component_id:
          typeof row.component_id === "string" ? row.component_id : null,
        quantity: Number(row.quantity),
        unit: String(row.unit),
      }));
    },

    async insertInput(companyId, versionId, row): Promise<VersionInput> {
      const { data, error } = await supabase
        .from("recipe_version_inputs")
        .insert({
          company_id: companyId,
          recipe_version_id: versionId,
          input_type: row.input_type,
          ingredient_id: row.ingredient_id,
          component_id: row.component_id,
          quantity: row.quantity,
          unit: row.unit,
          notes: null,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "No pude guardar la línea.");
      }
      return { id: String(data.id), ...row };
    },

    async updateInput(companyId, versionId, inputId, patch) {
      const { error } = await supabase
        .from("recipe_version_inputs")
        .update(patch)
        .eq("company_id", companyId)
        .eq("recipe_version_id", versionId)
        .eq("id", inputId);
      if (error) throw new Error(error.message);
    },

    async deleteInput(companyId, versionId, inputId) {
      const { error } = await supabase
        .from("recipe_version_inputs")
        .delete()
        .eq("company_id", companyId)
        .eq("recipe_version_id", versionId)
        .eq("id", inputId);
      if (error) throw new Error(error.message);
    },

    async createIngredient(companyId, input) {
      const { data, error } = await supabase
        .from("ingredients")
        .insert({
          company_id: companyId,
          name: input.name,
          default_unit: input.defaultUnit,
          current_unit_cost: null,
          currency: input.currency,
        })
        .select("id, name, default_unit")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? "No pude crear el ingrediente.");
      }
      return {
        id: String(data.id),
        name: String(data.name),
        default_unit:
          typeof data.default_unit === "string" ? data.default_unit : null,
      };
    },

    async addCostEntry(companyId, entry: NewCostEntry) {
      const { data: ing, error: ingError } = await supabase
        .from("ingredients")
        .select("id, default_unit")
        .eq("company_id", companyId)
        .eq("id", entry.ingredientId)
        .maybeSingle();
      if (ingError) throw new Error(ingError.message);
      if (!ing) throw new Error("No encontré el ingrediente.");
      const built = buildIngredientCostEntryInsert({
        companyId,
        ingredientId: entry.ingredientId,
        ingredientDefaultUnit:
          typeof ing.default_unit === "string" ? ing.default_unit : null,
        supplierId: null,
        sourceId: null,
        row: {
          rowIndex: 0,
          cost_date: entry.date,
          supplier_name: "",
          ingredient_name: "",
          quantity: 1,
          unit: entry.unit,
          total_cost: entry.unitCost,
          currency: entry.currency,
          notes: entry.note,
          supplier_item_name: null,
          supplier_sku: null,
        },
      });
      if (!built.ok) throw new Error(built.reason);
      const { error } = await supabase.from("ingredient_cost_entries").insert({
        ...built.insert,
        source_type: "manual",
        effective_date: entry.date,
        date_source: entry.dateSource,
      });
      if (error) throw new Error(error.message);
      const { error: updateError } = await supabase
        .from("ingredients")
        .update({
          current_unit_cost: built.insert.normalized_unit_cost,
          currency: entry.currency,
        })
        .eq("company_id", companyId)
        .eq("id", entry.ingredientId);
      if (updateError) throw new Error(updateError.message);
    },

    async loadAliases(companyId) {
      const map = new Map<string, string>();
      try {
        const { data, error } = await supabase
          .from("ingredient_aliases")
          .select("alias_name, ingredient_id")
          .eq("company_id", companyId);
        if (error) return map;
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          if (
            typeof row.alias_name === "string" &&
            typeof row.ingredient_id === "string"
          ) {
            map.set(
              row.alias_name
                .normalize("NFD")
                .replace(/\p{M}/gu, "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .replace(/\s+/g, " ")
                .trim(),
              row.ingredient_id
            );
          }
        }
      } catch {
        // No alias table yet: nothing remembered.
      }
      return map;
    },

    async rememberAlias(input) {
      const key = aliasKeyFor(input.aliasName);
      if (!key) return;
      const { error } = await supabase.from("ingredient_aliases").upsert(
        {
          company_id: input.companyId,
          alias_key: key,
          alias_name: input.aliasName.trim(),
          ingredient_id: input.ingredientId,
          created_by: input.userId,
        },
        { onConflict: "company_id,alias_key" }
      );
      if (error) throw new Error(error.message);
    },

    async currency(companyId) {
      return (await resolveCompanyCurrency(supabase, companyId)) || "USD";
    },
  };
}
