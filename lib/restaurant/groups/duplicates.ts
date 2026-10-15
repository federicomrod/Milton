// R1-15h: «¿Parecen duplicados?» — among the selected products of the SAME
// restaurant, those whose names are the same or nearly the same. It only
// offers to GROUP them; it never merges POS products (an ingredient merge
// with undo belongs in Limpieza de ingredientes). Products of different
// restaurants are never offered together: the same name in R1 and R2 is two
// products, not a duplicate.

import { foldText } from "./search";

export interface DuplicateCandidate {
  ref: string;
  name: string;
  /** The ONE restaurant the product sold in; null = both or unknown (never matched). */
  restaurant: string | null;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] =
        a[i - 1] === b[j - 1] ? last : 1 + Math.min(last, prev[j], prev[j - 1]);
      last = tmp;
    }
  }
  return prev[b.length];
}

/** Same name once accents, case and spaces are out, or one or two letters apart on a longer name. */
export function nearSameName(a: string, b: string): boolean {
  const x = foldText(a);
  const y = foldText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 6) return false;
  return distance(x, y) <= 2;
}

/** The biggest set of 2+ candidates (same restaurant) with near-same names, or null. */
export function duplicateHint(
  items: readonly DuplicateCandidate[]
): { name: string; refs: string[] } | null {
  const byRestaurant = new Map<string, DuplicateCandidate[]>();
  for (const item of items) {
    if (!item.restaurant) continue;
    byRestaurant.set(item.restaurant, [
      ...(byRestaurant.get(item.restaurant) ?? []),
      item,
    ]);
  }
  let best: DuplicateCandidate[] = [];
  for (const list of byRestaurant.values()) {
    // Union-find over "near the same name".
    const parent = list.map((_, i) => i);
    const find = (i: number): number =>
      parent[i] === i ? i : (parent[i] = find(parent[i]));
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (nearSameName(list[i].name, list[j].name)) parent[find(i)] = find(j);
    const sets = new Map<number, DuplicateCandidate[]>();
    list.forEach((item, i) => {
      const r = find(i);
      sets.set(r, [...(sets.get(r) ?? []), item]);
    });
    for (const set of sets.values()) if (set.length > best.length) best = set;
  }
  if (best.length < 2) return null;
  const name = best
    .map((i) => i.name.trim())
    .sort((a, b) => a.length - b.length || a.localeCompare(b, "es"))[0];
  return { name, refs: best.map((i) => i.ref) };
}
