/**
 * Mock Supabase client that mimics PostgREST `max_rows`:
 * every awaited select returns at most `maxRowsPerRequest` rows
 * (hosted default / supabase/config.toml = 1000).
 *
 * `.range(from, to)` pages past the cap; `.limit(N)` without `.range()`
 * still silently truncates to maxRowsPerRequest — the original cockpit bug.
 */

export type MockRow = Record<string, unknown>;

export interface PageErrorSpec {
  table: string;
  /** Matches the `.range(from, _)` start offset (0 for the first page). */
  from: number;
  message?: string;
}

export interface CappedSupabaseOptions {
  tables: Record<string, MockRow[]>;
  maxRowsPerRequest?: number;
  userId?: string | null;
  /** Simulated PostgREST/network failure for a specific page. */
  pageErrors?: PageErrorSpec[];
  /** Columns that do not exist on a table — select including them errors. */
  unknownColumns?: Record<string, string[]>;
  /** Artificial per-page delay so tests can measure sequential vs parallel. */
  delayMs?: number;
}

export function createCappedSupabase(opts: CappedSupabaseOptions) {
  const maxRows = opts.maxRowsPerRequest ?? 1000;
  const userId = opts.userId === undefined ? "user-1" : opts.userId;
  const pageErrors = opts.pageErrors ?? [];
  const unknownColumns = opts.unknownColumns ?? {};

  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from(table: string) {
      return new CappedQuery(
        [...(opts.tables[table] ?? [])],
        maxRows,
        table,
        pageErrors,
        unknownColumns[table] ?? [],
        opts.delayMs ?? 0
      );
    },
  };
}

class CappedQuery {
  private fromIdx = 0;
  private toIdx = Number.POSITIVE_INFINITY;
  private limitN = Number.POSITIVE_INFINITY;
  private head = false;
  private orders: { col: string; asc: boolean }[] = [];
  private selected = "";

  constructor(
    private rows: MockRow[],
    private maxRows: number,
    private table: string,
    private pageErrors: PageErrorSpec[],
    private unknownCols: string[] = [],
    private delayMs = 0
  ) {}

  select(cols?: unknown, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.head = true;
    if (typeof cols === "string") this.selected = cols;
    return this;
  }

  eq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }

  in(col: string, vals: unknown[]) {
    const set = new Set(vals);
    this.rows = this.rows.filter((r) => set.has(r[col]));
    return this;
  }

  is(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => r[col] == val);
    return this;
  }

  not(col: string, op: string, val: unknown) {
    if (op === "is" && val === null) {
      this.rows = this.rows.filter((r) => r[col] != null);
    }
    return this;
  }

  order(col: string, options?: { ascending?: boolean }) {
    this.orders.push({ col, asc: options?.ascending !== false });
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number) {
    this.fromIdx = from;
    this.toIdx = to;
    return this;
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.applyOrder()[0] ?? null,
      error: null,
    });
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: MockRow[] | null;
          error: { message?: string } | null;
          count: number | null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private pageError(): { message: string } | null {
    const selected = this.selected.split(",").map((s) => s.trim());
    for (const col of this.unknownCols) {
      if (selected.includes(col)) {
        return {
          message: `column ${this.table}.${col} does not exist`,
        };
      }
    }
    const hit = this.pageErrors.find(
      (e) => e.table === this.table && e.from === this.fromIdx
    );
    return hit ? { message: hit.message ?? "page failed" } : null;
  }

  private applyOrder(): MockRow[] {
    if (this.orders.length === 0) return this.rows;
    return [...this.rows].sort((a, b) => {
      for (const o of this.orders) {
        const av = a[o.col];
        const bv = b[o.col];
        if (av === bv) continue;
        if (av == null) return o.asc ? -1 : 1;
        if (bv == null) return o.asc ? 1 : -1;
        if (av < (bv as typeof av)) return o.asc ? -1 : 1;
        if (av > (bv as typeof av)) return o.asc ? 1 : -1;
      }
      return 0;
    });
  }

  private async execute() {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    const fail = this.pageError();
    if (fail) {
      return { data: null, error: fail, count: null };
    }
    const ordered = this.applyOrder();
    if (this.head) {
      return { data: null, error: null, count: ordered.length };
    }
    const start = this.fromIdx;
    const endExclusive = Math.min(
      ordered.length,
      this.toIdx + 1,
      start + this.limitN
    );
    const window = ordered.slice(start, Math.max(start, endExclusive));
    return {
      data: window.slice(0, this.maxRows),
      error: null,
      count: ordered.length,
    };
  }
}
