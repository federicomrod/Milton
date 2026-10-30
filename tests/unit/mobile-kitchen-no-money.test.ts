import { NextRequest } from "next/server";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";

const CO = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF_1 = "44444444-4444-4444-8444-444444444441";
const STAFF_2 = "44444444-4444-4444-8444-444444444442";
const DEVICE_1 = "55555555-5555-4555-8555-555555555551";
const DEVICE_2 = "55555555-5555-4555-8555-555555555552";
const INVITE_1 = "66666666-6666-4666-8666-666666666661";
const DEVICE_TOKEN = "device-token-for-cook-one-0000000000000000000";

// Distinctive amounts: if any of these shows up in a response, money leaked.
const MONEY_ROW = {
  price: 7731.17,
  unit_price: 7731.17,
  precio: 7731.17,
  cost: 5528.43,
  total_cost: 5528.43,
  costo: 5528.43,
  margin: 4417.91,
  margen: 4417.91,
  total: 3306.62,
  subtotal: 3306.62,
  ventas: 2295.88,
  sales: 2295.88,
  revenue: 2295.88,
  importe: 1184.56,
  iva: 6673.29,
};
const MONEY_VALUES = [
  "7731.17",
  "5528.43",
  "4417.91",
  "3306.62",
  "2295.88",
  "1184.56",
  "6673.29",
];

const h = vi.hoisted(() => ({
  schedule: vi.fn(),
  state: { db: null as any },
}));

