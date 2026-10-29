import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";

const CO = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER_JWT = "owner-token";
const BEARER_JWT_SECRET = "eyJhbGciOiJIUzI1NiJ9.super-secret-supabase-jwt";

const h = vi.hoisted(() => ({
  state: {
    db: null as any,
    explode: null as null | string,
    uploadBoom: null as null | string,
  },
}));

function adminClient() {
  if (h.state.explode) {
    const message = h.state.explode;
    return {
      from: () => {
        throw new Error(message);
      },
    };
  }
  const db = h.state.db.client;
  if (!h.state.uploadBoom) return db;
  const message = h.state.uploadBoom;
  return {
    from: (t: string) => db.from(t),
    storage: {
      from: () => ({
        upload: async () => {
          throw new Error(message);
        },
        remove: async () => ({ data: [], error: null }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClient(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const rls = Object.create(h.state.db.client);
    rls.auth = {
      getUser: async (jwt?: string) => {
        if (jwt === BEARER_JWT_SECRET) {
          throw new Error(`jwt exploded: ${jwt}`);
        }
        return jwt === MANAGER_JWT
          ? {
              data: { user: { id: OWNER, email: "owner@example.test" } },
              error: null,
            }
          : { data: { user: null }, error: { message: `bad jwt ${jwt}` } };
      },
    };
    return rls;
  },
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
import { POST as redeemPOST } from "@/app/api/mobile/v1/kitchen/redeem/route";
import { GET as meGET } from "@/app/api/mobile/v1/kitchen/me/route";
import { POST as mediaPOST } from "@/app/api/mobile/v1/kitchen/media/route";
import { POST as textPOST } from "@/app/api/mobile/v1/kitchen/text/route";
import { GET as historyGET } from "@/app/api/mobile/v1/kitchen/history/route";
import { POST as logoutPOST } from "@/app/api/mobile/v1/kitchen/logout/route";
import {
  POST as invitesPOST,
  GET as invitesGET,
} from "@/app/api/mobile/v1/kitchen/invites/route";
import { GET as meManagerGET } from "@/app/api/mobile/v1/me/route";
import { resetRedeemLimitForTests } from "@/lib/restaurant/kitchen/redeem-limit";

const spies = () => ({
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  info: vi.spyOn(console, "info").mockImplementation(() => {}),
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
  debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
});

let console_: ReturnType<typeof spies>;
function logged(): string {
  return Object.values(console_)
    .flatMap((s) => s.mock.calls)
    .map((args) =>
      args
        .map((a) =>
          a instanceof Error ? `${a.name}: ${a.message}` : String(a)
        )
        .join(" ")
    )
    .join("\n");
}
function loggedCount(): number {
  return Object.values(console_).reduce((n, s) => n + s.mock.calls.length, 0);
}

const call = (
  handler: (r: NextRequest) => Promise<Response>,
  path: string,
  method: string,
  token: string | null,
  body?: unknown
) =>
  handler(
    new NextRequest(`http://localhost/api/mobile/v1/${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );

function upload(token: string, ref: string) {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(32)], "a.jpg", { type: "image/jpeg" })
  );
  form.set("kind", "photo");
  form.set("clientRef", ref);
  return mediaPOST(
    new NextRequest("http://localhost/api/mobile/v1/kitchen/media", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })
  );
}

beforeEach(() => {
  resetRedeemLimitForTests();
  h.state.explode = null;
  h.state.uploadBoom = null;
  h.state.db = createFakeDb({
    companies: [{ id: CO, name: "Casa A" }],
    company_memberships: [{ company_id: CO, user_id: OWNER, role: "owner" }],
    restaurant_locations: [
      { id: LOC, company_id: CO, name: "Centro", status: "active" },
    ],
  });
  console_ = spies();
});
afterEach(() => vi.restoreAllMocks());

describe("nothing secret is ever logged", () => {
  it("across the whole invite -> redeem -> use -> logout life, including failures", async () => {
    // Owner creates an invite.
    const created = await (
      await call(invitesPOST, "kitchen/invites", "POST", MANAGER_JWT, {
        locationId: LOC,
      })
    ).json();
    const inviteSecret = created.inviteUrl.split("/k/")[1];
    await call(invitesGET, "kitchen/invites", "GET", MANAGER_JWT);

    // Cook redeems; a second try, and a wrong secret, fail.
    const redeemed = await (
      await call(redeemPOST, "kitchen/redeem", "POST", null, {
        secret: inviteSecret,
        name: "Luis",
      })
    ).json();
    const deviceToken = redeemed.deviceToken;
    await call(redeemPOST, "kitchen/redeem", "POST", null, {
      secret: inviteSecret,
      name: "Luis",
    });
    await call(redeemPOST, "kitchen/redeem", "POST", null, {
      secret: "wrong-secret-value",
      name: "X",
    });

    // Uses the API, with good and bad tokens.
    await call(meGET, "kitchen/me", "GET", deviceToken);
    await call(
      meGET,
      "kitchen/me",
      "GET",
      "not-a-real-device-token-0000000000"
    );
    await call(textPOST, "kitchen/text", "POST", deviceToken, {
      text: "hola",
      clientRef: "client-ref-t1",
    });
    await call(historyGET, "kitchen/history", "GET", deviceToken);
    expect((await upload(deviceToken, "client-ref-m1")).status).toBe(201);

    // Failures that carry the token inside the error message.
    h.state.explode = `db exploded for ${deviceToken} and ${inviteSecret}`;
    await call(meGET, "kitchen/me", "GET", deviceToken);
    await call(redeemPOST, "kitchen/redeem", "POST", null, {
      secret: inviteSecret,
      name: "Luis",
    });
    await call(invitesPOST, "kitchen/invites", "POST", MANAGER_JWT, {
      locationId: LOC,
    });
    h.state.explode = null;

    h.state.uploadBoom = `storage exploded for ${deviceToken}`;
    expect((await upload(deviceToken, "client-ref-m2")).status).toBe(502);
    h.state.uploadBoom = null;

    // Manager bearer that blows up inside the auth client.
    await call(meManagerGET, "me", "GET", BEARER_JWT_SECRET);
    await call(meManagerGET, "me", "GET", "garbage-jwt-value");

    expect(
      (await call(logoutPOST, "kitchen/logout", "POST", deviceToken)).status
    ).toBe(200);
    await call(meGET, "kitchen/me", "GET", deviceToken);

    const text = logged();
    // The error paths really did log something (static text / error names)...
    expect(loggedCount()).toBeGreaterThan(0);
    // ...and none of it contains a token, a hash, or an Authorization value.
    for (const secret of [
      inviteSecret,
      deviceToken,
      hashToken(inviteSecret),
      hashToken(deviceToken),
      MANAGER_JWT,
      BEARER_JWT_SECRET,
      "garbage-jwt-value",
      "wrong-secret-value",
      "not-a-real-device-token",
      "Bearer",
      "authorization",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/[0-9a-f]{64}/);
    expect(text).not.toMatch(/https?:\/\/\S*\/k\//);
    expect(text).not.toContain("signed.example");
  });
});
