// One Telegram account, several restaurants: join, links, pending items,
// routing default, callback data and staff removal. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

type Row = Record<string, unknown>;
const { store } = vi.hoisted(() => ({ store: {} as Record<string, Row[]> }));

vi.mock("@/lib/supabase/admin", () => {
  // one client for the whole test, so generated ids stay unique
  const db = makeFakeDb(store);
  return { createAdminClient: () => db };
});
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    companyId: "co-demo",
    userId: "user-1",
    supabase: {},
  }),
}));
vi.mock("@/lib/auth/permissions", () => ({
  resolveActor: async () => ({}),
  requireCapability: () => null,
  loadCompanyRole: async () => null,
}));

import {
  consumeKitchenJoin,
  generateKitchenToken,
  hashKitchenToken,
} from "@/lib/restaurant/telegram/kitchen-join";
import {
  listActiveLinks,
  validateLink,
} from "@/lib/restaurant/telegram/kitchen-links";
import { findActiveKitchenStaff } from "@/lib/restaurant/telegram/kitchen-reports";
import {
  DEFAULT_TTL_MS,
  PENDING_TTL_MS,
  callbackData,
  cleanupPendingOld,
  createPendingItem,
  expirePendingItem,
  getRoutingDefault,
  latestExpiredUnannounced,
  loadPendingByNonce,
  parseCallbackData,
  resolvePendingItem,
  setRoutingDefault,
} from "@/lib/restaurant/telegram/kitchen-pending";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
  renderLinksList,
} from "@/lib/restaurant/telegram/kitchen-copy";
import { DELETE } from "@/app/api/restaurant/kitchen/staff/[id]/route";

const COOK = 7001;
const qrDemo = generateKitchenToken();
const qrNorte = generateKitchenToken();
const qrCentroTwo = generateKitchenToken();

function seed() {
  for (const k of Object.keys(store)) delete store[k];
  store.companies = [
    { id: "co-demo", name: "Demo Resto" },
    { id: "co-stage", name: "Stage Test 1" },
  ];
  store.restaurant_locations = [
    {
      id: "loc-centro",
      company_id: "co-demo",
      name: "Local Centro",
      status: "active",
      archived_at: null,
    },
    {
      id: "loc-sur",
      company_id: "co-demo",
      name: "Local Sur",
      status: "active",
      archived_at: null,
    },
    {
      id: "loc-norte",
      company_id: "co-stage",
      name: "Local Norte",
      status: "active",
      archived_at: null,
    },
  ];
  store.kitchen_join_tokens = [
    {
      id: "t1",
      company_id: "co-demo",
      location_id: "loc-centro",
      token_hash: hashKitchenToken(qrDemo.secret),
      revoked_at: null,
    },
    {
      id: "t2",
      company_id: "co-stage",
      location_id: "loc-norte",
      token_hash: hashKitchenToken(qrNorte.secret),
      revoked_at: null,
    },
    {
      id: "t3",
      company_id: "co-demo",
      location_id: "loc-sur",
      token_hash: hashKitchenToken(qrCentroTwo.secret),
      revoked_at: null,
    },
  ];
  store.kitchen_staff = [];
  store.kitchen_pending_items = [];
  store.kitchen_routing_defaults = [];
}

const join = (payload: string, user = COOK) =>
  consumeKitchenJoin({
    payload,
    telegramUserId: user,
    chatId: user,
    displayName: "Cook",
  });

beforeEach(seed);

