// R1-15g (F4): Milton's group suggestions for items that sit in no group,
// by NAME and CATEGORY only (no AI, nothing leaves the browser):
//   1. three or more items that start with the same significant word
//      (Cerveza Toña, Cerveza Pilsener, Cerveza Suprema → «Cervezas»);
//   2. three or more items with the same category («Bebidas»).
// What is left over can be sent (names and categories only) to the AI.
// A suggestion never counts as grouped until a person accepts it.

import { dishKey } from "@/lib/restaurant/menu-dishes/variant-name";
import { wordsOf } from "./suggest";

export interface ClusterItem {
  ref: string;
  name: string;
  category?: string | null;
  /** The ONE restaurant the item sold in (Todos los restaurantes); null = both or unknown. */
  restaurant?: string | null;
}

export interface Cluster {
  /** Stable across renders: lets a dismissed suggestion stay dismissed. */
  key: string;
  name: string;
  refs: string[];
  reason: "nombre" | "categoria" | "ia";
  /** Set when the suggestion belongs to one restaurant: it never mixes restaurants. */
  restaurantId?: string | null;
}

const MIN_ITEMS = 3;
/** A "cluster" that holds most of the list is a category label, not a group. */
const MAX_SHARE = 0.6;

const norm = (s: string) => dishKey(s);

/**
 * «cerveza» → «Cervezas», «papas» → «Papas». Only the safe cases are made
 * plural (a word ending in a vowel); anything else (Whisky, Frozen) stays as
 * written, because a wrong plural looks worse than none. The name is editable.
 */
export function pluralName(word: string): string {
  const w = word.trim();
  if (!w) return w;
  const cap = w.charAt(0).toUpperCase() + w.slice(1);
  return /[aeiouáéíóú]$/i.test(cap) ? `${cap}s` : cap;
}

const GENERIC_CATEGORIES = new Set([
  "",
  "platos",
  "otros",
  "varios",
  "general",
]);

export function clusterSuggestions(
  items: readonly ClusterItem[],
  opts: {
    /** Items that already have a better home (a suggestion to an existing group or dish). */
    exclude?: ReadonlySet<string>;
    /** Names a group already has here: never suggest the same name twice. */
    takenNames?: ReadonlySet<string>;
    /**
     * Todos los restaurantes: suggest inside each restaurant on its own
     * (items sold in both, or unknown, form their own bucket), and tag each
     * suggestion with its restaurant. `takenFor` gives the names already
     * used in that restaurant's scope.
     */
    perRestaurant?: boolean;
    takenFor?: (restaurantId: string | null) => ReadonlySet<string>;
  } = {}
): Cluster[] {
  if (opts.perRestaurant) {
    const buckets = new Map<string | null, ClusterItem[]>();
    for (const item of items) {
      const key = item.restaurant ?? null;
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
    return [...buckets.entries()]
      .flatMap(([restaurantId, list]) =>
        clusterSuggestions(list, {
          exclude: opts.exclude,
          takenNames: opts.takenFor?.(restaurantId) ?? opts.takenNames,
        }).map((c) => ({
          ...c,
          key: `${restaurantId ?? "compartido"}|${c.key}`,
          restaurantId,
        }))
      )
      .sort(
        (a, b) =>
          b.refs.length - a.refs.length || a.name.localeCompare(b.name, "es")
      );
  }
  const taken = new Set([...(opts.takenNames ?? [])].map(norm));
  const pool = items.filter((i) => !opts.exclude?.has(i.ref));
  const out: Cluster[] = [];
  const used = new Set<string>();
  const cap = Math.max(MIN_ITEMS, Math.floor(pool.length * MAX_SHARE));

  // 1) A shared first word.
  const byWord = new Map<string, ClusterItem[]>();
  for (const item of pool) {
    const first = wordsOf(item.name)[0];
    if (!first) continue;
    byWord.set(first, [...(byWord.get(first) ?? []), item]);
  }
  for (const [word, list] of [...byWord.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "es")
  )) {
    const free = list.filter((i) => !used.has(i.ref));
    if (free.length < MIN_ITEMS || free.length > cap) continue;
    const name = pluralName(word);
    if (taken.has(norm(name)) || taken.has(norm(word))) continue;
    for (const i of free) used.add(i.ref);
    taken.add(norm(name));
    out.push({
      key: `nombre:${word}`,
      name,
      refs: free.map((i) => i.ref),
      reason: "nombre",
    });
  }

  // 2) A shared category.
  const byCategory = new Map<string, ClusterItem[]>();
  for (const item of pool) {
    if (used.has(item.ref)) continue;
    const cat = (item.category ?? "").trim();
    if (GENERIC_CATEGORIES.has(cat.toLowerCase())) continue;
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), item]);
  }
  for (const [cat, list] of byCategory) {
    if (list.length < MIN_ITEMS || list.length > cap) continue;
    if (taken.has(norm(cat))) continue;
    for (const i of list) used.add(i.ref);
    taken.add(norm(cat));
    out.push({
      key: `categoria:${norm(cat)}`,
      name: cat,
      refs: list.map((i) => i.ref),
      reason: "categoria",
    });
  }
  return out.sort(
    (a, b) =>
      b.refs.length - a.refs.length || a.name.localeCompare(b.name, "es")
  );
}

/** What of the pool is not in any cluster (candidates for the AI). */
export function leftOver(
  items: readonly ClusterItem[],
  clusters: readonly Cluster[]
): ClusterItem[] {
  const covered = new Set(clusters.flatMap((c) => c.refs));
  return items.filter((i) => !covered.has(i.ref));
}
