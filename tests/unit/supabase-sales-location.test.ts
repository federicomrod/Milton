import { describe, it, expect } from "vitest";
import type { POSSalesItem } from "@/types/restaurant";
import {
  computeOverviewFromRows,
  computeDishSales,
} from "@/lib/restaurant/supabase-sales";

// Multi-Restaurant UX v1 — Phase 4/7: fixtures simulating two locations
// (A and B) under one company, mirroring what
// `.eq("location_id", selectedLocationId)` hands back from Supabase for
// each case. These test the AGGREGATION is correctly scoped once the rows
// it's given are scoped — the query-level `.eq()` predicate itself is a
// single well-understood equality filter.

const LOCATION_A = "loc-a";
const LOCATION_B = "loc-b";

const ALL_ROWS: POSSalesItem[] = [
  {
    id: "1",
    company_id: "co-1",
    location_id: LOCATION_A,
    menu_item_id: "item-a1",
    check_id: "order-a1",
    sale_date: "2026-09-01",
    quantity: 2,
    unit_price: 10,
    total_revenue: 20,
    currency: "MXN",
  },
  {
    id: "2",
    company_id: "co-1",
    location_id: LOCATION_A,
    menu_item_id: "item-a2",
    check_id: "order-a2",
    sale_date: "2026-09-01",
    quantity: 1,
    unit_price: 30,
    total_revenue: 30,
    currency: "MXN",
  },
  {
    id: "3",
    company_id: "co-1",
    location_id: LOCATION_B,
    menu_item_id: "item-b1",
    check_id: "order-b1",
    sale_date: "2026-09-01",
    quantity: 5,
    unit_price: 8,
    total_revenue: 40,
    currency: "MXN",
  },
];

const ROWS_A = ALL_ROWS.filter((r) => r.location_id === LOCATION_A);
const ROWS_B = ALL_ROWS.filter((r) => r.location_id === LOCATION_B);

describe("Multi-Restaurant UX v1 — dashboard KPI scoping", () => {
  it("consolidated mode (all rows) includes both restaurants' revenue", () => {
    const overview = computeOverviewFromRows(ALL_ROWS);
    expect(overview.total_revenue).toBe(20 + 30 + 40);
    expect(overview.total_orders).toBe(3);
  });

  it("Restaurant A mode (rows pre-filtered to location A) includes only A's sales", () => {
    const overview = computeOverviewFromRows(ROWS_A);
    expect(overview.total_revenue).toBe(20 + 30);
    expect(overview.total_orders).toBe(2);
  });

  it("Restaurant B mode (rows pre-filtered to location B) includes only B's sales", () => {
    const overview = computeOverviewFromRows(ROWS_B);
    expect(overview.total_revenue).toBe(40);
    expect(overview.total_orders).toBe(1);
  });

  it("existing single-restaurant flow (every row shares one location_id) is unaffected", () => {
    const singleLocationRows = ALL_ROWS.map((r) => ({
      ...r,
      location_id: LOCATION_A,
    }));
    const consolidated = computeOverviewFromRows(singleLocationRows);
    expect(consolidated.total_revenue).toBe(20 + 30 + 40);
  });
});

describe("Multi-Restaurant UX v1 — dish list scoping", () => {
  const rawRowsFor = (rows: POSSalesItem[]) =>
    rows.map((r) => ({
      id: r.id,
      company_id: r.company_id,
      location_id: r.location_id,
      menu_item_id: r.menu_item_id,
      sale_date: r.sale_date,
      order_id: null as string | null,
      check_id: r.check_id ?? null,
      raw_item_name: r.menu_item_id === "item-b1" ? "B Poke Bowl" : "A Dish",
      quantity: r.quantity,
      gross_revenue: r.total_revenue,
      net_revenue: r.total_revenue,
      currency: r.currency,
      sales_channel: null as string | null,
      payment_type: null as string | null,
      category: null as string | null,
      sub_category: null as string | null,
    }));

  it("Restaurant A's dish list never includes Restaurant B's exclusive dish", () => {
    const dishes = computeDishSales(rawRowsFor(ROWS_A));
    expect(dishes.some((d) => d.item_name === "B Poke Bowl")).toBe(false);
  });

  it("Restaurant B's dish list only contains B's own dish", () => {
    const dishes = computeDishSales(rawRowsFor(ROWS_B));
    expect(dishes.map((d) => d.item_name)).toEqual(["B Poke Bowl"]);
  });
});
