import { nameKey } from "@/lib/restaurant/cost-import";

export const AUTO_NAME_SCORE = 0.85;
export const REVIEW_NAME_SCORE = 0.55;

export function normalizeMatchName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeMatchName(value)
      .split(" ")
      .filter((token) => token.length > 1)
  );
}

export function nameMatchScore(a: string, b: string): number {
  const left = normalizeMatchName(a);
  const right = normalizeMatchName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (nameKey(a) === nameKey(b)) return 1;

  if (left.includes(right) || right.includes(left)) {
    const ratio =
      Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return Math.min(0.98, 0.72 + ratio * 0.26);
  }

  const leftTokens = tokens(a);
  const rightTokens = tokens(b);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let inter = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) inter += 1;
  }
  const union = leftTokens.size + rightTokens.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface NameMatch<T> {
  item: T;
  score: number;
}

export function bestNameMatch<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string
): NameMatch<T> | null {
  let best: NameMatch<T> | null = null;
  let second = 0;
  for (const item of items) {
    const score = nameMatchScore(query, nameOf(item));
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { item, score };
    } else if (score > second) {
      second = score;
    }
  }
  if (!best || best.score <= 0) return null;
  // Two close candidates → not confident enough to auto-link.
  if (second > 0 && best.score - second < 0.08 && best.score < 0.97) {
    return { item: best.item, score: Math.min(best.score, REVIEW_NAME_SCORE) };
  }
  return best;
}

export function recipeNameFromSheet(sheetName: string): string {
  const cleaned = sheetName
    .replace(
      /^(sub[\s_-]*recetas?|sub[\s_-]*recipes?|recetas?|recipes?)[:\s-]*/i,
      ""
    )
    .trim();
  return cleaned || sheetName.trim();
}
