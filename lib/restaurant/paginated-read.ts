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
  /** HTTP pages issued (including empty trailing pages in a parallel wave). */
  pages: number;
  /** Wall time for the whole walk. */
  elapsedMs: number;
}

/**
 * Pages fetched at once after we know the first page is full.
 * Staging July data is ~8–20 pages; 8 concurrent PostgREST calls turns
 * ~20 sequential round trips into 2–3 waves.
 */
export const PARALLEL_PAGE_CONCURRENCY = 8;

/**
 * Rows from a succeeded read. On error this is always `[]` — never a
 * prefix of pages that happened to complete before the failure.
 */
export function succeededRows<T>(result: FetchAllRowsResult<T>): T[] {
  return result.error ? [] : result.rows;
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
 *
 * Pages after the first run in waves of PARALLEL_PAGE_CONCURRENCY so a
 * 20k-row month is a handful of round trips, not 20 sequential ones.
 * Any page error still fail-closes (empty rows + error).
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
  const started = Date.now();

  const empty = (
    error: { message?: string } | null,
    pages: number
  ): FetchAllRowsResult<T> => ({
    rows: [],
    truncated: false,
    error,
    pages,
    elapsedMs: Date.now() - started,
  });

  const firstTo = Math.min(pageSize - 1, safetyCap - 1);
  const firstExpected = firstTo + 1;
  const first = await makeQuery()
    .order(orderBy, { ascending: true })
    .range(0, firstTo);
  if (first.error) {
    return empty(first.error, 1);
  }
  const firstPage = (first.data ?? []) as T[];
  if (firstPage.length < firstExpected) {
    return {
      rows: firstPage,
      truncated: false,
      error: null,
      pages: 1,
      elapsedMs: Date.now() - started,
    };
  }

  const rows: T[] = [...firstPage];
  let from = pageSize;
  let pages = 1;

  while (from < safetyCap) {
    const batchStarts: number[] = [];
    for (
      let i = 0;
      i < PARALLEL_PAGE_CONCURRENCY && from + i * pageSize < safetyCap;
      i++
    ) {
      batchStarts.push(from + i * pageSize);
    }
    const results = await Promise.all(
      batchStarts.map(async (start) => {
        const to = Math.min(start + pageSize - 1, safetyCap - 1);
        const expected = to - start + 1;
        const { data, error } = await makeQuery()
          .order(orderBy, { ascending: true })
          .range(start, to);
        return { start, expected, data, error };
      })
    );
    pages += results.length;
    results.sort((a, b) => a.start - b.start);
    for (const result of results) {
      if (result.error) {
        return empty(result.error, pages);
      }
    }
    let short = false;
    for (const result of results) {
      const page = (result.data ?? []) as T[];
      rows.push(...page);
      if (page.length < result.expected) {
        short = true;
        break;
      }
    }
    if (short) {
      return {
        rows,
        truncated: false,
        error: null,
        pages,
        elapsedMs: Date.now() - started,
      };
    }
    from += batchStarts.length * pageSize;
  }

  return {
    rows,
    truncated: true,
    error: null,
    pages,
    elapsedMs: Date.now() - started,
  };
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