vi.mock("@/lib/restaurant/kitchen/pipeline/app-message", () => ({
  scheduleAppProcessing: (...a: unknown[]) => h.schedule(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const rls = Object.create(h.state.db.client);
    rls.auth = {
      getUser: async (jwt?: string) =>
        jwt === "owner-token"
          ? {
              data: { user: { id: OWNER, email: "owner@example.test" } },
              error: null,
            }
          : { data: { user: null }, error: { message: "bad" } },
    };
    return rls;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.state.db.client,
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: vi.fn(),
  getCachedCompanyId: vi.fn(),
}));
vi.mock("@/lib/restaurant/supabase-sales", () => ({
  resolveCompanyIdForUser: async () => CO,
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));

import { hashToken } from "@/lib/restaurant/kitchen/app-identity";
import {
  MONEY_FIELD_PATTERN,
  assertNoMoneyFields,
  isMoneyKey,
  pickAllowed,
  serializeKitchenDevice,
  serializeKitchenHistoryItem,
  serializeKitchenInvite,
  serializeKitchenMe,
} from "@/lib/restaurant/kitchen/kitchen-serializer";
import * as redeem from "@/app/api/mobile/v1/kitchen/redeem/route";
import * as me from "@/app/api/mobile/v1/kitchen/me/route";
import * as media from "@/app/api/mobile/v1/kitchen/media/route";
import * as text from "@/app/api/mobile/v1/kitchen/text/route";
import * as history from "@/app/api/mobile/v1/kitchen/history/route";
import * as logout from "@/app/api/mobile/v1/kitchen/logout/route";
import * as uploads from "@/app/api/mobile/v1/kitchen/uploads/route";
import * as uploadsComplete from "@/app/api/mobile/v1/kitchen/uploads/complete/route";
import * as recipes from "@/app/api/mobile/v1/kitchen/recipes/route";
import * as invites from "@/app/api/mobile/v1/kitchen/invites/route";
import * as inviteById from "@/app/api/mobile/v1/kitchen/invites/[id]/route";
import * as devices from "@/app/api/mobile/v1/kitchen/devices/route";
import * as deviceById from "@/app/api/mobile/v1/kitchen/devices/[id]/route";

const BASE = "http://localhost/api/mobile/v1/kitchen";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function jsonReq(
  path: string,
  method: string,
  token: string | null,
  body?: unknown
) {
  return new NextRequest(`${BASE}/${path}`, {
    method,
    headers: {
      ...(token ? bearer(token) : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function uploadReq(token: string, clientRef: string) {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(64)], "a.jpg", { type: "image/jpeg" })
  );
  form.set("kind", "photo");
  form.set("clientRef", clientRef);
  form.set("text", "se acabó el limón");
  return new NextRequest(`${BASE}/media`, {
    method: "POST",
    headers: bearer(token),
    body: form,
  });
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

/** One entry per route file under app/api/mobile/v1/kitchen (relative path). */
const CASES: Record<string, () => Promise<Response[]>> = {
  "redeem/route.ts": async () => [
    await redeem.POST(
      jsonReq("redeem", "POST", null, {
        secret: "invite-secret-one",
        name: "Luis",
      })
    ),
    await redeem.POST(
      jsonReq("redeem", "POST", null, {
        secret: "invite-secret-one",
        name: "Luis",
      })
    ),
  ],
  "me/route.ts": async () => [
    await me.GET(jsonReq("me", "GET", DEVICE_TOKEN)),
    await me.GET(jsonReq("me", "GET", null)),
  ],
  "media/route.ts": async () => [
    await media.POST(uploadReq(DEVICE_TOKEN, "client-ref-photo-1")),
    await media.POST(uploadReq(DEVICE_TOKEN, "client-ref-photo-1")),
  ],
  "text/route.ts": async () => [
    await text.POST(
      jsonReq("text", "POST", DEVICE_TOKEN, {
        text: "quedan pocas cebollas",
        clientRef: "client-ref-text-1",
      })
    ),
  ],
  "history/route.ts": async () => [
    await history.GET(jsonReq("history", "GET", DEVICE_TOKEN)),
  ],
  "uploads/route.ts": async () => [
    await uploads.POST(
      jsonReq("uploads", "POST", DEVICE_TOKEN, {
        kind: "photo",
        mime: "image/jpeg",
        sizeBytes: 1000,
        clientRef: "client-ref-upload-1",
        text: "se acabó el limón",
      })
    ),
    await uploads.POST(
      jsonReq("uploads", "POST", DEVICE_TOKEN, {
        kind: "photo",
        mime: "image/jpeg",
        sizeBytes: 1000,
        clientRef: "client-ref-upload-1",
      })
    ),
  ],
  "uploads/complete/route.ts": async () => {
    const ticket = await (
      await uploads.POST(
        jsonReq("uploads", "POST", DEVICE_TOKEN, {
          kind: "photo",
          mime: "image/jpeg",
          sizeBytes: 1000,
          clientRef: "client-ref-upload-2",
        })
      )
    ).json();
    h.state.db.objects.set(ticket.path, 1000);
    const body = {
      reportId: ticket.reportId,
      clientRef: "client-ref-upload-2",
      path: ticket.path,
    };
    return [
      await uploadsComplete.POST(
        jsonReq("uploads/complete", "POST", DEVICE_TOKEN, body)
      ),
      await uploadsComplete.POST(
        jsonReq("uploads/complete", "POST", DEVICE_TOKEN, body)
      ),
    ];
  },
  "recipes/route.ts": async () => [
    await recipes.GET(jsonReq("recipes", "GET", DEVICE_TOKEN)),
    await recipes.GET(jsonReq("recipes?q=tacos", "GET", DEVICE_TOKEN)),
  ],
  "logout/route.ts": async () => [
    await logout.POST(jsonReq("logout", "POST", DEVICE_TOKEN)),
    await logout.POST(jsonReq("logout", "POST", DEVICE_TOKEN)),
  ],
  "invites/route.ts": async () => [
    await invites.POST(
      jsonReq("invites", "POST", "owner-token", { locationId: LOC })
    ),
    await invites.GET(
      jsonReq(`invites?locationId=${LOC}`, "GET", "owner-token")
    ),
  ],
  "invites/[id]/route.ts": async () => [
    await inviteById.DELETE(
      jsonReq(`invites/${INVITE_1}`, "DELETE", "owner-token"),
      idParams(INVITE_1)
    ),
  ],
  "devices/route.ts": async () => [
    await devices.GET(
      jsonReq(`devices?locationId=${LOC}`, "GET", "owner-token")
    ),
  ],
  "devices/[id]/route.ts": async () => [
    await deviceById.DELETE(
      jsonReq(`devices/${DEVICE_2}`, "DELETE", "owner-token"),
      idParams(DEVICE_2)
    ),
  ],
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory()
      ? routeFiles(p)
      : name === "route.ts"
        ? [p]
        : [];
  });
}
const KITCHEN_DIR = join(process.cwd(), "app/api/mobile/v1/kitchen");
const ROUTES = routeFiles(KITCHEN_DIR).map((f) =>
  relative(KITCHEN_DIR, f).split(sep).join("/")
);

beforeEach(() => {
  h.state.db = createFakeDb({
    companies: [{ id: CO, name: "Casa A", ...MONEY_ROW }],
    restaurant_locations: [
      {
        id: LOC,
        company_id: CO,
        name: "Centro",
        status: "active",
        ...MONEY_ROW,
      },
    ],
    company_memberships: [{ company_id: CO, user_id: OWNER, role: "owner" }],
    kitchen_staff: [
      {
        id: STAFF_1,
        company_id: CO,
        location_id: LOC,
        display_name: "Luis",
        is_active: true,
        can_see_costs: false,
        ...MONEY_ROW,
      },
      {
        id: STAFF_2,
        company_id: CO,
        location_id: LOC,
        display_name: "Ana",
        is_active: true,
        can_see_costs: false,
        ...MONEY_ROW,
      },
    ],
    kitchen_devices: [
      {
        id: DEVICE_1,
        company_id: CO,
        staff_id: STAFF_1,
        token_hash: hashToken(DEVICE_TOKEN),
        platform: "ios",
        device_label: "iPhone",
        last_seen_at: null,
        revoked_at: null,
        created_at: "2026-10-01T10:00:00.000Z",
        ...MONEY_ROW,
      },
      {
        id: DEVICE_2,
        company_id: CO,
        staff_id: STAFF_2,
        token_hash: hashToken("another-cooks-device-token-000000000000"),
        platform: "android",
        device_label: "Pixel",
        last_seen_at: null,
        revoked_at: null,
        created_at: "2026-10-02T10:00:00.000Z",
        ...MONEY_ROW,
      },
    ],
    kitchen_invites: [
      {
        id: INVITE_1,
        company_id: CO,
        location_id: LOC,
        created_by: OWNER,
        invitee_name: "Marta",
        secret_hash: hashToken("pending-invite-secret"),
        expires_at: "2099-01-01T00:00:00.000Z",
        used_at: null,
        revoked_at: null,
        created_at: "2026-10-03T10:00:00.000Z",
        ...MONEY_ROW,
      },
      {
        id: "66666666-6666-4666-8666-666666666662",
        company_id: CO,
        location_id: LOC,
        created_by: OWNER,
        invitee_name: "Luis",
        secret_hash: hashToken("invite-secret-one"),
        expires_at: "2099-01-01T00:00:00.000Z",
        used_at: null,
        revoked_at: null,
        created_at: "2026-10-04T10:00:00.000Z",
        ...MONEY_ROW,
      },
    ],
    kitchen_reports: [
      {
        id: "77777777-7777-4777-8777-777777777771",
        company_id: CO,
        location_id: LOC,
        staff_id: STAFF_1,
        report_type: "waste",
        text: "tiré 2 kg de pollo",
        media_kind: null,
        media_mime: null,
        transcript: null,
        processed_at: null,
        created_at: "2026-10-05T10:00:00.000Z",
        channel: "app",
        ...MONEY_ROW,
      },
      {
        id: "77777777-7777-4777-8777-777777777772",
        company_id: CO,
        location_id: LOC,
        staff_id: STAFF_2,
        report_type: "86",
        text: "OTRO-COCINERO",
        media_kind: null,
        media_mime: null,
        transcript: null,
        processed_at: null,
        created_at: "2026-10-06T10:00:00.000Z",
        channel: "app",
        ...MONEY_ROW,
      },
    ],
    kitchen_media: [],
    menu_items: [
      {
        id: "99990000-0000-4000-8000-000000000001",
        company_id: CO,
        location_id: LOC,
        name: "Tacos al pastor",
        category: "Platos",
        description: null,
        status: "active",
        ...MONEY_ROW,
      },
    ],
    recipe_versions: [
      {
        id: "99990000-0000-4000-8000-000000000002",
        company_id: CO,
        menu_item_id: "99990000-0000-4000-8000-000000000001",
        version_number: 1,
        status: "approved",
        effective_date: null,
        serving_quantity: 4,
        serving_unit: "porciones",
        notes: "Asar 8 minutos.",
        ...MONEY_ROW,
      },
    ],
    recipe_version_inputs: [
      {
        id: "99990000-0000-4000-8000-000000000003",
        company_id: CO,
        recipe_version_id: "99990000-0000-4000-8000-000000000002",
        input_type: "ingredient",
        ingredient_id: "99990000-0000-4000-8000-000000000004",
        component_id: null,
        quantity: 12,
        unit: "pza",
        notes: null,
        ...MONEY_ROW,
      },
    ],
    ingredients: [
      {
        id: "99990000-0000-4000-8000-000000000004",
        company_id: CO,
        name: "Tortilla",
        ...MONEY_ROW,
      },
    ],
    prepared_components: [],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("no money in any kitchen route", () => {
  it("every route file under kitchen/ has a case here (a new route without coverage fails)", () => {
    expect(ROUTES.sort()).toEqual(Object.keys(CASES).sort());
  });

  for (const rel of Object.keys(CASES)) {
    it(`${rel}: responses carry no money keys or values and are no-store`, async () => {
      const responses = await CASES[rel]();
      expect(responses.length).toBeGreaterThan(0);
      for (const res of responses) {
        const raw = await res.text();
        expect(res.headers.get("cache-control")).toBe("no-store");
        const json = raw ? JSON.parse(raw) : {};
        expect(() => assertNoMoneyFields(json)).not.toThrow();
        for (const amount of MONEY_VALUES) expect(raw).not.toContain(amount);
        for (const key of Object.keys(MONEY_ROW)) {
          expect(raw).not.toMatch(new RegExp(`"${key}"\\s*:`));
        }
      }
      // The happy path of each route really answered (not only an error).
      expect(responses.some((r) => r.status < 400)).toBe(true);
    });
  }

  it("history only returns the calling cook's own items", async () => {
    const res = await history.GET(jsonReq("history", "GET", DEVICE_TOKEN));
    const raw = await res.text();
    expect(raw).toContain("tiré 2 kg de pollo");
    expect(raw).not.toContain("OTRO-COCINERO");
    const body = JSON.parse(raw);
    expect(Object.keys(body.items[0]).sort()).toEqual([
      "createdAt",
      "id",
      "kind",
      "result",
      "status",
      "text",
    ]);
  });

  it("logout revokes the device: the very next request is 401", async () => {
    expect((await me.GET(jsonReq("me", "GET", DEVICE_TOKEN))).status).toBe(200);
    expect(
      (await logout.POST(jsonReq("logout", "POST", DEVICE_TOKEN))).status
    ).toBe(200);
    expect((await me.GET(jsonReq("me", "GET", DEVICE_TOKEN))).status).toBe(401);
    expect(
      (
        await text.POST(
          jsonReq("text", "POST", DEVICE_TOKEN, {
            text: "hola",
            clientRef: "client-ref-after-1",
          })
        )
      ).status
    ).toBe(401);
  });

  it("a cook removed on the web gets 401 on the next request", async () => {
    h.state.db.tables.kitchen_staff[0].is_active = false;
    expect((await me.GET(jsonReq("me", "GET", DEVICE_TOKEN))).status).toBe(401);
    expect(
      (await history.GET(jsonReq("history", "GET", DEVICE_TOKEN))).status
    ).toBe(401);
  });

  it("every kitchen route runs on the node runtime and answers through the guard", () => {
    for (const rel of ROUTES) {
      const src = readFileSync(join(KITCHEN_DIR, rel), "utf8");
      expect(src, rel).toMatch(/export const runtime = "nodejs"/);
      const managerRoute = /^(invites|devices)\//.test(rel);
      if (managerRoute) {
        expect(src, rel).toMatch(/mobileJson/);
      } else {
        expect(src, rel).toMatch(/kitchenJson/);
        expect(src, rel).not.toMatch(/NextResponse\.json/);
      }
    }
  });
});

describe("kitchen serializer", () => {
  it("drops every field that is not on the allow-list", () => {
    const out = serializeKitchenMe({
      staff: {
        id: "s",
        display_name: "Luis",
        ...MONEY_ROW,
        telegram_user_id: 5,
      },
      company: { name: "Casa A", ...MONEY_ROW },
      locations: [{ id: "l", name: "Centro", ...MONEY_ROW }],
    });
    expect(out).toEqual({
      staff: { id: "s", name: "Luis" },
      company: { name: "Casa A" },
      locations: [{ id: "l", name: "Centro" }],
    });
    expect(pickAllowed({ a: 1, b: 2, price: 3 }, ["a"])).toEqual({ a: 1 });
    expect(pickAllowed(null, ["a"])).toEqual({});
    const item = serializeKitchenHistoryItem({
      id: "r",
      text: "x",
      created_at: "t",
      ...MONEY_ROW,
    });
    expect(Object.keys(item).sort()).toEqual([
      "createdAt",
      "id",
      "kind",
      "result",
      "status",
      "text",
    ]);
    const inv = serializeKitchenInvite({
      id: "i",
      secret_hash: "H",
      expires_at: "2099-01-01T00:00:00Z",
      ...MONEY_ROW,
    });
    expect(JSON.stringify(inv)).not.toContain('H"');
    expect(
      Object.keys(
        serializeKitchenDevice(
          { id: "d", token_hash: "H", ...MONEY_ROW },
          "Luis"
        )
      ).sort()
    ).toEqual([
      "createdAt",
      "deviceLabel",
      "id",
      "lastSeenAt",
      "platform",
      "revokedAt",
      "staffId",
      "staffName",
    ]);
  });

  it("assertNoMoneyFields throws on money keys, in any casing, at any depth", () => {
    for (const key of [
      "price",
      "unit_price",
      "unitPrice",
      "costPerUnit",
      "costo",
      "total",
      "subtotal",
      "margin",
      "margen",
      "ventas",
      "sales",
      "revenue",
      "importe",
      "iva",
      "IVA",
      "tax",
      "impuesto",
      "precio_unitario",
      "totalCost",
    ]) {
      expect(
        () => assertNoMoneyFields({ a: [{ b: { [key]: 1 } }] }),
        key
      ).toThrow();
    }
    expect(MONEY_FIELD_PATTERN.test("price")).toBe(true);
  });

  it("assertNoMoneyFields throws on an amount hiding in a value", () => {
    for (const value of ["$12.50", "12,50 €", "3 USD", "€ 3"]) {
      expect(() => assertNoMoneyFields({ label2: value }), value).toThrow();
    }
  });

  it("does not trip on normal kitchen data", () => {
    expect(() =>
      assertNoMoneyFields({
        items: [
          {
            id: "1",
            kind: "photo",
            text: "compré por $5 de limón",
            status: "received",
            createdAt: "2026-10-29T10:00:00.000Z",
          },
        ],
        nextCursor: null,
        deviceToken: "5eur-abc_def-9usd-xyz",
        staff: { id: "s", name: "Luis" },
        duplicate: false,
      })
    ).not.toThrow();
    for (const key of [
      "created_at",
      "status",
      "deviceToken",
      "staffId",
      "nextCursor",
      "durationS",
      "locationName",
      "private",
      "activity",
    ]) {
      expect(isMoneyKey(key), key).toBe(false);
    }
  });
});
