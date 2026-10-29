// A tiny in-memory stand-in for the Supabase client, enough for the kitchen
// app tests (mobile P0b). Queries run synchronously against plain arrays when
// awaited, so a conditional update («where used_at is null») is atomic, like in
// Postgres. Every insert/update/upsert payload is logged in `writes`, so a test
// can prove a raw token never reached the database.

import { randomUUID } from "crypto";

export type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

export interface FakeDb {
  tables: Record<string, Row[]>;
  writes: Array<{ table: string; op: string; payload: unknown }>;
  uploads: Array<{ path: string; bytes: number; contentType?: string }>;
  client: any;
}

/** Column sets that must be unique together (rows with a null part are exempt). */
const UNIQUE: Record<string, string[][]> = {
  kitchen_invites: [["secret_hash"]],
  kitchen_devices: [["token_hash"]],
  kitchen_reports: [["staff_id", "client_ref"]],
};

export function createFakeDb(initial: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: Object.fromEntries(
      Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))])
    ),
    writes: [],
    uploads: [],
    client: null,
  };
  const rowsOf = (t: string) => (db.tables[t] ??= []);

  class Query {
    private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    private filters: Filter[] = [];
    private payload: Row | Row[] | null = null;
    private orderBy: { col: string; asc: boolean } | null = null;
    private max: number | null = null;
    private returning = false;
    private mode: "many" | "single" | "maybe" = "many";

    constructor(private table: string) {}

    select(...args: unknown[]) {
      void args;
      this.returning = true;
      return this;
    }
    insert(p: Row | Row[]) {
      this.op = "insert";
      this.payload = p;
      return this;
    }
    update(p: Row) {
      this.op = "update";
      this.payload = p;
      return this;
    }
    upsert(p: Row | Row[]) {
      this.op = "upsert";
      this.payload = p;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(col: string, v: unknown) {
      this.filters.push((r) => r[col] === v);
      return this;
    }
    neq(col: string, v: unknown) {
      this.filters.push((r) => r[col] !== v);
      return this;
    }
    is(col: string, v: null | boolean) {
      this.filters.push((r) => (v === null ? r[col] == null : r[col] === v));
      return this;
    }
    in(col: string, vs: unknown[]) {
      this.filters.push((r) => vs.includes(r[col]));
      return this;
    }
    gt(col: string, v: any) {
      this.filters.push((r) => r[col] != null && r[col] > v);
      return this;
    }
    gte(col: string, v: any) {
      this.filters.push((r) => r[col] != null && r[col] >= v);
      return this;
    }
    lt(col: string, v: any) {
      this.filters.push((r) => r[col] != null && r[col] < v);
      return this;
    }
    lte(col: string, v: any) {
      this.filters.push((r) => r[col] != null && r[col] <= v);
      return this;
    }
    order(col: string, o?: { ascending?: boolean }) {
      this.orderBy = { col, asc: o?.ascending !== false };
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    maybeSingle() {
      this.mode = "maybe";
      return this.run();
    }
    single() {
      this.mode = "single";
      return this.run();
    }
    then(resolve: (v: any) => any, reject?: (e: any) => any) {
      return this.run().then(resolve, reject);
    }

    private matches(r: Row) {
      return this.filters.every((f) => f(r));
    }

    private violatesUnique(candidate: Row, ignore?: Row): boolean {
      for (const cols of UNIQUE[this.table] ?? []) {
        if (cols.some((c) => candidate[c] == null)) continue;
        const clash = rowsOf(this.table).some(
          (r) => r !== ignore && cols.every((c) => r[c] === candidate[c])
        );
        if (clash) return true;
      }
      return false;
    }

    private async run(): Promise<{ data: any; error: any }> {
      await Promise.resolve();
      const table = rowsOf(this.table);
      let affected: Row[] = [];

      if (this.op === "insert" || this.op === "upsert") {
        const incoming = Array.isArray(this.payload)
          ? this.payload
          : [this.payload as Row];
        db.writes.push({
          table: this.table,
          op: this.op,
          payload: this.payload,
        });
        for (const p of incoming) {
          const row: Row = {
            id: randomUUID(),
            created_at: new Date().toISOString(),
            ...p,
          };
          if (this.violatesUnique(row)) {
            return { data: null, error: { code: "23505", message: "unique" } };
          }
          table.push(row);
          affected.push(row);
        }
      } else if (this.op === "update") {
        db.writes.push({
          table: this.table,
          op: "update",
          payload: this.payload,
        });
        const hits = table.filter((r) => this.matches(r));
        for (const r of hits) {
          const next = { ...r, ...(this.payload as Row) };
          if (this.violatesUnique(next, r)) {
            return { data: null, error: { code: "23505", message: "unique" } };
          }
          Object.assign(r, this.payload);
          affected.push(r);
        }
      } else if (this.op === "delete") {
        db.writes.push({ table: this.table, op: "delete", payload: null });
        const keep = table.filter((r) => !this.matches(r));
        affected = table.filter((r) => this.matches(r));
        db.tables[this.table] = keep;
      } else {
        affected = table.filter((r) => this.matches(r));
        if (this.orderBy) {
          const { col, asc } = this.orderBy;
          affected = [...affected].sort((a, b) =>
            a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)
          );
        }
      }

      if (this.max != null) affected = affected.slice(0, this.max);
      const isRead = this.op === "select";
      if (!isRead && !this.returning) return { data: null, error: null };

      const out = affected.map((r) => ({ ...r }));
      if (this.mode === "single") {
        return out.length === 1
          ? { data: out[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "not one row" } };
      }
      if (this.mode === "maybe") {
        return out.length > 1
          ? { data: null, error: { code: "PGRST116", message: "many rows" } }
          : { data: out[0] ?? null, error: null };
      }
      return { data: out, error: null };
    }
  }

  db.client = {
    from: (table: string) => new Query(table),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array, opts?: any) => {
          db.uploads.push({
            path,
            bytes: bytes.byteLength,
            contentType: opts?.contentType,
          });
          return { data: { path }, error: null };
        },
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({
          data: { signedUrl: "https://signed.example/x" },
          error: null,
        }),
      }),
    },
  };
  return db;
}
