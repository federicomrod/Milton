// Plain-code typo matching. AI never decides a merge.

import { nameKey } from "@/lib/restaurant/cost-import";
import { normalizeMatchName } from "./names";

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
