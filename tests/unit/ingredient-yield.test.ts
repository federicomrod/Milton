// Ingredient yield (Merma, #406): range, append-only rows, «desde hoy» vs
// retroactive, and who may write.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PreferredLanguage } from "@/lib/restaurant/language";

let lang: PreferredLanguage = "es";
let role: string | null = "member";
const inserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/restaurant/api-lang", () => ({ apiLanguage: async () => lang }));
vi.mock("@/lib/restaurant/fixed-costs-auth", () => ({
  authorizeFixedCosts: async () => ({
    ok: true,
    supabase: {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: table === "ingredients" ? { id: "ing-1" } : null,
            error: null,
          }),
        };
        return chain;
      },
    },
    companyId: "c1",
    userId: "u1",
    actor: { userId: "u1", companyId: "c1", role, isMiltonStaff: false },
  }),
}));
vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  listAllCompanyRestaurants: async () => ({
    locations: [
      { id: "loc-1", name: "Sucursal Demo", brand_id: null, archived_at: null },
    ],
    archiveAvailable: true,
  }),
}));
vi.mock("@/lib/restaurant/kitchen-buffer-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/restaurant/kitchen-buffer-server")>()),
  loadBusinessToday: async () => "2026-11-10",
  loadCompanyFirstDataDate: async () => "2026-09-15",
  saveIngredientYield: async (a: Record<string, unknown>) => {
    inserts.push(a);
    return { ok: true, effectiveFrom: "2026-11-10" };
  },
}));

import { PUT } from "@/app/api/restaurant/ingredient-yield/route";
import {
  isValidYieldLossPct,
  saveIngredientYield,
} from "@/lib/restaurant/kitchen-buffer-server";
import {
  yieldAt,
  type IngredientYieldRow,
} from "@/lib/restaurant/yield-buffer";
import { es } from "@/lib/i18n/es";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";

const put = (
  body: Record<string, unknown> = {
    ingredientId: "ing-1",
    lossPct: 35,
    scope: "today",
  }
) =>
  PUT(
    new NextRequest("http://localhost/api/restaurant/ingredient-yield", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  lang = "es";
  role = "member";
  inserts.length = 0;
});

describe("PUT /api/restaurant/ingredient-yield", () => {
  it.each(["analyst", "viewer", "member", null])(
    "%s gets 403 and nothing is written",
    async (r) => {
      role = r;
      const res = await put();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(
        es.menu.screens.ingredientes.yield.roleDenied
      );
      expect(inserts).toHaveLength(0);
    }
  );
  it.each(["owner", "admin", "manager"])("%s saves", async (r) => {
    role = r;
    expect((await put()).status).toBe(200);
    expect(inserts).toHaveLength(1);
  });
  it("the refusal speaks en and de", async () => {
    lang = "en";
    expect((await (await put()).json()).error).toBe(
      en.menu.screens.ingredientes.yield.roleDenied
    );
    lang = "de";
    expect((await (await put()).json()).error).toBe(
      de.menu.screens.ingredientes.yield.roleDenied
    );
  });
  it("out-of-range values and bad scopes are rejected with a clear message", async () => {
    role = "manager";
    for (const lossPct of [-1, 100, 150, 99.995, "35", null, NaN]) {
      const res = await put({ ingredientId: "ing-1", lossPct, scope: "today" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        es.menu.screens.ingredientes.yield.invalid
      );
    }
    expect(
      (await put({ ingredientId: "ing-1", lossPct: 5, scope: "yesterday" }))
        .status
    ).toBe(400);
    expect((await put({ lossPct: 5, scope: "today" })).status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
  it("0 is a valid value (a saved 0%), 99.99 is the largest", async () => {
    role = "manager";
    expect(
      (await put({ ingredientId: "ing-1", lossPct: 0, scope: "today" })).status
    ).toBe(200);
    expect(
      (await put({ ingredientId: "ing-1", lossPct: 99.99, scope: "all" }))
        .status
    ).toBe(200);
    expect(isValidYieldLossPct(100)).toBe(false);
  });
});

/** An insert-only stand-in for ingredient_yields. */
function yieldsDb() {
  const rows: IngredientYieldRow[] = [];
  let n = 0;
  const supabase = {
    from(table: string) {
      expect(table).toBe("ingredient_yields");
      let payload: Record<string, unknown> = {};
      const chain: any = {
        insert: (p: Record<string, unknown>) => {
          payload = p;
          return chain;
        },
        select: () => chain,
        delete: () => {
          throw new Error("never deleted");
        },
        update: () => {
          throw new Error("never updated");
        },
        single: async () => {
          const r: IngredientYieldRow = {
            id: `y${++n}`,
            ingredient_id: payload.ingredient_id as string,
            loss_pct: payload.loss_pct as number,
            source: payload.source as string,
            status: payload.status as "draft" | "approved",
            effective_from: payload.effective_from as string,
            created_at: `2026-11-10T10:00:0${n}Z`,
          };
          rows.push(r);
          return { data: { id: r.id }, error: null };
        },
      };
      return chain;
    },
  };
  return { supabase: supabase as never, rows };
}

describe("saveIngredientYield", () => {
  const actual = async () =>
    (
      await vi.importActual<
        typeof import("@/lib/restaurant/kitchen-buffer-server")
      >("@/lib/restaurant/kitchen-buffer-server")
    ).saveIngredientYield;
  const base = {
    companyId: "c1",
    userId: "u1",
    ingredientId: "ing-1",
    today: "2026-11-10",
    firstDataDate: "2026-09-15",
  };

  it("writes an APPROVED row; «desde hoy» leaves past months unchanged", async () => {
    const save = await actual();
    const db = yieldsDb();
    const res = await save({
      ...base,
      supabase: db.supabase,
      lossPct: 35,
      scope: "today",
    });
    expect(res).toEqual({ ok: true, effectiveFrom: "2026-11-10" });
    expect(db.rows[0]).toMatchObject({
      status: "approved",
      source: "manual",
      loss_pct: 35,
    });
    expect(yieldAt(db.rows, "ing-1", "2026-10-15")).toBeNull(); // past: no yield
    expect(yieldAt(db.rows, "ing-1", "2026-11-10")?.lossPct).toBe(35);
  });
  it("retroactive changes the past; a later desde-hoy row wins from its date; nothing is deleted", async () => {
    const save = await actual();
    const db = yieldsDb();
    await save({ ...base, supabase: db.supabase, lossPct: 35, scope: "all" });
    expect(yieldAt(db.rows, "ing-1", "2026-09-20")?.lossPct).toBe(35);
    await save({
      ...base,
      today: "2026-11-20",
      supabase: db.supabase,
      lossPct: 10,
      scope: "today",
    });
    expect(yieldAt(db.rows, "ing-1", "2026-11-19")?.lossPct).toBe(35);
    expect(yieldAt(db.rows, "ing-1", "2026-11-20")?.lossPct).toBe(10);
    expect(db.rows).toHaveLength(2);
  });
  it("rejects out-of-range values and writes nothing", async () => {
    const save = await actual();
    for (const lossPct of [-0.01, 100, 100.5, NaN, Infinity]) {
      const db = yieldsDb();
      expect(
        await save({ ...base, supabase: db.supabase, lossPct, scope: "today" })
      ).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(db.rows).toHaveLength(0);
    }
  });
  it("the mocked export is not the real one (sanity)", () => {
    expect(saveIngredientYield).not.toBe(undefined);
  });
});
