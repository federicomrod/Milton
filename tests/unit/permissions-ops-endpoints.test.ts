/// <reference types="vite/client" />
// The shared permissions helper on the operations endpoints: kitchen QR /
// cooks / reports, kitchen drafts with several memberships, Odoo, targets,
// shifts, Configuración tabs and every Milton-staff-only route. Each endpoint
// has an allow and a deny case; every 401 / 403 is Spanish. Synthetic data only.
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

type Row = Record<string, unknown>;

const FORBIDDEN = "No tienes permiso para cambiar esto.";
const UNAUTHORIZED = "Inicia sesión de nuevo.";
const A = "company-a";
const B = "company-b";
const C = "company-c";
const USER = "user-1";
const LOC = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  store: {} as Record<string, Row[]>,
  staff: false,
  signedIn: true,
  companyId: "company-b",
  captured: [] as Array<Record<string, unknown>>,
}));

/** The signed-in client: the in-memory tables plus auth and an rpc that answers nothing. */
function userClient() {
  const db = makeFakeDb(state.store);
  return {
    from: db.from,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async () => ({
        data: { user: state.signedIn ? { id: USER } : null },
      }),
    },
  };
}

vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => state.staff,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => userClient(),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { makeFakeDb: make } = await import("./helpers/fake-db");
  return { createAdminClient: () => make(state.store) };
});
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () =>
    state.signedIn
      ? {
          ok: true,
          supabase: userClient(),
          companyId: state.companyId,
          userId: USER,
        }
      : {
          ok: false,
          response: NextResponse.json(
            { error: "Inicia sesión de nuevo." },
            { status: 401 }
          ),
        },
}));
vi.mock("@/lib/restaurant/supabase-sales", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/restaurant/supabase-sales")>();
  return { ...actual, resolveCompanyIdForUser: async () => state.companyId };
});
vi.mock("@/lib/restaurant/telegram/kitchen-qr", () => ({
  createOrRotateKitchenQr: async () => ({
    ok: true,
    deep_link: "https://t.me/x",
    qr_svg: "<svg/>",
    qr_png_data_url: "data:image/png;base64,",
  }),
}));
vi.mock("@/lib/restaurant/telegram/kitchen-join", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-join")
    >();
  return { ...actual, loadKitchenQrStatus: async () => [] };
});
vi.mock("@/lib/restaurant/odoo/load-connection", () => ({
  // Reaching here means the permission gate let the request through.
  loadOdooSession: async () => ({
    ok: false,
    response: NextResponse.json({ error: "gate-passed" }, { status: 418 }),
  }),
}));
// Configuración tabs: the forms only record the props they receive.
vi.mock("@/components/restaurant/settings/TurnosForm", () => ({
  TurnosForm: (props: Record<string, unknown>) => {
    state.captured.push(props);
    return null;
  },
}));
vi.mock("@/components/restaurant/settings/ObjetivosForm", () => ({
  ObjetivosForm: (props: Record<string, unknown>) => {
    state.captured.push(props);
    return null;
  },
}));
vi.mock("@/components/restaurant/settings/AppliesTo", () => ({
  AppliesTo: () => null,
}));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => ({ id: USER }),
  getCachedCompanyId: async () => state.companyId,
}));
vi.mock("@/lib/restaurant/business-day-server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/business-day-server")
    >();
  return { ...actual, loadShifts: async () => ({ shifts: [] }) };
});
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));
vi.mock("@/lib/restaurant/pos-timezone", () => ({
  resolvePosTimezone: async () => "UTC",
}));
vi.mock("@/lib/restaurant/cockpit-pos-rollup", () => ({
  fetchCockpitPosRollup: async () => ({ rollup: null }),
}));
vi.mock("@/lib/restaurant/supabase-targets", () => ({
  loadTargetsConfig: async () => ({ rows: [], available: true }),
  loadDefaultComparison: async () => null,
  getRestaurantKpiTargets: async () => ({}),
  upsertRestaurantKpiTarget: async () => ({}),
  TARGET_METRIC_KEYS: ["revenue", "orders", "units_sold", "avg_ticket"],
}));
vi.mock("@/lib/restaurant/costing/dish-economics-server", () => ({
  loadDishEconomics: async () => ({ ok: false }),
}));

