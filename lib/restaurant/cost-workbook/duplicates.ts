// Plain-code typo matching. AI never decides a merge.

import { nameKey } from "@/lib/restaurant/cost-import";
import {
  convertUnit,
  convertUnitPriceStr,
  normalizeUnit,
} from "@/lib/restaurant/units";
import { normalizeMatchName } from "./names";
import type { ReviewCandidate, WorkbookRowCandidate } from "./types";
import { implausiblePriceReason, typicalMassPriceScore } from "./plausibility";

const SHORT_NAME = 8;

function digitTokens(name: string): string[] {
  return (normalizeMatchName(name).match(/\d+/g) ?? []).sort();
}

function sizeGradeTokens(name: string): string[] {
  return normalizeMatchName(name)
    .split(" ")
    .filter((token) => /\d/.test(token))
    .sort();
}

function sameTokenList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((token, i) => token === right[i]);
}

/**
 * Spanish gender/number pair on a short word: queso/quesa, pimienta/pimientó
 * (a ↔ o), or a trailing a/as · o/os. Longer names are left to edit distance.
 */
function changesGenderNumberSuffix(a: string, b: string): boolean {
  const leftWords = normalizeMatchName(a).split(" ").filter(Boolean);
  const rightWords = normalizeMatchName(b).split(" ").filter(Boolean);
  if (leftWords.length !== rightWords.length) return false;
  for (let i = 0; i < leftWords.length; i++) {
    const left = leftWords[i];
    const right = rightWords[i];
    if (Math.max(left.length, right.length) > SHORT_NAME) continue;
    if (Math.min(left.length, right.length) < 4) continue;
    if (left.slice(0, -1) === right.slice(0, -1)) {
      const ends = [left.slice(-1), right.slice(-1)].sort().join("");
      if (ends === "ao") return true;
    }
    const [shorter, longer] =
      left.length <= right.length ? [left, right] : [right, left];
    if (
      longer === `${shorter}s` &&
      (shorter.endsWith("a") || shorter.endsWith("o"))
    ) {
      return true;
    }
  }
  return false;
}

export function canAutoLinkNames(a: string, b: string): boolean {
  const left = normalizeMatchName(a);
  const right = normalizeMatchName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (nameKey(a) === nameKey(b)) return true;
  return isObviousTypo(a, b);
}

export function damerauLevenshtein(a: string, b: string): number {
  const left = a;
  const right = b;
  const n = left.length;
  const m = right.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const prev = new Array<number>(m + 1);
  const curr = new Array<number>(m + 1);
  const prev2 = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        curr[j] = Math.min(curr[j], prev2[j - 2] + 1);
      }
    }
    for (let j = 0; j <= m; j++) {
      prev2[j] = prev[j];
      prev[j] = curr[j];
    }
  }
  return prev[m];
}

export function isObviousTypo(a: string, b: string): boolean {
  const left = normalizeMatchName(a);
  const right = normalizeMatchName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (!sameTokenList(digitTokens(left), digitTokens(right))) return false;
  if (!sameTokenList(sizeGradeTokens(left), sizeGradeTokens(right))) {
    return false;
  }
  if (changesGenderNumberSuffix(left, right)) return false;

  const dist = damerauLevenshtein(left, right);
  const maxLen = Math.max(left.length, right.length);
  const minLen = Math.min(left.length, right.length);
  if (minLen < 4) return false;
  if (maxLen <= SHORT_NAME) {
    if (dist !== 1) return false;
    if (left[0] !== right[0]) return false;
    // Same last letter, or a last-letter substitution that is not a/o
    // (ARROI → ARROZ). Insertion/deletion at the end would change the
    // last letter and is not treated as a typo for short names.
    if (left[left.length - 1] === right[right.length - 1]) return true;
    return left.length === right.length;
  }
  return dist <= 2 && dist / maxLen <= 0.25;
}

export function unitsCompatible(
  left?: string | null,
  right?: string | null
): boolean {
  if (!left || !right) return true;
  const a = normalizeUnit(left);
  const b = normalizeUnit(right);
  if (!a || !b) return true;
  if (a === b) return true;
  return convertUnit(1, a, b).ok;
}

