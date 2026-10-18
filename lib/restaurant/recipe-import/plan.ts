// Plan an import from the canonical recipe table. Pure: it decides what
// would be created, linked or left alone, and builds the preview. The
// server writes exactly this plan, and nothing before "Importar".
//
// Rules:
// - one ingredient per name (an existing one with the same name, or a
//   name a person already confirmed, is reused, never duplicated);
// - preparations are recipes of the same table; dish lines that use one
//   point at it;
// - a dish links to a POS product by name + size, confirmed by price
//   (Excel PRECIO DE VENTA SIN IVA × 1.13 ≈ POS price); doubtful = no link;
// - approved or hand-made recipes and Confirmado links are never touched;
// - costs stay as the file wrote them per line; missing = Pendiente.

import {
  nameMatchScore,
  normalizeMatchName,
  AUTO_NAME_SCORE,
} from "@/lib/restaurant/cost-workbook/names";
import { sizeOf, stripSize } from "@/lib/restaurant/menu-reading/match";
import type {
  CanonicalFlag,
  CanonicalLine,
  CanonicalRecipe,
  CanonicalWorkbook,
} from "./types";

/** El Salvador IVA. Excel prices are written without it. */
export const IVA_SV = 0.13;
/** POS price and Excel price count as the same within this share
 *  (an average price from sales moves a little with discounts). */
export const POS_PRICE_TOLERANCE = 0.05;

export interface PlanPosProduct {
  odoo_product_id: number;
  odoo_name: string;
  /** Price on the POS (with IVA), from the menu item or sales. */
  pos_price: number | null;
  link_state: string | null;
}

export interface PlanExistingDish {
  odoo_product_id: number;
  /**
   * An approved version or a recipe made by hand WITH lines: never replaced
   * unless the person picks the Excel's for this dish (a new draft version).
   */
  protected: boolean;
  /** Lines of that recipe, and its cost when known, for the comparison. */
  lines?: number;
  cost?: number | null;
}

export interface PlanCatalog {
  ingredients: ReadonlyArray<{ id: string; name: string }>;
  preparations: ReadonlyArray<{ id: string; name: string }>;
  /** normalizeMatchName(alias) → ingredient id, confirmed by a person. */
  aliases?: ReadonlyMap<string, string>;
  /**
   * normalizeMatchName(name) → the unit the price list prices it in. A new
   * ingredient takes it as its unit, so the list's price always fits
   * (recipe-line unit labels in a kitchen file are sometimes wrong).
   */
  listUnits?: ReadonlyMap<string, string>;
}

export interface PlannedIngredient {
  key: string;
  name: string;
  default_unit: string;
  existing_id: string | null;
  /** The catalog's own spelling when reused (the editor matches on it). */
  existing_name: string | null;
}

export interface PlannedPreparation {
  recipe: CanonicalRecipe;
  existing_id: string | null;
}

export interface PlannedDish {
  recipe: CanonicalRecipe;
  /** Every POS product this dish is linked to (variants of one dish). */
  pos: PlanPosProduct[];
  /** Why it is (not) linked, for the preview. */
  link_note: string;
  /** Set when the dish is left alone. */
  skip_reason: string | null;
  /** The dish already has a recipe with lines (kept unless the person chooses the Excel's). */
  conflict: { my_lines: number; my_cost: number | null } | null;
}

export interface PreviewConflict {
  key: string;
  dish: string;
  size: string | null;
  /** The recipe the dish has now. */
  my_cost: number | null;
  my_lines: number;
  /** The Excel's; null cost = some lines have no price. */
  excel_cost: number | null;
  excel_lines: number;
  /** Any one POS product of the dish, to read the current cost. */
  odoo_product_id: number | null;
}

export interface PreviewRow {
  key: string;
  dish: string;
  size: string | null;
  source: string;
  calculated_cost: number;
  excel_total_cost: number | null;
  match: boolean;
  pos_name: string | null;
  link_note: string;
  skip_reason: string | null;
  lines: number;
  flags: string[];
}

