// Cooks (kitchen roles) get no merma values from the recipe editor API:
// attachEffectiveCosts is never called and no line carries `effective`.
// Owner, admin, manager, analyst and viewer do get them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let role: string | null = "manager";
const attach = vi.fn(
  async (_s: unknown, _c: string, _l: unknown, state: any) => {
    for (const line of state.lines)
      line.effective = { effective: 105, factor: "kitchen_buffer", pct: 5 };
  }
);

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: {},
    companyId: "c1",
    userId: "u1",
  }),
}));
vi.mock("@/lib/restaurant/api-lang", () => ({ apiLanguage: async () => "es" }));
vi.mock("@/lib/auth/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/permissions")>()),
  resolveActor: async () => ({
    userId: "u1",
    companyId: "c1",
    role,
    isMiltonStaff: false,
  }),
}));
vi.mock("@/lib/restaurant/recipe-costing/editor-store", () => ({
  createSupabaseEditorStore: () => ({}),
}));
vi.mock("@/lib/restaurant/menu-reading/estimate-store", () => ({
  loadPriceEstimates: async () => ({ ok: true, rows: [] }),
}));
vi.mock("@/lib/restaurant/recipe-costing/editor-service", () => ({
  loadEditor: async () => ({
    ok: true,
    state: { lines: [{ amount: 100 }, { amount: 50 }] },
  }),
  applyEdit: async () => ({ ok: true, state: { lines: [] } }),
}));
vi.mock("@/lib/restaurant/effective-cost-server", () => ({
  attachEffectiveCosts: (...a: Parameters<typeof attach>) => attach(...a),
}));

import { GET } from "@/app/api/restaurant/recipes/editor/route";

const get = () =>
  GET(
    new NextRequest(
      "http://localhost/api/restaurant/recipes/editor?odoo_product_id=7"
    )
  );

beforeEach(() => {
  role = "manager";
  attach.mockClear();
});

describe("recipe editor API", () => {
  it.each(["member", null])(
    "%s (a cook): no merma values at all",
    async (r) => {
      role = r;
      const res = await get();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        lines: Array<Record<string, unknown>>;
      };
      expect(attach).not.toHaveBeenCalled();
      expect(body.lines.every((l) => !("effective" in l))).toBe(true);
    }
  );
  it.each(["owner", "admin", "manager", "analyst", "viewer"])(
    "%s sees the merma values",
    async (r) => {
      role = r;
      const body = (await (await get()).json()) as {
        lines: Array<Record<string, unknown>>;
      };
      expect(attach).toHaveBeenCalledTimes(1);
      expect(body.lines.every((l) => "effective" in l)).toBe(true);
    }
  );
});
