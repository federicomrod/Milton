import type { CostWorkbookRepo } from "./repo";
import type {
  CompanyCostResetSummary,
  CostResetStepId,
  CostResetStepResult,
} from "./types";

export const RESET_CONFIRM_FALLBACK = "START OVER";

export const COST_RESET_STEP_IDS = [
  "menu_recipe_inputs",
  "recipe_ingredients",
  "component_recipe_inputs",
  "recipes",
  "component_recipes",
  "prepared_components",
  "import_pos_mappings",
  "import_menu_items",
  "ingredient_cost_entries",
  "supplier_ingredients",
  "ingredients",
  "cost_import_review_items",
  "cost_import_layout_maps",
  "batches_marked_undone",
] as const satisfies readonly CostResetStepId[];

export const COST_RESET_STEP_LABELS: Record<
  CostResetStepId,
  { en: string; es: string }
> = {
  menu_recipe_inputs: {
    en: "recipe lines",
    es: "líneas de receta",
  },
  recipe_ingredients: {
    en: "legacy recipe ingredients",
    es: "ingredientes de receta (legado)",
  },
  component_recipe_inputs: {
    en: "sub-recipe lines",
    es: "líneas de sub-receta",
  },
  recipes: { en: "recipes", es: "recetas" },
  component_recipes: {
    en: "sub-recipe recipes",
    es: "recetas de sub-receta",
  },
  prepared_components: { en: "sub-recipes", es: "sub-recetas" },
  import_pos_mappings: {
    en: "imported POS links",
    es: "vínculos POS importados",
  },
  import_menu_items: {
    en: "imported dishes",
    es: "platillos importados",
  },
  ingredient_cost_entries: { en: "cost rows", es: "costos" },
  supplier_ingredients: {
    en: "supplier links",
    es: "vínculos de proveedor",
  },
  ingredients: { en: "ingredients", es: "ingredientes" },
  cost_import_review_items: {
    en: "needs-a-look rows",
    es: "filas por revisar",
  },
  cost_import_layout_maps: {
    en: "saved column maps",
    es: "mapas de columnas",
  },
  batches_marked_undone: {
    en: "imports marked undone",
    es: "cargas marcadas como deshechas",
  },
};

export const RESET_FORBIDDEN_ERROR_ES =
  "Solo el dueño o un admin puede hacer esto.";
export const RESET_FORBIDDEN_ERROR_EN =
  "Only the owner or an admin can do this.";
export const RESET_FAILED_ERROR_ES = "No se pudo empezar de nuevo.";
export const RESET_FAILED_ERROR_EN = "Reset failed.";
export const RESET_PARTIAL_ERROR_ES =
  "El reinicio quedó a medias. Vuelve a pulsar para terminar.";
export const RESET_PARTIAL_ERROR_EN =
  "Reset stopped halfway. Press again to finish.";
export const UNDO_ALL_FAILED_ERROR_ES =
  "No se pudieron deshacer todas las cargas.";
export const UNDO_ALL_FAILED_ERROR_EN = "Undo all failed.";
export const RESET_CONFIRM_SINGLE_ERROR_ES =
  "Escribe el nombre del restaurante para confirmar.";
export const RESET_CONFIRM_MULTI_ERROR_ES =
  "Escribe el nombre de la cuenta o el de todos los restaurantes para confirmar.";
export const RESET_SALES_LINKS_NOTE_ES =
  "Se pierden los vínculos entre las ventas y los platillos borrados; los totales de ingresos no cambian. Los platillos que creaste a mano se quedan como un cascarón vacío, sin receta.";
export const RESET_SALES_LINKS_NOTE_EN =
  "Links between sales and deleted dishes are lost; revenue totals stay. Handmade dishes keep an empty shell without a recipe.";

export interface CostResetConfirmTarget {
  companyName: string | null;
  restaurantNames: string[];
}

export function normalizeResetConfirm(value: string): string {
  return value.trim().toLocaleLowerCase("es-419").replace(/\s+/g, " ");
}

export function resetConfirmationMatches(
  typed: string,
  expected: string
): boolean {
  return normalizeResetConfirm(typed) === normalizeResetConfirm(expected);
}