export function pickCanonicalName(
  names: string[],
  existingNames: string[] = []
): string {
  const existing = existingNames.find((name) =>
    names.some(
      (candidate) =>
        normalizeMatchName(candidate) === normalizeMatchName(name) ||
        isObviousTypo(candidate, name)
    )
  );
  if (existing) return existing;
  let best = names[0] ?? "";
  for (const name of names) {
    if (normalizeMatchName(name).length > normalizeMatchName(best).length) {
      best = name;
    }
  }
  return best;
}

function pricesAgree(left: WorkbookRowCandidate, right: WorkbookRowCandidate) {
  if (left.unit_price === right.unit_price && left.unit === right.unit) {
    return true;
  }
  const converted = convertUnitPriceStr(left.unit_price, left.unit, right.unit);
  if (!converted.ok) return false;
  const abs = Math.abs(converted.value - right.unit_price);
  if (abs <= 0.05) return true;
  const denom = Math.max(
    Math.abs(right.unit_price),
    Math.abs(converted.value),
    1e-9
  );
  return abs / denom <= 0.02;
}

function rowScore(row: WorkbookRowCandidate): number {
  const implausible = implausiblePriceReason(
    row.ingredient_name,
    row.unit,
    row.unit_price
  );
  if (implausible) return -1;
  return typicalMassPriceScore(row.unit, row.unit_price);
}

function pickKeptRow(
  rows: WorkbookRowCandidate[],
  canonicalName: string
): WorkbookRowCandidate {
  const named = rows.find(
    (row) =>
      normalizeMatchName(row.ingredient_name) ===
      normalizeMatchName(canonicalName)
  );
  const ranked = [...rows].sort((a, b) => rowScore(b) - rowScore(a));
  const best = ranked[0] ?? rows[0];
  const base = named ?? best;
  const category =
    rows.find((row) => row.category)?.category ?? base.category ?? null;
  return {
    ...base,
    ingredient_name: canonicalName,
    category,
  };
}

export interface ExistingIngredientRef {
  name: string;
  default_unit?: string | null;
  handmade?: boolean;
}

export interface DuplicateMergeResult {
  rows: WorkbookRowCandidate[];
  skipped: ReviewCandidate[];
  hints: ReviewCandidate[];
  aliases: Map<string, string>;
}

class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }
  union(a: number, b: number) {
    const pa = this.find(a);
    const pb = this.find(b);
    if (pa !== pb) this.parent[pb] = pa;
  }
}

function aliasKeys(name: string): string[] {
  return [name.trim().toLowerCase(), normalizeMatchName(name)].filter(Boolean);
}

/**
 * Auto-merge obvious same-restaurant typos (normalized name + small
 * edit distance + compatible unit). Unclear near-matches become an
 * optional needs-a-look hint and are still saved.
 */
