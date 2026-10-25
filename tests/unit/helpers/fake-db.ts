// A tiny in-memory stand-in for the Supabase client (eq / in / is / gte /
// order / limit, select / insert / update / delete, single / maybeSingle).
// Enough for routes that only use those. Synthetic data only.

export type Row = Record<string, unknown>;
export type FakeStore = Record<string, Row[]>;

type Op =
  | {
      type: "eq" | "neq" | "is" | "gte" | "gt" | "lt" | "in";
      col: string;
      val: unknown;
    }
  | { type: "or"; expr: string }
  | { type: "not"; col: string; op: string; val: unknown }
  | { type: "contains"; col: string; val: unknown[] }
  | { type: "ilike"; col: string; val: string };

/** A PostgREST filter list: "a.eq.1,and(b.is.null,c.lt.2)" (comma = OR). */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function matchesFilter(row: Row, filter: string): boolean {
  const and = filter.match(/^and\((.*)\)$/);
  if (and) return splitTop(and[1]).every((f) => matchesFilter(row, f));
  const [col, op, ...rest] = filter.split(".");
  const val = rest.join(".");
  const cell = row[col];
  if (op === "eq") return String(cell) === val;
  if (op === "is") return val === "null" ? cell == null : String(cell) === val;
  if (op === "in")
    return val
      .replace(/^\(|\)$/g, "")
      .split(",")
      .includes(String(cell));
  if (op === "lt") return cell != null && String(cell) < val;
  if (op === "gte") return cell != null && String(cell) >= val;
  return false;
}

/** Plain column, or a PostgREST json path like "metadata->>key". */
function cellOf(row: Row, col: string): unknown {
  const at = col.indexOf("->>");
  if (at < 0) return row[col];
  const json = row[col.slice(0, at)];
  if (json && typeof json === "object") {
    const v = (json as Row)[col.slice(at + 3)];
    return v == null ? null : String(v);
  }
  return null;
}