export interface ImportPlan {
  ingredients: PlannedIngredient[];
  preparations: PlannedPreparation[];
  dishes: PlannedDish[];
  preview: {
    rows: PreviewRow[];
    dishes: number;
    matching: number;
    preparations: number;
    ingredients_new: number;
    ingredients_reused: number;
    linked: number;
    skipped: number;
    /** Main-menu dishes with no POS link, and why (events copies left out). */
    unmatched: Array<{ dish: string; reason: string }>;
    /** Dishes that already have a recipe with lines: kept unless chosen. */
    conflicts: PreviewConflict[];
  };
}

/** The unit a line is stored with: the app's unit, or the file's word. */
export function lineUnit(line: CanonicalLine): string {
  if (line.unit_norm) return line.unit_norm;
  const raw = (line.unit ?? "").trim().toLowerCase();
  return raw || "unit";
}

/** The POS size in the same words as a dish size ("6 oz", "3 personas"). */
function posSize(
  name: string
): { value: number; kind: "oz" | "personas" } | null {
  const size = sizeOf(name);
  if (!size) return null;
  const oz = size.match(/^([\d.]+)oz$/);
  if (oz) return { value: Number(oz[1]), kind: "oz" };
  const people = size.match(/^(\d+)p$/);
  if (people) return { value: Number(people[1]), kind: "personas" };
  return null;
}

function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) <= POS_PRICE_TOLERANCE;
}

/** Excel price with IVA, rounded like a menu price. */
export function excelPriceWithIva(recipe: CanonicalRecipe): number | null {
  if (recipe.excel_price_sin_iva == null || recipe.excel_price_sin_iva <= 0) {
    return null;
  }
  return Math.round(recipe.excel_price_sin_iva * (1 + IVA_SV) * 100) / 100;
}

/**
 * The POS name without its size or its modifiers, for comparing names:
 * "Churrasco Típico (6 onz.) (Pan con Ajo, Bien Cocido)" → "Churrasco Típico".
 */