describe("join with several restaurants", () => {
  it("a second QR in another company adds a link and keeps the first", async () => {
    expect(await join(qrDemo.payload)).toMatchObject({
      kind: "joined",
      companyName: "Demo Resto",
      locationName: "Local Centro",
    });
    const second = await join(qrNorte.payload);
    expect(second).toEqual({
      kind: "added",
      companyName: "Stage Test 1",
      locationName: "Local Norte",
    });
    const rows = store.kitchen_staff.filter((r) => r.telegram_user_id === COOK);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.is_active)).toBe(true);
    expect(
      renderKitchenCopy(KITCHEN_COPY.JOINED_ADDED, {
        empresa: "Stage Test 1",
        local: "Local Norte",
      })
    ).toContain("Ahora también estás en Stage Test 1 › Local Norte");
  });

  it("the same QR again is already_joined and writes nothing", async () => {
    await join(qrDemo.payload);
    await join(qrNorte.payload);
    expect(await join(qrDemo.payload)).toMatchObject({
      kind: "already_joined",
    });
    expect(store.kitchen_staff).toHaveLength(2);
  });

  it("re-scanning after removal reactivates the same row", async () => {
    await join(qrDemo.payload);
    const id = store.kitchen_staff[0].id;
    store.kitchen_staff[0].is_active = false;
    store.kitchen_staff[0].removed_at = "2026-10-01T00:00:00Z";
    expect(await join(qrDemo.payload)).toMatchObject({ kind: "joined" });
    expect(store.kitchen_staff).toHaveLength(1);
    expect(store.kitchen_staff[0]).toMatchObject({
      id,
      is_active: true,
      removed_at: null,
    });
  });

  it("two locations of one company give two links", async () => {
    await join(qrDemo.payload);
    expect(await join(qrCentroTwo.payload)).toMatchObject({ kind: "added" });
    const links = await listActiveLinks(COOK);
    expect(links.map((l) => `${l.companyName} › ${l.locationName}`)).toEqual([
      "Demo Resto › Local Centro",
      "Demo Resto › Local Sur",
    ]);
  });
});

describe("listActiveLinks / validateLink / compatibility wrapper", () => {
  beforeEach(async () => {
    await join(qrNorte.payload);
    await join(qrDemo.payload);
  });

  it("sorts by company then local and ignores inactive rows", async () => {
    let links = await listActiveLinks(COOK);
    expect(links.map((l) => l.companyName)).toEqual([
      "Demo Resto",
      "Stage Test 1",
    ]);
    store.kitchen_staff.find((r) => r.location_id === "loc-norte")!.is_active =
      false;
    links = await listActiveLinks(COOK);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      locationName: "Local Centro",
      telegramUserId: COOK,
    });
  });

  it("ignores rows whose location left the company or is archived", async () => {
    store.restaurant_locations.find((l) => l.id === "loc-norte")!.company_id =
      "co-demo";
    expect((await listActiveLinks(COOK)).map((l) => l.locationId)).toEqual([
      "loc-centro",
    ]);
    store.restaurant_locations.find((l) => l.id === "loc-centro")!.archived_at =
      "2026-10-02T00:00:00Z";
    expect(await listActiveLinks(COOK)).toEqual([]);
  });

  it("validateLink re-reads and rejects another account's staff id", async () => {
    const mine = (await listActiveLinks(COOK))[0];
    expect(await validateLink(COOK, mine.staffId)).toEqual(mine);
    expect(await validateLink(9999, mine.staffId)).toBeNull();
    store.kitchen_staff.find((r) => r.id === mine.staffId)!.is_active = false;
    expect(await validateLink(COOK, mine.staffId)).toBeNull();
    expect(await validateLink(COOK, "nope")).toBeNull();
  });

  it("findActiveKitchenStaff: null with several links, the link with exactly one, null with none", async () => {
    expect(await findActiveKitchenStaff(COOK)).toBeNull();
    store.kitchen_staff.find((r) => r.location_id === "loc-norte")!.is_active =
      false;
    expect(await findActiveKitchenStaff(COOK)).toMatchObject({
      company_name: "Demo Resto",
      location_name: "Local Centro",
    });
    expect(await findActiveKitchenStaff(424242)).toBeNull();
  });

  it("removing one location's row leaves the other active (staff route)", async () => {
    const norte = store.kitchen_staff.find(
      (r) => r.location_id === "loc-norte"
    )!;
    const centro = store.kitchen_staff.find(
      (r) => r.location_id === "loc-centro"
    )!;
    // the route is scoped to the signed-in company: remove the Demo Resto row
    const res = await DELETE(
      new NextRequest("http://localhost/x", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
      }
    );
    expect(res.status).toBe(404); // unknown id: nothing changed
    centro.id = "11111111-1111-4111-8111-111111111111";
    const ok = await DELETE(
      new NextRequest("http://localhost/x", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: centro.id as string }),
      }
    );
    expect(ok.status).toBe(200);
    expect(centro.is_active).toBe(false);
    expect(norte.is_active).toBe(true);
    const left = await listActiveLinks(COOK);
    expect(left).toHaveLength(1);
    expect(left[0].locationName).toBe("Local Norte");
  });
});

