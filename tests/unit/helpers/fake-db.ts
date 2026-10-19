// A tiny in-memory stand-in for the Supabase client (eq / in / is / gte /
// order / limit, select / insert / update / delete, single / maybeSingle).
// Enough for routes that only use those. Synthetic data only.

export type Row = Record<string, unknown>;
export type FakeStore = Record<string, Row[]>;

type Op =
  | { type: "eq" | "is" | "gte" | "lt" | "in"; col: string; val: unknown }
  | { type: "or"; expr: string };

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
  if (op === "lt") return cell != null && String(cell) < val;
  if (op === "gte") return cell != null && String(cell) >= val;
  return false;
}

function matches(row: Row, ops: Op[]) {
  return ops.every((op) => {
    if (op.type === "or") {
      return splitTop(op.expr).some((f) => matchesFilter(row, f));
    }
    if (op.type === "lt") {
      return row[op.col] != null && String(row[op.col]) < String(op.val);
    }
    if (op.type === "eq") return row[op.col] === op.val;
    if (op.type === "is") return (row[op.col] ?? null) === op.val;
    if (op.type === "gte") return String(row[op.col] ?? "") >= String(op.val);
    return (op.val as unknown[]).includes(row[op.col]);
  });
}

export interface FakeDbOptions {
  /** Make a write fail: return true to answer with a database error. */
  fail?: (
    table: string,
    mode: "insert" | "update" | "delete",
    payload: unknown
  ) => boolean;
}

export function makeFakeDb(store: FakeStore, options: FakeDbOptions = {}) {
  let generated = 1;
  function from(table: string) {
    const ops: Op[] = [];
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let payload: unknown = null;
    let orderCol: string | null = null;
    let cap: number | null = null;
    const rows = () => (store[table] ??= []);
    const run = () => {
      if (mode !== "select" && options.fail?.(table, mode, payload)) {
        return {
          data: null as unknown as Row[],
          error: { message: "forced failure" },
        };
      }
      if (mode === "update") {
        const hit = rows().filter((r) => matches(r, ops));
        for (const r of hit) Object.assign(r, payload as Row);
        return { data: hit.map((r) => ({ ...r })), error: null };
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
      if (cap !== null) data = data.slice(0, cap);
      return { data, error: null };
    };
    const self: Record<string, unknown> = {
      select: () => self,
      eq: (col: string, val: unknown) => (
        ops.push({ type: "eq", col, val }),
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
      lt: (col: string, val: unknown) => (
        ops.push({ type: "lt", col, val }),
        self
      ),
      or: (expr: string) => (ops.push({ type: "or", expr }), self),
      in: (col: string, val: unknown[]) => (
        ops.push({ type: "in", col, val }),
        self
      ),
      order: (col: string) => ((orderCol = col), self),
      limit: (n: number) => ((cap = n), self),
      update: (data: Row) => ((mode = "update"), (payload = data), self),
      insert: (data: Row | Row[]) => (
        (mode = "insert"),
        (payload = data),
        self
      ),
      delete: () => ((mode = "delete"), self),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        return { data: data[0] ?? null, error };
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
