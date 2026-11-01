// Yield loss and kitchen buffer «value at a date» (#404, migration 075).
// Synthetic demo ingredients and restaurants only.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bufferAt,
  loadBufferAt,
  loadYieldsAt,
  pickValueAt,
  yieldAt,
  type IngredientYieldRow,
  type KitchenBufferRow,
} from "@/lib/restaurant/yield-buffer";

const TOMATE = "ing-tomate";
const CEBOLLA = "ing-cebolla";
const CENTRO = "loc-centro";
const NORTE = "loc-norte";

const y = (
  ingredient_id: string,
  loss_pct: number,
  effective_from: string,
  status: "draft" | "approved" = "approved",
  created_at = "2026-01-01T00:00:00Z"
): IngredientYieldRow => ({
  id: `${ingredient_id}-${effective_from}-${status}-${created_at}`,
  ingredient_id,
  loss_pct,
  source: "manual",
  status,
  effective_from,
  created_at,
});
const b = (
  location_id: string,
  buffer_pct: number,
  effective_from: string,
  created_at = "2026-01-01T00:00:00Z"
): KitchenBufferRow => ({
  id: `${location_id}-${effective_from}-${created_at}`,
  location_id,
  buffer_pct,
  effective_from,
  created_at,
});

describe("pickValueAt", () => {
  const rows = [
    { effective_from: "2026-03-01" },
    { effective_from: "2026-01-01" },
    { effective_from: "2026-06-01" },
  ];
  it("takes the latest effective_from on or before the date", () => {
    expect(pickValueAt(rows, "2026-02-15")?.effective_from).toBe("2026-01-01");
    expect(pickValueAt(rows, "2026-06-01")?.effective_from).toBe("2026-06-01");
    expect(pickValueAt(rows, "2026-12-31")?.effective_from).toBe("2026-06-01");
  });
  it("is null before the first row, with no rows, or with a bad date", () => {
    expect(pickValueAt(rows, "2025-12-31")).toBeNull();
    expect(pickValueAt([], "2026-01-01")).toBeNull();
    expect(pickValueAt(rows, "2026-1-1")).toBeNull();
    expect(pickValueAt(rows, "")).toBeNull();
  });
  it("on the same day the row created last wins", () => {
    const tie = [
      {
        effective_from: "2026-03-01",
        created_at: "2026-03-01T08:00:00Z",
        v: 1,
      },
      {
        effective_from: "2026-03-01",
        created_at: "2026-03-01T09:00:00Z",
        v: 2,
      },
    ];
    expect(pickValueAt(tie, "2026-03-05")?.v).toBe(2);
    expect(pickValueAt([...tie].reverse(), "2026-03-05")?.v).toBe(2);
  });
});

describe("yieldAt", () => {
  const rows = [
    y(TOMATE, 8, "2026-01-01"),
    y(TOMATE, 12, "2026-04-01"),
    y(TOMATE, 99, "2026-05-01", "draft"),
    y(CEBOLLA, 15, "2026-02-01"),
  ];
  it("a change «a semanas anteriores» (earlier effective_from) reaches past dates", () => {
    expect(yieldAt(rows, TOMATE, "2026-03-31")).toEqual({
      lossPct: 8,
      effectiveFrom: "2026-01-01",
    });
    const backdated = [...rows, y(TOMATE, 20, "2026-03-01")];
    expect(yieldAt(backdated, TOMATE, "2026-03-31")?.lossPct).toBe(20);
  });
  it("a change «solo desde hoy» leaves the past alone", () => {
    const fromToday = [...rows, y(TOMATE, 25, "2026-07-10")];
    expect(yieldAt(fromToday, TOMATE, "2026-07-09")?.lossPct).toBe(12);
    expect(yieldAt(fromToday, TOMATE, "2026-07-10")?.lossPct).toBe(25);
  });
  it("ignores drafts and other ingredients", () => {
    expect(yieldAt(rows, TOMATE, "2026-06-01")?.lossPct).toBe(12);
    expect(yieldAt(rows, CEBOLLA, "2026-01-31")).toBeNull();
    expect(yieldAt(rows, "ing-unknown", "2026-06-01")).toBeNull();
  });
  it("keeps a real 0% loss (never confused with missing)", () => {
    expect(yieldAt([y(TOMATE, 0, "2026-01-01")], TOMATE, "2026-02-01")).toEqual(
      { lossPct: 0, effectiveFrom: "2026-01-01" }
    );
  });
});