import {
  GET as qrGet,
  POST as qrPost,
} from "@/app/api/restaurant/kitchen/qr/route";
import { DELETE as staffDelete } from "@/app/api/restaurant/kitchen/staff/[id]/route";
import { PATCH as reportPatch } from "@/app/api/restaurant/kitchen/reports/[id]/route";
import { PATCH as draftPatch } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/route";
import { POST as draftReject } from "@/app/api/restaurant/kitchen/recipe-drafts/[id]/reject/route";
import { POST as odooSync } from "@/app/api/restaurant/pos/odoo-sync/route";
import { GET as odooDiagnostics } from "@/app/api/restaurant/pos/odoo-combo-diagnostics/route";
import { POST as targetsPost } from "@/app/api/restaurant/targets/route";
import { POST as shiftsPost } from "@/app/api/restaurant/shifts/route";
import { TurnosTab } from "@/components/restaurant/settings/tabs/TurnosTab";
import { ObjetivosTab } from "@/components/restaurant/settings/tabs/ObjetivosTab";
import { REPORT_TYPES } from "@/lib/restaurant/telegram/kitchen-reports";
import { loadCompanyRole, resolveActor } from "@/lib/auth/permissions";

const json = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (id: string = ID) => ({ params: Promise.resolve({ id }) });

function member(companyId: string, role: string | null, userId = USER) {
  (state.store.company_memberships ??= []).push({
    company_id: companyId,
    user_id: userId,
    role,
  });
}

beforeEach(() => {
  state.staff = false;
  state.signedIn = true;
  state.companyId = B;
  state.captured = [];
  state.store = {
    company_memberships: [],
    kitchen_staff: [{ id: ID, company_id: B, is_active: true }],
    kitchen_reports: [{ id: ID, company_id: B, report_type: REPORT_TYPES[0] }],
    kitchen_recipe_drafts: [
      {
        id: "d-b",
        company_id: B,
        status: "draft",
        portions: 2,
        dish_name: "B",
      },
      {
        id: "d-a",
        company_id: A,
        status: "draft",
        portions: 2,
        dish_name: "A",
      },
      {
        id: "d-c",
        company_id: C,
        status: "draft",
        portions: 2,
        dish_name: "C",
      },
    ],
    kitchen_recipe_draft_lines: [],
    menu_items: [],
    ingredients: [],
    restaurant_locations: [{ id: LOC, company_id: B, name: "R" }],
  };
});

async function expectSpanish403(res: Response, message = FORBIDDEN) {
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: message });
}

describe("role read: trimmed, lowercased, per company", () => {
  it("loadCompanyRole reads the membership of exactly that company", async () => {
    member(A, "member");
    member(B, " Owner ");
    expect(await loadCompanyRole(B, USER)).toBe("owner");
    expect(await loadCompanyRole(A, USER)).toBe("member");
    expect(await loadCompanyRole(C, USER)).toBeNull();
  });
});

