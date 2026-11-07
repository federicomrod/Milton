// Fixed costs: only owner, admin and manager write. A member who gets past the
// app (or a database that refuses the write, migration 073) sees the usual
// «tu rol no puede…» message in es, en and de — never a raw database error.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PreferredLanguage } from "@/lib/restaurant/language";

let lang: PreferredLanguage = "es";
let role: string | null = "member";
let dbWrite: { error: { code?: string; message: string } | null } = {
  error: null,
};
const writes: string[] = [];

vi.mock("@/lib/restaurant/api-lang", () => ({
  apiLanguage: async () => lang,
}));
vi.mock("@/lib/restaurant/fixed-costs-auth", () => ({
  authorizeFixedCosts: async () => ({
    ok: true,
    supabase: stub(),
    companyId: "c1",
    userId: "u1",
    actor: { userId: "u1", companyId: "c1", role, isMiltonStaff: false },
  }),
}));
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));
vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  resolveRestaurantContext: async () => ({ selected: null, locations: [] }),
}));

/** A chainable Supabase stand-in: reads are empty; a write returns `dbWrite`. */
function stub() {
  return { from: () => chainFor() };
}

function chainFor() {
  let mode: "read" | "write" = "read";
  const chain: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) =>
          resolve(
            mode === "write"
              ? {
                  data: dbWrite.error ? null : { id: "x" },
                  error: dbWrite.error,
                }
              : { data: [], error: null }
          );
      }
      if (prop === "insert" || prop === "update" || prop === "delete") {
        return (payload?: unknown) => {
          mode = "write";
          writes.push(String(prop) + ":" + JSON.stringify(payload ?? null));
          return chain;
        };
      }
      return () => chain;
    },
  });
  return chain;
}

import { PUT } from "@/app/api/restaurant/fixed-costs/route";
import { es } from "@/lib/i18n/es";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";

const put = (value: number | null = 1200) =>
  PUT(
    new NextRequest("http://localhost/api/restaurant/fixed-costs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: "2026-10-01",
        entries: [{ category: "alquiler", value }],
      }),
    })
  );

beforeEach(() => {
  lang = "es";
  role = "member";
  dbWrite = { error: null };
  writes.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the app refuses a member before any write, in every language", () => {
  it.each([
    ["es", es.costs.fixed.roleDenied],
    ["en", en.costs.fixed.roleDenied],
    ["de", de.costs.fixed.roleDenied],
  ] as const)("%s", async (l, message) => {
    lang = l;
    for (const r of ["member", "viewer", "analyst", null]) {
      role = r;
      const res = await put();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(message);
    }
    expect(writes).toEqual([]);
  });
});

describe("owner, admin and manager write", () => {
  it.each(["owner", "admin", "manager"])("%s", async (r) => {
    role = r;
    const res = await put();
    expect(res.status).toBe(200);
    expect(writes.some((w) => w.startsWith("insert:"))).toBe(true);
  });
});

describe("a database that refuses the write (row-level security) is a 403 with the usual message", () => {
  it.each([
    ["es", es.costs.fixed.roleDenied],
    ["en", en.costs.fixed.roleDenied],
    ["de", de.costs.fixed.roleDenied],
  ] as const)("%s", async (l, message) => {
    lang = l;
    role = "manager"; // passes the app, the database says no
    dbWrite = {
      error: {
        code: "42501",
        message:
          'new row violates row-level security policy for table "restaurant_fixed_costs"',
      },
    };
    const res = await put();
    expect(res.status).toBe(403);
    const body = JSON.stringify(await res.json());
    expect(body).toContain(message);
    expect(body).not.toMatch(/row-level security|violates|42501/);
  });

  it("another database error keeps its own path (not a 403)", async () => {
    role = "owner";
    dbWrite = { error: { code: "23514", message: "check constraint" } };
    const res = await put();
    expect(res.status).toBe(400);
  });
});
