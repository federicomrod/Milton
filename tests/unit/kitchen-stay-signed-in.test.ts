// A cook joins once and stays signed in; a lost session comes back with
// kitchen code + name + PIN. Managers reset a PIN, send a new link, sign a
// phone out, and switch to Cocina without a link. In-memory database; demo
// data only.
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "11111111-1111-4111-8111-1111111111bb";
const LOC_A = "22222222-2222-4222-8222-222222222222";
const LOC_B = "22222222-2222-4222-8222-2222222222bb";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VIEWER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STAFF_A = "44444444-4444-4444-8444-444444444441";
const STAFF_B = "44444444-4444-4444-8444-4444444444bb";

const USERS: Record<string, string> = {
  "owner-token": OWNER,
  "manager-token": MANAGER,
  "viewer-token": VIEWER,
  "owner-b-token": OWNER_B,
};
const COMPANY_OF: Record<string, string> = {
  [OWNER]: CO_A,
  [MANAGER]: CO_A,
  [VIEWER]: CO_A,
  [OWNER_B]: CO_B,
};

const h = vi.hoisted(() => ({ state: { db: null as any } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const rls = Object.create(h.state.db.client);
    rls.auth = {
      getUser: async (jwt?: string) => {
        const id = USERS[jwt ?? ""];
        return id
          ? {
              data: {
                user: {
                  id,
                  email: `${id.slice(0, 4)}@example.test`,
                  user_metadata: { full_name: "Marta Demo" },
                },
              },
              error: null,
            }
          : { data: { user: null }, error: { message: "bad" } };
      },
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
  resolveCompanyIdForUser: async (_s: unknown, userId: string) =>
    COMPANY_OF[userId] ?? null,
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));

import { hashToken } from "@/lib/restaurant/kitchen/app-identity";
import * as redeem from "@/app/api/mobile/v1/kitchen/redeem/route";
import * as me from "@/app/api/mobile/v1/kitchen/me/route";
import * as pinLogin from "@/app/api/mobile/v1/kitchen/pin-login/route";
import * as pinRoute from "@/app/api/mobile/v1/kitchen/pin/route";
import * as selfDevice from "@/app/api/mobile/v1/kitchen/self-device/route";
import * as team from "@/app/api/mobile/v1/kitchen/team/route";
import * as teamById from "@/app/api/mobile/v1/kitchen/team/[id]/route";
import { resetRedeemLimitForTests } from "@/lib/restaurant/kitchen/redeem-limit";
import { hashPin } from "@/lib/restaurant/kitchen/pin";
import {
  createKitchenInvite,
  resolveKitchenDevice,
} from "@/lib/restaurant/kitchen/app-identity";
import { assertNoMoneyFields } from "@/lib/restaurant/kitchen/kitchen-serializer";

const BASE = "http://localhost/api/mobile/v1/kitchen";
let ipCounter = 0;
const req = (
  path: string,
  method: string,
  token: string | null,
  body?: unknown,
  ip = `10.0.0.${++ipCounter}`
) =>
  new NextRequest(`${BASE}/${path}`, {
    method,
    headers: {
      "x-forwarded-for": ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const idp = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => JSON.parse(await res.text());

const DEVICE_A = "cook-a-device-token-0000000000000000000000";

beforeEach(() => {
  resetRedeemLimitForTests();
  ipCounter = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.state.db = createFakeDb({
    companies: [
      { id: CO_A, name: "Casa A", kitchen_code: "ABC234" },
      { id: CO_B, name: "Casa B", kitchen_code: "XYZ789" },
    ],
    restaurant_locations: [
      { id: LOC_A, company_id: CO_A, name: "Centro", status: "active" },
      { id: LOC_B, company_id: CO_B, name: "Norte", status: "active" },
    ],
    company_memberships: [
      { company_id: CO_A, user_id: OWNER, role: "owner" },
      { company_id: CO_A, user_id: MANAGER, role: "manager" },
      { company_id: CO_A, user_id: VIEWER, role: "viewer" },
      { company_id: CO_B, user_id: OWNER_B, role: "owner" },
    ],
    kitchen_staff: [
      {
        id: STAFF_A,
        company_id: CO_A,
        location_id: LOC_A,
        display_name: "Luis Pérez",
        is_active: true,
        can_see_costs: false,
      },
      {
        id: STAFF_B,
        company_id: CO_B,
        location_id: LOC_B,
        display_name: "Luis Pérez",
        is_active: true,
        can_see_costs: false,
      },
    ],
    kitchen_staff_pins: [
      {
        staff_id: STAFF_A,
        company_id: CO_A,
        pin_hash: hashPin("2468"),
        must_change: false,
      },
      {
        staff_id: STAFF_B,
        company_id: CO_B,
        pin_hash: hashPin("1357"),
        must_change: false,
      },
    ],
    kitchen_devices: [
      {
        id: "55555555-5555-4555-8555-555555555551",
        company_id: CO_A,
        staff_id: STAFF_A,
        token_hash: hashToken(DEVICE_A),
        platform: "ios",
        device_label: "iPhone",
        last_seen_at: null,
        revoked_at: null,
      },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

const login = (body: Record<string, unknown>, ip?: string) =>
  pinLogin.POST(
    req("pin-login", "POST", null, { platform: "ios", ...body }, ip)
  );
const good = { code: "abc234", name: "luis perez", pin: "2468" };

describe("a 401 says why; trouble is not a 401", () => {
  it("an unknown token is 401 unknown_device", async () => {
    const res = await me.GET(req("me", "GET", "x".repeat(40)));
    expect(res.status).toBe(401);
    expect((await json(res)).reason).toBe("unknown_device");
  });
  it("a revoked phone is 401 revoked", async () => {
    h.state.db.tables.kitchen_devices[0].revoked_at = "2026-11-01T00:00:00Z";
    const res = await me.GET(req("me", "GET", DEVICE_A));
    expect(res.status).toBe(401);
    expect((await json(res)).reason).toBe("revoked");
  });
  it("a cook removed on the web is 401 revoked", async () => {
    h.state.db.tables.kitchen_staff[0].is_active = false;
    const res = await me.GET(req("me", "GET", DEVICE_A));
    expect(res.status).toBe(401);
    expect((await json(res)).reason).toBe("revoked");
  });
  it("a database error is 503 «unavailable», never 401", async () => {
    const real = h.state.db.client.from.bind(h.state.db.client);
    h.state.db.client.from = (table: string) => {
      if (table === "kitchen_devices")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: "boom" },
              }),
            }),
          }),
        };
      return real(table);
    };
    const res = await me.GET(req("me", "GET", DEVICE_A));
    expect(res.status).toBe(503);
    expect((await json(res)).reason).toBe("unavailable");
  });
  it("a valid token is never given an expiry and last_seen_at is updated", async () => {
    const before = h.state.db.tables.kitchen_devices[0].last_seen_at;
    expect(before).toBeNull();
    h.state.db.tables.kitchen_devices[0].created_at = "2020-01-01T00:00:00Z";
    const res = await me.GET(req("me", "GET", DEVICE_A));
    expect(res.status).toBe(200);
    expect(h.state.db.tables.kitchen_devices[0].last_seen_at).toBeTruthy();
    expect(
      await resolveKitchenDevice(h.state.db.client, DEVICE_A)
    ).not.toBeNull();
  });
});

describe("PIN is set at the first join", () => {
  async function invite() {
    const r = await createKitchenInvite(h.state.db.client, {
      companyId: CO_A,
      locationId: LOC_A,
      createdBy: OWNER,
    });
    if (!r.ok) throw new Error("invite");
    return r.secret;
  }
  it("stores the PIN hashed (never raw), returns the kitchen code and no hash", async () => {
    const secret = await invite();
    const res = await redeem.POST(
      req("redeem", "POST", null, { secret, name: "Ana Demo", pin: "8642" })
    );
    expect(res.status).toBe(201);
    const raw = await res.text();
    expect(raw).not.toContain("pin_hash");
    expect(raw).not.toContain("scrypt");
    const body = JSON.parse(raw);
    expect(body.pin).toEqual({ set: true, mustChange: false });
    expect(body.kitchenCode).toBe("ABC234");
    expect(() => assertNoMoneyFields(body)).not.toThrow();
    const stored = h.state.db.tables.kitchen_staff_pins.find(
      (p: any) => p.staff_id === body.staff.id
    );
    expect(stored.pin_hash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(h.state.db.writes)).not.toContain('"8642"');
  });
  it("a bad or weak PIN is refused BEFORE the invite is spent", async () => {
    const secret = await invite();
    for (const pin of ["12", "abcd", "1234"]) {
      const res = await redeem.POST(
        req("redeem", "POST", null, { secret, name: "Ana", pin })
      );
      expect(res.status).toBe(400);
    }
    const ok = await redeem.POST(
      req("redeem", "POST", null, { secret, name: "Ana", pin: "8642" })
    );
    expect(ok.status).toBe(201);
  });
  it("an older app without a PIN still joins; /me says pin.set = false", async () => {
    const secret = await invite();
    const res = await redeem.POST(
      req("redeem", "POST", null, { secret, name: "Ana" })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.pin.set).toBe(false);
    const mine = await me.GET(req("me", "GET", body.deviceToken));
    expect((await json(mine)).pin).toEqual({ set: false, mustChange: false });
  });
});

describe("PIN login", () => {
  it("name + code + PIN give a NEW token for the same cook; the old phone keeps working", async () => {
    const res = await login(good);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("pin_hash");
    const body = JSON.parse(raw);
    expect(body.staff.id).toBe(STAFF_A);
    expect(body.deviceToken).not.toBe(DEVICE_A);
    expect(h.state.db.tables.kitchen_devices).toHaveLength(2);
    expect((await me.GET(req("me", "GET", body.deviceToken))).status).toBe(200);
    expect((await me.GET(req("me", "GET", DEVICE_A))).status).toBe(200);
    expect(JSON.stringify(h.state.db.writes)).not.toContain(body.deviceToken);
  });
  it("a wrong code, wrong name, wrong PIN and a cook without a PIN all read the same", async () => {
    h.state.db.tables.kitchen_staff.push({
      id: "44444444-4444-4444-8444-444444444499",
      company_id: CO_A,
      location_id: LOC_A,
      display_name: "Sin Pin",
      is_active: true,
    });
    const cases = [
      { ...good, code: "ZZZZZZ" },
      { ...good, name: "Nadie" },
      { ...good, pin: "9999" },
      { code: "ABC234", name: "Sin Pin", pin: "2468" },
    ];
    const bodies: string[] = [];
    for (const c of cases) {
      const res = await login(c);
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });
  it("5 wrong tries lock the cook for 15 minutes, even with the right PIN", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login({ ...good, pin: "9999" })).status).toBe(401);
    }
    const locked = await login(good);
    expect(locked.status).toBe(429);
    const body = await json(locked);
    expect(body.reason).toBe("locked");
    expect(body.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(locked.headers.get("retry-after")).toBeTruthy();
  });
  it("an unknown name is locked the same way (the lock reveals nothing)", async () => {
    for (let i = 0; i < 5; i++) await login({ ...good, name: "Fantasma" });
    expect((await login({ ...good, name: "Fantasma" })).status).toBe(429);
  });
  it("a right PIN clears that cook's count", async () => {
    for (let i = 0; i < 4; i++) await login({ ...good, pin: "9999" });
    expect((await login(good)).status).toBe(200);
    // Counting restarted: 4 more wrong tries are still not a lock …
    for (let i = 0; i < 4; i++) await login({ ...good, pin: "9999" });
    expect((await login(good)).status).toBe(200);
  });
  it("one IP is locked after too many failures across different cooks", async () => {
    for (let i = 0; i < 20; i++) {
      await login({ ...good, name: `Otro ${i}`, pin: "9999" }, "9.9.9.9");
    }
    const res = await login(good, "9.9.9.9");
    expect(res.status).toBe(429);
    expect((await login(good, "8.8.8.8")).status).toBe(200);
  });
  it("is isolated by company: B's code never opens A's cook, and each PIN belongs to its company", async () => {
    // Same name in both companies; PINs differ.
    expect(
      (await login({ code: "XYZ789", name: "Luis Pérez", pin: "2468" })).status
    ).toBe(401);
    const b = await login({ code: "XYZ789", name: "Luis Pérez", pin: "1357" });
    expect(b.status).toBe(200);
    expect((await json(b)).staff.id).toBe(STAFF_B);
    expect(
      (await login({ code: "ABC234", name: "Luis Pérez", pin: "1357" })).status
    ).toBe(401);
  });
  it("a removed cook cannot sign in", async () => {
    h.state.db.tables.kitchen_staff[0].is_active = false;
    expect((await login(good)).status).toBe(401);
  });
  it("malformed input is the same plain failure", async () => {
    const res = await pinLogin.POST(
      req("pin-login", "POST", null, { code: "", name: "", pin: "x" })
    );
    expect(res.status).toBe(401);
  });
});

