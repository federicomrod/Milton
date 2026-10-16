// In-memory EditorStore for tests. Company-scoped like the real one.

import type { CostingData } from "@/lib/restaurant/costing";
import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";
import {
  convertPriceWithIngredientConversions,
  normalizeUnit,
} from "@/lib/restaurant/units";
import { unitMismatchMessage } from "@/lib/restaurant/cost-import";
import { groupConversions } from "@/lib/restaurant/unit-conversions-server";
import type {
  CatalogQuestion,
  VersionInput,
} from "@/lib/restaurant/recipe-costing/editor";
import type {
  EditorStore,
  LinkRef,
  NewCostEntry,
  VersionRef,
} from "@/lib/restaurant/recipe-costing/editor-service";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import type { ApprovalRecord } from "@/lib/restaurant/recipe-costing/approval-audit";

export interface MemoryEditorState {
  companyId: string;
  currency: string;
  ingredients: Array<{
    id: string;
    name: string;
    default_unit: string | null;
    archived?: boolean;
  }>;
  entries: IngredientCostEntry[];
  components: Array<{ id: string; name: string; output_unit: string }>;
  componentRecipes: Array<{
    id: string;
    component_id: string;
    output_quantity: number;
    output_unit: string;
  }>;
  componentInputs: Array<{
    component_recipe_id: string;
    ingredient_id: string;
    quantity: number;
    unit: string;
  }>;
  link: {
    id: string;
    menu_item_id: string | null;
    evidence: Record<string, unknown>;
  } | null;
  version: VersionRef | null;
  inputs: VersionInput[];
  /** The approved version in force when it is NOT the newest one (a later one has a future date). */
  inForceVersion?: VersionRef | null;
  /** Versions replaced by a newer draft («Crear versión nueva»), untouched. */
  olderVersions?: Array<{ version: VersionRef; inputs: VersionInput[] }>;
  aliases: Array<{
    key: string;
    name: string;
    ingredient_id: string;
    by: string | null;
  }>;
  failAlias?: boolean;
  /** Merges not undone: the ingredient that was merged away and its survivor. */
  merges?: Array<{ loserId: string; survivorName: string }>;
  /** Per-ingredient unit bridges (migration 056). */
  conversions?: Array<{
    ingredient_id: string;
    from_unit: string;
    to_unit: string;
    factor: number;
  }>;
  seq: number;
  /** Open unclear price-list rows (catalog_row review items). */
  catalogRows?: Array<{
    id: string;
    name: string;
    ingredient_id: string | null;
    reason: string;
    options: Array<{ unit: string; unit_cost: number }>;
    status: "pending" | "approved" | "skipped";
  }>;
  /** Preparations with their own (draft or approved) version. */
  preparations: Array<{
    component_id: string;
    name: string;
    version: VersionRef | null;
    inputs: VersionInput[];
    /** The open review item that holds its evidence, if any. */
    holder: { id: string; evidence: Record<string, unknown> } | null;
    resolved?: boolean;
    /** Who approved it (migration 041). */
    approval?: ApprovalRecord;
  }>;
}

export function memoryEditorState(
  patch: Partial<MemoryEditorState> = {}
): MemoryEditorState {
  return {
    companyId: "co-1",
    currency: "USD",
    ingredients: [],
    entries: [],
    components: [],
    componentRecipes: [],
    componentInputs: [],
    preparations: [],
    link: null,
    version: null,
    inputs: [],
    aliases: [],
    seq: 0,
    ...patch,
  };
}

export function entry(
  ingredientId: string,
  unit: string,
  unitCost: number,
  extra: Partial<IngredientCostEntry> = {}
): IngredientCostEntry {
  return {
    id: `e-${ingredientId}-${unitCost}`,
    company_id: "co-1",
    ingredient_id: ingredientId,
    supplier_id: null,
    source_type: "import",
    source_id: null,
    cost_date: "2026-04-01",
    effective_date: "2026-04-01",
    date_source: "dated_price_list",
    quantity: 1,
    unit,
    total_cost: unitCost,
    unit_cost: unitCost,
    normalized_unit: unit,
    normalized_unit_cost: unitCost,
    currency: "USD",
    notes: "Lista · fila 4",
    created_at: "2026-04-01T00:00:00Z",
    ...extra,
  };
}

