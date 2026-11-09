import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  auth: null as any,
  adminCalls: [] as unknown[],
  upserts: [] as any[],
  updates: [] as any[],
  deletes: [] as any[],
}));

vi.mock("@/lib/restaurant/mobile-manager/auth", () => ({
  authManager: vi.fn(async () => h.auth),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      delete: () => ({
        eq: (c: string, v: string) => ({
          neq: async (c2: string, v2: string) => (
            h.adminCalls.push([c, v, c2, v2]),
            { error: null }
          ),
        }),
      }),
    }),
  }),
}));

import {
  PUT as register,
  DELETE as unregister,
} from "@/app/api/mobile/v1/push/register/route";
import {
  GET as getPrefs,
  PUT as putPrefs,
} from "@/app/api/mobile/v1/push/preferences/route";

const TOKEN = "ExponentPushToken[abc123]";
const req = (
  method: string,
  body?: unknown,
  url = "http://localhost/api/mobile/v1/push/register"
) =>
  new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  h.adminCalls = [];
  h.upserts = [];
  h.updates = [];
  h.deletes = [];
  const row = {
    timezone: "UTC",
    daily_enabled: false,
    critical_enabled: true,
    daily_hour: 8,
    quiet_start: 22,
    quiet_end: 7,
  };
  h.auth = {
    ok: true,
    companyId: "co",
    userId: "u1",
    lang: "es",
    supabase: {
      from: () => ({
        upsert: async (p: unknown) => (h.upserts.push(p), { error: null }),
        delete: () => ({
          eq: () => ({ eq: async () => (h.deletes.push(1), { error: null }) }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        }),
        update: (p: unknown) => (
          h.updates.push(p),
          {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: { ...row, ...(p as object) },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        ),
      }),
    },
  };
});

describe("push routes", () => {
  it("every route returns the auth failure as is (kitchen token 401, other roles 403)", async () => {
    h.auth = { ok: false, response: NextResponse.json({}, { status: 403 }) };
    const calls = [
      register(req("PUT", { token: TOKEN })),
      unregister(req("DELETE", { token: TOKEN })),
      getPrefs(req("GET", undefined, "http://localhost/x?token=" + TOKEN)),
      putPrefs(req("PUT", { token: TOKEN, dailyEnabled: true })),
    ];
    for (const r of await Promise.all(calls)) expect(r.status).toBe(403);
    expect(h.upserts).toHaveLength(0);
  });

  it("registers the signed-in manager's phone, scoped to their company, and takes the token from a previous user", async () => {
    const res = await register(
      req("PUT", {
        token: TOKEN,
        platform: "ios",
        timezone: "America/Mexico_City",
        dailyHour: 9,
      })
    );
    expect(res.status).toBe(200);
    expect(h.adminCalls).toEqual([["expo_token", TOKEN, "user_id", "u1"]]);
    expect(h.upserts[0]).toMatchObject({
      company_id: "co",
      user_id: "u1",
      expo_token: TOKEN,
      platform: "ios",
      daily_hour: 9,
      disabled_at: null,
    });
  });

  it("refuses a bad token, platform, timezone or hour without saving anything", async () => {
    const good = { token: TOKEN, platform: "ios", timezone: "UTC" };
    for (const bad of [
      { ...good, token: "nope" },
      { ...good, platform: "windows" },
      { ...good, timezone: "Mars/Base" },
      { ...good, quietStart: 30 },
    ]) {
      expect((await register(req("PUT", bad))).status).toBe(400);
    }
    expect((await register(req("PUT"))).status).toBe(400);
    expect(h.upserts).toHaveLength(0);
  });

  it("a client cannot pick another user or company", async () => {
    await register(
      req("PUT", {
        token: TOKEN,
        platform: "ios",
        timezone: "UTC",
        user_id: "evil",
        company_id: "evil",
      })
    );
    expect(h.upserts[0]).toMatchObject({ user_id: "u1", company_id: "co" });
  });

  it("unregisters this phone only", async () => {
    expect((await unregister(req("DELETE", { token: TOKEN }))).status).toBe(
      200
    );
    expect(h.deletes).toHaveLength(1);
    expect((await unregister(req("DELETE", { token: "x" }))).status).toBe(400);
  });

  it("reads and changes the choices; defaults when the phone is unknown", async () => {
    const got = await (
      await getPrefs(req("GET", undefined, "http://localhost/x?token=" + TOKEN))
    ).json();
    expect(got).toMatchObject({
      registered: true,
      dailyEnabled: false,
      criticalEnabled: true,
      dailyHour: 8,
    });
    const unknown = await (
      await getPrefs(req("GET", undefined, "http://localhost/x"))
    ).json();
    expect(unknown).toMatchObject({
      registered: false,
      dailyEnabled: true,
      quietStart: 22,
      quietEnd: 7,
    });
    const put = await putPrefs(
      req("PUT", { token: TOKEN, criticalEnabled: false, quietStart: 21 })
    );
    expect(put.status).toBe(200);
    expect(h.updates[0]).toMatchObject({
      critical_enabled: false,
      quiet_start: 21,
    });
    expect((await putPrefs(req("PUT", { token: TOKEN }))).status).toBe(400);
    expect(
      (await putPrefs(req("PUT", { token: TOKEN, quietEnd: 99 }))).status
    ).toBe(400);
  });
});
