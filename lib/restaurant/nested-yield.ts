// lib/restaurant/nested-yield.ts
//
// #407 · the yield rule across preparations and nested recipes. A recipe lists
// raw, as-bought inputs; a yield turns input into output and is applied ONCE.
// For an ingredient line, in order:
//   1. the ingredient's own yield;
//   2. else no factor when ANY preparation above it, at any depth, has a
//      measured batch output;
//   3. else the restaurant's kitchen buffer.
// Preparations never get a buffer, and a preparation used inside a plato or
// another preparation is never buffered again. The Excel import's assumed
// «1 orden» is not measured. Pure, no I/O, no writes.

import { effectiveLineCost, type LineEffective } from "./effective-cost";

export interface PrepNode {
  id: string;
  /** Batch output confirmed by a person (not the import's assumed «1 orden»). */
  measured: boolean;
  /** Preparations this preparation's recipe uses. */
  children: readonly string[];
}

/** The preparations that use `prepId`, directly or through others. */
export function ancestorsOf(
  prepId: string,
  preps: ReadonlyMap<string, PrepNode>
): Set<string> {
  const parents = new Map<string, string[]>();
  for (const p of preps.values())
    for (const c of p.children) {
      const list = parents.get(c) ?? [];
      list.push(p.id);
      parents.set(c, list);
    }
  const seen = new Set<string>();
  const stack = [...(parents.get(prepId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id) || id === prepId) continue;
    seen.add(id);
    stack.push(...(parents.get(id) ?? []));
  }
  return seen;
}

/**
 * TODO(#407 follow-up): a preparation used both under a measured preparation
 * and directly in a plato is shown as covered here (editor view, one answer
 * per preparation). When effective cost is wired into dish costs / COGS,
 * resolve per usage path with `factorsForTree` instead. No behaviour change now.
 *
 * True when a line of `prepId` is covered by a measured yield: the
 * preparation itself or any preparation above it.
 */
export function coveredByMeasuredPrep(
  prepId: string,
  preps: ReadonlyMap<string, PrepNode>
): boolean {
  if (preps.get(prepId)?.measured) return true;
  for (const id of ancestorsOf(prepId, preps))
    if (preps.get(id)?.measured) return true;
  return false;
}

export interface TreeLine {
  amount: number | null;
  kind: "ingredient" | "component" | "unresolved";
  ownCost?: boolean;
  ownYieldLossPct: number | null;
}

/** One line of a recipe tree with the factor it carries. */
export function factorForLine(
  line: TreeLine,
  covered: boolean,
  bufferPct: number
): LineEffective {
  return effectiveLineCost({
    amount: line.amount,
    kind: line.kind,
    ownCost: line.ownCost,
    ownYieldLossPct: line.ownYieldLossPct,
    insideMeasuredPrep: covered,
    bufferPct,
  });
}

/** A preparation whose batch output is missing or only assumed: «falta rendimiento». */
export function missingYield(prep: { measured: boolean }): boolean {
  return !prep.measured;
}

export interface TreeRecipe {
  /** "plato" recipes sit at the top; a preparation id for the rest. */
  prepId: string | null;
  lines: readonly (TreeLine & { name: string; prepId?: string })[];
}

export interface TreeResult {
  path: string;
  name: string;
  effective: number | null;
  raw: number | null;
  factor: LineEffective["factor"];
}

/**
 * Walks a plato (or a preparation) down through every nested preparation and
 * gives each ingredient line its single factor. A preparation line itself is
 * never changed or buffered. `recipes` maps a preparation id to its lines.
 */
export function factorsForTree(
  root: TreeRecipe,
  recipes: ReadonlyMap<string, TreeRecipe>,
  preps: ReadonlyMap<string, PrepNode>,
  bufferPct: number
): TreeResult[] {
  const out: TreeResult[] = [];
  const walk = (
    r: TreeRecipe,
    covered: boolean,
    path: string,
    seen: Set<string>
  ) => {
    for (const line of r.lines) {
      if (line.kind === "component" && line.prepId) {
        if (seen.has(line.prepId)) continue;
        const sub = recipes.get(line.prepId);
        const node = preps.get(line.prepId);
        if (!sub) continue;
        walk(
          sub,
          covered || Boolean(node?.measured),
          `${path}/${line.name}`,
          new Set(seen).add(line.prepId)
        );
        continue;
      }
      const e = factorForLine(line, covered, bufferPct);
      out.push({
        path: `${path}/${line.name}`,
        name: line.name,
        raw: line.amount,
        effective: e.effective,
        factor: e.factor,
      });
    }
  };
  walk(
    root,
    root.prepId ? Boolean(preps.get(root.prepId)?.measured) : false,
    root.prepId ?? "plato",
    new Set(root.prepId ? [root.prepId] : [])
  );
  return out;
}
