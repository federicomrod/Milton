// lib/restaurant/missing-schema-column.ts
//
// Migration 027 (last_sync) and 030 (is_tip) are applied by hand on
// staging. A deploy that SELECTs / upserts a column that is not there
// yet must retry without it instead of failing the page or Sync now.
// Same idea as app/api/admin/odoo/connection/route.ts for last_sync.

import {
  fetchAllRows,
  type FetchAllRowsOptions,
  type FetchAllRowsResult,
  type OrderableQuery,
} from "@/lib/restaurant/paginated-read";

export type SchemaErrorLike = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
} | null;

/** True when a PostgREST / Postgres error names `column`. */
export function errorMentionsColumn(
  error: SchemaErrorLike | undefined,
  column: string
): boolean {
  if (!error) return false;
  const hay = [error.message, error.details, error.hint, error.code]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0
    )
    .join(" ")
    .toLowerCase();
  return hay.includes(column.toLowerCase());
}

export function dropColumnFromSelect(select: string, column: string): string {
  return select
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== column)
    .join(", ");
}

export function omitColumn<T extends object>(row: T, column: string): T {
  const next = { ...(row as T & Record<string, unknown>) };
  delete next[column];
  return next as T;
}

export function omitColumnFromRows<T extends object>(
  rows: T[],
  column: string
): T[] {
  return rows.map((row) => omitColumn(row, column));
}

/**
 * Page every row with `selectWithColumn`. If the error names `column`
 * (schema cache / "does not exist"), walk again without that column.
 */
export async function fetchAllRowsRetryingWithoutColumn<T>(
  column: string,
  makeQuery: (select: string) => OrderableQuery,
  selectWithColumn: string,
  options?: FetchAllRowsOptions
): Promise<FetchAllRowsResult<T>> {
  const first = await fetchAllRows<T>(
    () => makeQuery(selectWithColumn),
    options
  );
  if (!first.error || !errorMentionsColumn(first.error, column)) {
    return first;
  }
  return fetchAllRows<T>(
    () => makeQuery(dropColumnFromSelect(selectWithColumn, column)),
    options
  );
}

export async function fetchAllRowsRetryingWithoutColumns<T>(
  columns: readonly string[],
  makeQuery: (select: string) => OrderableQuery,
  selectWithColumns: string,
  options?: FetchAllRowsOptions
): Promise<FetchAllRowsResult<T>> {
  let select = selectWithColumns;
  let last = await fetchAllRows<T>(() => makeQuery(select), options);
  if (!last.error) return last;
  for (const column of columns) {
    if (!errorMentionsColumn(last.error, column)) continue;
    select = dropColumnFromSelect(select, column);
    last = await fetchAllRows<T>(() => makeQuery(select), options);
    if (!last.error) return last;
  }
  return last;
}

export async function upsertRetryingWithoutColumn<T extends object>(
  column: string,
  upsert: (rows: T[]) => Promise<{
    error: SchemaErrorLike;
    count?: number | null;
  }>,
  rows: T[]
): Promise<{ error: SchemaErrorLike; count: number; omittedColumn: boolean }> {
  const first = await upsert(rows);
  if (!first.error) {
    return {
      error: null,
      count: first.count ?? rows.length,
      omittedColumn: false,
    };
  }
  if (!errorMentionsColumn(first.error, column)) {
    return { error: first.error, count: 0, omittedColumn: false };
  }
  const stripped = omitColumnFromRows(rows, column);
  const second = await upsert(stripped);
  if (second.error) {
    return { error: second.error, count: 0, omittedColumn: true };
  }
  return {
    error: null,
    count: second.count ?? stripped.length,
    omittedColumn: true,
  };
}

/**
 * Same retry, for several hand-applied columns (is_tip, combo parent
 * fields). Omits each named column only when the error mentions it.
 */
export async function upsertRetryingWithoutColumns<T extends object>(
  columns: readonly string[],
  upsert: (rows: T[]) => Promise<{
    error: SchemaErrorLike;
    count?: number | null;
  }>,
  rows: T[]
): Promise<{
  error: SchemaErrorLike;
  count: number;
  omittedColumns: string[];
}> {
  let current = rows;
  const omittedColumns: string[] = [];
  let last = await upsert(current);
  if (!last.error) {
    return {
      error: null,
      count: last.count ?? current.length,
      omittedColumns,
    };
  }
  for (const column of columns) {
    if (!errorMentionsColumn(last.error, column)) continue;
    current = omitColumnFromRows(current, column);
    omittedColumns.push(column);
    last = await upsert(current);
    if (!last.error) {
      return {
        error: null,
        count: last.count ?? current.length,
        omittedColumns,
      };
    }
  }
  return { error: last.error, count: 0, omittedColumns };
}
