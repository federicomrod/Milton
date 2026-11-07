// tests/pg/harness.ts
//
// A DISPOSABLE, LOCAL, SYNTHETIC-ONLY Postgres for the fixed-cost integration
// tests. It is a real Postgres server (embedded-postgres binaries), started in a
// fresh temp directory, listening on 127.0.0.1 on a free port, with its own
// throwaway credentials. It reads NO environment variable and NO .env file, so a
// hosted connection can never be used as a fallback. assertIsolated() proves it
// before any SQL runs; if anything is ambiguous the suite fails closed.

import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
export const MIGRATIONS = [
  "064_restaurant_fixed_costs.sql",
  "073_fixed_costs_write_roles.sql",
  "079_fixed_cost_items_and_commands.sql",
];
export const ENFORCE = "080_fixed_cost_enforce_command_boundary.sql";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface TestDb {
  port: number;
  dir: string;
  connect(): Promise<Client>;
  stop(): Promise<void>;
}

export async function startTestDb(
  opts: { enforce?: boolean } = {}
): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "milton-fc-pg-"));
  const port = await freePort();
  const pw = `t${Math.random().toString(36).slice(2)}`;
  const server = new EmbeddedPostgres({
    databaseDir: path.join(dir, "data"),
    user: "fc_test",
    password: pw,
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "fsync=off"],
  });
  await server.initialise();
  await server.start();
  const connect = async () => {
    const c = new Client({
      host: "127.0.0.1",
      port,
      user: "fc_test",
      password: pw,
      database: "postgres",
    });
    await c.connect();
    return c;
  };
  const db: TestDb = {
    port,
    dir,
    connect,
    stop: async () => {
      await server.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  const admin = await connect();
  try {
    await assertIsolated(admin, dir);
    await admin.query(
      fs.readFileSync(path.join(__dirname, "bootstrap.sql"), "utf8")
    );
    for (const f of MIGRATIONS)
      await admin.query(
        fs.readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8")
      );
    if (opts.enforce)
      await admin.query(
        fs.readFileSync(path.join(ROOT, "supabase/migrations", ENFORCE), "utf8")
      );
  } catch (e) {
    await admin.end();
    await db.stop();
    throw e;
  }
  await admin.end();
  return db;
}

/** Fails closed unless this is the empty throwaway server we just created. */
async function assertIsolated(c: Client, dir: string) {
  const r = await c.query(
    "select inet_server_addr()::text as addr, current_setting('data_directory') as dd, " +
      "(select count(*) from pg_database where datname not in ('postgres','template0','template1')) as dbs, " +
      "(select count(*) from pg_tables where schemaname = 'public') as tables, " +
      "current_setting('listen_addresses') as la"
  );
  const row = r.rows[0];
  const ok =
    String(row.addr).startsWith("127.0.0.1") &&
    row.la === "127.0.0.1" &&
    fs.realpathSync(row.dd).startsWith(fs.realpathSync(dir)) &&
    Number(row.dbs) === 0 &&
    Number(row.tables) === 0;
  if (!ok)
    throw new Error(
      `Refusing to run: the test database is not a fresh local throwaway (${JSON.stringify(row)})`
    );
}

/** One PostgREST-like request: a transaction as `authenticated` with a JWT sub. */
export async function asUser<T>(
  c: Client,
  uid: string | null,
  fn: (c: Client) => Promise<T>
): Promise<T> {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(
        uid ? { sub: uid, role: "authenticated" } : { role: "anon" }
      ),
    ]);
    await c.query(uid ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
