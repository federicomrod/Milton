// lib/restaurant/add-restaurant-server.ts
//
// Pure idempotency core for POST /api/restaurant/add-restaurant. Split out
// of the route so it's directly unit-testable (route.ts files may only
// export HTTP method handlers + Next.js route config, not arbitrary
// helpers).
//
// There is no idempotency-key column (adding one needs a migration, out of
// scope for Multi-Restaurant UX v1), so a retried/duplicate submission is
// detected the same way the rest of this codebase does it — by looking the
// row up first. A case-insensitive, trimmed match against the company's
// EXISTING restaurant_brands.name is treated as "this is a retry of an
// earlier submission".

export interface ExistingBrandRow {
  id: string;
  name: string | null;
}

/**
 * Returns the existing brand whose (trimmed, case-insensitive) name
 * matches `name`, or null if this would be a genuinely new restaurant.
 */
export function findMatchingBrandByName(
  brands: ExistingBrandRow[],
  name: string
): ExistingBrandRow | null {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  return (
    brands.find((b) => (b.name ?? "").trim().toLowerCase() === target) ?? null
  );
}
