// The leftover CFO write route still called by the dashboard layout
// (kpis/calculate) needs company.edit. The other legacy write routes
// had no live callers and are gone. Synthetic data only.
import { existsSync } from "fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fake-db";

type Row = Record<string, unknown>;
const { store, isUserAdminServer, db } = vi.hoisted(() => ({
  store: {} as Record<string, Row[]>,
  isUserAdminServer: vi.fn(),
  db: { writes: 0, role: "owner" as string | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeFakeDb(store),
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: (...a: unknown[]) => isUserAdminServer(...a),
}));
// The user's own client: a company row for the signed-in user, every write counted.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const result = { data: { id: "co-1" }, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit", "match"]) {
      chain[m] = () => chain;
    }
    for (const m of ["insert", "update", "delete", "upsert"]) {
      chain[m] = () => {
        db.writes += 1;
        return chain;
      };
    }
    chain.single = async () => result;
    chain.maybeSingle = async () => result;
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: [], error: null, count: 0 });
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }),
      },
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
    };
  },
}));

import { POST as calculateKpis } from "@/app/api/kpis/calculate/route";

const req = (method: string, body: unknown = {}) =>
  new NextRequest("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const ROUTES: Array<[string, () => Promise<Response>]> = [
  [
    "POST kpis/calculate",
    () =>
      calculateKpis(
        req("POST", { from_date: "2026-01-01", to_date: "2026-02-01" }) as never
      ),
  ],
];

const MESSAGE = "Tu rol no puede cambiar los datos de la empresa.";

beforeEach(() => {
  db.writes = 0;
  isUserAdminServer.mockResolvedValue(false);
  Object.assign(store, { company_memberships: [] });
});
const as = (role: string | null, staff = false) => {
  store.company_memberships = role
    ? [{ company_id: "co-1", user_id: "u-1", role }]
    : [];
  isUserAdminServer.mockResolvedValue(staff);
};

describe("deleted routes", () => {
  it("legacy CFO routes with no live callers are gone", () => {
    const gone = [
      "app/api/data/upload/route.ts",
      "app/api/kpis/select/route.ts",
      "app/api/data/delete-model-table/route.ts",
      "app/api/data/normalize-values/route.ts",
      "app/api/data/parse/route.ts",
      "app/api/data/sources/route.ts",
      "app/api/data/table-names/route.ts",
      "app/api/data/table-preview/route.ts",
      "app/api/data/upload-model-table/route.ts",
      "app/api/kpis/series/route.ts",
      "app/api/model-data/tables/route.ts",
      "app/api/onboarding/kpi-preferences/route.ts",
      "app/api/onboarding/rank-kpis/route.ts",
      "app/api/report-data/route.ts",
      "app/api/scenarios/route.ts",
      "app/api/scenarios/[id]/route.ts",
      "app/api/analytics/financial-metrics/route.ts",
    ];
    for (const f of gone) expect(existsSync(f), f).toBe(false);
  });
});

describe.each(ROUTES)("%s needs company.edit", (_name, call) => {
  it.each(["member", "viewer", "manager"])(
    "%s → 403 in Spanish, nothing written",
    async (role) => {
      as(role);
      const res = await call();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(MESSAGE);
      expect(db.writes).toBe(0);
    }
  );

  it("no membership → 403", async () => {
    as(null);
    expect((await call()).status).toBe(403);
    expect(db.writes).toBe(0);
  });

  it.each(["owner", "admin", " Owner "])("%s → not 403", async (role) => {
    as(role);
    expect((await call()).status).not.toBe(403);
  });

  it("Milton staff → not 403", async () => {
    as(null, true);
    expect((await call()).status).not.toBe(403);
  });
});