describe("pending items", () => {
  const links = [
    {
      staffId: "s1",
      companyId: "co-demo",
      companyName: "Demo Resto",
      locationId: "loc-centro",
      locationName: "Local Centro",
      telegramUserId: COOK,
    },
    {
      staffId: "s2",
      companyId: "co-stage",
      companyName: "Stage Test 1",
      locationId: "loc-norte",
      locationName: "Local Norte",
      telegramUserId: COOK,
    },
  ];
  const input = (over: Record<string, unknown> = {}) => ({
    telegramUserId: COOK,
    chatId: COOK,
    telegramMessageId: 50,
    kind: "photo" as const,
    payload: { file_id: "FILE", caption: "x".repeat(3000) },
    links,
    ...over,
  });
  async function make(over: Record<string, unknown> = {}) {
    const r = await createPendingItem(input(over));
    if (!r.ok) throw new Error("create failed");
    return r;
  }
  beforeEach(() => {
    store.kitchen_staff = [{ id: "s1" }, { id: "s2" }];
  });

  it("is idempotent on (chat, message) and truncates text", async () => {
    const a = await make();
    expect(a.created).toBe(true);
    expect((a.item.payload.caption as string).length).toBe(2000);
    expect(a.item.optionStaffIds).toEqual(["s1", "s2"]);
    expect(a.item.nonce.length).toBeGreaterThanOrEqual(22);
    const b = await make();
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    expect(store.kitchen_pending_items).toHaveLength(1);
    expect(
      new Date(a.item.expiresAt).getTime() -
        new Date(a.item.createdAt).getTime()
    ).toBe(PENDING_TTL_MS);
  });

  it("keeps at most 8 options and the default_only flag", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...links[0],
      staffId: `s${i}`,
    }));
    const r = await make({ links: many, defaultOnly: true });
    expect(r.item.optionStaffIds).toHaveLength(8);
    expect(r.item.payload.default_only).toBe(true);
  });

  it("resolves atomically once; the payload is returned, then cleared", async () => {
    const { item } = await make();
    const [x, y] = await Promise.all([
      resolvePendingItem(item.id, "s2"),
      resolvePendingItem(item.id, "s2"),
    ]);
    const oks = [x, y].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    const loser = [x, y].find((r) => !r.ok)!;
    expect(loser).toEqual({ ok: false, reason: "already_resolved" });
    const won = oks[0] as {
      ok: true;
      item: { payload: Record<string, unknown>; chosenStaffId: string };
    };
    expect(won.item.payload.file_id).toBe("FILE");
    expect(won.item.chosenStaffId).toBe("s2");
    expect(store.kitchen_pending_items[0].payload).toEqual({});
    expect(store.kitchen_pending_items[0].chosen_staff_id).toBe("s2");
  });

  it("rejects an unknown item, or a staff id that was not offered", async () => {
    const { item } = await make();
    expect(await resolvePendingItem("nope", "s1")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await resolvePendingItem(item.id, "s9")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("expired items cannot resolve and lose their payload", async () => {
    const { item } = await make();
    store.kitchen_pending_items[0].expires_at = new Date(
      Date.now() - 1000
    ).toISOString();
    expect(await resolvePendingItem(item.id, "s1")).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(store.kitchen_pending_items[0].payload).toEqual({});
    expect(store.kitchen_pending_items[0].resolved_at ?? null).toBeNull();
  });

  it("announces an expiry once", async () => {
    const { item } = await make();
    expect(await latestExpiredUnannounced(COOK, COOK)).toBeNull();
    store.kitchen_pending_items[0].expires_at = new Date(
      Date.now() - 1000
    ).toISOString();
    const seen = await latestExpiredUnannounced(COOK, COOK);
    expect(seen?.id).toBe(item.id);
    expect(seen?.payload).toEqual({});
    await expirePendingItem(item.id);
    expect(await latestExpiredUnannounced(COOK, COOK)).toBeNull();
  });

  it("loads by nonce", async () => {
    const { item } = await make();
    expect((await loadPendingByNonce(item.nonce))?.id).toBe(item.id);
    expect(await loadPendingByNonce("missing")).toBeNull();
  });

  it("cleanup deletes rows older than 24 h only", async () => {
    await make();
    await make({ telegramMessageId: 51 });
    store.kitchen_pending_items[0].created_at = new Date(
      Date.now() - 25 * 3600_000
    ).toISOString();
    await cleanupPendingOld();
    expect(store.kitchen_pending_items).toHaveLength(1);
    expect(store.kitchen_pending_items[0].telegram_message_id).toBe(51);
  });

  it("the routing default is valid under 30 minutes and not after", async () => {
    expect(await getRoutingDefault(COOK)).toBeNull();
    await setRoutingDefault(COOK, "s1");
    expect((await getRoutingDefault(COOK))?.staffId).toBe("s1");
    await setRoutingDefault(COOK, "s2");
    expect(store.kitchen_routing_defaults).toHaveLength(1);
    expect((await getRoutingDefault(COOK))?.staffId).toBe("s2");
    store.kitchen_routing_defaults[0].chosen_at = new Date(
      Date.now() - DEFAULT_TTL_MS + 60_000
    ).toISOString();
    expect(await getRoutingDefault(COOK)).not.toBeNull();
    store.kitchen_routing_defaults[0].chosen_at = new Date(
      Date.now() - DEFAULT_TTL_MS - 1000
    ).toISOString();
    expect(await getRoutingDefault(COOK)).toBeNull();
  });

  it("returns typed errors instead of throwing", async () => {
    const boom = {
      from: () => {
        throw new Error("db down");
      },
    };
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => boom,
    }));
    const mod = await import("@/lib/restaurant/telegram/kitchen-pending");
    expect(await mod.createPendingItem(input())).toEqual({
      ok: false,
      reason: "error",
    });
    expect(await mod.loadPendingByNonce("x")).toBeNull();
    expect(await mod.resolvePendingItem("a", "b")).toEqual({
      ok: false,
      reason: "error",
    });
    await expect(mod.cleanupPendingOld()).resolves.toBeUndefined();
    await expect(mod.setRoutingDefault(1, "s")).resolves.toBeUndefined();
    vi.doUnmock("@/lib/supabase/admin");
  });
});

