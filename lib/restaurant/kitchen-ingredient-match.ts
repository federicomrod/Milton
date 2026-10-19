// How a name a cook said ("bacon", "queso fresco") finds an ingredient of the
// company. Pure (no I/O) so the server (Telegram draft) and the browser
// (Revisar receta) use the SAME rules:
//
//   1. exact name, ignoring accents and capitals        → picked
//   2. a remembered alias (ingredient_aliases)          → picked
//   3. the small synonym list, whole name (tomate = jitomate) → picked
//   4. anything looser (a shared word)                  → only a SUGGESTION
//      «¿Es <X>?», never pre-selected.
//
// Ties are broken the same way every time: best score, then name, then id.

export interface MatchableIngredient {
  id: string;
  name: string;
}

export function normalizeKitchenName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const KITCHEN_SYNONYMS: Record<string, string> = {
  tomate: "jitomate",
  jitomate: "tomate",
  papa: "patata",
  patata: "papa",
  chile: "chili",
  chili: "chile",
  elote: "maiz",
  maiz: "elote",
};

export function spanishWordForms(word: string): Set<string> {
  const forms = new Set<string>([word]);
  if (word.length <= 3) return forms;

  if (word.endsWith("ces")) {
    forms.add(`${word.slice(0, -3)}z`);
  }
  if (word.endsWith("es")) {
    const stem = word.slice(0, -2);
    if (stem.length > 0) {
      forms.add(stem);
      forms.add(`${stem}e`);
    }
  } else if (word.endsWith("s")) {
    forms.add(word.slice(0, -1));
  }
  return forms;
}

function formsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const form of a) {
    if (b.has(form)) return true;
  }
  return false;
}

function synonymForms(word: string): Set<string> {
  const expanded = new Set<string>();
  for (const form of spanishWordForms(word)) {
    const synonym = KITCHEN_SYNONYMS[form];
    if (!synonym) continue;
    expanded.add(synonym);
    for (const synForm of spanishWordForms(synonym)) {
      expanded.add(synForm);
    }
  }
  return expanded;
}

export function directWordsMatch(
  cookWord: string,
  catalogWord: string
): boolean {
  if (cookWord.length < 3) return false;
  return formsOverlap(
    spanishWordForms(cookWord),
    spanishWordForms(catalogWord)
  );
}

export function synonymWordsMatch(
  cookWord: string,
  catalogWord: string
): boolean {
  if (cookWord.length < 3) return false;
  const catalogForms = spanishWordForms(catalogWord);
  if (formsOverlap(synonymForms(cookWord), catalogForms)) return true;
  return formsOverlap(synonymForms(catalogWord), spanishWordForms(cookWord));
}

function words(text: string): string[] {
  return normalizeKitchenName(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const byNameThenId = (a: MatchableIngredient, b: MatchableIngredient) =>
  a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id);

/** 1. Same name, ignoring accents and capitals. */
export function findExactIngredient<T extends MatchableIngredient>(
  name: string,
  ingredients: readonly T[]
): T | null {
  const key = words(name).join(" ");
  if (!key) return null;
  return (
    [...ingredients]
      .sort(byNameThenId)
      .find((ing) => words(ing.name).join(" ") === key) ?? null
  );
}

/**
 * 3. The same name written as a plural ("tomates" = "Tomate") or through the
 * synonym list ("tomate rojo" = "jitomate rojo"): same number of words and
 * every word equal, a plural of the other, or a synonym. A shared word alone
 * is not enough (that is a suggestion).
 */
export function findSynonymIngredient<T extends MatchableIngredient>(
  name: string,
  ingredients: readonly T[]
): T | null {
  const cook = words(name);
  if (cook.length === 0) return null;
  for (const ing of [...ingredients].sort(byNameThenId)) {
    const theirs = words(ing.name);
    if (theirs.length !== cook.length) continue;
    const same = cook.every(
      (w, i) =>
        w === theirs[i] ||
        directWordsMatch(w, theirs[i]) ||
        synonymWordsMatch(w, theirs[i])
    );
    if (same) return ing;
  }
  return null;
}

export interface IngredientSuggestion<T extends MatchableIngredient> {
  ingredient: T;
  /** 0–1: shared words over the longer name. */
  score: number;
}

/**
 * 4. A looser guess for a name nothing matched: the ingredient that shares the
 * most words. Never pre-selected; the screen shows «¿Es <X>?». Deterministic:
 * best score, then shorter name, then name, then id.
 */
export function suggestIngredient<T extends MatchableIngredient>(
  name: string,
  ingredients: readonly T[]
): IngredientSuggestion<T> | null {
  const cook = words(name);
  if (cook.length === 0 || normalizeKitchenName(name).trim().length < 3) {
    return null;
  }
  let best: IngredientSuggestion<T> | null = null;
  for (const ing of [...ingredients].sort(byNameThenId)) {
    const theirs = words(ing.name);
    if (theirs.length === 0) continue;
    // A shared word counts 1, a synonym of a word 0.9 (so a direct match wins).
    let shared = 0;
    for (const w of cook) {
      if (theirs.some((t) => directWordsMatch(w, t))) shared += 1;
      else if (theirs.some((t) => synonymWordsMatch(w, t))) shared += 0.9;
    }
    if (shared === 0) continue;
    const score = shared / Math.max(cook.length, theirs.length);
    if (
      !best ||
      score > best.score ||
      (score === best.score && ing.name.length < best.ingredient.name.length)
    ) {
      best = { ingredient: ing, score };
    }
  }
  return best;
}
