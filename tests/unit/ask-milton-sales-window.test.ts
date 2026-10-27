// The «1,788 unidades la última semana» bug: «la ultima semanas» was not
// read as a week (the whole month was used), and combo component lines
// were counted as extra units on top of the combo itself.
import { describe, expect, it } from "vitest";
import {
  buildSalesSnapshot,
  cleanPosItemName,
  relativeWindowDays,
  resolveSalesPeriod,
  type SalesFactRow,
} from "@/lib/restaurant/ask-milton-sales";
import {
  buildDeterministicAnswer,
  salesPeriodPhrase,
} from "@/lib/restaurant/ask-milton-prompt";
import { topSellingAnswerIsGrounded } from "@/lib/restaurant/ask-milton-ground";
import {
  ES_TZ,
  salesContext,
  salesFact,
} from "./helpers/ask-milton-sales-fixtures";

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const octDates = Array.from(
  { length: 27 },
  (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`
);

describe("relative windows — «la última semana» is the last 7 days", () => {
  it.each([
    ["cual es el plato mas vendido de la ultima semanas?", 7],
    ["lo más vendido de la última semana", 7],
    ["ventas de la semana pasada", 7],
    ["best seller last week", 7],
    ["últimos 14 días", 14],
    ["ultimos tres dias", 3],
    ["last 2 weeks", 14],
    ["past 30 days", 30],
  ])("%s → %i days", (q, days) => {
    expect(relativeWindowDays(fold(q))).toBe(days);
  });

  it("does not read a plain month question as a window", () => {
    expect(relativeWindowDays(fold("lo más vendido en octubre"))).toBeNull();
  });

  it("ends the window on the latest synced sale date", () => {
    const period = resolveSalesPeriod(
      "cual es el plato mas vendido de la ultima semanas?",
      octDates
    );
    expect(period).toEqual({
      start: "2026-10-21",
      end: "2026-10-27",
      source: "last_week",
      days: 7,
    });
  });

  it("only counts sales inside the 7 days", () => {
    const rows = octDates.map((d) =>
      salesFact({ sale_date: d, item_name: "Típico", quantity: 10, order_key: d })
    );
    const snap = buildSalesSnapshot(rows, ES_TZ, {
      question: "cual es el plato mas vendido de la ultima semanas?",
    });
    expect(snap.totals.units).toBe(70);
    expect(snap.top_items_by_units[0].units).toBe(70);
  });
});

describe("combo lines — units counted once, revenue on the combo", () => {
  const rows: SalesFactRow[] = [
    salesFact({
      sale_date: "2026-10-26",
      item_name: "Típico Nicaragüense",
      quantity: 2,
      revenue: 20,
      order_key: "o1",
      line_id: "L1",
    }),
    salesFact({
      sale_date: "2026-10-26",
      item_name: "Gallo pinto",
      quantity: 2,
      revenue: 0,
      order_key: "o1",
      line_id: "L2",
      combo_parent_line_id: "L1",
    }),
    salesFact({
      sale_date: "2026-10-26",
      item_name: "Huevos",
      quantity: 2,
      revenue: 4,
      order_key: "o1",
      line_id: "L3",
      combo_parent_line_id: "L1",
    }),
  ];

  it("does not add component units to the total", () => {
    const snap = buildSalesSnapshot(rows, ES_TZ, { question: "última semana" });
    expect(snap.totals.units).toBe(2);
    expect(snap.totals.revenue).toBe(24);
    expect(snap.top_items_by_units).toHaveLength(1);
    expect(snap.top_items_by_units[0]).toMatchObject({
      name: "Típico nicaragüense",
      units: 2,
      revenue: 24,
    });
  });

  it("a line pointing at itself is not a combo part", () => {
    const snap = buildSalesSnapshot(
      [{ ...rows[0], combo_parent_line_id: "L1" }],
      ES_TZ,
      {}
    );
    expect(snap.totals.units).toBe(2);
  });
});

describe("POS names — clean dish name, variants merged", () => {
  it.each([
    ['"TIPICO NICARAGÜENSE (Huevo frito, Queso)"', "Tipico nicaragüense"],
    ["Café  americano (Grande)", "Café americano"],
    ["Pupusa de queso", "Pupusa de queso"],
  ])("%s → %s", (raw, clean) => {
    expect(cleanPosItemName(raw)).toBe(clean);
  });

  it("merges option variants into one item", () => {
    const snap = buildSalesSnapshot(
      [
        salesFact({ sale_date: "2026-10-26", item_name: "Café (Grande)", quantity: 3, order_key: "a" }),
        salesFact({ sale_date: "2026-10-26", item_name: "Café (Pequeño)", quantity: 2, order_key: "b" }),
      ],
      ES_TZ,
      {}
    );
    expect(snap.top_items_by_units).toHaveLength(1);
    expect(snap.top_items_by_units[0]).toMatchObject({ name: "Café", units: 5 });
  });
});

describe("top-selling answer states the real window", () => {
  const none = { resolved_ingredients: [], resolved_menu_items: [] };
  const weekRows = octDates.map((d, i) =>
    salesFact({
      sale_date: d,
      item_name: i % 2 ? "Típico Nicaragüense" : "Café",
      quantity: 5,
      order_key: d,
    })
  );

  it("names the last-7-days dates, not the month", () => {
    const ctx = salesContext(weekRows, "es");
    ctx.sales = buildSalesSnapshot(weekRows, ES_TZ, {
      question: "cual es el plato mas vendido de la ultima semanas?",
    });
    const out = buildDeterministicAnswer(
      ctx,
      "cual es el plato mas vendido de la ultima semanas?",
      "top_selling_items",
      none
    );
    expect(out.answer).toMatch(
      /^Tu plato más vendido en los últimos 7 días con ventas \(del 21 al 27 de octubre\) es /
    );
    expect(out.answer).not.toMatch(/"/);
  });

  it("honours «top 3» as a numbered list", () => {
    const rows = ["A", "B", "C", "D", "E"].map((n, i) =>
      salesFact({ sale_date: "2026-10-26", item_name: n, quantity: 10 - i, order_key: n })
    );
    const ctx = salesContext(rows, "es");
    ctx.sales = buildSalesSnapshot(rows, ES_TZ, { question: "última semana" });
    const out = buildDeterministicAnswer(
      ctx,
      "top 3 platos más vendidos de la última semana",
      "top_selling_items",
      none
    );
    const lines = out.answer.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(3);
    expect(out.answer.startsWith("Tus 3 platos más vendidos")).toBe(true);
  });

  it("a month is never called a week", () => {
    const snap = buildSalesSnapshot(weekRows, ES_TZ, { question: "octubre" });
    expect(salesPeriodPhrase(snap.period, "es", "x", 2026)).toBe("en octubre");
    expect(salesPeriodPhrase(snap.period, "es", "x", 2027)).toBe(
      "en octubre de 2026"
    );
    const ctx = salesContext(weekRows, "es");
    ctx.sales = snap;
    expect(
      topSellingAnswerIsGrounded(
        `Tu plato más vendido de la última semana es ${snap.top_items_by_units[0].name}.`,
        ctx,
        "lo más vendido"
      )
    ).toBe(false);
    expect(
      topSellingAnswerIsGrounded(
        `Tu plato más vendido en octubre es ${snap.top_items_by_units[0].name}.`,
        ctx,
        "lo más vendido"
      )
    ).toBe(true);
  });
});
