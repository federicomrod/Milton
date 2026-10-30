import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "22222222-2222-4222-8222-222222222222";
const LOC_A = "33333333-3333-4333-8333-333333333333";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const TOKENS: Record<string, string> = {
  "owner-token": OWNER,
  "manager-token": MANAGER,
  "other-token": OTHER,
};

const h = vi.hoisted(() => ({
  state: { db: null as any },
  createClientCalls: [] as unknown[][],
  adminCalls: { n: 0 },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async (...args: unknown[]) => {
    h.createClientCalls.push(args);
    const token = args[1] as string | undefined;
    const rls = Object.create(h.state.db.client);
    rls.auth = {
      getUser: async (jwt?: string) => {
        const id = TOKENS[jwt ?? ""];
        return id
          ? { data: { user: { id, email: `${id}@example.test` } }, error: null }
          : { data: { user: null }, error: { message: "bad jwt" } };
      },
    };
    rls.__token = token;
    return rls;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.adminCalls.n++;
    return h.state.db.client;
  },
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: vi.fn(),
  getCachedCompanyId: vi.fn(),
}));
vi.mock("@/lib/restaurant/supabase-sales", () => ({
  resolveCompanyIdForUser: async (_s: unknown, userId: string) =>
    (h.state.db.tables.company_memberships as any[]).find(
      (m) => m.user_id === userId
    )?.company_id ?? null,
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));

import {
  authAndCompanyFromBearer,
  authUserFromBearer,
  readBearerToken,
} from "@/lib/restaurant/api-auth";
import { GET as meGET } from "@/app/api/mobile/v1/me/route";
import { POST as invitesPOST } from "@/app/api/mobile/v1/kitchen/invites/route";

const req = (
  path: string,
  token?: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {}
) =>
  new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string>),
    },
  });