function matches(row: Row, ops: Op[]) {
  return ops.every((op) => {
    if (op.type === "ilike") {
      const pattern = op.val
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`, "i").test(String(row[op.col] ?? ""));
    }
    if (op.type === "contains") {
      const cell = row[op.col];
      return Array.isArray(cell) && op.val.every((v) => cell.includes(v));
    }
    if (op.type === "not") {
      if (op.op === "is") return (row[op.col] ?? null) !== op.val;
      return row[op.col] !== op.val;
    }
    if (op.type === "or") {
      return splitTop(op.expr).some((f) => matchesFilter(row, f));
    }
    if (op.type === "lt") {
      return row[op.col] != null && String(row[op.col]) < String(op.val);
    }
    if (op.type === "eq") return cellOf(row, op.col) === op.val;
    if (op.type === "neq") return cellOf(row, op.col) !== op.val;
    if (op.type === "is") return (row[op.col] ?? null) === op.val;
    if (op.type === "gte") return String(row[op.col] ?? "") >= String(op.val);
    if (op.type === "gt") {
      return row[op.col] != null && String(row[op.col]) > String(op.val);
    }
    return (op.val as unknown[]).includes(row[op.col]);
  });
}

export interface FakeDbOptions {
  /**
   * Make a call fail: return true to answer with a database error, or an
   * error object (for example `{ code: "42P01", message }` for a missing table).
   */
  fail?: (
    table: string,
    mode: "select" | "insert" | "update" | "delete",
    payload: unknown
  ) => boolean | { code?: string; message: string };
}

export function makeFakeDb(store: FakeStore, options: FakeDbOptions = {}) {
  let generated = 1;
  function from(table: string) {
    const ops: Op[] = [];
    let mode: "select" | "update" | "insert" | "delete" | "upsert" = "select";
    let conflictCols: string[] = [];
    let payload: unknown = null;
    let orderCol: string | null = null;
    let orderDesc = false;
    let cap: number | null = null;
    let offset = 0;
    const rows = () => (store[table] ??= []);
    const run = () => {
      const failure = options.fail?.(
        table,
        mode === "upsert" ? "insert" : mode,
        payload
      );
      if (failure) {
        return {
          data: null as unknown as Row[],
          error:
            typeof failure === "object"
              ? failure
              : { message: "forced failure" },
        };
      }
      if (mode === "update") {
        const hit = rows().filter((r) => matches(r, ops));
        for (const r of hit) Object.assign(r, payload as Row);
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (mode === "upsert") {
        const incoming = (
          Array.isArray(payload) ? payload : [payload]
        ) as Row[];
        const out = incoming.map((r) => {
          const hit = rows().find((row) =>
            conflictCols.every((c) => row[c] === r[c])
          );
          if (hit) {
            Object.assign(hit, r);
            return { ...hit };
          }
          const row = { ...r, id: r.id ?? `gen-${generated++}` };
          rows().push(row);
          return { ...row };
        });
        return { data: out, error: null };
      }
      if (mode === "insert") {
        const incoming = (
          Array.isArray(payload) ? payload : [payload]
        ) as Row[];
        const out = incoming.map((r) => {
          const row = { ...r, id: r.id ?? `gen-${generated++}` };
          rows().push(row);
          return { ...row };
        });
        return { data: out, error: null };
      }
      if (mode === "delete") {
        const hit = rows().filter((r) => matches(r, ops));
        const ids = new Set(hit.map((r) => r.id));
        store[table] = rows().filter((r) => !ids.has(r.id));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      let data = rows()
        .filter((r) => matches(r, ops))
        .map((r) => ({ ...r }));
      if (orderCol) {
        const col = orderCol;
        data.sort((a, b) =>
          typeof a[col] === "string"
            ? String(a[col]).localeCompare(String(b[col]))
            : Number(a[col] ?? 0) - Number(b[col] ?? 0)
        );
      }
      if (orderCol && orderDesc) data.reverse();
      data = data.slice(offset, cap === null ? undefined : offset + cap);
      return { data, error: null };
    };
    const self: Record<string, unknown> = {
      select: () => self,
      eq: (col: string, val: unknown) => (
        ops.push({ type: "eq", col, val }),
        self
      ),
      neq: (col: string, val: unknown) => (
        ops.push({ type: "neq", col, val }),
        self
      ),
      is: (col: string, val: unknown) => (
        ops.push({ type: "is", col, val }),
        self
      ),
      gte: (col: string, val: unknown) => (
        ops.push({ type: "gte", col, val }),
        self
      ),
      gt: (col: string, val: unknown) => (
        ops.push({ type: "gt", col, val }),
        self
      ),
      lt: (col: string, val: unknown) => (
        ops.push({ type: "lt", col, val }),
        self
      ),
      ilike: (col: string, val: string) => (
        ops.push({ type: "ilike", col, val }),
        self
      ),
      contains: (col: string, val: unknown[]) => (
        ops.push({ type: "contains", col, val }),
        self
      ),
      not: (col: string, op: string, val: unknown) => (
        ops.push({ type: "not", col, op, val }),
        self
      ),
      or: (expr: string) => (ops.push({ type: "or", expr }), self),
      in: (col: string, val: unknown[]) => (
        ops.push({ type: "in", col, val }),
        self
      ),
      order: (col: string, opts?: { ascending?: boolean }) => (
        (orderCol = col),
        (orderDesc = opts?.ascending === false),
        self
      ),
      limit: (n: number) => ((cap = n), self),
      range: (from: number, to: number) => (
        (offset = from),
        (cap = to - from + 1),
        self
      ),
      update: (data: Row) => ((mode = "update"), (payload = data), self),
      insert: (data: Row | Row[]) => (
        (mode = "insert"),
        (payload = data),
        self
      ),
      delete: () => ((mode = "delete"), self),
      upsert: (data: Row | Row[], opts?: { onConflict?: string }) => (
        (mode = "upsert"),
        (payload = data),
        (conflictCols = (opts?.onConflict ?? "id").split(",")),
        self
      ),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown
      ) => Promise.resolve(run()).then(resolve, reject),
    };
    return self;
  }
  return { from };
}
