// The manager side of the app (mobile P1, #432): /api/mobile/v1 home, ventas,
// rentabilidad, costos, invoice approve / reject and the sign-in routes.
// Real route + lib code over an in-memory database; only the heavy web loaders
// (the POS cube, dish economics, rentabilidad) are stand-ins so the numbers can
// be compared with what the web libs compute for the same input.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";
import { buildBusinessDayConfig } from "@/lib/restaurant/business-day";
import { buildDetailCube } from "@/lib/restaurant/sales-detail-cube";
import {
  computeDetail,
  prepareCube,
  DEFAULT_STATE,
} from "@/lib/restaurant/sales-detail";
import { addDays } from "@/lib/restaurant/cockpit-math";

const CO = "11111111-1111-4111-8111-111111111111";
const CO_B = "99999999-9999-4999-8999-999999999999";
const LOC1 = "33333333-3333-4333-8333-333333333331";
const LOC2 = "33333333-3333-4333-8333-333333333332";
const LOC_B = "33333333-3333-4333-8333-3333333333bb";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANALYST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INV_OK = "44444444-4444-4444-8444-444444444441";
const INV_BAD = "44444444-4444-4444-8444-444444444442";
const INV_DONE = "44444444-4444-4444-8444-444444444443";
const ING = "55555555-5555-4555-8555-555555555555";
const KITCHEN_DEVICE_TOKEN = "kitchen-device-token-0000000000000000000000";

const TOKENS: Record<string, string> = {
  "owner-token": OWNER,
  "manager-token": MANAGER,
  "analyst-token": ANALYST,
  "member-token": MEMBER,
};

const h = vi.hoisted(() => ({
  state: {
    db: null as any,
    salesPayload: null as any,
    rentabilidad: null as any,
  },
  signIn: vi.fn(),
  refresh: vi.fn(),
  rentabilidadCalls: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const rls = Object.create(h.state.db.client);
    rls.auth = {
      getUser: async (jwt?: string) => {
        const id = TOKENS[jwt ?? ""];
        return id
          ? { data: { user: { id, email: `${id}@example.test` } }, error: null }
          : { data: { user: null }, error: { message: "bad jwt" } };
      },
    };
    return rls;
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (...a: unknown[]) => h.signIn(...a),
      refreshSession: (...a: unknown[]) => h.refresh(...a),
    },
  }),
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
    (h.state.db.tables.company_memberships as any[]).find(
      (m) => m.user_id === userId
    )?.company_id ?? null,
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));
vi.mock("@/lib/restaurant/sales-detail-server", () => ({
  loadSalesDetailCached: async (
    _s: unknown,
    _c: string,
    loc: string | null
  ) => ({
    ...h.state.salesPayload(),
    locationId: loc,
  }),
}));
vi.mock("@/lib/restaurant/costing/dish-economics-server", () => ({
  loadDishCostContextWith: async () => ({ ok: true, context: {} }),
  loadDishEconomicsWith: async () => ({
    ok: true,
    result: {
      menu_dishes: [
        { name: "Pupusa", units: 30, net_sales: 90, excluded_reason: null },
        {
          name: "Cerveza",
          units: 50,
          net_sales: 150,
          excluded_reason: "bebida",
        },
        { name: "Tamal", units: 10, net_sales: 40, excluded_reason: null },
        { name: "Sin ventas", units: 0, net_sales: 0, excluded_reason: null },
      ],
    },
  }),
}));
vi.mock("@/lib/restaurant/rentabilidad-server", () => ({
  loadRentabilidadPage: async (args: unknown) => {
    h.rentabilidadCalls.push(args);
    return h.state.rentabilidad();
  },
}));

import { GET as homeGET } from "@/app/api/mobile/v1/home/route";
import { GET as ventasGET } from "@/app/api/mobile/v1/ventas/route";
import { GET as rentabilidadGET } from "@/app/api/mobile/v1/rentabilidad/route";
import { GET as locationsGET } from "@/app/api/mobile/v1/locations/route";
import { GET as costosGET } from "@/app/api/mobile/v1/costos/route";
import { POST as approvePOST } from "@/app/api/mobile/v1/invoices/[id]/approve/route";
import { POST as rejectPOST } from "@/app/api/mobile/v1/invoices/[id]/reject/route";
import { POST as loginPOST } from "@/app/api/mobile/v1/auth/login/route";
import { POST as refreshPOST } from "@/app/api/mobile/v1/auth/refresh/route";
import { GET as meGET } from "@/app/api/mobile/v1/me/route";
import { POST as inviteCreatePOST } from "@/app/api/mobile/v1/kitchen/invites/route";
import { shapeRentabilidad } from "@/lib/restaurant/mobile-manager/rentabilidad";
import { findingText } from "@/lib/restaurant/rentabilidad-copy";
import { formatMoney } from "@/lib/restaurant/costs-format";

