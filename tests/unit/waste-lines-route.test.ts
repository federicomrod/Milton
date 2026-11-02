// Only owner, admin and manager confirm a waste line; a draft is not valued
// until then; no quantity or no price stays without a value. Demo data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let role: string | null = "manager";
let valued: { unitCost: number; value: number } | null = {
  unitCost: 10.5,
  value: 21,
};
const updates: Array<Record<string, unknown>> = [];
const deletes: string[] = [];
const line = {
  id: "w1",
  status: "draft",
  location_id: "loc-1",
  ingredient_id: "ing-1",
  quantity: 2,
  unit: "kg",
  report_date: "2026-10-12",
};

function table(name: string) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.maybeSingle = async () =>
    name === "kitchen_waste_lines"
      ? { data: line, error: null }
      : { data: { id: "ing-2" }, error: null };
  api.update = (patch: Record<string, unknown>) => {
    updates.push(patch);
    return { eq: () => ({ eq: async () => ({ error: null }) }) };
  };
  api.delete = () => ({
    eq: () => ({
      eq: async () => {
        deletes.push("w1");
        return { error: null };
      },
    }),
  });
  return api;
}

vi.mock("@/lib/restaurant/api-lang", () => ({ apiLanguage: async () => "es" }));
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: { from: table },
    companyId: "c1",
    userId: "u1",
  }),
}));
vi.mock("@/lib/auth/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/permissions")>()),
  resolveActor: async () => ({
    userId: "u1",
    companyId: "c1",
    role,
    isMiltonStaff: false,
  }),
}));
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));
vi.mock("@/lib/restaurant/unplanned-waste-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/restaurant/unplanned-waste-server")>()),
  valueIngredientWaste: async () => valued,
}));

import { PATCH } from "@/app/api/restaurant/kitchen/waste-lines/route";

const patch = (body: Record<string, unknown>) =>
  PATCH(
    new NextRequest("http://localhost/api/restaurant/kitchen/waste-lines", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

beforeEach(() => {
  role = "manager";
  valued = { unitCost: 10.5, value: 21 };
  updates.length = 0;
  deletes.length = 0;
});

describe("waste-lines route", () => {
  it.each(["analyst", "viewer", "member", null])(
    "403 for %s: nothing is written",
    async (r) => {
      role = r;
      const res = await patch({ id: "w1", action: "confirm" });
      expect(res.status).toBe(403);
      expect(updates).toHaveLength(0);
      expect(deletes).toHaveLength(0);
    }
  );

  it.each(["owner", "admin", "manager"])(
    "%s confirms and values it",
    async (r) => {
      role = r;
      const res = await patch({ id: "w1", action: "confirm" });
      expect(res.status).toBe(200);
      expect(updates[0]).toMatchObject({
        status: "confirmed",
        value: 21,
        unit_cost: 10.5,
        currency: "USD",
        confirmed_by: "u1",
      });
    }
  );

  it("an edit of the quantity is what gets valued and stored", async () => {
    await patch({ id: "w1", action: "confirm", quantity: 3, unit: "kg" });
    expect(updates[0]).toMatchObject({ quantity: 3, unit: "kg" });
  });

  it("no price: confirmed with NO value (never 0)", async () => {
    valued = null;
    await patch({ id: "w1", action: "confirm" });
    expect(updates[0]).toMatchObject({
      status: "confirmed",
      value: null,
      unit_cost: null,
    });
  });

  it("rejects a bad quantity and discards a draft", async () => {
    expect(
      (await patch({ id: "w1", action: "confirm", quantity: -2 })).status
    ).toBe(400);
    expect((await patch({ id: "w1", action: "discard" })).status).toBe(200);
    expect(deletes).toEqual(["w1"]);
  });
});
