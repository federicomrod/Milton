import { can } from "@/lib/auth/capabilities";
import type { CostWorkbookRepo } from "./repo";
import type {
  CompanyCostResetSummary,
  CostResetStepId,
  CostResetStepResult,
} from "./types";

export const RESET_CONFIRM_FALLBACK = "EMPEZAR DE NUEVO";

// What "Empezar de nuevo" clears, in order: everything the costing setup
// produced, so the next cost-file upload behaves like a first one. Never
// POS sales, the Odoo connection, or menu items the costing flow did not
// create. Uploads are kept as an archive (marked undone, never read again
// as a recipe source). Review rows go first so an early failure can never
// leave them behind (#188).
export const COST_RESET_STEP_IDS = [
  "cost_import_review_items",
  "pos_product_links",
  "menu_recipe_inputs",
  "recipe_ingredients",
  "component_recipe_inputs",
  "recipes",
  "component_recipes",
  "prepared_components",
  "import_pos_mappings",
  "costing_menu_items",
  "ingredient_aliases",
  "ingredient_cost_entries",
  "supplier_ingredients",
  "ingredients",
  "cost_import_layout_maps",
  "batches_marked_undone",
] as const satisfies readonly CostResetStepId[];

export const COST_RESET_STEP_LABELS: Record<CostResetStepId, string> = {
  cost_import_review_items: "filas por revisar",
  pos_product_links: "vínculos y tratamientos de productos del POS",
  menu_recipe_inputs: "líneas de receta",
  recipe_ingredients: "ingredientes de receta (legado)",
  component_recipe_inputs: "líneas de preparación",
  recipes: "recetas y sus versiones",
  component_recipes: "recetas de preparación y sus versiones",
  prepared_components: "preparaciones",
  import_pos_mappings: "vínculos POS importados",
  costing_menu_items: "platos creados al costear",
  ingredient_aliases: "nombres recordados",
  ingredient_cost_entries: "costos",
  supplier_ingredients: "vínculos de proveedor",
  ingredients: "ingredientes",
  cost_import_layout_maps: "mapas de columnas",
  batches_marked_undone: "cargas archivadas (deshechas)",
};

export const RESET_FORBIDDEN_ERROR_ES =
  "Solo el dueño o un admin puede hacer esto.";
export const RESET_FAILED_ERROR_ES = "No se pudo empezar de nuevo.";
export const RESET_PARTIAL_ERROR_ES =
  "El reinicio quedó a medias. Vuelve a pulsar para terminar.";
export const UNDO_ALL_FAILED_ERROR_ES =
  "No se pudieron deshacer todas las cargas.";
export const RESET_CONFIRM_SINGLE_ERROR_ES =
  "Escribe el nombre del restaurante para confirmar.";
export const RESET_CONFIRM_MULTI_ERROR_ES =
  "Escribe el nombre de la cuenta o el de todos los restaurantes para confirmar.";
export const RESET_SALES_LINKS_NOTE_ES =
  "Se pierden los vínculos entre las ventas y los platos borrados; los totales de ingresos no cambian. Los platos que creaste a mano se quedan como un cascarón vacío, sin receta.";

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

function isNameBoundary(haystack: string, start: number, end: number): boolean {
  const beforeOk = start === 0 || /[\s,]/.test(haystack[start - 1] ?? "");
  const afterOk = end === haystack.length || /[\s,]/.test(haystack[end] ?? "");
  return beforeOk && afterOk;
}

function findNameSpan(haystack: string, name: string): [number, number] | null {
  let from = 0;
  while (from <= haystack.length - name.length) {
    const idx = haystack.indexOf(name, from);
    if (idx === -1) return null;
    if (isNameBoundary(haystack, idx, idx + name.length)) {
      return [idx, idx + name.length];
    }
    from = idx + 1;
  }
  return null;
}

function leftoverIsOnlySeparators(value: string): boolean {
  return (
    value
      .replace(/\b(?:y|and)\b/g, " ")
      .replace(/,/g, " ")
      .replace(/\s+/g, "").length === 0
  );
}

