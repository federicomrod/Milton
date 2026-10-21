// Telegram manager connection hardening: private-chat pairing only, admin-only
// connect / disconnect, disconnect of THIS company only, atomic code claim.
// In-memory fake of the service-role client; synthetic ids only.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db: {
  restaurant_telegram_connections: Row[];
  restaurant_telegram_pairing_codes: Row[];
} = {
  restaurant_telegram_connections: [],
  restaurant_telegram_pairing_codes: [],
};
let seq = 0;

/** Just enough of the Supabase query builder for pairing.ts. */
function builder(table: keyof typeof db) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "insert" | "update" | "delete" = "select";
  let patch: Row = {};
  let inserted: Row | null = null;
  let returning = false;
  const run = () => {
    const rows = db[table];
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "insert") {
      const row: Row = { id: `id-${++seq}`, ...inserted! };
      const uniq =
        table === "restaurant_telegram_connections" &&
        rows.some(
          (r) => r.company_id === row.company_id || r.chat_id === row.chat_id
        );
      if (uniq) return { data: null, error: { message: "duplicate key" } };
      rows.push(row);
      return { data: [row], error: null };
    }
    if (op === "update") {
      hit.forEach((r) => Object.assign(r, patch));
      return {
        data: returning ? hit.map((r) => ({ id: r.id })) : null,
        error: null,
      };
    }
    if (op === "delete") {
      db[table] = rows.filter((r) => !hit.includes(r));
      return { data: null, error: null };
    }
    return { data: hit, error: null };
  };
  const b: Record<string, unknown> = {
    select() {
      returning = true;
      return b;
    },
    insert(row: Row) {
      op = "insert";
      inserted = row;
      return b;
    },
    update(p: Row) {
      op = "update";
      patch = p;
      returning = false;
      return b;
    },
    delete() {
      op = "delete";
      return b;
    },
    eq(col: string, v: unknown) {
      filters.push((r) => r[col] === v);
      return b;
    },
    is(col: string, v: unknown) {
      filters.push((r) => (r[col] ?? null) === v);
      return b;
    },
    gt(col: string, v: string) {
      filters.push((r) => String(r[col]) > v);
      return b;
    },
    maybeSingle() {
      const out = run();
      return Promise.resolve({
        data: (out.data as Row[] | null)?.[0] ?? null,
        error: out.error,
      });
    },
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve);
    },
  };
  return b;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: keyof typeof db) => builder(t) }),
}));

import {
  consumePairingCode,
  createPairingCode,
  disconnectTelegram,
} from "@/lib/restaurant/telegram/pairing";

beforeEach(() => {
  db.restaurant_telegram_connections = [];
  db.restaurant_telegram_pairing_codes = [];
  seq = 0;
});

async function issue(companyId: string) {
  const out = await createPairingCode(companyId);
  if (!out.ok) throw new Error("not issued");
  return out.issued.code;
}

describe("atomic claim of the pairing code", () => {
  it("two simultaneous /start with the same code create ONE connection", async () => {
    const code = await issue("co-1");
    const [a, b] = await Promise.all([
      consumePairingCode(code, 111),
      consumePairingCode(code, 222),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser).toEqual({ ok: false, reason: "invalid_or_expired" });
    expect(db.restaurant_telegram_connections).toHaveLength(1);
  });
  it("a second use of a spent code is invalid_or_expired", async () => {
    const code = await issue("co-1");
    expect((await consumePairingCode(code, 111)).ok).toBe(true);
    expect(await consumePairingCode(code, 333)).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
    expect(db.restaurant_telegram_connections).toHaveLength(1);
  });
  it("a refused pairing (chat already connected) does not spend the code", async () => {
    const other = await issue("co-2");
    await consumePairingCode(other, 111);
    const code = await issue("co-1");
    expect(await consumePairingCode(code, 111)).toEqual({
      ok: false,
      reason: "chat_already_connected",
    });
    const row = db.restaurant_telegram_pairing_codes.find(
      (r) => r.code === code
    )!;
    expect(row.consumed_at ?? null).toBeNull();
  });
});

describe("disconnect", () => {
  it("removes only this company's row, retires only its unused codes, and a new code can be issued", async () => {
    const mine = await issue("co-1");
    await consumePairingCode(mine, 111);
    const theirs = await issue("co-2");
    await consumePairingCode(theirs, 222);
    const leftoverMine = await issue("co-1").catch(() => null);
    expect(leftoverMine).toBeNull(); // still connected: no new code yet

    // an unused code of co-1 issued earlier, and one of co-2
    db.restaurant_telegram_pairing_codes.push(
      {
        id: "c-a",
        company_id: "co-1",
        code: "AAA",
        expires_at: "2999-01-01",
        consumed_at: null,
      },
      {
        id: "c-b",
        company_id: "co-2",
        code: "BBB",
        expires_at: "2999-01-01",
        consumed_at: null,
      }
    );
    const out = await disconnectTelegram("co-1");
    expect(out).toEqual({ ok: true, disconnected: true, chatId: 111 });
    expect(db.restaurant_telegram_connections.map((r) => r.company_id)).toEqual(
      ["co-2"]
    );
    const codes = db.restaurant_telegram_pairing_codes;
    expect(codes.find((r) => r.id === "c-a")!.consumed_at).toBeTruthy();
    expect(codes.find((r) => r.id === "c-b")!.consumed_at ?? null).toBeNull();
    expect(await consumePairingCode("AAA", 999)).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
    expect((await createPairingCode("co-1")).ok).toBe(true);
  });
  it("disconnecting a company with no chat is a harmless no-op", async () => {
    expect(await disconnectTelegram("co-9")).toEqual({
      ok: true,
      disconnected: false,
      chatId: null,
    });
  });
});