describe("change PIN", () => {
  it("needs the current PIN; a wrong one counts toward the lock", async () => {
    const wrong = await pinRoute.POST(
      req("pin", "POST", DEVICE_A, { pin: "8642", currentPin: "1111" })
    );
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).reason).toBe("wrong_pin");
    const ok = await pinRoute.POST(
      req("pin", "POST", DEVICE_A, { pin: "8642", currentPin: "2468" })
    );
    expect(ok.status).toBe(200);
    expect((await login({ ...good, pin: "8642" })).status).toBe(200);
    expect((await login(good)).status).toBe(401);
  });
  it("refuses a weak PIN", async () => {
    const res = await pinRoute.POST(
      req("pin", "POST", DEVICE_A, { pin: "1234", currentPin: "2468" })
    );
    expect(res.status).toBe(400);
  });
});

describe("managers", () => {
  it("reset to a temporary PIN: the cook signs in with it, must change it, then it is gone", async () => {
    const reset = await teamById.POST(
      req(`team/${STAFF_A}`, "POST", "manager-token", {
        action: "reset_pin",
        mode: "temporary",
      }),
      idp(STAFF_A)
    );
    expect(reset.status).toBe(200);
    const { temporaryPin } = await json(reset);
    expect(temporaryPin).toMatch(/^\d{6}$/);
    expect(JSON.stringify(h.state.db.writes)).not.toContain(
      `"${temporaryPin}"`
    );
    expect((await login(good)).status).toBe(401); // the old PIN is gone
    const res = await login({ ...good, pin: temporaryPin });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pin.mustChange).toBe(true);
    // forced change: no current PIN needed
    const change = await pinRoute.POST(
      req("pin", "POST", body.deviceToken, { pin: "8642" })
    );
    expect(change.status).toBe(200);
    expect(
      (await json(await login({ ...good, pin: "8642" }))).pin.mustChange
    ).toBe(false);
    expect((await login({ ...good, pin: temporaryPin })).status).toBe(401);
  });
  it("reset to «no PIN»: the signed-in phone stays signed in and can set one without a current PIN", async () => {
    const reset = await teamById.POST(
      req(`team/${STAFF_A}`, "POST", "owner-token", {
        action: "reset_pin",
        mode: "clear",
      }),
      idp(STAFF_A)
    );
    expect((await json(reset)).temporaryPin).toBeNull();
    expect((await me.GET(req("me", "GET", DEVICE_A))).status).toBe(200);
    expect((await json(await me.GET(req("me", "GET", DEVICE_A)))).pin.set).toBe(
      false
    );
    expect((await login(good)).status).toBe(401);
    const set = await pinRoute.POST(
      req("pin", "POST", DEVICE_A, { pin: "8642" })
    );
    expect(set.status).toBe(200);
  });
  it("a new link for an existing cook signs the SAME kitchen_staff row in (history kept)", async () => {
    const link = await teamById.POST(
      req(`team/${STAFF_A}`, "POST", "manager-token", { action: "new_link" }),
      idp(STAFF_A)
    );
    expect(link.status).toBe(201);
    const { inviteUrl } = await json(link);
    const secret = inviteUrl.split("/k/")[1];
    const staffBefore = h.state.db.tables.kitchen_staff.length;
    const res = await redeem.POST(
      req("redeem", "POST", null, { secret, name: "Otro Nombre" })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.staff.id).toBe(STAFF_A);
    expect(body.staff.name).toBe("Luis Pérez");
    expect(h.state.db.tables.kitchen_staff).toHaveLength(staffBefore);
    expect(body.pin.set).toBe(true); // the PIN the cook already had stays
  });
  it("sign out on one phone revokes only that phone: the next request is 401 revoked", async () => {
    const dev = h.state.db.tables.kitchen_devices[0].id;
    const res = await teamById.POST(
      req(`team/${STAFF_A}`, "POST", "manager-token", {
        action: "sign_out",
        deviceId: dev,
      }),
      idp(STAFF_A)
    );
    expect(res.status).toBe(200);
    const next = await me.GET(req("me", "GET", DEVICE_A));
    expect(next.status).toBe(401);
    expect((await json(next)).reason).toBe("revoked");
  });
  it("only owner, admin and manager; never another company", async () => {
    expect((await team.GET(req("team", "GET", "manager-token"))).status).toBe(
      200
    );
    expect((await team.GET(req("team", "GET", "owner-token"))).status).toBe(
      200
    );
    expect((await team.GET(req("team", "GET", "viewer-token"))).status).toBe(
      403
    );
    const viewer = await teamById.POST(
      req(`team/${STAFF_A}`, "POST", "viewer-token", { action: "reset_pin" }),
      idp(STAFF_A)
    );
    expect(viewer.status).toBe(403);
    // Company B's owner cannot touch company A's cook.
    for (const body of [
      { action: "reset_pin", mode: "temporary" },
      { action: "new_link" },
      { action: "sign_out" },
    ]) {
      const res = await teamById.POST(
        req(`team/${STAFF_A}`, "POST", "owner-b-token", body),
        idp(STAFF_A)
      );
      expect(res.status).toBe(404);
    }
    expect(h.state.db.tables.kitchen_devices[0].revoked_at ?? null).toBeNull();
    const list = await json(
      await team.GET(req("team", "GET", "owner-b-token"))
    );
    expect(list.team.map((m: any) => m.id)).toEqual([STAFF_B]);
    expect(JSON.stringify(list)).not.toMatch(/pin_hash|scrypt|token/i);
  });
});

