// lib/restaurant/paginated-read.ts
//
// Shared PostgREST reader that walks `.range()` pages so we don't silently
// truncate at Supabase's `max_rows` cap (1000 locally and on hosted).
//
// Trap this helper exists to avoid: `.limit(10_000)` (or an unbounded
// select) still returns at most 1000 arbitrary rows. A caller that treats
// "fewer than 10_000" as "that's all of them" then shows partial totals.
// Pages here are therefore clamped to POSTGREST_MAX_ROWS, ordered by a
// unique column (`id` by default), and walked until a short page.
//
// SECURITY: Callers pass their own (RLS-bound) query factory. This module
// never constructs a Supabase client and never uses the service role.

/** Hosted / `supabase/config.toml` default: rows per HTTP response. */
export const POSTGREST_MAX_ROWS = 1000;

/**
 * Hard stop so a runaway table cannot OOM the cockpit.
 * A busy restaurant in this pilot is ~10k POS lines/month → ~120k/year;
 * 500k is well above a full pilot year.
 */
export const PAGINATED_READ_SAFETY_CAP = 500_000;

export interface FetchAllRowsOptions {
  /** Unique, stable sort column. Defaults to `id`. */
  orderBy?: string;
  /**
   * Rows requested per page. Clamped to POSTGREST_MAX_ROWS — requesting
   * more than the server will return would look like a short final page
   * and stop the loop early (the original 10k-limit bug).
   */
  pageSize?: number;
  safetyCap?: number;
}

export interface FetchAllRowsResult<T> {
  rows: T[];
  /** True when `safetyCap` was reached and more rows may exist. */
  truncated: boolean;
  error: { message?: string } | null;
}

/**
 * Minimal surface we call on a PostgREST filter builder after the caller
 * has applied `.from().select().eq()` (etc.). Row shape is `unknown` here
 * because supabase-js infers select-column objects that are not assignable
 * to our DTOs (missing unselected fields). Callers pass `T` on fetchAllRows.
 */
export interface OrderableQuery {
  order: (
    column: string,
    options?: { ascending?: boolean }
  ) => {
    range: (
      from: number,
      to: number
    ) => PromiseLike<{
      data: unknown[] | null;
      error: { message?: string } | null;
    }>;
  };
}

/**
 * Load every row matching `makeQuery()`, paging past the 1,000-row cap.
 * `makeQuery` must return a **fresh** builder each call — PostgREST
 * builders accumulate `.order()` / `.range()` if reused.
 */
export async function fetchAllRows<T>(
  makeQuery: () => OrderableQuery,
  options: FetchAllRowsOptions = {}
): Promise<FetchAllRowsResult<T>> {
  const orderBy = options.orderBy ?? "id";
  const pageSize = Math.min(
    Math.max(1, options.pageSize ?? POSTGREST_MAX_ROWS),
    POSTGREST_MAX_ROWS
  );
  const safetyCap = options.safetyCap ?? PAGINATED_READ_SAFETY_CAP;

  const rows: T[] = [];
  let from = 0;

  while (from < safetyCap) {
    const to = Math.min(from + pageSize - 1, safetyCap - 1);
    const expected = to - from + 1;
    const { data, error } = await makeQuery()
      .order(orderBy, { ascending: true })
      .range(from, to);
    if (error) {
      return { rows, truncated: false, error };
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < expected) {
      return { rows, truncated: false, error: null };
    }
    from += pageSize;
  }

  return { rows, truncated: true, error: null };
}

/** Log when a safety cap truncated a read so it never fails silently. */
export function warnIfTruncated(
  label: string,
  result: { truncated: boolean; rows: { length: number } }
): void {
  if (!result.truncated) return;
  console.warn(
    `[paginated-read] ${label} hit the ${PAGINATED_READ_SAFETY_CAP.toLocaleString("en-US")}-row safety cap; returning ${result.rows.length} rows (partial).`
  );
}