describe("kitchen QR, cooks and reports: capability kitchen.qr", () => {
  it("QR GET tells the owner can_manage = true and a manager false", async () => {
    member(B, "owner");
    expect(await (await qrGet()).json()).toMatchObject({ can_manage: true });
    state.store.company_memberships = [];
    member(B, "manager");
    expect(await (await qrGet()).json()).toMatchObject({ can_manage: false });
  });

  it("QR POST: owner and Milton staff pass; a manager, admin and member get the Spanish 403", async () => {
    member(B, "owner");
    expect((await qrPost(json({ location_id: LOC }))).status).toBe(200);
    for (const role of ["admin", "manager", "member", null]) {
      state.store.company_memberships = [];
      member(B, role);
      await expectSpanish403(await qrPost(json({ location_id: LOC })));
    }
    state.store.company_memberships = [];
    state.staff = true;
    expect((await qrPost(json({ location_id: LOC }))).status).toBe(200);
  });

  it("cook DELETE: owner removes, a manager is refused in Spanish", async () => {
    member(B, "manager");
    await expectSpanish403(await staffDelete(json({}, "DELETE"), ctx()));
    state.store.company_memberships = [];
    member(B, "owner");
    expect((await staffDelete(json({}, "DELETE"), ctx())).status).toBe(200);
  });

  it("report PATCH: owner reclassifies, a member is refused in Spanish", async () => {
    member(B, "member");
    await expectSpanish403(
      await reportPatch(json({ report_type: REPORT_TYPES[0] }, "PATCH"), ctx())
    );
    state.store.company_memberships = [];
    member(B, "owner");
    expect(
      (
        await reportPatch(
          json({ report_type: REPORT_TYPES[0] }, "PATCH"),
          ctx()
        )
      ).status
    ).toBe(200);
  });

  it("signed out: Spanish 401", async () => {
    state.signedIn = false;
    const res = await qrPost(json({ location_id: LOC }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: UNAUTHORIZED });
  });
});

describe("kitchen drafts with several memberships (kitchen.drafts)", () => {
  // Memberships: A (member) and B (owner); the profile points at B.
  beforeEach(() => {
    member(A, "member");
    member(B, "owner");
  });

  it("saves a draft of the company in use (B): 200", async () => {
    state.companyId = B;
    const res = await draftPatch(
      json({ dish_name: "Plato" }, "PATCH"),
      ctx("d-b")
    );
    expect(res.status).toBe(200);
  });

  it("the same person in the company where they are only a member gets the Spanish 403", async () => {
    state.companyId = A;
    await expectSpanish403(
      await draftPatch(json({ dish_name: "Plato" }, "PATCH"), ctx("d-a"))
    );
    await expectSpanish403(await draftReject(json({}), ctx("d-a")));
  });

  it("a draft of the other company is a 404 (never reveals it exists), and so is a company with no membership", async () => {
    state.companyId = B;
    for (const id of ["d-a", "d-c"]) {
      const res = await draftPatch(json({ dish_name: "x" }, "PATCH"), ctx(id));
      expect(res.status).toBe(404);
    }
    expect((await draftReject(json({}), ctx("d-c"))).status).toBe(404);
  });

  it("the same user is a manager of nothing: no membership in the company in use -> Spanish 403, Milton staff pass", async () => {
    state.companyId = C;
    await expectSpanish403(
      await draftPatch(json({ dish_name: "x" }, "PATCH"), ctx("d-c"))
    );
    state.staff = true;
    expect(
      (await draftPatch(json({ dish_name: "x" }, "PATCH"), ctx("d-c"))).status
    ).toBe(200);
  });
});

describe("Odoo", () => {
  const syncReq = () =>
    json({ start_date: "2026-07-01", end_date: "2026-07-31" });

  it("sync is Milton staff only: an owner gets the Spanish 403, staff pass the gate", async () => {
    member(B, "owner");
    await expectSpanish403(await odooSync(syncReq()));
    state.staff = true;
    expect((await odooSync(syncReq())).status).not.toBe(403);
  });

  it("combo diagnostics: owner, admin and staff pass; manager and member get the Spanish 403", async () => {
    for (const role of ["owner", "admin"]) {
      state.store.company_memberships = [];
      member(B, role);
      expect((await odooDiagnostics()).status).toBe(418);
    }
    for (const role of ["manager", "member", "viewer", null]) {
      state.store.company_memberships = [];
      member(B, role);
      await expectSpanish403(await odooDiagnostics());
    }
    state.store.company_memberships = [];
    state.staff = true;
    expect((await odooDiagnostics()).status).toBe(418);
  });
});