describe("bufferAt", () => {
  const rows = [b(CENTRO, 5, "2026-01-01"), b(CENTRO, 10, "2026-05-01")];
  it("is per restaurant and per date", () => {
    expect(bufferAt(rows, CENTRO, "2026-04-30")?.bufferPct).toBe(5);
    expect(bufferAt(rows, CENTRO, "2026-05-01")?.bufferPct).toBe(10);
    expect(bufferAt(rows, NORTE, "2026-05-01")).toBeNull();
    expect(bufferAt(rows, CENTRO, "2025-12-31")).toBeNull();
  });
  it("keeps a real 0% buffer", () => {
    expect(
      bufferAt([b(CENTRO, 0, "2026-01-01")], CENTRO, "2026-02-01")
    ).toEqual({ bufferPct: 0, effectiveFrom: "2026-01-01" });
  });
});

/** A chainable stand-in that records the filters and returns `rows`. */
function stub(rows: unknown[], error: { message: string } | null = null) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then")
          return (resolve: (v: unknown) => void) =>
            resolve({ data: error ? null : rows, error });
        return (...args: unknown[]) => {
          calls.push([prop, ...args]);
          return chain;
        };
      },
    }
  );
  return {
    client: {
      from: (t: string) => (calls.push(["from", t]), chain),
    } as unknown as SupabaseClient,
    calls,
  };
}

describe("loadYieldsAt", () => {
  it("reads once, company-scoped, approved only, up to the date", async () => {
    const { client, calls } = stub([
      y(TOMATE, 8, "2026-01-01"),
      y(TOMATE, 12, "2026-04-01"),
      y(CEBOLLA, 15, "2026-02-01"),
    ]);
    const out = await loadYieldsAt(
      client,
      "co-1",
      [TOMATE, CEBOLLA, "ing-x"],
      "2026-04-15"
    );
    expect(calls.filter((c) => c[0] === "from")).toEqual([
      ["from", "ingredient_yields"],
    ]);
    expect(calls).toContainEqual(["eq", "company_id", "co-1"]);
    expect(calls).toContainEqual(["eq", "status", "approved"]);
    expect(calls).toContainEqual(["lte", "effective_from", "2026-04-15"]);
    expect(out.get(TOMATE)?.lossPct).toBe(12);
    expect(out.get(CEBOLLA)?.lossPct).toBe(15);
    expect(out.has("ing-x")).toBe(false);
  });
  it("makes no query for no ingredients or a bad date", async () => {
    const { client, calls } = stub([]);
    expect((await loadYieldsAt(client, "co-1", [], "2026-04-15")).size).toBe(0);
    expect((await loadYieldsAt(client, "co-1", [TOMATE], "soon")).size).toBe(0);
    expect(calls).toEqual([]);
  });
  it("throws the database error", async () => {
    const { client } = stub([], { message: "boom" });
    await expect(
      loadYieldsAt(client, "co-1", [TOMATE], "2026-04-15")
    ).rejects.toThrow("boom");
  });
});

describe("loadBufferAt", () => {
  it("returns the buffer in force, scoped to company and restaurant", async () => {
    const { client, calls } = stub([b(CENTRO, 10, "2026-05-01")]);
    expect(await loadBufferAt(client, "co-1", CENTRO, "2026-06-01")).toEqual({
      bufferPct: 10,
      effectiveFrom: "2026-05-01",
    });
    expect(calls).toContainEqual(["eq", "company_id", "co-1"]);
    expect(calls).toContainEqual(["eq", "location_id", CENTRO]);
    expect(calls).toContainEqual(["lte", "effective_from", "2026-06-01"]);
  });
  it("is null when nothing is set by then", async () => {
    const { client } = stub([]);
    expect(await loadBufferAt(client, "co-1", CENTRO, "2026-06-01")).toBeNull();
  });
  it("a numeric string from the database is a number", async () => {
    const { client } = stub([
      { ...b(CENTRO, 0, "2026-05-01"), buffer_pct: "7.50" },
    ]);
    expect(
      (await loadBufferAt(client, "co-1", CENTRO, "2026-06-01"))?.bufferPct
    ).toBe(7.5);
  });
});
