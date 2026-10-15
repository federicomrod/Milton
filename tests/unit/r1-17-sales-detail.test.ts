// R1-17b: the arithmetic of Ventas › Detalle (acceptance 5–9, T1–T6). Synthetic.
import { describe, expect, it } from "vitest";
import {
  buildBusinessDayConfig,
  type Shift,
} from "@/lib/restaurant/business-day";
import {
  buildDetailCube,
  OTHER_SHIFT,
} from "@/lib/restaurant/sales-detail-cube";
import {
  baselineFor,
  computeDetail,
  DEFAULT_STATE,
  heatValue,
  parseDetailState,
  prepareCube,
  serializeDetailState,
  toggleToken,
  TILE_DELTA_THRESHOLD,
  type DetailState,
} from "@/lib/restaurant/sales-detail";
import { addDays } from "@/lib/restaurant/cockpit-math";

const TZ = "America/El_Salvador"; // UTC-6
const ALL = [1, 2, 3, 4, 5, 6, 7];
const sh = (
  name: string,
  s: string,
  e: string,
  order: number,
  active = true
): Shift & { restaurant_id: string } => ({
  restaurant_id: "L1",
  name,
  start_time: s,
  end_time: e,
  weekdays: ALL,
  active,
  sort_order: order,
});
const config = (shifts: Array<Shift & { restaurant_id: string }>) =>
  buildBusinessDayConfig(shifts, ["L1"]);
const SEED = [
  sh("Almuerzo", "00:00", "17:00", 1),
  sh("Cena", "17:00", "24:00", 2),
];

interface L {
  date: string;
  time: string; // local HH:MM
  order: string;
  net: number;
  qty?: number;
  cat?: string;
  ch?: string | null;
  pay?: string | null;
  tip?: boolean;
}
const rowsOf = (lines: L[], cutoff = 240) =>
  lines.map((l) => ({
    sale_date: l.date,
    order_placed_at: new Date(`${l.date}T${l.time}:00-06:00`).toISOString(),
    location_id: "L1",
    check_id: l.order,
    raw_item_name: l.tip ? "Propina" : "x",
    is_tip: l.tip ?? false,
    quantity: l.qty ?? 1,
    gross_revenue: l.net,
    currency: "USD",
    category: l.cat ?? "Platos",
    sales_channel: l.ch === undefined ? "in_store" : l.ch,
    payment_type: l.pay === undefined ? "Efectivo" : l.pay,
    business_cutoff_min: cutoff,
  }));
const cubeOf = (lines: L[], shifts = SEED) =>
  buildDetailCube(rowsOf(lines) as never, {
    timezone: TZ,
    currency: "USD",
    config: config(shifts),
  });
const stateOf = (over: Partial<DetailState> = {}): DetailState => ({
  ...DEFAULT_STATE,
  ...over,
});
const view = (
  lines: L[],
  over: Partial<DetailState> = {},
  shifts = SEED,
  shiftsVisible = true
) =>
  computeDetail({
    prepared: prepareCube(cubeOf(lines, shifts)),
    state: stateOf(over),
    targets: [],
    scope: { locationId: null, restaurantIds: ["L1"] },
    shiftsVisible,
  })!;

// One week (Sat 25 Jul – Fri 31 Jul 2026), 3 orders a day, one of them with two categories.
function week(): L[] {
  const out: L[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays("2026-07-25", i);
    out.push({
      date,
      time: "12:30",
      order: `${date}-a`,
      net: 40 + i,
      cat: "Parrilla",
      ch: "in_store",
      pay: "Efectivo",
    });
    out.push({
      date,
      time: "12:30",
      order: `${date}-a`,
      net: 10,
      cat: "Bebidas",
      ch: "in_store",
      pay: "Efectivo",
      qty: 2,
    });
    out.push({
      date,
      time: "19:15",
      order: `${date}-b`,
      net: 60,
      cat: "Parrilla",
      ch: "takeaway",
      pay: "Tarjeta",
    });
    out.push({
      date,
      time: "20:00",
      order: `${date}-c`,
      net: 25,
      cat: "Postres",
      ch: "in_store",
      pay: "Tarjeta",
    });
  }
  out.push({
    date: "2026-07-31",
    time: "20:05",
    order: "2026-07-31-c",
    net: 3,
    tip: true,
    cat: "x",
  });
  return out;
}
const TOTAL = Array.from({ length: 7 }, (_, i) => 40 + i + 10 + 60 + 25).reduce(
  (a, b) => a + b,
  0
);

