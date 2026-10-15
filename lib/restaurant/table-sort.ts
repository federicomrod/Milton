// R1-15e: one sort for every table. Click a header: descending, then
// ascending, then back to the table's default. A missing value ("Sin
// precio", no data) always sorts to the bottom, in both directions, and is
// never read as 0. Pure and client-side: sorting never asks the server.

export type SortDir = "desc" | "asc";
export interface SortState {
  key: string;
  dir: SortDir;
}
export type SortValue = number | string | null | undefined;

/** The state after a click on `key`. `null` = back to the table's default order. */
export function nextSort(
  current: SortState | null,
  key: string,
  fallback: SortState | null = null
): SortState | null {
  const base = current ?? fallback;
  if (!base || base.key !== key) return { key, dir: "desc" };
  if (base.dir === "desc") return { key, dir: "asc" };
  // Ascending: back to the default (which is itself ascending → start over).
  return current === null ? { key, dir: "desc" } : null;
}

const missing = (v: SortValue): v is null | undefined =>
  v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));

/** Missing values last whatever the direction; text with accents folded. */
export function compareSort(a: SortValue, b: SortValue, dir: SortDir): number {
  const ma = missing(a);
  const mb = missing(b);
  if (ma && mb) return 0;
  if (ma) return 1;
  if (mb) return -1;
  const sign = dir === "desc" ? -1 : 1;
  if (typeof a === "string" || typeof b === "string") {
    return (
      String(a).localeCompare(String(b), "es", { sensitivity: "base" }) * sign
    );
  }
  return ((a as number) - (b as number)) * sign;
}

/** A stable copy sorted by the state; `null` keeps the given order. */
export function sortRows<T>(
  rows: readonly T[],
  state: SortState | null,
  value: (row: T, key: string) => SortValue
): T[] {
  if (!state) return [...rows];
  return rows
    .map((row, i) => ({ row, i, v: value(row, state.key) }))
    .sort((x, y) => compareSort(x.v, y.v, state.dir) || x.i - y.i)
    .map((x) => x.row);
}

/**
 * Sort a tree level by level: the nodes of each level among themselves, the
 * children inside each node, children always staying under their parent.
 */
export function sortTree<N extends { children: N[] }>(
  nodes: readonly N[],
  state: SortState | null,
  value: (node: N, key: string) => SortValue
): N[] {
  if (!state) return [...nodes];
  return sortRows(nodes, state, value).map((n) =>
    n.children.length > 0
      ? { ...n, children: sortTree(n.children, state, value) }
      : n
  );
}
