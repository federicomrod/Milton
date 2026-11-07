import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { startTestDb, type TestDb } from "./harness";

let db: TestDb;
let c: Client;
beforeAll(async () => {
  db = await startTestDb();
  c = await db.connect();
});
afterAll(async () => {
  await c?.end();
  await db?.stop();
});

describe("migrations apply on a fresh local database", () => {
  it("creates the command API", async () => {
    const r = await c.query(
      "select proname from pg_proc where proname like 'fixed_cost_%' order by 1"
    );
    expect(r.rows.map((x) => x.proname)).toEqual([
      "fixed_cost_approve_upload",
      "fixed_cost_copy",
      "fixed_cost_item_command",
      "fixed_cost_preview_copy",
      "fixed_cost_preview_upload",
      "fixed_cost_save_totals",
      "fixed_cost_undo",
    ]);
  });
});
