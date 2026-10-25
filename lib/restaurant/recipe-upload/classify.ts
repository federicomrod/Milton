// lib/restaurant/recipe-upload/classify.ts
//
// PURE and DETERMINISTIC: decides whether an uploaded recipe is a «plato» or a
// «preparacion», and how many portions it has, from what is WRITTEN (the yield
// text and the tab/section name). The model's `kind` is only advisory.
//
// Rules, in order:
//  1. Yield written as platos / porciones / personas / servicios / raciones →
//     plato, portions = that integer. Explicit portions win over a tab name.
//  2. Yield in a weight or volume (litro, taza, kg, g, ml, galón, libra, onza…)
//     → preparación, portions null.
//  3. Yield as a count of discrete units («12 panes», «10 unidades») → plato
//     with that many portions, unless the tab is Salsas / Preparaciones /
//     Bases (then preparación, portions null).
//     «20 pasteles (porción = 3 unidades)» → 20 / 3 portions when whole, else
//     portions null (never a rounded or invented number).
//  4. No yield but a tab named Salsas / Preparaciones / Bases → preparación.
//  5. No yield info and no tab hint → the model's kind (default plato).
// Using another preparation as an ingredient never makes a dish a preparación:
// ingredient names are not an input here.

export type RecipeKind = "plato" | "preparacion";

export interface RecipeClassification {
  kind: RecipeKind;
  portions: number | null;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const PLATE_WORDS =
  /^(?:platos?|porcion(?:es)?|personas?|servicios?|raciones?|comensales|servings?|portions?)$/;
const MEASURE_WORDS =
  /^(?:litros?|lts?|l|tazas?|kgs?|kilos?|kilogramos?|gramos?|g|grs?|ml|mililitros?|galon(?:es)?|libras?|lbs?|onzas?|oz|cuartos?|quarts?|pintas?|cucharadas?|cucharaditas?)$/;

type YieldType = "plate" | "measure" | "count" | "none";

interface ParsedYield {
  type: YieldType;
  count: number | null;
}

function parseYield(yieldText: string | null | undefined): ParsedYield {
  if (!yieldText) return { type: "none", count: null };
  let t = fold(yieldText).replace(
    /^(?:rendimiento|rinde|porciones?|yield|serves)\s*:?\s*/,
    (m) => (/^porcion/.test(m) ? "porciones " : "")
  );
  // «(porción = 3 unidades)» is a portion size, not the yield itself.
  let portionSize: number | null = null;
  const size = t.match(/\(?\s*(?:1\s+)?porcion\s*=\s*(\d+)\b[^)]*\)?/);
  if (size) {
    portionSize = Number(size[1]);
    t = t.replace(size[0], " ");
  }
  // Any other parenthetical («(1 pescado por plato)») is a note.
  t = t.replace(/\([^)]*\)/g, " ").trim();

  // A bare integer is a portions count («Porciones: 6» keeps only «6»).
  const bare = t.match(/^(?:porciones\s+)?(\d+)$/);
  if (bare) return { type: "plate", count: Number(bare[1]) };

  const m = t.match(/(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)\s*([a-z]+)/);
  if (!m) return { type: "none", count: null };
  const word = m[2];
  const num = Number(m[1].replace(",", "."));
  if (PLATE_WORDS.test(word)) {
    return { type: "plate", count: toInt(num) };
  }
  if (MEASURE_WORDS.test(word)) return { type: "measure", count: null };
  // Discrete units: panes, unidades, pasteles…
  let count = toInt(num);
  if (count !== null && portionSize !== null) {
    count =
      portionSize > 0 && count % portionSize === 0 ? count / portionSize : null;
  }
  return { type: "count", count };
}

function toInt(n: number): number | null {
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Integer portions written in a yield text, or null. */
export function portionsFromYieldText(
  yieldText: string | null | undefined
): number | null {
  const y = parseYield(yieldText);
  return y.type === "plate" || y.type === "count" ? y.count : null;
}

/** True for a tab/section named Salsas, Preparaciones or Bases (any plural). */
export function isPreparationTab(tabLabel: string | null | undefined): boolean {
  if (!tabLabel) return false;
  return fold(tabLabel)
    .split(/[^a-z]+/)
    .some((w) => /^(?:salsas?|preparacion(?:es)?|bases?)$/.test(w));
}

export function classifyRecipeKind(input: {
  yieldText?: string | null;
  tabLabel?: string | null;
  modelKind?: string | null;
  /** The portions the model gave (kept only when nothing written overrides it). */
  modelPortions?: number | null;
}): RecipeClassification {
  const y = parseYield(input.yieldText);
  const prepTab = isPreparationTab(input.tabLabel);
  const modelPortions = input.modelPortions ?? null;

  if (y.type === "plate") {
    return { kind: "plato", portions: y.count ?? modelPortions };
  }
  if (y.type === "measure") return { kind: "preparacion", portions: null };
  if (y.type === "count") {
    if (prepTab) return { kind: "preparacion", portions: null };
    // Divided or unreadable count: portions unknown, never guessed.
    return { kind: "plato", portions: y.count };
  }
  if (prepTab) return { kind: "preparacion", portions: modelPortions };
  return {
    kind: input.modelKind === "preparacion" ? "preparacion" : "plato",
    portions: modelPortions,
  };
}
