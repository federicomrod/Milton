// R1-15k: possible duplicate ingredients ("ACEITE DE OLIVA" / "ACEITE DE OIVA"
// / "ACEITE OLIVIA") and how a merge is planned. Pure: no I/O, so the rules
// are pinned by tests. Heuristics first; the AI only ever sees what these
// leave over (names and units only) and its answer goes through the same
// checks (`validateAiSets`).

import { normalizeUnit } from "@/lib/restaurant/units";
import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export type UnitFamily = "weight" | "volume" | "count" | "portion" | "unknown";

/** Only ingredients of the same family can share one price per unit. */
export function unitFamily(unit: string | null | undefined): UnitFamily {
  const u = normalizeUnit(unit ?? null);
  if (!u) return "unknown";
  if (u === "kg" || u === "g" || u === "lb" || u === "oz") return "weight";
  if (u === "l" || u === "ml" || u === "gal") return "volume";
  if (u === "unit") return "count";
  if (u === "portion") return "portion";
  return "unknown";
}

const sameFamily = (a: UnitFamily, b: UnitFamily) =>
  a === "unknown" || b === "unknown" || a === b;

const STOP = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "en",
  "con",
  "y",
  "al",
]);

/** The name reduced to what identifies it: no accents, case, punctuation or fillers. */
export function ingredientKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .join(" ");
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

const numbersOf = (key: string) =>
  key
    .split(" ")
    .filter((t) => /\d/.test(t))
    .sort()
    .join(",");

/** Same key, or one or two letters apart on a longer name; numbers (600 ml / 350 ml) must match. */
export function similarIngredients(a: string, b: string): number | null {
  const x = ingredientKey(a);
  const y = ingredientKey(b);
  if (!x || !y) return null;
  if (numbersOf(x) !== numbersOf(y)) return null;
  const d = distance(x, y);
  if (d === 0) return 1;
  const len = Math.max(x.length, y.length);
  if (len < 8 || d > 2) return null;
  return Math.round((1 - d / len) * 1000) / 1000;
}

function familyLabel(family: UnitFamily, lang: PreferredLanguage): string {
  const m = getDictionary(lang).menu.screens.merge;
  switch (family) {
    case "weight":
      return m.familyWeight;
    case "volume":
      return m.familyVolume;
    case "count":
      return m.familyCount;
    case "portion":
      return m.familyPortion;
    default:
      return m.familyUnknown;
  }
}

/**
 * A merge needs ONE unit family (the survivor's price applies to every line).
 * Returns the reason (in `lang`) when two of them differ, else null. An unknown
 * unit fits any family. The database enforces the same rule.
 */
export function mergeUnitMismatch(
  items: ReadonlyArray<{ name: string; unit: string | null | undefined }>,
  lang: PreferredLanguage = "es"
): string | null {
  const known = items
    .map((i) => ({ name: i.name, family: unitFamily(i.unit) }))
    .filter((i) => i.family !== "unknown");
  const first = known[0];
  const other = first && known.find((k) => k.family !== first.family);
  if (!first || !other) return null;
  return fmt(getDictionary(lang).menu.screens.merge.unitMismatch, {
    a: first.name,
    familyA: familyLabel(first.family, lang),
    b: other.name,
    familyB: familyLabel(other.family, lang),
  });
}

export interface DupItem {
  id: string;
  name: string;
  unit: string | null;
  archived?: boolean;
}

export interface DuplicateSet {
  /** Sorted ids, joined: the identity of a suggestion. */
  key: string;
  ids: string[];
  score: number;
  source: "name" | "ai";
}

export const setKeyOf = (ids: readonly string[]) => [...ids].sort().join(",");
export const pairKey = (a: string, b: string) =>
  a < b ? `${a},${b}` : `${b},${a}`;

const MAX_SET = 6;

/**
 * Sets of 2+ ingredients that look like the same thing. Archived ones are
 * ignored; a pair a person rejected ("No son iguales") never links; two
 * ingredients of different unit families never link.
 */