// --------------------------- synthetic sales --------------------------------

const TZ = "America/El_Salvador";
const config = () =>
  buildBusinessDayConfig(
    [
      {
        restaurant_id: LOC1,
        name: "Todo el día",
        start_time: "00:00",
        end_time: "24:00",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        active: true,
        sort_order: 1,
      } as never,
    ],
    [LOC1]
  );
function salesPayload() {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 21; i += 1) {
    const date = addDays("2026-07-10", i);
    for (const [n, ch, net] of [
      ["a", "in_store", 40 + i],
      ["b", "takeaway", 25],
    ] as const) {
      rows.push({
        sale_date: date,
        order_placed_at: new Date(`${date}T12:30:00-06:00`).toISOString(),
        location_id: LOC1,
        check_id: `${date}-${n}`,
        raw_item_name: "x",
        is_tip: false,
        quantity: 1,
        gross_revenue: net,
        currency: "USD",
        category: "Platos",
        sales_channel: ch,
        payment_type: "Efectivo",
        business_cutoff_min: 240,
      });
    }
  }
  const cube = buildDetailCube(rows as never, {
    timezone: TZ,
    currency: "USD",
    config: config(),
  });
  return {
    cube,
    targets: [],
    restaurants: [
      { id: LOC1, name: "Centro" },
      { id: LOC2, name: "Norte" },
    ],
    locationId: null,
    currency: "USD",
    timezone: TZ,
    shiftsVisible: false,
    noShifts: false,
    shiftsAvailable: true,
    shiftHours: {},
  };
}

function monthOf(over: Record<string, unknown> = {}) {
  return {
    month: "2026-10-01",
    actualDays: 20,
    daysInMonth: 31,
    isCurrentMonth: true,
    hasData: true,
    basis: "real",
    monthTotals: {
      sales: 12000,
      food: 3600,
      waste: 0,
      margin: 8400,
      impuestos: 0,
      marginPct: 0.7,
    },
    actual: {
      sales: 8000,
      food: 2400,
      waste: 0,
      margin: 5600,
      impuestos: 0,
      marginPct: 0.7,
    },
    profit: 1234.5,
    profitPct: 0.103,
    breakEvenPerDay: 310,
    breakEvenDay: { date: "2026-10-18", day: 18, projected: false },
    avgSalesPerDay: 400,
    cada100: [
      { key: "comida", pct: 30 },
      { key: "planilla", pct: 25 },
      { key: "ganancia", pct: 10.3 },
    ],
    cada100Loss: false,
    fixed: { total: 5000, missing: [], amounts: {}, missingAmounts: [] },
    coverage: {
      pct: 1,
      uncoveredPct: 0.2,
      coveredMarginPct: 0.7,
      uncovered: [{ name: "x" }],
    },
    days: [],
    weekdayAverages: [],
    ...over,
  };
}
const pageOf = (over: Record<string, unknown> = {}) => ({
  currency: "USD",
  today: "2026-10-31",
  month: monthOf(over),
  previous: null,
  chips: null,
  findings: [{ kind: "coverage", amounts: {} }],
});

// ------------------------------- helpers ------------------------------------

