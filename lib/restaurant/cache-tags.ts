// lib/restaurant/cache-tags.ts
//
// Cross-request caching of the heavy per-company reads (Next's unstable_cache),
// and the tags that expire it. Until now only React `cache()` (one request) was
// used, so every navigation recomputed everything.
//
// SAFETY
//   * The key ALWAYS starts with the company id: an entry is never shared across
//     companies (`companyCacheKey`).
//   * The company id is already authorized by the caller (auth → company); the
//     cached function runs with an RLS-bound client built from the caller's
//     access token (lib/restaurant/cache-client.ts) — no cookies are read inside
//     a cache scope, and RLS still applies.
//   * Only successful, JSON-safe results are cached; a failure is never cached
//     and falls back to the uncached read.
//   * Anything that changes the data expires the tag: `revalidateSales` after a
//     POS sync / upload, a shift, a goal or a restaurant change.
//     (`revalidateCosting` / `costingTag` are ready for the costing loaders; see
//     the PR: they are not cached yet because their results hold Maps and
//     functions that unstable_cache cannot store.)

import { revalidateTag, unstable_cache } from "next/cache";

/** Tag for everything computed from a company's POS sales. */
export function salesTag(companyId: string): string {
  return `company:${companyId}:sales`;
}

/** Tag for everything computed from a company's recipes, prices and links. */
export function costingTag(companyId: string): string {
  return `company:${companyId}:costing`;
}

export const CACHE_REVALIDATE_SECONDS = 300;

/**
 * The key parts of a cached read: the cache name, then the company, then every
 * given part as `name=value` (sorted, so call order never changes the key; a
 * missing value is `name=-`).
 */
export function companyCacheKey(
  name: string,
  companyId: string,
  parts: Record<string, string | number | null | undefined> = {}
): string[] {
  if (!companyId) throw new Error("A cached read needs a company id.");
  return [
    "milton",
    name,
    companyId,
    ...Object.keys(parts)
      .sort()
      .map((k) => `${k}=${parts[k] ?? "-"}`),
  ];
}

export interface CachedForCompany {
  name: string;
  companyId: string;
  parts?: Record<string, string | number | null | undefined>;
  tags: readonly string[];
  revalidate?: number;
}

/**
 * Run `fn` through the cross-request cache. `fn` must return JSON-safe data and
 * THROW on a failure (a failure is never cached). Any cache problem (outside a
 * Next request, a serialization error…) falls back to calling `fn` directly.
 */
export async function cachedForCompany<T>(
  opts: CachedForCompany,
  fn: () => Promise<T>,
  /** What runs when the cache path fails (default: `fn` again). */
  fallback: () => Promise<T> = fn
): Promise<T> {
  let cached: () => Promise<T>;
  try {
    cached = unstable_cache(
      fn,
      companyCacheKey(opts.name, opts.companyId, opts.parts),
      {
        tags: [...opts.tags],
        revalidate: opts.revalidate ?? CACHE_REVALIDATE_SECONDS,
      }
    );
  } catch {
    return fallback();
  }
  try {
    return await cached();
  } catch {
    // The cache layer or the read failed: one uncached attempt.
    return fallback();
  }
}

function expire(tag: string): void {
  try {
    // { expire: 0 }: the entry is gone now (the next read recomputes), not
    // served stale while it refreshes.
    revalidateTag(tag, { expire: 0 });
  } catch {
    // Outside a Next request (a script, a test): nothing cached to expire.
  }
}

export function revalidateSales(companyId: string | null | undefined): void {
  if (companyId) expire(salesTag(companyId));
}

export function revalidateCosting(companyId: string | null | undefined): void {
  if (companyId) expire(costingTag(companyId));
}