describe("totals", () => {
  const v = view(week());
  it("net sales, DISTINCT tickets, units, tips and best day", () => {
    expect(v.kpis.net.value).toBe(TOTAL);
    expect(v.kpis.tickets.value).toBe(21); // 3 orders × 7 days; the 2-category order counts once
    expect(v.kpis.ticket.value).toBeCloseTo(TOTAL / 21, 6);
    expect(v.kpis.units.value).toBe(7 * (1 + 2 + 1 + 1));
    expect(v.kpis.tips).toBe(3);
    expect(v.kpis.best).toMatchObject({ date: "2026-07-31", tickets: 3 });
  });
  it("the daily series has every day of the period (bars for < 8 points)", () => {
    expect(v.daily).toHaveLength(7);
    expect(v.daily.reduce((a, d) => a + d.net, 0)).toBe(TOTAL);
  });
});

describe("tiles and tables (acceptance 5, T6)", () => {
  it("categoría / canal / pago rows sum to Ventas netas (±$1) and shares to 100% (±0.2)", () => {
    for (const dim of ["categoria", "canal", "pago", "turno"] as const) {
      const v = view(week(), { dim });
      expect(
        Math.abs(v.dimRows.reduce((a, r) => a + r.net, 0) - TOTAL)
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(v.dimRows.reduce((a, r) => a + r.share, 0) - 100)
      ).toBeLessThanOrEqual(0.2);
    }
  });
  it("sorted by sales; tiles and table are the same rows", () => {
    const v = view(week());
    const nets = v.dimRows.map((r) => r.net);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
    expect(v.dimRows[0].label).toBe("Parrilla");
  });
  it("T6: two categories selected → the KPIs equal the sum of those tiles; the tiles still show every category", () => {
    const v = view(week(), { categories: ["Parrilla", "Postres"] });
    const picked = v.dimRows.filter((r) => r.selected);
    expect(picked.map((r) => r.label).sort()).toEqual(["Parrilla", "Postres"]);
    expect(v.dimRows).toHaveLength(3);
    expect(v.kpis.net.value).toBeCloseTo(
      picked.reduce((a, r) => a + r.net, 0),
      6
    );
    expect(v.selection?.labels.sort()).toEqual(["Parrilla", "Postres"]);
    expect(v.selection?.net).toBeCloseTo(v.kpis.net.value as number, 2);
  });
  it("category tiles count a ticket per category the order has", () => {
    const v = view(week());
    expect(v.dimRows.find((r) => r.label === "Bebidas")?.tickets).toBe(7);
    expect(v.dimRows.find((r) => r.label === "Parrilla")?.tickets).toBe(14);
  });
  it("Canal = Para llevar updates KPIs, the chart and the heatmap; other dims' tiles follow it", () => {
    const v = view(week(), { channels: ["takeaway"] });
    expect(v.kpis.net.value).toBe(7 * 60);
    expect(v.kpis.tickets.value).toBe(7);
    expect(v.daily.every((d) => d.net === 60)).toBe(true);
    const heatSum = v.heat.flat().reduce((a, c) => a + c.net, 0);
    expect(heatSum).toBe(7 * 60);
    expect(v.dimRows.map((r) => r.label)).toEqual(["Parrilla"]);
  });
});

describe("heatmap (acceptance 7)", () => {
  it("cells sum to Ventas netas; hours are the real local clock hours", () => {
    const v = view(week());
    expect(v.heat.flat().reduce((a, c) => a + c.net, 0)).toBe(TOTAL);
    // Saturday 25 Jul (iso 6) 12:30 → hour 12
    expect(v.heat[6][12].net).toBe(40 + 10);
    expect(v.heat[6][19].net).toBe(60);
    expect(heatValue(v.heat[6][12], "ticket")).toBe(50);
    expect(heatValue(v.heat[6][3], "ticket")).toBeNull();
  });
  it("a selected day + hour filters KPIs but not the grid itself", () => {
    const v = view(week(), { weekdays: [6], hours: [12] });
    expect(v.kpis.net.value).toBe(50);
    expect(v.heat.flat().reduce((a, c) => a + c.net, 0)).toBe(TOTAL); // every cell still visible
  });
  it("«Cruzar con» gives a small grid per top value", () => {
    const v = view(week(), { cross: "canal" });
    expect(v.cross.map((c) => c.label)).toEqual(["Comer aquí", "Para llevar"]);
    expect(v.cross[1].grid.flat().reduce((a, c) => a + c.net, 0)).toBe(420);
  });
});

