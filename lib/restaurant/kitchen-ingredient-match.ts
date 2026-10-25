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
 * Words that name a CATEGORY, not an identity ("salsa roja" is not "Salsa de
 * soya"). Sharing only one of these is never enough for a suggestion.
 * Kept small on purpose; matched folded and in plural.
 */
export const GENERIC_HEAD_WORDS: readonly string[] = [
  "salsa",
  "aceite",
  "crema",
  "queso",
  "polvo",
  "jugo",
  "pasta",
  "mezcla",
  "caldo",
  "harina",
];

const FILLER_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "con",
  "para",
  "en",
  "y",
  "al",
]);

function isGenericWord(word: string): boolean {
  for (const form of spanishWordForms(word)) {
    if (GENERIC_HEAD_WORDS.includes(form)) return true;
  }
  return false;
}

/** Words that identify the thing: no fillers, no generic category words. */
export function distinguishingWords(text: string): string[] {
  return words(text).filter((w) => !FILLER_WORDS.has(w) && !isGenericWord(w));
}

function wordsMatch(a: string, b: string): number {
  if (directWordsMatch(a, b)) return 1;
  if (synonymWordsMatch(a, b)) return 0.9;
  return 0;
}

function allCovered(source: string[], target: string[]): boolean {
  return source.every((w) => target.some((t) => wordsMatch(w, t) > 0));
}

/**
 * Do these two names point at the same thing, loosely? Needs a shared
 * IDENTIFYING word (not just "salsa") and one name's identifying words to be
 * contained in the other's: "tomate cherry" ~ "Tomate", "pollo" ~ "Pechuga de
 * pollo", but not "salsa roja" ~ "Salsa de soya" nor "chile rojo" ~ "chile
 * verde". A name made only of generic words ("queso") may match on those.
 */
export function looselySameName(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const da = distinguishingWords(a);
  const db = distinguishingWords(b);
  if (da.length > 0 && db.length > 0) {
    if (!(allCovered(da, wb) || allCovered(db, wa))) return 0;
  } else if (da.length > 0 || db.length > 0) {
    // One side is only generic words: it must be covered by the other.
    const only = da.length === 0 ? wa : wb;
    const other = da.length === 0 ? wb : wa;
    if (
      !allCovered(
        only.filter((w) => !FILLER_WORDS.has(w)),
        other
      )
    )
      return 0;
  }
  let shared = 0;
  for (const w of wa) {
    const best = Math.max(0, ...wb.map((t) => wordsMatch(w, t)));
    shared += best;
  }
  if (shared === 0) return 0;
  // Needs at least one identifying word in common when there are any.
  if (da.length > 0 && db.length > 0) {
    const common = da.some((w) => db.some((t) => wordsMatch(w, t) > 0));
    if (!common) return 0;
  }
  return shared / Math.max(wa.length, wb.length);
}

/**
 * 4. A looser guess for a name nothing matched. Never pre-selected; the screen
 * shows «¿Es <X>?». Deterministic: best score, then shorter name, then name,
 * then id. See looselySameName for what counts.
 */
export function suggestIngredient<T extends MatchableIngredient>(
  name: string,
  ingredients: readonly T[]
): IngredientSuggestion<T> | null {
  if (
    words(name).length === 0 ||
    normalizeKitchenName(name).trim().length < 3
  ) {
    return null;
  }
  let best: IngredientSuggestion<T> | null = null;
  for (const ing of [...ingredients].sort(byNameThenId)) {
    const score = looselySameName(name, ing.name);
    if (score === 0) continue;
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

/** Strip «(para pupusas y pasteles)» style qualifiers before comparing. */
export function stripParenthetical(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PreparationRef {
  id?: string;
  name: string;
}

/** The preparation (existing or from the same upload) a name looks like. */
export function suggestPreparation<T extends PreparationRef>(
  name: string,
  preparations: readonly T[]
): T | null {
  if (
    words(name).length === 0 ||
    normalizeKitchenName(name).trim().length < 3
  ) {
    return null;
  }
  let best: { prep: T; score: number } | null = null;
  for (const prep of preparations) {
    const clean = stripParenthetical(prep.name);
    const score = looselySameName(stripParenthetical(name), clean);
    if (score === 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && clean.length < best.prep.name.length)
    ) {
      best = { prep, score };
    }
  }
  return best?.prep ?? null;
}