export function uniqueRestaurantNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = normalizeResetConfirm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function joinRestaurantNamesEs(names: string[]): string {
  const clean = uniqueRestaurantNames(names);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} y ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} y ${clean[clean.length - 1]}`;
}

export function companyNameIsDistinct(
  companyName: string | null,
  restaurantNames: string[]
): boolean {
  const company = normalizeResetConfirm(companyName ?? "");
  if (!company) return false;
  return !uniqueRestaurantNames(restaurantNames).some(
    (name) => normalizeResetConfirm(name) === company
  );
}

function splitRestaurantPhrase(typed: string): string[] {
  return typed
    .split(/\s*(?:,| y | and )\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function restaurantNamesPhraseMatches(
  typed: string,
  restaurantNames: string[]
): boolean {
  const expected = uniqueRestaurantNames(restaurantNames).map((name) =>
    normalizeResetConfirm(name)
  );
  if (expected.length < 2) return false;
  const parts = splitRestaurantPhrase(typed);
  if (parts.length !== expected.length) return false;
  const got = [...parts].sort();
  const want = [...expected].sort();
  return got.every((part, index) => part === want[index]);
}

export function resetConfirmationAccepted(
  typed: string,
  target: CostResetConfirmTarget
): boolean {
  const normalized = normalizeResetConfirm(typed);
  if (!normalized) return false;

  const restaurants = uniqueRestaurantNames(target.restaurantNames);
  const company = target.companyName?.trim() ?? "";

  if (restaurants.length <= 1) {
    if (company && normalizeResetConfirm(company) === normalized) return true;
    const only = restaurants[0] ?? "";
    if (only && normalizeResetConfirm(only) === normalized) return true;
    return resetConfirmationMatches(typed, RESET_CONFIRM_FALLBACK);
  }

  if (company && companyNameIsDistinct(company, restaurants)) {
    if (normalizeResetConfirm(company) === normalized) return true;
  }

  return restaurantNamesPhraseMatches(normalized, restaurants);
}

export function multiRestaurantResetWarningEs(
  restaurantNames: string[],
  selectedName: string
): string {
  const all = joinRestaurantNamesEs(restaurantNames);
  return `Esto borra los costos y recetas de TODOS los restaurantes de la cuenta (${all}), no solo de ${selectedName}. No se puede deshacer.`;
}

export function multiRestaurantResetWarningEn(
  restaurantNames: string[],
  selectedName: string
): string {
  const all = joinRestaurantNamesEs(restaurantNames);
  return `This deletes costs and recipes for EVERY restaurant on the account (${all}), not just ${selectedName}. This cannot be undone.`;
}

export function resetConfirmPromptEs(target: CostResetConfirmTarget): string {
  const restaurants = uniqueRestaurantNames(target.restaurantNames);
  if (restaurants.length > 1) {
    const both = joinRestaurantNamesEs(restaurants);
    if (companyNameIsDistinct(target.companyName, restaurants)) {
      return `Escribe ${target.companyName?.trim()} o «${both}» para confirmar. No se puede deshacer.`;
    }
    return `Escribe «${both}» para confirmar. No se puede deshacer.`;
  }
  const expected =
    restaurants[0]?.trim() ||
    target.companyName?.trim() ||
    RESET_CONFIRM_FALLBACK;
  return `Escribe ${expected} para confirmar. No se puede deshacer.`;
}

export function resetConfirmPromptEn(target: CostResetConfirmTarget): string {
  const restaurants = uniqueRestaurantNames(target.restaurantNames);
  if (restaurants.length > 1) {
    const both = joinRestaurantNamesEs(restaurants);
    if (companyNameIsDistinct(target.companyName, restaurants)) {
      return `Type ${target.companyName?.trim()} or “${both}” to confirm. This cannot be undone.`;
    }
    return `Type “${both}” to confirm. This cannot be undone.`;
  }
  const expected =
    restaurants[0]?.trim() ||
    target.companyName?.trim() ||
    RESET_CONFIRM_FALLBACK;
  return `Type ${expected} to confirm. This cannot be undone.`;
}

export function resetConfirmErrorEs(target: CostResetConfirmTarget): string {
  return uniqueRestaurantNames(target.restaurantNames).length > 1
    ? RESET_CONFIRM_MULTI_ERROR_ES
    : RESET_CONFIRM_SINGLE_ERROR_ES;
}

export function canManageCompanyCostReset(input: {
  role: string | null | undefined;
  roleColumnMissing?: boolean;
}): boolean {
  if (input.roleColumnMissing) return true;
  return input.role === "owner" || input.role === "admin";
}

export function emptyResetSummary(): CompanyCostResetSummary {
  return {
    ok: true,
    cost_entries: 0,
    ingredients: 0,
    supplier_ingredient_links: 0,
    recipes: 0,
    components: 0,
    import_menu_items: 0,
    import_pos_mappings: 0,
    review_items: 0,
    layout_maps: 0,
    batches_marked_undone: 0,
    kept_manual_menu_items: 0,
    kept_manual_pos_mappings: 0,
    steps: [],
  };
}

export function countResetStep(
  steps: CostResetStepResult[],
  id: CostResetStepId
): number {
  return steps.find((step) => step.id === id)?.deleted ?? 0;
}

export function summaryFromResetSteps(
  steps: CostResetStepResult[],
  kept: {
    kept_manual_menu_items: number;
    kept_manual_pos_mappings: number;
  }
): CompanyCostResetSummary {
  return {
    ok: steps.every((step) => step.status === "completed"),
    cost_entries: countResetStep(steps, "ingredient_cost_entries"),
    ingredients: countResetStep(steps, "ingredients"),
    supplier_ingredient_links: countResetStep(steps, "supplier_ingredients"),
    recipes: countResetStep(steps, "recipes"),
    components: countResetStep(steps, "prepared_components"),
    import_menu_items: countResetStep(steps, "import_menu_items"),
    import_pos_mappings: countResetStep(steps, "import_pos_mappings"),
    review_items: countResetStep(steps, "cost_import_review_items"),
    layout_maps: countResetStep(steps, "cost_import_layout_maps"),
    batches_marked_undone: countResetStep(steps, "batches_marked_undone"),
    kept_manual_menu_items: kept.kept_manual_menu_items,
    kept_manual_pos_mappings: kept.kept_manual_pos_mappings,
    steps,
  };
}

export async function runResetSteps(
  execute: (id: CostResetStepId) => Promise<number>
): Promise<CostResetStepResult[]> {
  const steps: CostResetStepResult[] = [];
  for (const id of COST_RESET_STEP_IDS) {
    const labels = COST_RESET_STEP_LABELS[id];
    try {
      const deleted = await execute(id);
      steps.push({
        id,
        label_en: labels.en,
        label_es: labels.es,
        status: "completed",
        deleted,
      });
    } catch (err) {
      steps.push({
        id,
        label_en: labels.en,
        label_es: labels.es,
        status: "failed",
        deleted: 0,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  }
  return steps;
}

export function formatResetPartialFailureEs(
  steps: CostResetStepResult[]
): string {
  const done = steps.filter((step) => step.status === "completed");
  const failed = steps.filter((step) => step.status === "failed");
  const doneText =
    done.length > 0
      ? done.map((step) => `${step.label_es} (${step.deleted})`).join(", ")
      : "ninguno";
  const failText =
    failed.length > 0
      ? failed
          .map((step) =>
            step.error ? `${step.label_es} (${step.error})` : step.label_es
          )
          .join(", ")
      : "ninguno";
  return `El reinicio quedó a medias. Lo que ya se borró no se puede deshacer. Pasos listos: ${doneText}. Pasos que no se completaron: ${failText}. Vuelve a pulsar para terminar.`;
}

export function formatResetPartialFailureEn(
  steps: CostResetStepResult[]
): string {
  const done = steps.filter((step) => step.status === "completed");
  const failed = steps.filter((step) => step.status === "failed");
  const doneText =
    done.length > 0
      ? done.map((step) => `${step.label_en} (${step.deleted})`).join(", ")
      : "none";
  const failText =
    failed.length > 0
      ? failed
          .map((step) =>
            step.error ? `${step.label_en} (${step.error})` : step.label_en
          )
          .join(", ")
      : "none";
  return `Reset stopped halfway. What already deleted cannot be undone. Finished: ${doneText}. Not finished: ${failText}. Press again to finish.`;
}

export async function resetCompanyCostData(
  repo: CostWorkbookRepo,
  companyId: string
): Promise<CompanyCostResetSummary> {
  return repo.resetCompanyCostCatalog(companyId);
}
