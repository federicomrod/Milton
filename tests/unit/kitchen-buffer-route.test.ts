// Only owner, admin and manager save the kitchen buffer: anyone else gets the
// localized «tu rol no puede…» 403 and nothing is written.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PreferredLanguage } from "@/lib/restaurant/language";

let lang: PreferredLanguage = "es";
let role: string | null = "member";
const saved: unknown[] = [];

vi.mock("@/lib/restaurant/api-lang", () => ({ apiLanguage: async () => lang }));
vi.mock("@/lib/restaurant/fixed-costs-auth", () => ({
  authorizeFixedCosts: async () => ({
    ok: true,
    supabase: {},
    companyId: "c1",
    userId: "u1",
    actor: { userId: "u1", companyId: "c1", role, isMiltonStaff: false },
  }),
}));
vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  resolveRestaurantContext: async (_s: unknown, _c: string, id: string) => ({
    selected: { locationId: id, brandId: null },
    locations: [],
  }),
}));
vi.mock("@/lib/restaurant/kitchen-buffer-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/restaurant/kitchen-buffer-server")>()),
  loadBusinessToday: async () => "2026-11-10",
  loadFirstDataDate: async () => "2026-09-15",
  saveKitchenBuffer: async (a: unknown) => {
    saved.push(a);
    return { ok: true, effectiveFrom: "2026-11-10" };
  },
}));

import { PUT } from "@/app/api/restaurant/kitchen-buffer/route";
import { es } from "@/lib/i18n/es";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";

const put = (
  body: Record<string, unknown> = {
    locationId: "loc-1",
    bufferPct: 8,
    scope: "today",
  }
) =>
  PUT(
    new NextRequest("http://localhost/api/restaurant/kitchen-buffer", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  lang = "es";
  role = "member";
  saved.length = 0;
});

describe("PUT /api/restaurant/kitchen-buffer", () => {
  it.each(["member", "viewer", "analyst", null])(
    "%s cannot save: 403 and nothing written",
    async (r) => {
      role = r;
      const res = await put();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(es.costs.buffer.roleDenied);
      expect(saved).toHaveLength(0);
    }
  );
  it.each(["owner", "admin", "manager"])("%s saves", async (r) => {
    role = r;
    const res = await put();
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
  });
  it.each([
    ["en", en.costs.buffer.roleDenied],
    ["de", de.costs.buffer.roleDenied],
  ] as const)("the refusal speaks %s", async (l, text) => {
    lang = l;
    const res = await put();
    expect((await res.json()).error).toBe(text);
  });
  it("a manager cannot send a value outside 0–30 or a bad scope", async () => {
    role = "manager";
    for (const body of [
      { locationId: "loc-1", bufferPct: 31, scope: "today" },
      { locationId: "loc-1", bufferPct: -1, scope: "today" },
      { locationId: "loc-1", bufferPct: 5, scope: "yesterday" },
      { bufferPct: 5, scope: "today" },
    ])
      expect((await put(body)).status).toBe(400);
    expect(saved).toHaveLength(0);
  });
});
