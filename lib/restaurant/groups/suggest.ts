// lib/restaurant/groups/suggest.ts
//
// R1-15c: Milton's inline suggestion for an item that is in no group
// ("✦ ¿Añadir a Churrasco Típico?"). Name heuristics only (no AI here, no
// client data leaves the browser: this runs on the names already on screen).
// A suggestion is only ever a suggestion: it never counts as grouped until a
// person accepts it.
//
// Order of evidence (stop at the first that gives ONE clear answer):
//   1. the same dish: its name without the size and options, same key as the
//      menu dishes (variant-name.ts);
//   2. every word of a group's name is in the item's name ("Lomo de aguja"
//      in "Lomo de aguja (Proveedor B)");
//   3. the same base name as an item that is already in a group.
// Two equally good answers = no suggestion ("Sin sugerencia"): a wrong guess
// costs the person more than no guess.

import {
  dishKey,
  parseVariantName,
  sameDishKey,
} from "@/lib/restaurant/menu-dishes/variant-name";

export interface SuggestTarget {
  id: string;
  name: string;
  /** A menu dish (adding is a move of the variant) or a group of the person. */
  kind: "dish" | "group";
  /** Names of items already in it (evidence 3). */
  memberNames?: readonly string[];
}

export interface Suggestion {
  target: SuggestTarget;
  reason: "plato" | "nombre" | "parecido";
}

const STOP = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "con",
  "y",
  "a",
  "al",
  "en",
  "por",
  "oz",
  "onz",
  "onza",
  "onzas",
  "lb",
  "kg",
  "g",
  "ml",
  "l",
  "un",
  "una",
  "extra",
]);

/** Significant words: lowercase, no accents, no sizes or fillers. */
export function wordsOf(text: string): string[] {
  return dishKey(parseVariantName(text).base || text)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

function only<T>(items: T[]): T | null {
  return items.length === 1 ? items[0] : null;
}

export function suggestGroup(
  itemName: string,
  targets: readonly SuggestTarget[]
): Suggestion | null {
  const key = dishKey(parseVariantName(itemName).base || itemName);
  if (!key) return null;

  // 1) The same dish.
  const sameDish = targets.filter(
    (t) => t.kind === "dish" && sameDishKey(dishKey(t.name), key)
  );
  const dish = only(sameDish);
  if (dish) return { target: dish, reason: "plato" };
  if (sameDish.length > 1) return null;

  // 2) All of a group's words are in the item's name.
  const itemWords = new Set(wordsOf(itemName));
  if (itemWords.size === 0) return null;
  const named = targets
    .map((t) => ({ t, words: wordsOf(t.name) }))
    .filter(
      ({ words }) => words.length > 0 && words.every((w) => itemWords.has(w))
    );
  if (named.length > 0) {
    const best = Math.max(...named.map((n) => n.words.length));
    const top = named.filter((n) => n.words.length === best);
    const one = only(top);
    return one ? { target: one.t, reason: "nombre" } : null;
  }

  // 3) The same base name as something already in a group.
  const sibling = targets.filter((t) =>
    (t.memberNames ?? []).some((m) =>
      sameDishKey(dishKey(parseVariantName(m).base || m), key)
    )
  );
  const one = only(sibling);
  return one ? { target: one, reason: "parecido" } : null;
}

/** When every selected item has the same suggestion, that group; otherwise null. */
export function sharedSuggestion(
  suggestions: ReadonlyMap<string, Suggestion | null>,
  selected: readonly string[]
): SuggestTarget | null {
  if (selected.length === 0) return null;
  let target: SuggestTarget | null = null;
  for (const key of selected) {
    const s = suggestions.get(key);
    if (!s) return null;
    if (target && target.id !== s.target.id) return null;
    target = s.target;
  }
  return target;
}