export function createMemoryEditorStore(state: MemoryEditorState): EditorStore {
  const mine = (companyId: string) => companyId === state.companyId;
  const prepOf = (companyId: string, version: VersionRef) =>
    mine(companyId) && version.kind === "preparation"
      ? state.preparations.find((p) => p.version?.id === version.id)
      : undefined;
  const rowsFor = (companyId: string, version: VersionRef) => {
    if (!mine(companyId)) return undefined;
    if (version.kind === "preparation")
      return prepOf(companyId, version)?.inputs;
    if (state.version?.id === version.id) return state.inputs;
    if (state.inForceVersion?.id === version.id)
      return state.olderVersions?.find((v) => v.version.id === version.id)
        ?.inputs;
    return state.olderVersions?.find((v) => v.version.id === version.id)
      ?.inputs;
  };
  return {
    async loadCosting() {
      const byIngredient = new Map<string, IngredientCostEntry[]>();
      for (const e of state.entries) {
        const list = byIngredient.get(e.ingredient_id) ?? [];
        list.push(e);
        byIngredient.set(e.ingredient_id, list);
      }
      const inputsByRecipe = new Map<
        string,
        Array<{
          input_type: "ingredient";
          ingredient_id: string;
          component_id: null;
          quantity: number;
          unit: string;
        }>
      >();
      for (const row of state.componentInputs) {
        const list = inputsByRecipe.get(row.component_recipe_id) ?? [];
        list.push({
          input_type: "ingredient",
          ingredient_id: row.ingredient_id,
          component_id: null,
          quantity: row.quantity,
          unit: row.unit,
        });
        inputsByRecipe.set(row.component_recipe_id, list);
      }
      const data: CostingData = {
        ingredientsById: new Map(state.ingredients.map((r) => [r.id, r])),
        componentsById: new Map(
          state.components.map((c) => [c.id, { ...c, status: "active" }])
        ),
        componentRecipesByComponentId: new Map(
          state.componentRecipes.map((r) => [
            r.component_id,
            { ...r, status: "active" },
          ])
        ),
        componentRecipeInputsByRecipeId: inputsByRecipe,
        menuItemsById: new Map(),
        menuRecipesByMenuItemId: new Map(),
        menuRecipeInputsByRecipeId: new Map(),
        costEntriesByIngredientId: byIngredient,
        unitConversionsByIngredientId: groupConversions(
          (state.conversions ?? []).map((c, i) => ({ ...c, id: `c${i}` }))
        ),
        componentRecipeVersionsByComponentId: new Map(
          state.preparations
            .filter((p) => p.version)
            .map((p) => [
              p.component_id,
              [
                {
                  id: p.version!.id,
                  component_recipe_id: p.version!.component_recipe_id ?? "",
                  component_id: p.component_id,
                  version_number: 1,
                  status: p.version!.status,
                  effective_date: null,
                  output_quantity: p.version!.output_quantity ?? 1,
                  output_unit: p.version!.output_unit ?? "unit",
                },
              ],
            ])
        ),
        componentRecipeVersionInputsByVersionId: new Map(
          state.preparations
            .filter((p) => p.version)
            .map((p) => [p.version!.id, p.inputs.map((i) => ({ ...i }))])
        ),
      };
      return {
        data,
        sourceOf: (id) => {
          const e = state.entries.find((x) => x.id === id);
          if (!e) return "lista";
          if (e.source_type === "manual") return "manual";
          return "lista";
        },
      };
    },
    async loadLink(companyId): Promise<LinkRef | null> {
      if (!mine(companyId) || !state.link) return null;
      return { ...state.link };
    },
    async saveEvidence(companyId, holder, evidence) {
      if (!mine(companyId) || !holder.id) return;
      if (holder.kind === "dish") {
        if (state.link?.id === holder.id) state.link.evidence = evidence;
        return;
      }
      const prep = state.preparations.find((p) => p.holder?.id === holder.id);
      if (prep?.holder && !prep.resolved) prep.holder.evidence = evidence;
    },
    async latestVersion(companyId) {
      return mine(companyId) ? state.version : null;
    },
    async loadPreparation(companyId, componentId) {
      if (!mine(companyId)) return null;
      const prep = state.preparations.find(
        (p) => p.component_id === componentId
      );
      if (!prep) return null;
      const open = prep.holder && !prep.resolved ? prep.holder : null;
      return {
        component_id: prep.component_id,
        name: prep.name,
        holder: {
          kind: "preparation",
          id: open?.id ?? null,
          evidence: open?.evidence ?? {},
        },
        version: prep.version ? { ...prep.version } : null,
      };
    },
    async approvedVersionInForce(companyId) {
      return mine(companyId) ? (state.inForceVersion ?? null) : null;
    },
    async createDraftVersion(companyId, from) {
      if (!mine(companyId) || from.kind !== "dish")
        throw new Error("wrong scope");
      const draft: VersionRef = {
        ...from,
        id: `v-new-${++state.seq}`,
        status: "in_review",
      };
      (state.olderVersions ??= []).push({
        version: { ...from },
        inputs: state.inputs,
      });
      state.version = draft;
      state.inputs = [];
      return { ...draft };
    },
    async listInputs(companyId, version) {
      return rowsFor(companyId, version)?.map((r) => ({ ...r })) ?? [];
    },
    async insertInput(companyId, version, row) {
      const rows = rowsFor(companyId, version);
      if (!rows) throw new Error("wrong scope");
      const created = { id: `in-${++state.seq}`, ...row };
      rows.push(created);
      return { ...created };
    },
    async updateInput(companyId, version, inputId, patch) {
      const row = rowsFor(companyId, version)?.find((r) => r.id === inputId);
      if (row) Object.assign(row, patch);
    },
    async deleteInput(companyId, version, inputId) {
      const rows = rowsFor(companyId, version);
      if (!rows) return;
      const index = rows.findIndex((r) => r.id === inputId);
      if (index >= 0) rows.splice(index, 1);
    },
    async setPreparationYield(companyId, version, input) {
      const prep = prepOf(companyId, version);
      if (!prep?.version || prep.version.status !== "in_review") return;
      prep.version.output_quantity = input.quantity;
      prep.version.output_unit = input.unit;
    },
    async approvePreparationVersion(companyId, version, approval) {
      const prep = prepOf(companyId, version);
      if (!prep?.version || prep.version.status !== "in_review") {
        throw new Error("not in review");
      }
      prep.version.status = "approved";
      prep.approval = { ...approval };
    },
    async resolveHolder(companyId, holder) {
      if (!mine(companyId) || holder.kind !== "preparation" || !holder.id)
        return;
      const prep = state.preparations.find((p) => p.holder?.id === holder.id);
      if (prep) prep.resolved = true;
    },
    async dishesUsingPreparation(companyId, componentId) {
      if (!mine(companyId)) return [];
      const wanted = new Set([componentId]);
      for (const prep of state.preparations) {
        if (
          prep.inputs.some((i) => i.component_id && wanted.has(i.component_id))
        ) {
          wanted.add(prep.component_id);
        }
      }
      return state.inputs.some(
        (i) => i.component_id && wanted.has(i.component_id)
      )
        ? [{ odooProductId: 7, locationId: null }]
        : [];
    },
    async createIngredient(_companyId, input) {
      const created = {
        id: `ing-new-${++state.seq}`,
        name: input.name,
        default_unit: input.defaultUnit,
      };
      state.ingredients.push(created);
      return created;
    },
    async createPreparation(companyId, input) {
      if (!mine(companyId)) throw new Error("wrong scope");
      const id = `prep-new-${++state.seq}`;
      const recipeId = `crec-new-${state.seq}`;
      state.components.push({
        id,
        name: input.name,
        output_unit: input.outputUnit,
      });
      state.componentRecipes.push({
        id: recipeId,
        component_id: id,
        output_quantity: input.outputQuantity,
        output_unit: input.outputUnit,
      });
      state.preparations.push({
        component_id: id,
        name: input.name,
        version: {
          id: `cver-new-${state.seq}`,
          status: "in_review",
          kind: "preparation",
          component_id: id,
          component_recipe_id: recipeId,
          output_quantity: input.outputQuantity,
          output_unit: input.outputUnit,
        },
        inputs: [],
        holder: null,
      });
      return { id, name: input.name };
    },
    async catalogQuestions(companyId) {
      if (!mine(companyId)) return [];
      return (state.catalogRows ?? [])
        .filter((row) => row.status === "pending")
        .map(
          (row): CatalogQuestion => ({
            item_id: row.id,
            name: row.name,
            ingredient_id: row.ingredient_id,
            reason: row.reason,
            options: row.options.map((o) => ({ ...o })),
          })
        );
    },
    async skipCatalogQuestion(companyId, itemId) {
      const row = (state.catalogRows ?? []).find((r) => r.id === itemId);
      if (!mine(companyId) || !row || row.status !== "pending") {
        return { ok: false, reason: "No encontré esa fila de tu lista." };
      }
      row.status = "skipped";
      return { ok: true };
    },
    async answerCatalogQuestion(companyId, itemId, unit) {
      const row = (state.catalogRows ?? []).find((r) => r.id === itemId);
      if (!mine(companyId) || !row || row.status !== "pending") {
        return { ok: false, reason: "No encontré esa fila de tu lista." };
      }
      const option = row.options.find((o) => o.unit === unit);
      if (!option) return { ok: false, reason: "Esa opción no existe." };
      let ingredientId = row.ingredient_id;
      if (!ingredientId) {
        ingredientId = `ing-row-${++state.seq}`;
        state.ingredients.push({
          id: ingredientId,
          name: row.name,
          default_unit: option.unit,
        });
      }
      state.entries.push(
        entry(ingredientId, option.unit, option.unit_cost, {
          id: `e-catalog-${++state.seq}`,
          notes: "Lista · fila (unidad confirmada)",
        })
      );
      row.status = "approved";
      return { ok: true, ingredientId };
    },
    async addCostEntry(_companyId, e: NewCostEntry) {
      const ing = state.ingredients.find((r) => r.id === e.ingredientId)!;
      const target = e.keepUnit ? e.unit : (ing.default_unit ?? e.unit);
      const converted = convertPriceWithIngredientConversions(
        e.unitCost,
        e.unit,
        target,
        (state.conversions ?? []).filter(
          (c) => c.ingredient_id === e.ingredientId
        )
      );
      if (!converted.ok)
        return {
          ok: false,
          error: unitMismatchMessage(e.unit, ing.default_unit ?? null),
          conversion: ing.default_unit
            ? {
                ingredient_id: e.ingredientId,
                ingredient_name: ing.name,
                from_unit: e.unit,
                to_unit: ing.default_unit,
              }
            : undefined,
        };
      state.entries.push(
        entry(e.ingredientId, e.unit, e.unitCost, {
          id: `e-new-${++state.seq}`,
          source_type: "manual",
          date_source: "manual",
          effective_date: e.date,
          cost_date: e.date,
          normalized_unit: normalizeUnit(target) ?? target,
          normalized_unit_cost: converted.value,
          currency: e.currency,
          notes: e.note,
          created_at: new Date(Date.now() + state.seq).toISOString(),
        })
      );
      return { ok: true };
    },
    async mergedInto(_companyId, ingredientId) {
      const m = (state.merges ?? []).find((x) => x.loserId === ingredientId);
      return m ? { name: m.survivorName } : null;
    },
    async loadAliases(companyId) {
      const map = new Map<string, string>();
      if (!mine(companyId)) return map;
      for (const a of state.aliases) {
        map.set(
          a.name
            .normalize("NFD")
            .replace(/\p{M}/gu, "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
          a.ingredient_id
        );
      }
      return map;
    },
    async rememberAlias(input) {
      if (state.failAlias)
        throw new Error('relation "ingredient_aliases" does not exist');
      state.aliases.push({
        key: aliasKeyFor(input.aliasName),
        name: input.aliasName,
        ingredient_id: input.ingredientId,
        by: input.userId,
      });
    },
    async currency() {
      return state.currency;
    },
  };
}