beforeEach(() => {
  h.createClientCalls.length = 0;
  h.adminCalls.n = 0;
  h.state.db = createFakeDb({
    companies: [
      { id: CO_A, name: "Casa A" },
      { id: CO_B, name: "Casa B" },
    ],
    company_memberships: [
      { company_id: CO_A, user_id: OWNER, role: "owner" },
      { company_id: CO_A, user_id: MANAGER, role: "manager" },
      { company_id: CO_B, user_id: OTHER, role: "owner" },
    ],
    restaurant_locations: [
      { id: LOC_A, company_id: CO_A, name: "Centro", status: "active" },
    ],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readBearerToken", () => {
  it("reads only a well-formed Bearer header", () => {
    expect(readBearerToken(req("/x", "abc"))).toBe("abc");
    expect(readBearerToken(req("/x"))).toBeNull();
    expect(
      readBearerToken(
        req("/x", undefined, { headers: { authorization: "Basic abc" } })
      )
    ).toBeNull();
    expect(
      readBearerToken(
        req("/x", undefined, { headers: { authorization: "Bearer" } })
      )
    ).toBeNull();
  });
});

describe("authUserFromBearer", () => {
  it("missing bearer -> 401 in the usual shape, no client built", async () => {
    const r = await authUserFromBearer(req("/x"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(401);
    expect(await r.response.json()).toEqual({
      error: "Inicia sesión de nuevo.",
    });
    expect(r.response.headers.get("cache-control")).toBe("no-store");
    expect(h.createClientCalls).toHaveLength(0);
  });

  it("invalid token -> 401", async () => {
    const r = await authUserFromBearer(req("/x", "garbage"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("valid token builds the client WITH that token (RLS path), never the admin client", async () => {
    const r = await authUserFromBearer(req("/x", "owner-token"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.userId).toBe(OWNER);
    expect(h.createClientCalls).toHaveLength(1);
    expect(h.createClientCalls[0][0]).toBeUndefined();
    expect(h.createClientCalls[0][1]).toBe("owner-token");
    expect((r.supabase as any).__token).toBe("owner-token");
    expect(h.adminCalls.n).toBe(0);
  });
});

describe("authAndCompanyFromBearer", () => {
  it("resolves the user's own company without a requested one", async () => {
    const r = await authAndCompanyFromBearer(req("/x", "owner-token"));
    expect(r.ok && r.companyId).toBe(CO_A);
  });

  it("a client-sent companyId of another company -> 403", async () => {
    for (const r of [
      await authAndCompanyFromBearer(
        req(`/x?companyId=${CO_B}`, "owner-token")
      ),
      await authAndCompanyFromBearer(
        req("/x", "owner-token", { headers: { "x-company-id": CO_B } })
      ),
      await authAndCompanyFromBearer(req("/x", "owner-token"), {
        companyId: CO_B,
      }),
    ]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(403);
    }
  });

  it("accepts a requested company only when it is a membership", async () => {
    const r = await authAndCompanyFromBearer(
      req(`/x?companyId=${CO_A}`, "owner-token")
    );
    expect(r.ok && r.companyId).toBe(CO_A);
  });

  it("rejects a malformed companyId with 400", async () => {
    const r = await authAndCompanyFromBearer(
      req("/x?companyId=not-a-uuid", "owner-token")
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("no token -> 401 and no database read", async () => {
    const r = await authAndCompanyFromBearer(req("/x"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
});

describe("GET /api/mobile/v1/me", () => {
  it("401 without a valid bearer", async () => {
    expect((await meGET(req("/api/mobile/v1/me"))).status).toBe(401);
    expect((await meGET(req("/api/mobile/v1/me", "garbage"))).status).toBe(401);
  });

  it("a manager only sees their own companies and role", async () => {
    const res = await meGET(req("/api/mobile/v1/me", "manager-token"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.user.id).toBe(MANAGER);
    expect(body.companies.map((c: any) => c.id)).toEqual([CO_A]);
    expect(body.companies[0]).toMatchObject({
      name: "Casa A",
      role: "manager",
    });
    expect(body.companies[0].capabilities).toContain("prices.edit");
    expect(body.companies[0].capabilities).not.toContain("kitchen.qr");
    expect(JSON.stringify(body)).not.toContain("Casa B");
  });

  it("an owner gets the kitchen.qr capability", async () => {
    const body = await (
      await meGET(req("/api/mobile/v1/me", "owner-token"))
    ).json();
    expect(body.companies[0].capabilities).toContain("kitchen.qr");
  });
});

describe("POST /api/mobile/v1/kitchen/invites is owner only", () => {
  const post = (token: string | undefined, body: unknown) =>
    invitesPOST(
      req("/api/mobile/v1/kitchen/invites", token, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      })
    );

  it("a manager who is not an owner gets 403 and nothing is created", async () => {
    const res = await post("manager-token", { locationId: LOC_A });
    expect(res.status).toBe(403);
    expect(h.state.db.tables.kitchen_invites ?? []).toHaveLength(0);
  });

  it("an owner of ANOTHER company cannot invite into this one", async () => {
    const res = await invitesPOST(
      req(`/api/mobile/v1/kitchen/invites?companyId=${CO_A}`, "other-token", {
        method: "POST",
        body: JSON.stringify({ locationId: LOC_A }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(403);
    expect(h.state.db.tables.kitchen_invites ?? []).toHaveLength(0);
  });

  it("an owner gets an invite URL on the request origin; only the hash is stored", async () => {
    const res = await post("owner-token", {
      locationId: LOC_A,
      inviteeName: "Marta",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.inviteUrl).toMatch(
      /^http:\/\/localhost\/k\/[A-Za-z0-9_-]{43}$/
    );
    expect(Object.keys(body).sort()).toEqual([
      "expiresAt",
      "inviteId",
      "inviteUrl",
    ]);
    const secret = body.inviteUrl.split("/k/")[1];
    const row = h.state.db.tables.kitchen_invites[0];
    expect(row.created_by).toBe(OWNER);
    expect(row.company_id).toBe(CO_A);
    expect(JSON.stringify(h.state.db.writes)).not.toContain(secret);
  });

  it("rejects a missing or malformed locationId, and a location of another company", async () => {
    expect((await post("owner-token", {})).status).toBe(400);
    expect(
      (
        await post("owner-token", {
          locationId: "22222222-2222-4222-8222-aaaaaaaaaaaa",
        })
      ).status
    ).toBe(404);
  });
});
