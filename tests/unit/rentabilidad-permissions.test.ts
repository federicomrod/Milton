// Rentabilidad + Costos fijos (#403): only owner, admin and manager (and
// Milton staff) get in. Analyst, viewer and every other role: 403 on the fixed
// costs API and a redirect away from the page — checked on the server.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { can, CAPABILITIES, type Actor } from "@/lib/auth/capabilities";

let role: string | null = "owner";
let isMiltonStaff = false;
const loads: string[] = [];

vi.mock("@/lib/restaurant/api-lang", () => ({
  apiLanguage: async () => "es",
  apiDictionary: async () => (await import("@/lib/i18n")).getDictionary("es"),
}));
vi.mock("@/lib/restaurant/fixed-costs-auth", () => ({
  authorizeFixedCosts: async () => ({
    ok: true,
    supabase: {},
    companyId: "c1",
    userId: "u1",
    actor: { userId: "u1", companyId: "c1", role, isMiltonStaff },
  }),
}));
vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  resolveRestaurantContext: async () => ({
    selected: { locationId: "l1", brandId: null },
    locations: [{ id: "l1", name: "Demo Centro" }],
  }),
}));
vi.mock("@/lib/restaurant/fixed-costs-server", () => ({
  loadFixedCostsView: async () => {
    loads.push("view");
    return { lines: [] };
  },
}));
vi.mock("@/lib/restaurant/rentabilidad-server", () => ({
  loadMonthMargin: async () => ({ ok: false, reason: "x" }),
  loadRentabilidadPages: async () => {
    loads.push("pages");
    return {};
  },
  loadRentabilidadGroups: async () => {
    loads.push("groups");
    return {};
  },
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: "u1" }),
  getCachedCompanyId: async () => "c1",
  getCachedActor: async () => ({
    userId: "u1",
    companyId: "c1",
    role,
    isMiltonStaff,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/components/restaurant/shell/OperatingPageHeader", () => ({
  OperatingPageHeader: () => null,
}));

import { GET } from "@/app/api/restaurant/fixed-costs/route";
import RentabilidadRoute from "@/app/dashboard/restaurant/rentabilidad/page";

const get = () =>
  GET(
    new NextRequest(
      "http://localhost/api/restaurant/fixed-costs?month=2026-10&location=l1"
    )
  );
const actor = (r: string | null, staff = false): Actor => ({
  userId: "u",
  companyId: "c",
  role: r,
  isMiltonStaff: staff,
});

beforeEach(() => {
  role = "owner";
  isMiltonStaff = false;
  loads.length = 0;
});

describe("the costs.fixed capability", () => {
  it("is granted to owner, admin and manager only", () => {
    expect([...CAPABILITIES["costs.fixed"]].sort()).toEqual([
      "admin",
      "manager",
      "owner",
    ]);
    for (const r of ["analyst", "viewer", "member", "intern", null])
      expect(can(actor(r), "costs.fixed")).toBe(false);
  });
  it("Milton staff keep the access their role gives", () => {
    expect(can(actor(null, true), "costs.fixed")).toBe(true);
  });
});

describe("GET /api/restaurant/fixed-costs", () => {
  it.each(["analyst", "viewer", "member", "intern", null])(
    "%s -> 403 and nothing is read",
    async (r) => {
      role = r;
      const res = await get();
      expect(res.status).toBe(403);
      expect(loads).toEqual([]);
    }
  );
  it.each(["owner", "admin", "manager"])("%s -> 200", async (r) => {
    role = r;
    expect((await get()).status).toBe(200);
  });
});

describe("the Rentabilidad page", () => {
  const open = () =>
    RentabilidadRoute({
      searchParams: Promise.resolve({ location: "l1" }),
    });

  it.each(["analyst", "viewer", "member", null])(
    "%s is redirected away, nothing is loaded",
    async (r) => {
      role = r;
      await expect(open()).rejects.toThrow("REDIRECT:/dashboard/restaurant");
      expect(loads).toEqual([]);
    }
  );
  it.each(["owner", "admin", "manager"])("%s sees it", async (r) => {
    role = r;
    await open();
    expect(loads).toEqual(["pages"]);
  });
});