export function posBaseName(name: string): string {
  return stripSize(name.replace(/\([^)]*\)/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The POS products for an Excel dish: same name (modifiers in parentheses
 * ignored), same size, and the price agrees — Excel PRECIO DE VENTA SIN
 * IVA × 1.13, or without IVA when the POS reports net prices. Every POS
 * variant that agrees is linked (the same dish sold with different
 * sides is one recipe). Says why when nothing links.
 */
export function matchDishToPos(
  recipe: CanonicalRecipe,
  products: readonly PlanPosProduct[]
): { products: PlanPosProduct[]; note: string } {
  const base = recipe.dish_name;
  const candidates = products.filter((product) => {
    const score = nameMatchScore(base, posBaseName(product.odoo_name));
    if (score < AUTO_NAME_SCORE) return false;
    const size = posSize(product.odoo_name);
    if (recipe.size_value === null) return size === null;
    return (
      size !== null &&
      size.value === recipe.size_value &&
      size.kind === recipe.size_kind
    );
  });
  if (candidates.length === 0) {
    return { products: [], note: "No encontré este plato en el POS" };
  }
  const withIva = excelPriceWithIva(recipe);
  const net = recipe.excel_price_sin_iva;
  if (withIva === null || net === null) {
    return {
      products: [],
      note: "El Excel no trae precio de venta para confirmar el vínculo",
    };
  }
  const confirmed = candidates.filter(
    (product) =>
      product.pos_price !== null &&
      product.pos_price > 0 &&
      (samePrice(product.pos_price, withIva) ||
        samePrice(product.pos_price, net))
  );
  if (confirmed.length > 0) {
    return {
      products: confirmed,
      note:
        confirmed.length === 1
          ? `Nombre, tamaño y precio coinciden (${withIva.toFixed(2)})`
          : `Nombre, tamaño y precio coinciden en ${confirmed.length} productos del POS (${withIva.toFixed(2)})`,
    };
  }
  const seen = candidates
    .map((p) => (p.pos_price !== null ? p.pos_price.toFixed(2) : "sin ventas"))
    .slice(0, 3)
    .join(", ");
  return {
    products: [],
    note: `El precio no coincide con el POS (Excel ${withIva.toFixed(2)} con IVA; POS ${seen})`,
  };
}

const FLAG_LABELS: Partial<Record<CanonicalFlag, string>> = {
  excel_no_cuadra: "Excel no cuadra",
  sin_total_excel: "sin COSTO TOTAL en el Excel",
  lineas_pendientes: "costos pendientes",
  menu_eventos: "menú de eventos",
  nombre_repetido: "nombre repetido",
};
const LINE_FLAG_LABELS: Partial<Record<CanonicalFlag, string>> = {
  costo_pendiente: "sin costo",
  costo_distinto: "costo distinto en otra hoja",
  unidad_distinta: "unidad distinta a otras recetas",
  unidad_no_reconocida: "unidad no reconocida",
  cantidad_cero: "cantidad 0",
  fuera_del_total_excel: "fuera del COSTO TOTAL del Excel",
  total_linea_no_cuadra: "total de línea no cuadra",
};

/** Flags of a recipe in words, line flags counted. */
export function flagWords(recipe: CanonicalRecipe): string[] {
  const words = recipe.flags
    .map((flag) => FLAG_LABELS[flag])
    .filter((text): text is string => Boolean(text));
  const counts = new Map<CanonicalFlag, number>();
  for (const line of recipe.lines) {
    for (const flag of line.flags)
      counts.set(flag, (counts.get(flag) ?? 0) + 1);
  }
  for (const [flag, n] of counts) {
    const label = LINE_FLAG_LABELS[flag];
    if (label) words.push(`${n} ${n === 1 ? "línea" : "líneas"}: ${label}`);
  }
  return words;
}

export function planImport(input: {
  workbook: CanonicalWorkbook;
  catalog: PlanCatalog;
  products: readonly PlanPosProduct[];
  existing: readonly PlanExistingDish[];
}): ImportPlan {
  const recipes = input.workbook.recipes;

  // Ingredients: one per name, for every line that is not a preparation.
  const ingredientByKey = new Map<string, PlannedIngredient>();
  const unitVotes = new Map<string, Map<string, number>>();
  const catalogNameById = new Map(
    input.catalog.ingredients.map((row) => [row.id, row.name])
  );
  const catalogByKey = new Map(
    input.catalog.ingredients.map((row) => [
      normalizeMatchName(row.name),
      row.id,
    ])
  );
  for (const recipe of recipes) {
    for (const line of recipe.lines) {
      if (line.preparation_key) continue;
      const key = normalizeMatchName(line.ingredient_name);
      if (!key) continue;
      if (!ingredientByKey.has(key)) {
        const existingId =
          catalogByKey.get(key) ?? input.catalog.aliases?.get(key) ?? null;
        ingredientByKey.set(key, {
          key,
          name: line.ingredient_name.replace(/\s+/g, " ").trim(),
          default_unit: "unit",
          existing_id: existingId,
          existing_name: existingId
            ? (catalogNameById.get(existingId) ?? null)
            : null,
        });
      }
      const votes = unitVotes.get(key) ?? new Map<string, number>();
      const unit = line.unit_norm ?? "unit";
      votes.set(unit, (votes.get(unit) ?? 0) + 1);
      unitVotes.set(key, votes);
    }
  }
  for (const [key, votes] of unitVotes) {
    const fromList = input.catalog.listUnits?.get(key);
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const unit = fromList ?? top?.[0];
    if (unit) ingredientByKey.get(key)!.default_unit = unit;
  }

  // Preparations: reuse one with the same name, else create.
  const prepByName = new Map(
    input.catalog.preparations.map((row) => [
      normalizeMatchName(row.name),
      row.id,
    ])
  );
  const preparations: PlannedPreparation[] = recipes
    .filter((recipe) => recipe.kind === "preparation")
    .map((recipe) => ({
      recipe,
      existing_id: prepByName.get(normalizeMatchName(recipe.name)) ?? null,
    }));

  // Dishes: main menu first, so an events copy never takes its POS product.
  const protectedBy = new Map(
    input.existing
      .filter((row) => row.protected)
      .map((row) => [row.odoo_product_id, row])
  );
  const dishRecipes = recipes
    .filter((recipe) => recipe.kind === "dish")
    .sort(
      (a, b) =>
        Number(a.flags.includes("menu_eventos")) -
        Number(b.flags.includes("menu_eventos"))
    );
  const claimed = new Map<number, PlannedDish>();
  const dishes: PlannedDish[] = [];
  for (const recipe of dishRecipes) {
    const hit = matchDishToPos(recipe, input.products);
    const dish: PlannedDish = {
      recipe,
      pos: [],
      link_note: hit.note,
      skip_reason: null,
      conflict: null,
    };
    const taken: string[] = [];
    for (const product of hit.products) {
      const earlier = claimed.get(product.odoo_product_id);
      if (earlier) {
        // The events copy of a main dish: the main dish keeps the link.
        taken.push(`«${product.odoo_name}» ya va con ${earlier.recipe.name}`);
        continue;
      }
      const mine = protectedBy.get(product.odoo_product_id);
      if (mine && !dish.conflict) {
        dish.conflict = {
          my_lines: mine.lines ?? 0,
          my_cost: mine.cost ?? null,
        };
      }
      claimed.set(product.odoo_product_id, dish);
      dish.pos.push(product);
    }
    if (dish.pos.length === 0 && hit.products.length > 0 && taken.length > 0) {
      dish.link_note = taken[0];
    }
    dishes.push(dish);
  }

  const rows: PreviewRow[] = dishes
    .slice()
    .sort((a, b) => a.recipe.key.localeCompare(b.recipe.key, "es"))
    .map((dish) => ({
      key: dish.recipe.key,
      dish: dish.recipe.name,
      size: dish.recipe.size,
      source: `${dish.recipe.source_tab.trim()} › ${dish.recipe.source_cell}`,
      calculated_cost: Math.round(dish.recipe.calculated_cost * 100) / 100,
      excel_total_cost:
        dish.recipe.excel_total_cost === null
          ? null
          : Math.round(dish.recipe.excel_total_cost * 100) / 100,
      match: !dish.recipe.flags.includes("excel_no_cuadra"),
      pos_name:
        dish.pos.length === 0
          ? null
          : dish.pos.length === 1
            ? dish.pos[0].odoo_name
            : `${dish.pos[0].odoo_name} y ${dish.pos.length - 1} más`,
      link_note: dish.link_note,
      skip_reason: dish.skip_reason,
      lines: dish.recipe.lines.length,
      flags: flagWords(dish.recipe),
    }));

  const ingredients = [...ingredientByKey.values()];
  return {
    ingredients,
    preparations,
    dishes,
    preview: {
      rows,
      dishes: dishes.length,
      matching: rows.filter((row) => row.match).length,
      preparations: preparations.length,
      ingredients_new: ingredients.filter((row) => !row.existing_id).length,
      ingredients_reused: ingredients.filter((row) => row.existing_id).length,
      linked: dishes.filter((dish) => dish.pos.length > 0 && !dish.skip_reason)
        .length,
      unmatched: dishes
        .filter(
          (dish) =>
            dish.pos.length === 0 && !dish.recipe.flags.includes("menu_eventos")
        )
        .map((dish) => ({
          dish: dish.recipe.name,
          reason: dish.skip_reason ?? dish.link_note,
        })),
      skipped: dishes.filter((dish) => dish.skip_reason).length,
      conflicts: dishes
        .filter((dish) => dish.conflict)
        .map((dish) => ({
          key: dish.recipe.key,
          dish: dish.recipe.name,
          size: dish.recipe.size,
          my_cost: dish.conflict!.my_cost,
          my_lines: dish.conflict!.my_lines,
          excel_cost:
            dish.recipe.pending_lines > 0
              ? null
              : Math.round(dish.recipe.calculated_cost * 100) / 100,
          excel_lines: dish.recipe.lines.filter(
            (line) => line.quantity && line.quantity > 0
          ).length,
          odoo_product_id: dish.pos[0]?.odoo_product_id ?? null,
        })),
    },
  };
}
