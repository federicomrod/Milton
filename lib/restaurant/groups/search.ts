// R1-15e: search that finds groups as well as products. A group whose name
// matches shows open with all its members; a product that matches shows
// inside its group, with the group row visible (and open).

export const foldText = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export interface SearchNode {
  id: string;
  kind: "group" | "leaf";
  name: string;
  children: SearchNode[];
}

/**
 * The tree reduced to what matches `query`. `open` lists the groups to show
 * expanded. An empty query returns the nodes untouched.
 */
export function searchTree<N extends SearchNode>(
  nodes: readonly N[],
  query: string,
  /** Extra text a leaf can be found by (supplier, …). */
  extra: (node: N) => string | null | undefined = () => null
): { nodes: N[]; open: Set<string> } {
  const q = foldText(query);
  const open = new Set<string>();
  if (!q) return { nodes: [...nodes], open };

  const openAll = (n: N) => {
    if (n.kind === "group") open.add(n.id);
    for (const c of n.children) openAll(c as N);
  };
  const visit = (list: readonly N[]): N[] => {
    const out: N[] = [];
    for (const n of list) {
      const hit =
        foldText(n.name).includes(q) || foldText(extra(n) ?? "").includes(q);
      if (n.kind === "group") {
        if (hit) {
          openAll(n);
          out.push(n);
          continue;
        }
        const kept = visit(n.children as N[]);
        if (kept.length > 0) {
          open.add(n.id);
          out.push({ ...n, children: kept });
        }
      } else if (hit) {
        out.push(n);
      }
    }
    return out;
  };
  return { nodes: visit(nodes), open };
}
