import { nameKey } from "@/lib/restaurant/cost-import";
import { normalizeMatchName } from "./names";
import type { CostTabType } from "./types";

const PREFIX_RE = /^(costos?|precios?|lista\s+de\s+precios?|lista)\s+/i;

export function cleanTabCategoryName(tabName: string): string {
  return tabName.replace(PREFIX_RE, "").replace(/\s+/g, " ").trim();
}

export function resolveCategoryName(
  tabName: string,
  existingCategories: string[]
): string {
  const cleaned = cleanTabCategoryName(tabName);
  if (!cleaned) return tabName.trim();
  const hit = existingCategories.find((category) => {
    if (!category) return false;
    return (
      nameKey(category) === nameKey(cleaned) ||
      normalizeMatchName(category) === normalizeMatchName(cleaned)
    );
  });
  return hit ?? cleaned;
}

export function categoryForTab(
  tabType: CostTabType,
  tabName: string,
  existingCategories: string[]
): string | null {
  if (tabType !== "category_cost") return null;
  const resolved = resolveCategoryName(tabName, existingCategories);
  return resolved || null;
}
