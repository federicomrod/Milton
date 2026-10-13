import { nameKey } from "@/lib/restaurant/cost-import";

/** Pick the restaurant-scoped menu item when the schema has location_id. */
export function pickMenuItemForLocation<
  T extends { name: string; location_id?: string | null },
>(items: T[], name: string, locationId?: string | null): T | undefined {
  const key = nameKey(name);
  const sameName = items.filter((row) => nameKey(row.name) === key);
  if (sameName.length === 0) return undefined;
  if (locationId) {
    return (
      sameName.find((row) => row.location_id === locationId) ??
      sameName.find((row) => row.location_id == null)
    );
  }
  return sameName.find((row) => row.location_id == null) ?? sameName[0];
}