export function restaurantNamesPhraseMatches(
  typed: string,
  restaurantNames: string[]
): boolean {
  const expected = uniqueRestaurantNames(restaurantNames)
    .map((name) => normalizeResetConfirm(name))
    .filter(Boolean);
  if (expected.length < 2) return false;

  function consume(remaining: string, leftover: string[]): boolean {
    if (leftover.length === 0) return leftoverIsOnlySeparators(remaining);
    const ordered = [...leftover].sort((a, b) => b.length - a.length);
    for (const name of ordered) {
      const span = findNameSpan(remaining, name);
      if (!span) continue;
      const next = `${remaining.slice(0, span[0])} ${remaining.slice(span[1])}`;
      if (
        consume(
          next,
          leftover.filter((item) => item !== name)
        )
      )
        return true;
    }
    return false;
  }

  return consume(normalizeResetConfirm(typed), expected);
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
    if (!company && !only) {
      return resetConfirmationMatches(typed, RESET_CONFIRM_FALLBACK);
    }
    return false;
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

export function resetConfirmErrorEs(target: CostResetConfirmTarget): string {
  return uniqueRestaurantNames(target.restaurantNames).length > 1
    ? RESET_CONFIRM_MULTI_ERROR_ES
    : RESET_CONFIRM_SINGLE_ERROR_ES;
}

export function canManageCompanyCostReset(input: {
  role: string | null | undefined;
}): boolean {
  return can(
    {
      userId: "",
      companyId: null,
      role: input.role ?? null,
      isMiltonStaff: false,
    },
    "costs.reset"
  );
}

export function undoFailureMessageEs(
  reason?: string,
  filename?: string
): string {
  let mapped = UNDO_ALL_FAILED_ERROR_ES;
  if (reason) {
    const lower = reason.toLocaleLowerCase("es-419");
    if (lower.includes("newer import") || lower.includes("más nueva")) {
      mapped =
        "Hay una carga más nueva que tocó las mismas filas. Deshaz primero esa.";
    } else if (lower.includes("already undone") || lower.includes("ya está")) {
      mapped = "Esa carga ya está deshecha.";
    } else if (lower.includes("not found") || lower.includes("no encontr")) {
      mapped = "No encontré esa carga.";
    }
  }
  return filename ? `Se detuvo en ${filename}. ${mapped}` : mapped;
}

export function emptyResetSummary(): CompanyCostResetSummary {
  return {
    ok: true,
    cost_entries: 0,
    ingredients: 0,
    supplier_ingredient_links: 0,
    recipes: 0,
    components: 0,
    pos_product_links: 0,
    costing_menu_items: 0,
    import_pos_mappings: 0,
    ingredient_aliases: 0,
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
    pos_product_links: countResetStep(steps, "pos_product_links"),
    costing_menu_items: countResetStep(steps, "costing_menu_items"),
    import_pos_mappings: countResetStep(steps, "import_pos_mappings"),
    ingredient_aliases: countResetStep(steps, "ingredient_aliases"),
    review_items: countResetStep(steps, "cost_import_review_items"),
    layout_maps: countResetStep(steps, "cost_import_layout_maps"),
    batches_marked_undone: countResetStep(steps, "batches_marked_undone"),
    kept_manual_menu_items: kept.kept_manual_menu_items,
    kept_manual_pos_mappings: kept.kept_manual_pos_mappings,
    steps,
  };
}

/**
 * Run every step, even after one fails: each step only deletes its own
 * company's rows, so a later step never depends on an earlier success
 * (the order only keeps foreign keys happy). A failure is reported and the
 * reset can be pressed again to finish.
 */
export async function runResetSteps(
  execute: (id: CostResetStepId) => Promise<number>
): Promise<CostResetStepResult[]> {
  const steps: CostResetStepResult[] = [];
  for (const id of COST_RESET_STEP_IDS) {
    const label_es = COST_RESET_STEP_LABELS[id];
    try {
      const deleted = await execute(id);
      steps.push({
        id,
        label_es,
        status: "completed",
        deleted,
      });
    } catch (err) {
      steps.push({
        id,
        label_es,
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
  const skipped = steps.filter((step) => step.status === "skipped");
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
  const skippedText =
    skipped.length > 0
      ? skipped.map((step) => step.label_es).join(", ")
      : "ninguno";
  const skippedPart =
    skipped.length > 0 ? ` Pasos que no se corrieron: ${skippedText}.` : "";
  return `El reinicio quedó a medias. Lo que ya se borró no se puede deshacer. Pasos listos: ${doneText}. Pasos que no se completaron: ${failText}.${skippedPart} Vuelve a pulsar para terminar.`;
}

export async function resetCompanyCostData(
  repo: CostWorkbookRepo,
  companyId: string
): Promise<CompanyCostResetSummary> {
  return repo.resetCompanyCostCatalog(companyId);
}