describe("shifts (T1, T2, T5)", () => {
  it("T1/T5: the seeded split → Almuerzo/Cena; shifts + Otro horario = Ventas netas", () => {
    const v = view(week());
    const cards = v.shiftCards!;
    expect(cards.map((c) => c.name)).toEqual(["Almuerzo", "Cena"]);
    expect(cards[0].net).toBe(7 * 50 + 21); // 12:30 orders (40+i+10) summed
    expect(cards.reduce((a, c) => a + c.net, 0)).toBe(TOTAL);
  });
  it("«Otro horario» shows only when it has sales, and still adds up", () => {
    const lines = [
      ...week(),
      { date: "2026-07-31", time: "03:00", order: "late", net: 8 } as L,
    ];
    const v = view(lines, {}, [
      sh("Almuerzo", "11:00", "17:00", 1),
      sh("Cena", "18:00", "23:00", 2),
    ]);
    const other = v.shiftCards!.find((c) => c.other)!;
    expect(other.name).toBe(OTHER_SHIFT);
    expect(other.net).toBe(8);
    expect(v.shiftCards!.reduce((a, c) => a + c.net, 0)).toBeCloseTo(
      v.kpis.net.value as number,
      6
    );
  });
  it("T2: with shiftsVisible false there are no cards; the KPIs do not change", () => {
    const a = view(week(), {}, SEED, true);
    const b = view(
      week(),
      {},
      [
        sh("Almuerzo", "00:00", "17:00", 1, false),
        sh("Cena", "17:00", "24:00", 2),
      ],
      false
    );
    expect(b.shiftCards).toBeNull();
    expect(b.kpis.net.value).toBe(a.kpis.net.value);
    expect(b.kpis.tickets.value).toBe(a.kpis.tickets.value);
  });
  it("a Turno filter narrows everything to that shift", () => {
    const v = view(week(), { shifts: ["Cena"] });
    expect(v.kpis.net.value).toBe(7 * 85);
    expect(v.shiftCards!.map((c) => c.name)).toEqual(["Almuerzo", "Cena"]); // cards keep every shift
  });
});

describe("Δ vs the comparison (acceptance 9)", () => {
  // two weeks: 18–24 Jul = 100/day (1 order), 25–31 Jul = 150/day
  const two = (): L[] => {
    const out: L[] = [];
    for (let i = 0; i < 7; i += 1) {
      out.push({
        date: addDays("2026-07-18", i),
        time: "12:00",
        order: `p${i}`,
        net: 100,
      });
      out.push({
        date: addDays("2026-07-25", i),
        time: "12:00",
        order: `c${i}`,
        net: 150,
      });
    }
    return out;
  };
  it("semana anterior: (actual − anterior) ÷ anterior", () => {
    const v = view(two(), { compare: "prev_week" });
    expect(v.kpis.net.delta).toBe(50);
    expect(v.kpis.tickets.delta).toBe(0);
    expect(v.kpis.ticket.delta).toBe(50);
  });
  it("no comparable period → «—» (null), never 0%", () => {
    const v = view(week(), { compare: "prev_week" }); // the data starts on the 25th
    expect(v.kpis.net.delta).toBeNull();
    expect(v.kpis.tickets.delta).toBeNull();
    expect(v.dimRows.every((r) => r.delta === null)).toBe(true);
    expect(view(two(), { compare: "last_year" }).kpis.net.delta).toBeNull();
  });
  it("a tile whose base is 0 is «—», not +∞ or 0", () => {
    const lines = two().concat([
      { date: "2026-07-31", time: "13:00", order: "n", net: 20, cat: "Nueva" },
    ]);
    const v = view(lines, { compare: "prev_week" });
    expect(v.dimRows.find((r) => r.label === "Nueva")?.delta).toBeNull();
    expect(v.dimRows.find((r) => r.label === "Platos")?.delta).not.toBeNull();
  });
  it("trailing averages are cut to where the data starts and scaled to the days of the period", () => {
    const b = baselineFor(
      "avg_6",
      { from: "2026-07-25", to: "2026-07-31" },
      "2026-07-18"
    )!;
    expect(b.range).toEqual({ from: "2026-07-18", to: "2026-07-24" });
    expect(b.scale).toBe(1);
    expect(b.note).toBe("solo 7 días de datos");
    expect(
      baselineFor(
        "avg_6",
        { from: "2026-07-18", to: "2026-07-24" },
        "2026-07-18"
      )
    ).toBeNull();
    const v = view(two(), { compare: "avg_6" });
    expect(v.kpis.net.delta).toBe(50);
  });
  it("the tile colour threshold is a constant", () => {
    expect(TILE_DELTA_THRESHOLD).toBe(15);
  });
});