const call = (
  handler: (r: NextRequest, c?: any) => Promise<Response>,
  path: string,
  token: string | null,
  init: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {}
) =>
  handler(
    new NextRequest(`http://localhost/api/mobile/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        "accept-language": "es",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }),
    init.params ? { params: Promise.resolve(init.params) } : undefined
  );

const invoice = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  company_id: CO,
  supplier_id: null,
  invoice_number: null,
  invoice_date: "2026-10-30",
  currency: "USD",
  status: "needs_review",
  source_type: "manual",
  created_at: "2026-10-30T10:00:00Z",
  ...over,
});
const line = (
  id: string,
  invoiceId: string,
  over: Record<string, unknown> = {}
) => ({
  id,
  company_id: CO,
  invoice_id: invoiceId,
  ingredient_id: ING,
  supplier_id: null,
  supplier_item_name: null,
  description: "harina",
  quantity: 3,
  unit: "kg",
  unit_cost: 2,
  line_total: 6,
  tax_amount: null,
  match_status: "matched",
  review_status: "pending",
  notes: null,
  created_at: "2026-10-30T10:00:00Z",
  ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests";
  h.rentabilidadCalls.length = 0;
  h.signIn.mockReset();
  h.refresh.mockReset();
  h.state.salesPayload = salesPayload;
  h.state.rentabilidad = () => pageOf();
  h.state.db = createFakeDb({
    companies: [
      { id: CO, name: "Casa A", preferred_language: "es" },
      { id: CO_B, name: "Casa B" },
    ],
    company_memberships: [
      { company_id: CO, user_id: OWNER, role: "owner" },
      { company_id: CO, user_id: MANAGER, role: "manager" },
      { company_id: CO, user_id: ANALYST, role: "analyst" },
      { company_id: CO, user_id: MEMBER, role: "member" },
    ],
    restaurant_locations: [
      {
        id: LOC1,
        company_id: CO,
        name: "Centro",
        status: "active",
        brand_id: null,
      },
      {
        id: LOC2,
        company_id: CO,
        name: "Norte",
        status: "active",
        brand_id: null,
      },
      {
        id: LOC_B,
        company_id: CO_B,
        name: "Ajeno",
        status: "active",
        brand_id: null,
      },
    ],
    suppliers: [],
    ingredients: [{ id: ING, company_id: CO, default_unit: "kg" }],
    supplier_invoices: [
      invoice(INV_OK),
      invoice(INV_BAD, { source_type: "telegram" }),
      invoice(INV_DONE, { status: "posted" }),
    ],
    supplier_invoice_lines: [
      line("l-ok", INV_OK),
      // The kitchen only half read this one: placeholders, «Sin precio» + «Falta».
      line("l-bad", INV_BAD, {
        description: "tomates",
        quantity: 1,
        unit: "unidad",
        unit_cost: null,
        line_total: 0,
        match_status: "unmatched",
        ingredient_id: null,
        notes: "[falta:cantidad,unidad]",
      }),
    ],
    ingredient_cost_entries: [],
    invoice_events: [],
    kitchen_devices: [],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const MONEY_ROUTES: Array<[string, any]> = [
  ["home", homeGET],
  ["ventas?period=week", ventasGET],
  ["rentabilidad?location=" + LOC1, rentabilidadGET],
  ["costos", costosGET],
  ["locations", locationsGET],
];

// ---------------------------------- tests -----------------------------------

describe("security: who can reach the money routes", () => {
  it.each(MONEY_ROUTES)("%s: no token -> 401", async (path, handler) => {
    expect((await call(handler, path, null)).status).toBe(401);
  });

  it.each(MONEY_ROUTES)(
    "%s: a kitchen DEVICE token (not a Supabase session) -> 401",
    async (path, handler) => {
      const res = await call(handler, path, KITCHEN_DEVICE_TOKEN);
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).not.toMatch(
        /ventas|total|profit/i
      );
    }
  );

  it.each(MONEY_ROUTES)(
    "%s: analyst and member roles -> 403, no data",
    async (path, handler) => {
      for (const token of ["analyst-token", "member-token"]) {
        const res = await call(handler, path, token);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
          error: "Tu rol no tiene acceso a Gestión. Pídeselo al dueño.",
        });
      }
    }
  );

  it.each(MONEY_ROUTES)(
    "%s: owner and manager -> 200, no-store",
    async (path, handler) => {
      for (const token of ["owner-token", "manager-token"]) {
        const res = await call(handler, path, token);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
    }
  );

  it("approve and reject: a kitchen device token -> 401, a member -> 403, nothing changes", async () => {
    for (const handler of [approvePOST, rejectPOST]) {
      for (const [token, status] of [
        [KITCHEN_DEVICE_TOKEN, 401],
        ["member-token", 403],
        ["analyst-token", 403],
      ] as const) {
        const res = await call(handler, `invoices/${INV_OK}/x`, token, {
          method: "POST",
          params: { id: INV_OK },
        });
        expect(res.status).toBe(status);
      }
    }
    expect(h.state.db.tables.ingredient_cost_entries).toHaveLength(0);
    expect(
      h.state.db.tables.supplier_invoices.find((i: any) => i.id === INV_OK)
        .status
    ).toBe("needs_review");
  });

  it("a restaurant of another company is ignored, never read", async () => {
    const res = await call(
      ventasGET,
      `ventas?period=week&location=${LOC_B}`,
      "owner-token"
    );
    expect(res.status).toBe(200);
    expect((await res.json()).locationId).toBeNull();
  });

  it("a company the user does not belong to -> 403", async () => {
    const res = await call(homeGET, `home?companyId=${CO_B}`, "owner-token");
    expect(res.status).toBe(403);
  });
});

describe("Ventas = the web's computeDetail", () => {
  const web = (period: "day" | "week" | "month") => {
    const p = salesPayload();
    const last = p.cube.last_day as string;
    const from =
      period === "day" ? last : addDays(last, period === "week" ? -6 : -29);
    return computeDetail({
      prepared: prepareCube(p.cube),
      state: {
        ...DEFAULT_STATE,
        period: "custom",
        from,
        to: last,
        compare: period === "day" ? "prev_week" : "prev_period",
      },
      targets: [],
      scope: { locationId: null, restaurantIds: [LOC1, LOC2] },
      shiftsVisible: false,
      lang: "es",
    })!;
  };

  it.each(["day", "week", "month"] as const)(
    "%s: total, delta, tickets and average ticket equal the web view",
    async (period) => {
      const res = await call(
        ventasGET,
        `ventas?period=${period}`,
        "owner-token"
      );
      const body = await res.json();
      const view = web(period);
      expect(body.total).toEqual({
        value: view.kpis.net.value,
        delta: view.kpis.net.delta,
      });
      expect(body.tickets.value).toBe(view.kpis.tickets.value);
      expect(body.avgTicket.value).toBe(view.kpis.ticket.value);
      expect(body.daily.map((d: any) => d.net)).toEqual(
        view.daily.map((d) => d.net)
      );
      expect(body.range).toEqual(view.range);
      expect(body.total.value).toBeGreaterThan(0);
    }
  );

  it("week: every day has the same day of the previous period beside it", async () => {
    const body = await (
      await call(ventasGET, "ventas?period=week", "owner-token")
    ).json();
    expect(body.daily).toHaveLength(7);
    expect(
      body.daily.every((d: any) => typeof d.previousNet === "number")
    ).toBe(true);
  });

  it("channels are the web's channel rows; dishes are ALL rows with sales, drinks and zero-sales out", async () => {
    const body = await (
      await call(ventasGET, "ventas?period=week", "owner-token")
    ).json();
    const view = web("week");
    expect(body.channels.length).toBeGreaterThan(0);
    expect(
      body.channels.reduce((a: number, c: any) => a + c.net, 0)
    ).toBeCloseTo(view.kpis.net.value as number, 1);
    expect(body.dishes).toEqual([
      { name: "Pupusa", units: 30, net: 90 },
      { name: "Tamal", units: 10, net: 40 },
    ]);
  });

  it("year is drawn as month bars; a bad period is a 400", async () => {
    const body = await (
      await call(ventasGET, "ventas?period=year", "owner-token")
    ).json();
    expect(body.daily.every((d: any) => /^\d{4}-\d{2}$/.test(d.date))).toBe(
      true
    );
    expect(
      (await call(ventasGET, "ventas?period=decade", "owner-token")).status
    ).toBe(400);
  });

  it("no sales at all: empty, with null values (never 0 made up)", async () => {
    h.state.salesPayload = () => {
      const p = salesPayload();
      return {
        ...p,
        cube: buildDetailCube([] as never, {
          timezone: TZ,
          currency: "USD",
          config: config(),
        }),
      };
    };
    const body = await (
      await call(ventasGET, "ventas?period=day", "owner-token")
    ).json();
    expect(body.empty).toBe(true);
    expect(body.total.value).toBeNull();
    expect(body.daily).toEqual([]);
  });
});

describe("Rentabilidad = the web's loadRentabilidadPage", () => {
  it("passes the verified company and restaurant, and returns the web's numbers", async () => {
    const res = await call(
      rentabilidadGET,
      `rentabilidad?month=2026-10&location=${LOC1}`,
      "manager-token"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.rentabilidadCalls).toHaveLength(1);
    expect(h.rentabilidadCalls[0]).toMatchObject({
      companyId: CO,
      locationId: LOC1,
      month: "2026-10-01",
    });
    const page = pageOf() as any;
    expect(body).toEqual(shapeRentabilidad(page, LOC1, "es"));
    expect(body.profit).toBe(1234.5);
    expect(body.profitPct).toBe(0.103);
    expect(body.cada100.map((p: any) => p.key)).toEqual([
      "comida",
      "planilla",
      "ganancia",
    ]);
    expect(body.foodCostPct).toBe(30);
    expect(body.findings).toEqual([
      findingText(
        page.findings[0],
        page.month,
        (n) => formatMoney(n, "USD", "es"),
        "es"
      ),
    ]);
  });

  it("needs ONE restaurant (two exist, none picked) -> 400; a bad month -> 400", async () => {
    expect(
      (await call(rentabilidadGET, "rentabilidad", "owner-token")).status
    ).toBe(400);
    expect(
      (
        await call(
          rentabilidadGET,
          `rentabilidad?month=nope&location=${LOC1}`,
          "owner-token"
        )
      ).status
    ).toBe(400);
  });

  it("an estimated month says so and a month without data has null money", async () => {
    h.state.rentabilidad = () => pageOf({ basis: "estimada" });
    const est = await (
      await call(
        rentabilidadGET,
        `rentabilidad?location=${LOC1}`,
        "owner-token"
      )
    ).json();
    expect(est.basis).toBe("estimada");
    h.state.rentabilidad = () =>
      pageOf({ hasData: false, profit: null, profitPct: null, cada100: null });
    const none = await (
      await call(
        rentabilidadGET,
        `rentabilidad?location=${LOC1}`,
        "owner-token"
      )
    ).json();
    expect(none.hasData).toBe(false);
    expect(none.profit).toBeNull();
    expect(none.sales).toBeNull();
  });

  it("a future month is clamped to the current one", async () => {
    await call(
      rentabilidadGET,
      `rentabilidad?month=2999-01&location=${LOC1}`,
      "owner-token"
    );
    expect(h.rentabilidadCalls[0]).toMatchObject({
      month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
    expect((h.rentabilidadCalls[0] as any).month).not.toBe("2999-01-01");
  });
});

describe("Inicio", () => {
  it("yesterday vs last week, the month's profit and margin, the web's findings, pending invoices", async () => {
    const body = await (
      await call(homeGET, `home?location=${LOC1}`, "owner-token")
    ).json();
    const p = salesPayload();
    const day = computeDetail({
      prepared: prepareCube(p.cube),
      state: {
        ...DEFAULT_STATE,
        period: "custom",
        from: p.cube.last_day,
        to: p.cube.last_day,
        compare: "prev_week",
      },
      targets: [],
      scope: { locationId: LOC1, restaurantIds: [LOC1, LOC2] },
      shiftsVisible: false,
    })!;
    expect(body.yesterday).toMatchObject({
      date: p.cube.last_day,
      net: day.kpis.net.value,
      delta: day.kpis.net.delta,
    });
    expect(body.month).toMatchObject({
      profit: 1234.5,
      profitPct: 0.103,
      basis: "real",
    });
    expect(body.highlights).toHaveLength(1);
    expect(body.highlights[0].link).toBe("rentabilidad");
    expect(body.pending.count).toBe(2);
    expect(body.locations).toEqual([
      { id: LOC1, name: "Centro" },
      { id: LOC2, name: "Norte" },
    ]);
  });

  it("with two restaurants and none picked it asks for one instead of guessing", async () => {
    const body = await (await call(homeGET, "home", "owner-token")).json();
    expect(body.needsRestaurant).toBe(true);
    expect(body.month).toBeNull();
    expect(h.rentabilidadCalls).toHaveLength(0);
  });

  it("no invented insight: nothing to say -> an empty list", async () => {
    h.state.rentabilidad = () => ({ ...pageOf(), findings: [] });
    const body = await (
      await call(homeGET, `home?location=${LOC1}`, "owner-token")
    ).json();
    expect(body.highlights).toEqual([]);
  });
});

describe("Costos: pending invoices, «Sin precio», approve and reject", () => {
  it("lists the pending invoices with their lines; a half-read line has no price, never 0", async () => {
    const body = await (await call(costosGET, "costos", "owner-token")).json();
    expect(body.pendingCount).toBe(2);
    expect(body.invoices.map((i: any) => i.id).sort()).toEqual(
      [INV_BAD, INV_OK].sort()
    );
    const ok = body.invoices.find((i: any) => i.id === INV_OK);
    expect(ok.total).toBe(6);
    expect(ok.lines[0]).toMatchObject({
      name: "harina",
      quantity: 3,
      unitCost: 2,
      lineTotal: 6,
      incomplete: false,
    });
    const bad = body.invoices.find((i: any) => i.id === INV_BAD);
    expect(bad.total).toBeNull();
    expect(bad.priced).toBe(false);
    expect(bad.lines[0]).toMatchObject({
      unitCost: null,
      lineTotal: null,
      missing: ["quantity", "unit"],
      incomplete: true,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /"(unitCost|lineTotal|total)":0\b/
    );
    expect(body.canApprove).toBe(true);
    expect(body.kpis).toBeNull();
    expect(body.needsRestaurant).toBe(true);
  });

  it("KPIs below come from the web rentabilidad when one restaurant is in view", async () => {
    const body = await (
      await call(costosGET, `costos?location=${LOC1}`, "manager-token")
    ).json();
    expect(body.kpis).toMatchObject({
      foodCostPct: 30,
      fixedTotal: 5000,
      basis: "real",
    });
  });

  it("Aprobar posts the ready lines with the web's own posting, exactly once", async () => {
    const res = await call(
      approvePOST,
      `invoices/${INV_OK}/approve`,
      "manager-token",
      {
        method: "POST",
        params: { id: INV_OK },
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posted_lines).toBe(1);
    const entries = h.state.db.tables.ingredient_cost_entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source_id: "l-ok",
      quantity: 3,
      unit_cost: 2,
      total_cost: 6,
    });
    expect(
      h.state.db.tables.supplier_invoices.find((i: any) => i.id === INV_OK)
        .status
    ).toBe("posted");
    // A second tap cannot post it again.
    const again = await call(
      approvePOST,
      `invoices/${INV_OK}/approve`,
      "manager-token",
      {
        method: "POST",
        params: { id: INV_OK },
      }
    );
    expect(again.status).toBe(409);
    expect(h.state.db.tables.ingredient_cost_entries).toHaveLength(1);
  });

  it("an invoice with only a half-read line cannot be approved: no cost entry, no $0", async () => {
    const res = await call(
      approvePOST,
      `invoices/${INV_BAD}/approve`,
      "owner-token",
      {
        method: "POST",
        params: { id: INV_BAD },
      }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.skipped_lines[0].line_id).toBe("l-bad");
    expect(h.state.db.tables.ingredient_cost_entries).toHaveLength(0);
    expect(
      h.state.db.tables.supplier_invoice_lines.find(
        (l: any) => l.id === "l-bad"
      ).review_status
    ).toBe("pending");
  });

  it("Rechazar sets the existing rejected status and posts nothing; a posted one is a 409; unknown is a 404", async () => {
    const res = await call(
      rejectPOST,
      `invoices/${INV_BAD}/reject`,
      "manager-token",
      {
        method: "POST",
        params: { id: INV_BAD },
      }
    );
    expect(res.status).toBe(200);
    expect(
      h.state.db.tables.supplier_invoices.find((i: any) => i.id === INV_BAD)
        .status
    ).toBe("rejected");
    expect(h.state.db.tables.ingredient_cost_entries).toHaveLength(0);
    expect(
      h.state.db.tables.invoice_events.some(
        (e: any) => e.event_type === "rejected"
      )
    ).toBe(true);
    const done = await call(
      rejectPOST,
      `invoices/${INV_DONE}/reject`,
      "owner-token",
      {
        method: "POST",
        params: { id: INV_DONE },
      }
    );
    expect(done.status).toBe(409);
    const missing = await call(rejectPOST, "x", "owner-token", {
      method: "POST",
      params: { id: "77777777-7777-4777-8777-777777777777" },
    });
    expect(missing.status).toBe(404);
    const bad = await call(rejectPOST, "x", "owner-token", {
      method: "POST",
      params: { id: "nope" },
    });
    expect(bad.status).toBe(404);
  });

  it("another company's invoice cannot be touched", async () => {
    h.state.db.tables.supplier_invoices.push(
      invoice("66666666-6666-4666-8666-666666666666", { company_id: CO_B })
    );
    const res = await call(rejectPOST, "x", "owner-token", {
      method: "POST",
      params: { id: "66666666-6666-4666-8666-666666666666" },
    });
    expect(res.status).toBe(404);
  });
});

describe("sign-in", () => {
  const session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_at: 1_900_000_000,
    user: {
      id: OWNER,
      email: "owner@example.test",
      user_metadata: { full_name: "Ana" },
    },
  };

  it("login: email + password -> the session, no-store; the password is never echoed or logged", async () => {
    h.signIn.mockResolvedValue({
      data: { session, user: session.user },
      error: null,
    });
    const log = vi.spyOn(console, "error");
    const res = await call(loginPOST, "auth/login", null, {
      method: "POST",
      body: { email: "owner@example.test", password: "s3cret-pass-word" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 1_900_000_000,
      user: { id: OWNER, email: "owner@example.test", name: "Ana" },
    });
    expect(raw).not.toContain("s3cret-pass-word");
    expect(JSON.stringify(log.mock.calls)).not.toContain("s3cret-pass-word");
    expect(h.signIn).toHaveBeenCalledWith({
      email: "owner@example.test",
      password: "s3cret-pass-word",
    });
  });

  it("a wrong password and an unknown email answer the same 401; an outage is a 503; junk is a 400", async () => {
    h.signIn.mockResolvedValue({
      data: { session: null },
      error: { status: 400 },
    });
    const wrong = await call(loginPOST, "auth/login", null, {
      method: "POST",
      body: { email: "a@b.test", password: "x" },
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({
      error: "Correo o contraseña incorrectos.",
    });
    h.signIn.mockResolvedValue({
      data: { session: null },
      error: { status: 500 },
    });
    expect(
      (
        await call(loginPOST, "auth/login", null, {
          method: "POST",
          body: { email: "a@b.test", password: "x" },
        })
      ).status
    ).toBe(503);
    expect(
      (
        await call(loginPOST, "auth/login", null, {
          method: "POST",
          body: { email: "" },
        })
      ).status
    ).toBe(400);
  });

  it("refresh: a refresh token -> a new session; a bad one -> 401", async () => {
    h.refresh.mockResolvedValue({
      data: {
        session: { ...session, access_token: "access-2" },
        user: session.user,
      },
      error: null,
    });
    const ok = await call(refreshPOST, "auth/refresh", null, {
      method: "POST",
      body: { refreshToken: "refresh-1" },
    });
    expect((await ok.json()).accessToken).toBe("access-2");
    expect(h.refresh).toHaveBeenCalledWith({ refresh_token: "refresh-1" });
    h.refresh.mockResolvedValue({
      data: { session: null },
      error: { status: 400 },
    });
    expect(
      (
        await call(refreshPOST, "auth/refresh", null, {
          method: "POST",
          body: { refreshToken: "old" },
        })
      ).status
    ).toBe(401);
    expect(
      (
        await call(refreshPOST, "auth/refresh", null, {
          method: "POST",
          body: {},
        })
      ).status
    ).toBe(401);
  });
});

describe("Invitar a mi equipo reuses the kitchen invites API (owner only)", () => {
  it("a manager cannot create an invite (kitchen.qr is the owner's)", async () => {
    const res = await call(
      inviteCreatePOST,
      "kitchen/invites",
      "manager-token",
      {
        method: "POST",
        body: { locationId: LOC1 },
      }
    );
    expect(res.status).toBe(403);
  });
});

describe("/me tells the app the company language and role", () => {
  it("returns each company's role, capabilities and language (fallback es)", async () => {
    h.state.db.tables.companies[0].preferred_language = "de";
    const res = await call(meGET, "me", "owner-token");
    const body = await res.json();
    expect(body.companies[0]).toMatchObject({
      id: CO,
      role: "owner",
      language: "de",
    });
    expect(body.companies[0].capabilities).toContain("kitchen.qr");
    h.state.db.tables.companies[0].preferred_language = null;
    const none = await (await call(meGET, "me", "manager-token")).json();
    expect(none.companies[0].language).toBe("es");
    expect(none.companies[0].capabilities).not.toContain("kitchen.qr");
    expect(none.companies[0].capabilities).toContain("prices.edit");
  });
});

describe("locations", () => {
  it("lists only the caller's company restaurants", async () => {
    const body = await (
      await call(locationsGET, "locations", "owner-token")
    ).json();
    expect(body.locations).toEqual([
      { id: LOC1, name: "Centro" },
      { id: LOC2, name: "Norte" },
    ]);
  });
});