export function findDuplicateSets(
  items: readonly DupItem[],
  notDuplicates: ReadonlySet<string> = new Set()
): DuplicateSet[] {
  const live = items.filter((i) => !i.archived);
  // Worked out once per ingredient, not once per pair.
  const prep = live.map((i) => {
    const key = ingredientKey(i.name);
    return { key, numbers: numbersOf(key), family: unitFamily(i.unit) };
  });
  const parent = live.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const scores = new Map<string, number>();
  for (let i = 0; i < live.length; i++) {
    const a = prep[i];
    if (!a.key) continue;
    for (let j = i + 1; j < live.length; j++) {
      const b = prep[j];
      if (!b.key || a.numbers !== b.numbers) continue;
      // Edit distance is at least the difference in length: skip the far ones cheaply.
      if (Math.abs(a.key.length - b.key.length) > 2) continue;
      if (!sameFamily(a.family, b.family)) continue;
      if (notDuplicates.has(pairKey(live[i].id, live[j].id))) continue;
      const d = distance(a.key, b.key);
      const len = Math.max(a.key.length, b.key.length);
      if (d > 2 || (d > 0 && len < 8)) continue;
      scores.set(
        pairKey(live[i].id, live[j].id),
        d === 0 ? 1 : Math.round((1 - d / len) * 1000) / 1000
      );
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  live.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const out: DuplicateSet[] = [];
  for (const members of groups.values()) {
    if (members.length < 2 || members.length > MAX_SET) continue;
    const ids = members.map((i) => live[i].id);
    // A chain can link two names that are not close to each other; the set's
    // score is its WEAKEST pair, so such a set ranks last.
    let weakest = 1;
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        const s = scores.get(pairKey(ids[a], ids[b]));
        weakest = Math.min(weakest, s ?? 0.5);
      }
    out.push({ key: setKeyOf(ids), ids, score: weakest, source: "name" });
  }
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface StoredSuggestion {
  id: string;
  ids: string[];
  key: string;
  source: "name" | "ai";
  score: number | null;
  status: "pending" | "skipped" | "accepted" | "rejected";
  skippedAt: string | null;
}

export interface QueueEntry extends DuplicateSet {
  /** The stored row, when there is one (a detected set is stored on its first decision). */
  storedId: string | null;
  skipped: boolean;
  skippedAt: string | null;
}

/**
 * Everything pending, then what was skipped ("Ahora no": the end of the
 * queue, still pending). A set whose members are gone or archived, or that
 * holds a rejected pair, or that was accepted or rejected, is not shown.
 */
export function buildQueue(input: {
  detected: readonly DuplicateSet[];
  stored: readonly StoredSuggestion[];
  items: readonly DupItem[];
  notDuplicates: ReadonlySet<string>;
}): QueueEntry[] {
  const live = new Set(input.items.filter((i) => !i.archived).map((i) => i.id));
  const decided = new Set(
    input.stored
      .filter((s) => s.status === "accepted" || s.status === "rejected")
      .map((s) => s.key)
  );
  const byKey = new Map<string, QueueEntry>();
  const ok = (ids: readonly string[]) =>
    ids.length >= 2 &&
    ids.every((id) => live.has(id)) &&
    !ids.some((a) =>
      ids.some((b) => a < b && input.notDuplicates.has(pairKey(a, b)))
    );
  for (const d of input.detected) {
    if (decided.has(d.key) || !ok(d.ids)) continue;
    byKey.set(d.key, { ...d, storedId: null, skipped: false, skippedAt: null });
  }
  for (const s of input.stored) {
    if (s.status !== "pending" && s.status !== "skipped") continue;
    if (!ok(s.ids)) continue;
    const base = byKey.get(s.key);
    byKey.set(s.key, {
      key: s.key,
      ids: s.ids,
      score: base?.score ?? s.score ?? 0.8,
      source: base?.source ?? s.source,
      storedId: s.id,
      skipped: s.status === "skipped",
      skippedAt: s.skippedAt,
    });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
    if (a.skipped && b.skipped)
      return (a.skippedAt ?? "").localeCompare(b.skippedAt ?? "");
    return b.score - a.score || a.key.localeCompare(b.key);
  });
}

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

export interface MergeCandidate {
  id: string;
  name: string;
  /** The latest price (per `priceUnit`); null = Sin precio. */
  price: number | null;
  priceUnit: string | null;
  /** Where it came from and when: only a SOURCED price makes it the survivor. */
  priceDate: string | null;
  priceSourced: boolean;
  priceEntryId: string | null;
  recipeCount: number;
  lineCount: number;
}

/**
 * The ingredient that stays: the one with a sourced price and the most recent
 * effective date; then the one more recipes use; then the name. A person can
 * pick another card.
 */
export function chooseSurvivor(candidates: readonly MergeCandidate[]): string {
  const ranked = [...candidates].sort((a, b) => {
    const as = a.priceSourced && a.price !== null ? 1 : 0;
    const bs = b.priceSourced && b.price !== null ? 1 : 0;
    if (as !== bs) return bs - as;
    const ad = a.priceDate ?? "";
    const bd = b.priceDate ?? "";
    if (ad !== bd) return bd.localeCompare(ad);
    if (a.recipeCount !== b.recipeCount) return b.recipeCount - a.recipeCount;
    return a.name.localeCompare(b.name, "es");
  });
  return ranked[0].id;
}

export interface MergePlan {
  survivorId: string;
  loserIds: string[];
  /** Recipe lines (active versions) that will point at the survivor. */
  linesReassigned: number;
  /** Prices to choose from when they differ: never averaged, never picked silently. */
  priceOptions: Array<{
    entryId: string;
    price: number;
    unit: string | null;
    from: string;
  }>;
  priceConflict: boolean;
  /** The entry that applies unless the person picks another: the survivor's own latest. */
  defaultEntryId: string | null;
}

export function planMerge(
  candidates: readonly MergeCandidate[],
  survivorId: string
): MergePlan {
  const survivor = candidates.find((c) => c.id === survivorId)!;
  const losers = candidates.filter((c) => c.id !== survivorId);
  const priced = candidates.filter(
    (c) => c.price !== null && c.priceEntryId !== null
  );
  const distinct = new Set(
    priced.map((c) => `${c.price}|${c.priceUnit ?? ""}`)
  );
  // The survivor's own price first, then the others, newest first.
  const options = [
    ...priced.filter((c) => c.id === survivorId),
    ...priced
      .filter((c) => c.id !== survivorId)
      .sort((a, b) => (b.priceDate ?? "").localeCompare(a.priceDate ?? "")),
  ].map((c) => ({
    entryId: c.priceEntryId!,
    price: c.price!,
    unit: c.priceUnit,
    from: c.name,
  }));
  return {
    survivorId,
    loserIds: losers.map((l) => l.id),
    linesReassigned: losers.reduce((s, l) => s + l.lineCount, 0),
    priceOptions: options,
    priceConflict: distinct.size > 1,
    defaultEntryId: survivor.priceEntryId ?? options[0]?.entryId ?? null,
  };
}

// ---------------------------------------------------------------------------
// The AI step: the same checks as the heuristics
// ---------------------------------------------------------------------------

export function validateAiSets(
  raw: unknown,
  sent: readonly DupItem[],
  notDuplicates: ReadonlySet<string> = new Set()
): DuplicateSet[] {
  const byId = new Map(sent.map((i) => [i.id, i]));
  const list = Array.isArray((raw as { sets?: unknown })?.sets)
    ? ((raw as { sets: unknown[] }).sets as unknown[])
    : [];
  const used = new Set<string>();
  const out: DuplicateSet[] = [];
  for (const entry of list) {
    const ids = [
      ...new Set(
        (Array.isArray((entry as { ids?: unknown })?.ids)
          ? ((entry as { ids: unknown[] }).ids as unknown[])
          : []
        ).filter((x): x is string => typeof x === "string")
      ),
    ].filter((id) => byId.has(id) && !used.has(id));
    if (ids.length < 2 || ids.length > MAX_SET) continue;
    const items = ids.map((id) => byId.get(id)!);
    const families = new Set(
      items.map((i) => unitFamily(i.unit)).filter((f) => f !== "unknown")
    );
    if (families.size > 1) continue;
    if (
      ids.some((a) =>
        ids.some((b) => a < b && notDuplicates.has(pairKey(a, b)))
      )
    )
      continue;
    for (const id of ids) used.add(id);
    out.push({ key: setKeyOf(ids), ids, score: 0.7, source: "ai" });
  }
  return out;
}

export function aiDuplicatePrompt(items: readonly DupItem[]): {
  system: string;
  user: string;
} {
  return {
    system:
      "Eres Milton. Encuentras ingredientes de cocina que son el MISMO producto escrito distinto " +
      "(erratas, abreviaturas, plural/singular, orden de palabras). No juntes variantes reales " +
      "(p. ej. pollo pechuga y pollo muslo, o tamaños distintos). " +
      'Responde SOLO JSON: {"sets":[{"ids":["id",...]}]}. Usa solo los ids recibidos, grupos de 2 a 6, ' +
      "cada id en un solo grupo. Si dudas, déjalo fuera.",
    user: JSON.stringify(
      items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))
    ),
  };
}
