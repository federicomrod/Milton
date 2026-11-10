// Rentabilidad + Costos fijos (#403): only owner, admin and manager (and
// Milton staff) get in. Analyst, viewer and every other role: 403 on the fixed
// costs API and a redirect away from the page — checked on the server.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { can, CAPABILITIES, type Actor } from "@/lib/auth/capabilities";

let role: string | null = "owner";
let isMiltonStaff = false;
const loads: string[] = [];
const reasonsStub = { foodCost: { pct: null } };

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
  listFixedCosts: async () => [],
}));
vi.mock("@/lib/restaurant/fixed-cost-commands", () => ({
  saveTotals: async () => {
    loads.push("save");
    return { ok: true, value: { status: "applied", changed: [] } };
  },
}));
// Mobile manager routes: a synthetic bearer sign-in, the role from `role`, and
// the heavy builders replaced so only the gate is under test.
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompanyFromBearer: async () => ({
    ok: true,
    supabase: {},
    companyId: "c1",
    userId: "u1",
    email: "demo@example.test",
  }),
}));
vi.mock("@/lib/auth/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/permissions")>()),
  resolveActor: async () => ({
    userId: "u1",
    companyId: "c1",
    role,
    isMiltonStaff,
  }),
}));
vi.mock("@/lib/restaurant/mobile-manager/home", () => ({
  buildHome: async () => {
    loads.push("home");
    return {};
  },
}));
vi.mock("@/lib/restaurant/mobile-manager/sales", () => ({
  parseVentasPeriod: () => "week",
  buildVentas: async () => {
    loads.push("ventas");
    return {};
  },
}));
vi.mock("@/lib/restaurant/mobile-manager/rentabilidad", () => ({
  parseMonth: () => null,
  buildRentabilidad: async () => {
    loads.push("rentabilidad");
    return { month: "2026-10-01", hasData: false, reasons: reasonsStub };
  },
  // The current month's route leads with the latest month that has data.
  buildRentabilidadWithLatest: async () => {
    loads.push("rentabilidad");
    return {
      month: "2026-10-01",
      hasData: false,
      reasons: reasonsStub,
      latest: null,
    };
  },
}));
vi.mock("@/lib/restaurant/mobile-manager/costos", () => ({
  loadPendingInvoices: async () => {
    loads.push("costos");
    return { invoices: [] };
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

import { GET, PUT } from "@/app/api/restaurant/fixed-costs/route";
import { GET as homeGET } from "@/app/api/mobile/v1/home/route";
import { GET as ventasGET } from "@/app/api/mobile/v1/ventas/route";
import { GET as rentabilidadGET } from "@/app/api/mobile/v1/rentabilidad/route";
import { GET as costosGET } from "@/app/api/mobile/v1/costos/route";
import RentabilidadRoute from "@/app/dashboard/restaurant/rentabilidad/page";

const get = () =>
  GET(
    new NextRequest(
      "http://localhost/api/restaurant/fixed-costs?month=2026-10&location=l1"
    )
  );
const put = () =>
  PUT(
    new NextRequest("http://localhost/api/restaurant/fixed-costs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        month: "2026-10-01",
        commandKey: "11111111-1111-4111-8111-111111111111",
        entries: [{ category: "alquiler", value: 1200, expectedVersion: 0 }],
      }),
    })
  );
const mobile = (path: string) =>
  new NextRequest(`http://localhost/api/mobile/v1/${path}`, {
    headers: { authorization: "Bearer synthetic-test-token" },
  });
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

describe("PUT /api/restaurant/fixed-costs", () => {
  it.each(["analyst", "viewer", "member", "intern", null])(
    "%s -> 403 and nothing is written",
    async (r) => {
      role = r;
      expect((await put()).status).toBe(403);
      expect(loads).toEqual([]);
    }
  );
  it.each(["owner", "admin", "manager"])("%s -> 200", async (r) => {
    role = r;
    expect((await put()).status).toBe(200);
    expect(loads).toEqual(["save"]);
  });
});

const MOBILE_ROUTES = [
  ["home", "home", () => homeGET(mobile("home"))],
  ["ventas", "ventas", () => ventasGET(mobile("ventas?period=week"))],
  [
    "rentabilidad",
    "rentabilidad",
    () => rentabilidadGET(mobile("rentabilidad?location=l1")),
  ],
  ["costos", "costos", () => costosGET(mobile("costos"))],
] as const;

describe.each(MOBILE_ROUTES)("GET /api/mobile/v1/%s", (_n, marker, call) => {
  it.each(["analyst", "viewer", "member", "intern", null])(
    "%s -> 403 and nothing is loaded",
    async (r) => {
      role = r;
      expect((await call()).status).toBe(403);
      expect(loads).not.toContain(marker);
    }
  );
  it.each(["owner", "admin", "manager"])("%s -> 200", async (r) => {
    role = r;
    expect((await call()).status).toBe(200);
    expect(loads).toContain(marker);
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