describe("a manager switches to Cocina without a link", () => {
  const selfReq = (token: string, body: unknown = { platform: "ios" }) =>
    selfDevice.POST(req("self-device", "POST", token, body));

  it("creates the manager's OWN kitchen identity (linked by user_id) and a token that works", async () => {
    const memberships = JSON.stringify(h.state.db.tables.company_memberships);
    const res = await selfReq("manager-token");
    expect(res.status).toBe(201);
    const body = await json(res);
    const staff = h.state.db.tables.kitchen_staff.find(
      (s: any) => s.user_id === MANAGER
    );
    expect(staff).toMatchObject({
      company_id: CO_A,
      location_id: LOC_A,
      display_name: "Marta Demo",
      is_active: true,
    });
    expect(staff.telegram_user_id ?? null).toBeNull();
    expect(body.staff.id).toBe(staff.id);
    expect((await me.GET(req("me", "GET", body.deviceToken))).status).toBe(200);
    expect(JSON.stringify(h.state.db.tables.company_memberships)).toBe(
      memberships
    );
    expect(() => assertNoMoneyFields(body)).not.toThrow();
  });
  it("a second switch reuses the same identity (one per restaurant)", async () => {
    const a = await json(await selfReq("manager-token"));
    const b = await json(await selfReq("manager-token"));
    expect(b.staff.id).toBe(a.staff.id);
    expect(
      h.state.db.tables.kitchen_staff.filter((s: any) => s.user_id === MANAGER)
    ).toHaveLength(1);
    expect(b.deviceToken).not.toBe(a.deviceToken);
  });
  it("owners may; a viewer may not; an unknown restaurant is refused", async () => {
    expect((await selfReq("owner-token")).status).toBe(201);
    expect((await selfReq("viewer-token")).status).toBe(403);
    expect((await selfReq("manager-token", { locationId: LOC_B })).status).toBe(
      404
    );
  });
  it("signing the manager out of Cocina does not touch the manager's own session", async () => {
    const body = await json(await selfReq("manager-token"));
    const dev = h.state.db.tables.kitchen_devices.find(
      (d: any) => d.token_hash === hashToken(body.deviceToken)
    );
    await teamById.POST(
      req(`team/${body.staff.id}`, "POST", "owner-token", {
        action: "sign_out",
        deviceId: dev.id,
      }),
      idp(body.staff.id)
    );
    expect((await me.GET(req("me", "GET", body.deviceToken))).status).toBe(401);
    expect((await team.GET(req("team", "GET", "manager-token"))).status).toBe(
      200
    );
  });
});
