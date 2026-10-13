// In-memory EditorStore for tests. Company-scoped like the real one.

import type { CostingData } from "@/lib/restaurant/costing";
import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";
import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";
import type { VersionInput } from "@/lib/restaurant/recipe-costing/editor";
import type {
  EditorStore,
  LinkRef,
  NewCostEntry,
  VersionRef,
} from "@/lib/restaurant/recipe-costing/editor-service";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

export interface MemoryEditorState {
  companyId: string;
  currency: string;
  ingredients: Array<{ id: string; name: string; default_unit: string | null }>;
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
  aliases: Array<{
    key: string;
    name: string;
    ingredient_id: string;
    by: string | null;
  }>;
  failAlias?: boolean;
  seq: number;
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
    async saveEvidence(companyId, linkId, evidence) {
      if (!mine(companyId) || state.link?.id !== linkId) return;
      state.link.evidence = evidence;
    },
    async latestVersion(companyId) {
      return mine(companyId) ? state.version : null;
    },
    async listInputs(companyId, versionId) {
      if (!mine(companyId) || state.version?.id !== versionId) return [];
      return state.inputs.map((r) => ({ ...r }));
    },
    async insertInput(companyId, versionId, row) {
      if (!mine(companyId) || state.version?.id !== versionId) {
        throw new Error("wrong scope");
      }
      const created = { id: `in-${++state.seq}`, ...row };
      state.inputs.push(created);
      return { ...created };
    },
    async updateInput(companyId, versionId, inputId, patch) {
      if (!mine(companyId) || state.version?.id !== versionId) return;
      const row = state.inputs.find((r) => r.id === inputId);
      if (row) Object.assign(row, patch);
    },
    async deleteInput(companyId, versionId, inputId) {
      if (!mine(companyId) || state.version?.id !== versionId) return;
      state.inputs = state.inputs.filter((r) => r.id !== inputId);
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
    async addCostEntry(_companyId, e: NewCostEntry) {
      const ing = state.ingredients.find((r) => r.id === e.ingredientId)!;
      const target = ing.default_unit ?? e.unit;
      const converted = convertUnitPriceStr(e.unitCost, e.unit, target);
      state.entries.push(
        entry(e.ingredientId, e.unit, e.unitCost, {
          id: `e-new-${++state.seq}`,
          source_type: "manual",
          date_source: "manual",
          effective_date: e.date,
          cost_date: e.date,
          normalized_unit: normalizeUnit(target) ?? target,
          normalized_unit_cost: converted.ok ? converted.value : e.unitCost,
          currency: e.currency,
          notes: e.note,
          created_at: new Date(Date.now() + state.seq).toISOString(),
        })
      );
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