export function mergeTypoDuplicates(
  rows: WorkbookRowCandidate[],
  existing: ExistingIngredientRef[] = []
): DuplicateMergeResult {
  const aliases = new Map<string, string>();
  const skipped: ReviewCandidate[] = [];
  const hints: ReviewCandidate[] = [];
  if (rows.length === 0) {
    return { rows, skipped, hints, aliases };
  }

  const uf = new UnionFind(rows.length);
  const hinted = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (
        normalizeMatchName(a.ingredient_name) ===
        normalizeMatchName(b.ingredient_name)
      ) {
        uf.union(i, j);
        continue;
      }
      if (!isObviousTypo(a.ingredient_name, b.ingredient_name)) continue;
      if (unitsCompatible(a.unit, b.unit)) {
        uf.union(i, j);
        continue;
      }
      const key = [i, j].join(":");
      if (hinted.has(key)) continue;
      hinted.add(key);
      const better = pickCanonicalName([a.ingredient_name, b.ingredient_name]);
      const worse = better === a.ingredient_name ? b : a;
      hints.push({
        tabName: worse.tabName,
        rowIndex: worse.rowIndex,
        reason: `looks like a typo of ${better}?`,
        raw: worse.raw,
        suggested: {
          ingredient_name: better,
          unit: worse.unit,
          quantity: worse.quantity,
          total_cost: worse.total_cost,
          cost_date: worse.cost_date,
        },
      });
    }
  }

  const existingByCluster = new Map<number, string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hit = existing.find(
      (item) =>
        normalizeMatchName(item.name) ===
          normalizeMatchName(row.ingredient_name) ||
        isObviousTypo(item.name, row.ingredient_name)
    );
    if (!hit) continue;
    if (
      hit.handmade &&
      normalizeMatchName(hit.name) !== normalizeMatchName(row.ingredient_name)
    ) {
      hints.push({
        tabName: row.tabName,
        rowIndex: row.rowIndex,
        reason: `looks like a typo of ${hit.name}?`,
        raw: row.raw,
        suggested: {
          ingredient_name: hit.name,
          unit: row.unit,
          quantity: row.quantity,
          total_cost: row.total_cost,
          cost_date: row.cost_date,
        },
      });
      continue;
    }
    if (
      isObviousTypo(hit.name, row.ingredient_name) &&
      !unitsCompatible(hit.default_unit, row.unit) &&
      normalizeMatchName(hit.name) !== normalizeMatchName(row.ingredient_name)
    ) {
      hints.push({
        tabName: row.tabName,
        rowIndex: row.rowIndex,
        reason: `looks like a typo of ${hit.name}?`,
        raw: row.raw,
        suggested: {
          ingredient_name: hit.name,
          unit: row.unit,
          quantity: row.quantity,
          total_cost: row.total_cost,
          cost_date: row.cost_date,
        },
      });
      continue;
    }
    const root = uf.find(i);
    existingByCluster.set(root, hit.name);
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const root = uf.find(i);
    const list = clusters.get(root) ?? [];
    list.push(i);
    clusters.set(root, list);
  }

  const kept: WorkbookRowCandidate[] = [];
  for (const indexes of clusters.values()) {
    const clusterRows = indexes.map((i) => rows[i]);
    const names = clusterRows.map((row) => row.ingredient_name);
    const root = uf.find(indexes[0]);
    const existingName = existingByCluster.get(root);
    const canonical = pickCanonicalName(
      names,
      existingName ? [existingName] : []
    );
    const winner = pickKeptRow(clusterRows, canonical);
    const disagree = clusterRows.some(
      (row) => row !== winner && !pricesAgree(row, winner)
    );
    kept.push(winner);
    for (const row of clusterRows) {
      for (const key of aliasKeys(row.ingredient_name)) {
        aliases.set(key, canonical);
      }
      if (
        row === winner ||
        (row.rowIndex === winner.rowIndex && row.tabName === winner.tabName)
      ) {
        continue;
      }
      skipped.push({
        tabName: row.tabName,
        rowIndex: row.rowIndex,
        reason: `merged typo of ${canonical}`,
        raw: row.raw,
        suggested: {
          ingredient_name: canonical,
          unit: winner.unit,
          quantity: winner.quantity,
          total_cost: winner.total_cost,
          cost_date: winner.cost_date,
        },
      });
    }
    if (disagree && clusterRows.length > 1) {
      hints.push({
        tabName: winner.tabName,
        rowIndex: winner.rowIndex,
        reason: `merged typo of ${canonical} — lb/oz prices didn't convert`,
        raw: winner.raw,
        suggested: {
          ingredient_name: canonical,
          unit: winner.unit,
          quantity: winner.quantity,
          total_cost: winner.total_cost,
          cost_date: winner.cost_date,
        },
      });
    }
  }

  return { rows: kept, skipped, hints, aliases };
}

export function resolveAliasName(
  name: string,
  aliases: Map<string, string>
): string {
  return (
    aliases.get(name.trim().toLowerCase()) ??
    aliases.get(normalizeMatchName(name)) ??
    name
  );
}
