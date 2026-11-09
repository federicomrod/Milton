// A tiny in-memory Supabase for server tests: tables of rows, a chainable
// query builder (select / insert / update / delete, eq / in / is / order /
// limit, single / maybeSingle) and a log of every write per table.
type Row = Record<string, unknown>;

export function fakeSupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed))
    tables[k] = v.map((r) => ({ ...r }));
  const writes: Array<{
    table: string;
    op: "insert" | "update" | "delete";
    row?: Row;
  }> = [];
  let n = 0;

  function from(table: string) {
    tables[table] ??= [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    const filters: Array<(r: Row) => boolean> = [];
    let orderKey: string | null = null;
    let desc = false;
    let max = Infinity;
    const api: Record<string, unknown> = {};
    const chain = () => api;
    api.select = chain;
    api.insert = (p: Row | Row[]) => {
      op = "insert";
      payload = p;
      return api;
    };
    api.update = (p: Row) => {
      op = "update";
      payload = p;
      return api;
    };
    api.delete = () => {
      op = "delete";
      return api;
    };
    api.eq = (k: string, v: unknown) => {
      filters.push((r) => r[k] === v);
      return api;
    };
    api.in = (k: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[k]));
      return api;
    };
    api.is = (k: string, v: unknown) => {
      filters.push((r) => (r[k] ?? null) === v);
      return api;
    };
    api.order = (k: string, o?: { ascending?: boolean }) => {
      orderKey = k;
      desc = o?.ascending === false;
      return api;
    };
    api.limit = (m: number) => {
      max = m;
      return api;
    };
    function run(): { data: Row[]; error: null } {
      const match = tables[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const rows = (Array.isArray(payload) ? payload : [payload as Row]).map(
          (r) => ({
            id: `${table}-${++n}`,
            created_at: new Date().toISOString(),
            ...r,
          })
        );
        for (const r of rows) {
          tables[table].push(r);
          writes.push({ table, op: "insert", row: r });
        }
        return { data: rows, error: null };
      }
      if (op === "update") {
        for (const r of match) {
          Object.assign(r, payload);
          writes.push({ table, op: "update", row: { ...r } });
        }
        return { data: match, error: null };
      }
      if (op === "delete") {
        tables[table] = tables[table].filter((r) => !match.includes(r));
        writes.push({ table, op: "delete" });
        return { data: match, error: null };
      }
      const out = [...match];
      if (orderKey) {
        const k = orderKey;
        out.sort(
          (a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (desc ? -1 : 1)
        );
      }
      return { data: out.slice(0, max), error: null };
    }
    api.single = async () => {
      const { data } = run();
      return {
        data: data[0] ?? null,
        error: data[0] ? null : { message: "none" },
      };
    };
    api.maybeSingle = async () => ({
      data: run().data[0] ?? null,
      error: null,
    });
    api.then = (resolve: (v: unknown) => unknown) => resolve(run());
    return api;
  }
  return { client: { from } as never, tables, writes };
}