describe("callback data", () => {
  const nonce = "AbCdEfGhIjKlMnOpQrStUv"; // 22 chars
  it("round-trips and stays within 64 bytes", () => {
    for (const [kind, i] of [
      ["item", 3],
      ["default", 0],
    ] as const) {
      const d = callbackData(kind, nonce, i);
      expect(Buffer.byteLength(d)).toBeLessThanOrEqual(64);
      expect(parseCallbackData(d)).toEqual({ kind, nonce, index: i });
    }
    const c = callbackData("cancel", nonce);
    expect(c).toBe(`kc1:${nonce}`);
    expect(parseCallbackData(c)).toEqual({
      kind: "cancel",
      nonce,
      index: null,
    });
  });
  it("rejects junk, oversized and malformed data", () => {
    for (const bad of [
      "",
      "hello",
      "kr1:",
      `kr1:${nonce}`,
      `kr1:${nonce}:x`,
      `kr1:short:1`,
      `kc1:${nonce}:1`,
      `kx1:${nonce}:1`,
      `kr1:${nonce}:1:2`,
      ` kr1:${nonce}:1`,
      `kr1:${"a".repeat(80)}:1`,
      `kr1:${nonce}:123`,
      `kr1:${nonce}!:1`,
    ]) {
      expect(parseCallbackData(bad)).toBeNull();
    }
  });
  it("never contains ids or names", () => {
    const d = callbackData("item", nonce, 1);
    expect(d).not.toMatch(/co-demo|loc-|Demo|Local/);
  });
});

describe("links list copy", () => {
  it("lists one restaurant per line", () => {
    expect(
      renderLinksList([
        { companyName: "Demo Resto", locationName: "Local Centro" },
        { companyName: "Stage Test 1", locationName: "Local Norte" },
      ])
    ).toBe(
      "Tus restaurantes:\n• Demo Resto › Local Centro\n• Stage Test 1 › Local Norte"
    );
  });
  it("routing copy has the agreed text", () => {
    expect(KITCHEN_COPY.ROUTING_ASK).toBe("¿Para qué restaurante es?");
    expect(KITCHEN_COPY.ROUTING_EXPIRED).toContain("Pasaron 15 minutos");
    expect(KITCHEN_COPY.CHANGE_HINT).toContain("el dueño o un admin");
  });
});
