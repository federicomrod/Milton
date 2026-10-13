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
import { PREPARATION_DRAFT_KIND } from "./prefill-preparations";
import { effectiveDateForNewApprovedVersion } from "@/lib/restaurant/recipe-versions";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import type {
  CostingLoad,
  EditorStore,
  LinkRef,
  NewCostEntry,
  VersionRef,
} from "./editor-service";
import type { VersionInput } from "./editor";

function inputTable(version: VersionRef): { table: string; fk: string } {
  return version.kind === "preparation"
    ? {
        table: "component_recipe_version_inputs",
        fk: "component_recipe_version_id",
      }
    : { table: "recipe_version_inputs", fk: "recipe_version_id" };
}

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

    async saveEvidence(companyId, holder, evidence) {
      if (!holder.id) return;
      if (holder.kind === "dish") {
        const { error } = await supabase
          .from("pos_product_links")
          .update({ evidence, updated_at: new Date().toISOString() })
          .eq("company_id", companyId)
          .eq("id", holder.id);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await supabase
        .from("cost_import_review_items")
        .update({ raw_values: evidence })
        .eq("company_id", companyId)
        .eq("id", holder.id)
        .eq("status", "pending");
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
            kind: "dish",
            menu_item_id: String(row.menu_item_id),
          }
        : null;
    },

    async loadPreparation(companyId, componentId) {
      const { data: comp, error } = await supabase
        .from("prepared_components")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("id", componentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!comp) return null;
      const versions = await supabase
        .from("component_recipe_versions")
        .select(
          "id, status, component_id, component_recipe_id, version_number, output_quantity, output_unit"
        )
        .eq("company_id", companyId)
        .eq("component_id", componentId)
        .order("version_number", { ascending: false })
        .limit(1);
      if (versions.error) throw new Error(versions.error.message);
      const v = versions.data?.[0];
      const items = await supabase
        .from("cost_import_review_items")
        .select("id, raw_values")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .eq("raw_values->>kind", PREPARATION_DRAFT_KIND)
        .eq("raw_values->>component_id", componentId)
        .limit(1);
      if (items.error) throw new Error(items.error.message);
      const item = items.data?.[0];
      return {
        component_id: String(comp.id),
        name: String(comp.name),
        holder: {
          kind: "preparation",
          id: item ? String(item.id) : null,
          evidence:
            item && item.raw_values && typeof item.raw_values === "object"
              ? (item.raw_values as Record<string, unknown>)
              : {},
        },
        version: v
          ? {
              id: String(v.id),
              status: String(v.status),
              kind: "preparation",
              component_id: String(v.component_id),
              component_recipe_id: String(v.component_recipe_id),
              output_quantity: Number(v.output_quantity),
              output_unit: String(v.output_unit),
            }
          : null,
      };
    },

    async listInputs(companyId, version): Promise<VersionInput[]> {
      const t = inputTable(version);
      const { data, error } = await supabase
        .from(t.table)
        .select("id, input_type, ingredient_id, component_id, quantity, unit")
        .eq("company_id", companyId)
        .eq(t.fk, version.id)
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

    async insertInput(companyId, version, row): Promise<VersionInput> {
      const t = inputTable(version);
      const { data, error } = await supabase
        .from(t.table)
        .insert({
          company_id: companyId,
          [t.fk]: version.id,
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

    async updateInput(companyId, version, inputId, patch) {
      const t = inputTable(version);
      const { error } = await supabase
        .from(t.table)
        .update(patch)
        .eq("company_id", companyId)
        .eq(t.fk, version.id)
        .eq("id", inputId);
      if (error) throw new Error(error.message);
    },

    async deleteInput(companyId, version, inputId) {
      const t = inputTable(version);
      const { error } = await supabase
        .from(t.table)
        .delete()
        .eq("company_id", companyId)
        .eq(t.fk, version.id)
        .eq("id", inputId);
      if (error) throw new Error(error.message);
    },

    async setPreparationYield(companyId, version, input) {
      if (version.kind !== "preparation") return;
      const { error } = await supabase
        .from("component_recipe_versions")
        .update({ output_quantity: input.quantity, output_unit: input.unit })
        .eq("company_id", companyId)
        .eq("id", version.id)
        .eq("status", "in_review");
      if (error) throw new Error(error.message);
      if (version.component_recipe_id) {
        const working = await supabase
          .from("component_recipes")
          .update({ output_quantity: input.quantity, output_unit: input.unit })
          .eq("company_id", companyId)
          .eq("id", version.component_recipe_id);
        if (working.error) throw new Error(working.error.message);
      }
    },

    async approvePreparationVersion(companyId, version) {
      if (version.kind !== "preparation" || !version.component_recipe_id) {
        throw new Error("No es una preparación.");
      }
      const siblings = await supabase
        .from("component_recipe_versions")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("component_recipe_id", version.component_recipe_id);
      if (siblings.error) throw new Error(siblings.error.message);
      const { error } = await supabase
        .from("component_recipe_versions")
        .update({
          status: "approved",
          effective_date: effectiveDateForNewApprovedVersion(
            (siblings.data ?? []) as Array<{ status: string }>
          ),
        })
        .eq("company_id", companyId)
        .eq("id", version.id)
        .eq("status", "in_review");
      if (error) throw new Error(error.message);
    },

    async resolveHolder(companyId, holder) {
      if (holder.kind !== "preparation" || !holder.id) return;
      const { error } = await supabase
        .from("cost_import_review_items")
        .update({ status: "approved", resolved_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", holder.id);
      if (error) throw new Error(error.message);
    },

    async dishesUsingPreparation(companyId, componentId) {
      // The preparation, plus every preparation that uses it (any depth).
      const wanted = new Set([componentId]);
      for (let depth = 0; depth < 6; depth++) {
        const { data, error } = await supabase
          .from("component_recipe_version_inputs")
          .select("component_recipe_version_id")
          .eq("company_id", companyId)
          .in("component_id", [...wanted]);
        if (error) throw new Error(error.message);
        const versionIds = [
          ...new Set(
            (data ?? []).map((r) => String(r.component_recipe_version_id))
          ),
        ];
        if (versionIds.length === 0) break;
        const parents = await supabase
          .from("component_recipe_versions")
          .select("component_id")
          .eq("company_id", companyId)
          .in("id", versionIds);
        if (parents.error) throw new Error(parents.error.message);
        const before = wanted.size;
        for (const row of parents.data ?? [])
          wanted.add(String(row.component_id));
        if (wanted.size === before) break;
      }
      const inputs = await supabase
        .from("recipe_version_inputs")
        .select("recipe_version_id")
        .eq("company_id", companyId)
        .in("component_id", [...wanted]);
      if (inputs.error) throw new Error(inputs.error.message);
      const versionIds = [
        ...new Set((inputs.data ?? []).map((r) => String(r.recipe_version_id))),
      ];
      if (versionIds.length === 0) return [];
      const versions = await supabase
        .from("recipe_versions")
        .select("menu_item_id")
        .eq("company_id", companyId)
        .in("id", versionIds);
      if (versions.error) throw new Error(versions.error.message);
      const menuIds = [
        ...new Set((versions.data ?? []).map((r) => String(r.menu_item_id))),
      ];
      if (menuIds.length === 0) return [];
      const links = await supabase
        .from("pos_product_links")
        .select("odoo_product_id, location_id")
        .eq("company_id", companyId)
        .in("menu_item_id", menuIds);
      if (links.error) throw new Error(links.error.message);
      return (links.data ?? []).map((row) => ({
        odooProductId: Number(row.odoo_product_id),
        locationId:
          typeof row.location_id === "string" ? row.location_id : null,
      }));
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

    async createPreparation(companyId, input) {
      const comp = await supabase
        .from("prepared_components")
        .insert({
          company_id: companyId,
          name: input.name,
          output_unit: input.outputUnit,
          status: "active",
          source_type: "manual",
        })
        .select("id, name")
        .single();
      if (comp.error || !comp.data) {
        throw new Error(comp.error?.message ?? "No pude crear la preparación.");
      }
      const componentId = String(comp.data.id);
      const undo = async () => {
        await supabase
          .from("prepared_components")
          .delete()
          .eq("company_id", companyId)
          .eq("id", componentId);
      };
      const recipe = await supabase
        .from("component_recipes")
        .insert({
          company_id: companyId,
          component_id: componentId,
          name: input.name,
          output_quantity: input.outputQuantity,
          output_unit: input.outputUnit,
          status: "active",
          source_type: "manual",
        })
        .select("id")
        .single();
      if (recipe.error || !recipe.data) {
        await undo();
        throw new Error(
          recipe.error?.message ?? "No pude crear la receta de la preparación."
        );
      }
      const version = await supabase.from("component_recipe_versions").insert({
        company_id: companyId,
        component_recipe_id: recipe.data.id,
        component_id: componentId,
        version_number: 1,
        status: "in_review",
        effective_date: null,
        output_quantity: input.outputQuantity,
        output_unit: input.outputUnit,
        source_type: "manual",
      });
      if (version.error) {
        await supabase
          .from("component_recipes")
          .delete()
          .eq("company_id", companyId)
          .eq("id", recipe.data.id);
        await undo();
        throw new Error(version.error.message);
      }
      return { id: componentId, name: String(comp.data.name) };
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