describe("goals (Objetivos)", () => {
  const goal = (value: number, metric = "revenue") =>
    ({
      metric_key: metric,
      target_period: "monthly",
      target_value: value,
      location_id: null,
      effective_from: "2000-01-01",
      is_active: true,
      weekday_weights: null,
    }) as never;
  const run = (over: Partial<DetailState>, targets: unknown[]) =>
    computeDetail({
      prepared: prepareCube(cubeOf(week())),
      state: stateOf(over),
      targets: targets as never,
      scope: { locationId: null, restaurantIds: ["L1"] },
      shiftsVisible: true,
    })!;
  it("no goal → no line, no chip, never 0", () => {
    const v = run({}, []);
    expect(v.dailyTarget).toBe(false);
    expect(v.kpis.net.target).toBeNull();
    expect(v.kpis.net.vsTarget).toBeNull();
    expect(v.kpis.ticket.target).toBeNull();
  });
  it("with goals: the period target, the chip vs goal and the daily line", () => {
    const v = run({}, [goal(31000), goal(40, "avg_ticket")]);
    expect(v.dailyTarget).toBe(true);
    expect(v.kpis.net.target).toBeGreaterThan(0);
    expect(v.kpis.net.vsTarget).not.toBeNull();
    expect(v.kpis.ticket.target).toBe(40);
  });
  it("a dimension filter hides the goals (a sales goal is for the whole business)", () => {
    const v = run({ channels: ["takeaway"] }, [goal(31000)]);
    expect(v.dailyTarget).toBe(false);
    expect(v.kpis.net.target).toBeNull();
  });
});

describe("state in the URL", () => {
  it("round-trips, with defaults left out", () => {
    const s = stateOf({
      tab: "desglose",
      dim: "canal",
      view: "tabla",
      period: "30d",
      compare: "avg_6",
      categories: ["Platos y más", "B|ebidas".replace("|", "")],
      weekdays: [4],
      hours: [13],
    });
    const q = serializeDetailState(s);
    expect(serializeDetailState(DEFAULT_STATE).toString()).toBe("");
    expect(parseDetailState(new URLSearchParams(q.toString()))).toEqual(s);
  });
  it("garbage falls back to the defaults", () => {
    expect(
      parseDetailState(
        new URLSearchParams("tab=zzz&p=9&cmp=x&dia=99&hora=-1&desde=hoy")
      )
    ).toEqual(DEFAULT_STATE);
  });
  it("click toggles one value; ⌘/Ctrl/Shift adds; clicking the only one clears it", () => {
    expect(toggleToken([], "a", false)).toEqual(["a"]);
    expect(toggleToken(["a"], "a", false)).toEqual([]);
    expect(toggleToken(["a"], "b", false)).toEqual(["b"]);
    expect(toggleToken(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleToken(["a", "b"], "a", true)).toEqual(["b"]);
    expect(toggleToken(["a", "b"], "a", false)).toEqual(["a"]);
  });
});

describe("speed (acceptance 8: < 300 ms, no request)", () => {
  it(
    "100k+ rows: a full recompute with filters and a comparison is well under 300 ms",
    { timeout: 60_000 },
    () => {
      const lines: L[] = [];
      let order = 0;
      for (let d = 0; d < 400; d += 1) {
        const date = addDays("2025-06-01", d);
        for (let o = 0; o < 130; o += 1) {
          order += 1;
          const t = `${String(11 + (o % 11)).padStart(2, "0")}:${String((o * 7) % 60).padStart(2, "0")}`;
          for (const cat of ["Parrilla", "Bebidas", "Postres"].slice(
            0,
            1 + (o % 3)
          ))
            lines.push({
              date,
              time: t,
              order: `o${order}`,
              net: 10 + (o % 9),
              cat,
              ch: o % 5 ? "in_store" : "takeaway",
              pay: o % 2 ? "Efectivo" : "Tarjeta",
            });
        }
      }
      const prepared = prepareCube(cubeOf(lines));
      expect(prepared.n).toBeGreaterThan(100_000);
      const run = (over: Partial<DetailState>) =>
        computeDetail({
          prepared,
          state: stateOf({
            period: "90d",
            compare: "avg_12",
            cross: "canal",
            ...over,
          }),
          targets: [],
          scope: { locationId: null, restaurantIds: ["L1"] },
          shiftsVisible: true,
        })!;
      run({});
      const t0 = performance.now();
      run({
        channels: ["in_store"],
        categories: ["Parrilla", "Bebidas"],
        weekdays: [5],
        dim: "pago",
      });
      run({ dim: "turno" });
      const ms = (performance.now() - t0) / 2;
      console.log("RECOMPUTE ms", ms.toFixed(1), "rows", prepared.n);
      expect(ms).toBeLessThan(300);
    }
  );
});
