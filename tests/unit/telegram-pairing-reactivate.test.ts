// Pairing: an inactive company row is reactivated (update, not insert); an
// active row still blocks; a chat connected elsewhere is still refused.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

let store: FakeStore = {};
const inserts: string[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = makeFakeDb(store);
    return {
      from: (t: string) => {
        const q = db.from(t) as Record<string, unknown>;
        const ins = q.insert as (d: unknown) => unknown;
        q.insert = (d: unknown) => {
          inserts.push(t);
          return ins(d);
        };
        return q;
      },
    };
  },
}));
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: {},
    userId: "u1",
    companyId: "co-1",
  }),
}));
vi.mock("@/lib/auth/permissions", () => ({
  resolveActor: async () => ({}),
  requireCapability: () => null,
}));

import {
  consumePairingCode,
  createPairingCode,
} from "@/lib/restaurant/telegram/pairing";
import { POST } from "@/app/api/restaurant/telegram/pairing-code/route";

const future = () => new Date(Date.now() + 600_000).toISOString();

beforeEach(() => {
  inserts.length = 0;
  store = {
    restaurant_telegram_connections: [],
    restaurant_telegram_pairing_codes: [],
  };
});

describe("pairing with an inactive company row", () => {
  it("issues a code and reactivates the row instead of inserting", async () => {
    store.restaurant_telegram_connections.push({
      id: "c1",
      company_id: "co-1",
      chat_id: 111,
      is_active: false,
      connected_at: "2026-01-01T00:00:00Z",
    });
    const issued = await createPairingCode("co-1");
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    inserts.length = 0;
    const res = await consumePairingCode(issued.issued.code, 222);
    expect(res).toEqual({ ok: true, companyId: "co-1" });
    expect(inserts).not.toContain("restaurant_telegram_connections");
    const rows = store.restaurant_telegram_connections;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chat_id: 222, is_active: true });
    expect(rows[0].connected_at).not.toBe("2026-01-01T00:00:00Z");
  });

  it("still refuses when the company row is active", async () => {
    store.restaurant_telegram_connections.push({
      id: "c1",
      company_id: "co-1",
      chat_id: 111,
      is_active: true,
    });
    expect(await createPairingCode("co-1")).toEqual({
      ok: false,
      reason: "already_connected",
    });
    store.restaurant_telegram_pairing_codes.push({
      id: "p1",
      company_id: "co-1",
      code: "abc",
      expires_at: future(),
      consumed_at: null,
    });
    expect(await consumePairingCode("abc", 222)).toEqual({
      ok: false,
      reason: "company_already_connected",
    });
  });

  it("keeps chat_already_connected when the chat is active in another company", async () => {
    store.restaurant_telegram_connections.push(
      {
        id: "c1",
        company_id: "co-1",
        chat_id: 111,
        is_active: false,
      },
      { id: "c2", company_id: "co-2", chat_id: 333, is_active: true }
    );
    store.restaurant_telegram_pairing_codes.push({
      id: "p1",
      company_id: "co-1",
      code: "abc",
      expires_at: future(),
      consumed_at: null,
    });
    expect(await consumePairingCode("abc", 333)).toEqual({
      ok: false,
      reason: "chat_already_connected",
    });
    expect(store.restaurant_telegram_connections[0].chat_id).toBe(111);
  });

  it("pairing-code route answers 409 in Spanish for an active connection", async () => {
    store.restaurant_telegram_connections.push({
      id: "c1",
      company_id: "co-1",
      chat_id: 111,
      is_active: true,
    });
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Este restaurante ya tiene un chat de Telegram conectado."
    );
  });
});
