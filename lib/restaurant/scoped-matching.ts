// lib/restaurant/scoped-matching.ts
//
// Shared "scoped name → id" resolution used everywhere Milton matches a
// free-text POS name to an internal row while a restaurant can have more
// than one brand/location. Two independent call sites need the exact same
// precedence rule:
//
//   1. an exact match within the known scope (brand for menu items at POS
//      ingest time; location for pos_item_mappings at profitability read
//      time)
//   2. a scope-less ("legacy"/company-wide) fallback match
//   3. unmatched
//
// Pure, no I/O — safe to unit test directly and share between
// pos-import.ts (Revel), lib/restaurant/odoo/sync.ts (Odoo), and
// profitability-server.ts (pos_item_mappings reads).

export interface ScopedNameIndex {
  /** scopeId -> normalizedName -> id, for rows that declared a scope. */
  byScope: Map<string, Map<string, string>>;
  /** normalizedName -> id, for rows with no scope (legacy/company-wide). */
  unscoped: Map<string, string>;
}

/**
 * Builds a ScopedNameIndex from rows that each have an id, a name to
 * normalize/index by, and an optional scope id (brand_id, location_id,
 * etc.). `normalize` should be the same normalization the caller will use
 * to look up names later (e.g. pos-import.ts's normalizeHeader).
 */
export function buildScopedNameIndex<
  T extends { id: string; name: string; scopeId: string | null },
>(rows: T[], normalize: (s: string) => string): ScopedNameIndex {
  const byScope = new Map<string, Map<string, string>>();
  const unscoped = new Map<string, string>();

  for (const row of rows) {
    if (!row?.name) continue;
    const key = normalize(row.name);
    if (row.scopeId) {
      let bucket = byScope.get(row.scopeId);
      if (!bucket) {
        bucket = new Map<string, string>();
        byScope.set(row.scopeId, bucket);
      }
      bucket.set(key, row.id);
    } else {
      unscoped.set(key, row.id);
    }
  }

  return { byScope, unscoped };
}

/**
 * Resolves a normalized name to an id, preferring an exact match within
 * `scopeId` (when known) and falling back to the unscoped/company-wide
 * bucket. Returns null — never guesses across scopes, and never falls
 * back into a DIFFERENT scope's bucket.
 */
export function resolveScopedName(
  index: ScopedNameIndex,
  scopeId: string | null,
  normalizedName: string
): string | null {
  if (scopeId) {
    const scoped = index.byScope.get(scopeId)?.get(normalizedName);
    if (scoped) return scoped;
  }
  return index.unscoped.get(normalizedName) ?? null;
}
