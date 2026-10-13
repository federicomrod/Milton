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
/** POS price and Excel price × 1.13 count as the same within this share. */
export const POS_PRICE_TOLERANCE = 0.03;

export interface PlanPosProduct {
  odoo_product_id: number;
  odoo_name: string;
  /** Price on the POS (with IVA), from the menu item or sales. */
  pos_price: number | null;
  link_state: string | null;
}

export interface PlanExistingDish {
  odoo_product_id: number;
  /** An approved version or a recipe made by hand: never overwritten. */
  protected: boolean;
}

export interface PlanCatalog {
  ingredients: ReadonlyArray<{ id: string; name: string }>;
  preparations: ReadonlyArray<{ id: string; name: string }>;
  /** normalizeMatchName(alias) → ingredient id, confirmed by a person. */
  aliases?: ReadonlyMap<string, string>;
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
  pos: PlanPosProduct | null;
  /** Why it is (not) linked, for the preview. */
  link_note: string;
  /** Set when the dish is left alone. */
  skip_reason: string | null;
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
 * The POS product for an Excel dish: same name, same size, and the price
 * agrees. Returns why not when it does not link.
 */
export function matchDishToPos(
  recipe: CanonicalRecipe,
  products: readonly PlanPosProduct[]
): { product: PlanPosProduct | null; note: string } {
  const base = recipe.dish_name;
  const candidates = products.filter((product) => {
    const score = nameMatchScore(base, stripSize(product.odoo_name));
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
    return { product: null, note: "No encontré este plato en el POS" };
  }
  const price = excelPriceWithIva(recipe);
  if (price === null) {
    return {
      product: null,
      note: "El Excel no trae precio de venta para confirmar el vínculo",
    };
  }
  const confirmed = candidates.filter(
    (product) =>
      product.pos_price !== null &&
      product.pos_price > 0 &&
      samePrice(product.pos_price, price)
  );
  if (confirmed.length === 1) {
    return {
      product: confirmed[0],
      note: `Nombre, tamaño y precio coinciden (${price.toFixed(2)})`,
    };
  }
  if (confirmed.length > 1) {
    return { product: null, note: "Hay más de un producto del POS posible" };
  }
  return {
    product: null,
    note: `El precio no coincide con el POS (Excel ${price.toFixed(2)} con IVA)`,
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
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) ingredientByKey.get(key)!.default_unit = top[0];
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
  const protectedIds = new Set(
    input.existing
      .filter((row) => row.protected)
      .map((row) => row.odoo_product_id)
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
      pos: hit.product,
      link_note: hit.note,
      skip_reason: null,
    };
    if (hit.product) {
      const earlier = claimed.get(hit.product.odoo_product_id);
      if (earlier) {
        // The events copy of a main dish: the main dish keeps the link.
        dish.pos = null;
        dish.link_note = `«${hit.product.odoo_name}» ya va con ${earlier.recipe.name}`;
      } else {
        claimed.set(hit.product.odoo_product_id, dish);
        if (protectedIds.has(hit.product.odoo_product_id)) {
          dish.skip_reason =
            "Ya tiene una receta aprobada o hecha a mano; no se toca";
        }
      }
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
      pos_name: dish.pos?.odoo_name ?? null,
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
      linked: dishes.filter((dish) => dish.pos && !dish.skip_reason).length,
      skipped: dishes.filter((dish) => dish.skip_reason).length,
    },
  };
}