describe("targets and shifts: targets.edit / shifts.edit", () => {
  it("targets POST: manager passes the gate (400 = reached validation), member gets «objetivos»", async () => {
    member(B, "manager");
    expect((await targetsPost(json({}))).status).toBe(400);
    state.store.company_memberships = [];
    member(B, "member");
    await expectSpanish403(
      await targetsPost(json({ version: 2, location_id: null })),
      "Tu rol no puede cambiar los objetivos."
    );
  });

  it("shifts POST: owner passes the gate, viewer gets «turnos»", async () => {
    member(B, "owner");
    expect((await shiftsPost(json({}))).status).toBe(400);
    state.store.company_memberships = [];
    member(B, "viewer");
    await expectSpanish403(
      await shiftsPost(json({})),
      "Tu rol no puede cambiar los turnos."
    );
  });

  it("signed out: Spanish 401 on both", async () => {
    state.signedIn = false;
    for (const call of [
      () => targetsPost(json({})),
      () => shiftsPost(json({})),
    ]) {
      const res = await call();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: UNAUTHORIZED });
    }
  });
});

describe("Configuración tabs: the server decides canEdit", () => {
  async function propsOf(tab: () => Promise<unknown>) {
    state.captured = [];
    const element = (await tab()) as { props?: Record<string, unknown> };
    // The tab returns the form itself (Turnos) or a wrapper around it.
    const { renderToStaticMarkup } = await import("react-dom/server");
    renderToStaticMarkup(element as never);
    return state.captured[0];
  }

  it("Turnos: owner and manager can edit, member and viewer cannot", async () => {
    for (const [role, expected] of [
      ["owner", true],
      ["manager", true],
      ["member", false],
      ["viewer", false],
    ] as const) {
      state.store.company_memberships = [];
      member(B, role);
      expect((await propsOf(() => TurnosTab()))?.canEdit).toBe(expected);
    }
  });

  it("Objetivos: owner can edit, a member cannot", async () => {
    member(B, "owner");
    expect((await propsOf(() => ObjetivosTab({})))?.canEdit).toBe(true);
    state.store.company_memberships = [];
    member(B, "member");
    expect((await propsOf(() => ObjetivosTab({})))?.canEdit).toBe(false);
  });
});

describe("Milton-staff-only routes answer in Spanish", () => {
  const modules = import.meta.glob([
    "/app/api/admin/**/route.ts",
    "/app/api/management/**/route.ts",
  ]);
  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const paramCtx = {
    params: Promise.resolve({ id: ID, key: "k" }),
  };
  const req = (method: string) =>
    new Request("http://localhost/api/x", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    });

  it("finds the admin and management routes", () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(18);
  });

  it.each(Object.keys(modules))(
    "%s: signed-in non-staff -> Spanish 403; signed out -> Spanish 401 or 403; staff pass the gate",
    async (file) => {
      const mod = (await modules[file]()) as Record<string, unknown>;
      const handlers = METHODS.filter((m) => typeof mod[m] === "function");
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const run = mod[method] as (
          r: Request,
          c: unknown
        ) => Promise<Response>;

        state.staff = false;
        state.signedIn = true;
        const denied = await run(req(method), paramCtx);
        expect(denied.status, `${file} ${method}`).toBe(403);
        expect(await denied.json()).toEqual({ error: FORBIDDEN });

        state.signedIn = false;
        const out = await run(req(method), paramCtx);
        expect([401, 403], `${file} ${method}`).toContain(out.status);
        expect(await out.json()).toEqual({
          error: out.status === 401 ? UNAUTHORIZED : FORBIDDEN,
        });

        state.staff = true;
        state.signedIn = true;
        try {
          const ok = await run(req(method), paramCtx);
          expect([401, 403], `${file} ${method}`).not.toContain(ok.status);
        } catch {
          // The handler got past the gate and tripped on the stub: fine.
        }
      }
    }
  );
});

describe("resolveActor", () => {
  it("reads the role of the company asked about, not another one", async () => {
    member(A, "member");
    member(B, "owner");
    expect(await resolveActor(null, USER, { companyId: A })).toMatchObject({
      role: "member",
      companyId: A,
      isMiltonStaff: false,
    });
    expect(await resolveActor(null, USER, { companyId: B })).toMatchObject({
      role: "owner",
    });
    expect(await resolveActor(null, USER, { companyId: C })).toMatchObject({
      role: null,
    });
  });
});
