import { nameKey } from "@/lib/restaurant/cost-import";
import { isObviousTypo } from "./duplicates";
import { normalizeMatchName } from "./names";
import type { GroupedRecipe } from "./types";

export function matchesPreparedName(
  name: string,
  preparedNames: string[]
): string | null {
  const exact = preparedNames.find(
    (item) =>
      nameKey(item) === nameKey(name) ||
      normalizeMatchName(item) === normalizeMatchName(name)
  );
  if (exact) return exact;
  const typo = preparedNames.find((item) => isObviousTypo(item, name));
  return typo ?? null;
}

export function preparedNamesFromGroups(groups: GroupedRecipe[]): string[] {
  return [...new Set(groups.map((group) => group.name))];
}
