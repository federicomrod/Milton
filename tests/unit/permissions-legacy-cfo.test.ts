// The legacy CFO write routes that are still called by the legacy dashboard
// need company.edit (owner / admin / Milton staff). data/upload and
// kpis/select had no callers and are deleted. Synthetic data only.
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

import { DELETE as deleteModelTable } from "@/app/api/data/delete-model-table/route";
import { POST as normalizeValues } from "@/app/api/data/normalize-values/route";
import { POST as uploadModelTable } from "@/app/api/data/upload-model-table/route";
import { POST as calculateKpis } from "@/app/api/kpis/calculate/route";
import { POST as createScenario } from "@/app/api/scenarios/route";
import {
  DELETE as deleteScenario,
  PATCH as patchScenario,
} from "@/app/api/scenarios/[id]/route";

const req = (method: string, body: unknown = {}) =>
  new NextRequest("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "s-1" }) };

const ROUTES: Array<[string, () => Promise<Response>]> = [
  [
    "DELETE data/delete-model-table",
    () => deleteModelTable(req("DELETE", { tableName: "t" })),
  ],
  [
    "POST data/normalize-values",
    () =>
      normalizeValues(req("POST", { fields: [{ field: "a", values: ["x"] }] })),
  ],
  [
    "POST data/upload-model-table",
    () => uploadModelTable(req("POST", { tableName: "t", rows: [{ a: 1 }] })),
  ],
  [
    "POST kpis/calculate",
    () =>
      calculateKpis(
        req("POST", { from_date: "2026-01-01", to_date: "2026-02-01" }) as never
      ),
  ],
  ["POST scenarios", () => createScenario(req("POST", { name: "Plan" }))],
  [
    "PATCH scenarios/[id]",
    () => patchScenario(req("PATCH", { name: "Plan 2" }), ctx),
  ],
  ["DELETE scenarios/[id]", () => deleteScenario(req("DELETE"), ctx)],
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
  it("data/upload and kpis/select had no callers and are gone", () => {
    expect(existsSync("app/api/data/upload/route.ts")).toBe(false);
    expect(existsSync("app/api/kpis/select/route.ts")).toBe(false);
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
