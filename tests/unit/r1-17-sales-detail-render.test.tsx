// R1-17b: Ventas › Detalle drawn (server-rendered pieces). Acceptance 1, 2, 3,
// 5, 6, 10 and the Spanish dictionary. Synthetic.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  buildBusinessDayConfig,
  type Shift,
} from "@/lib/restaurant/business-day";
import { buildDetailCube } from "@/lib/restaurant/sales-detail-cube";
import {
  computeDetail,
  DEFAULT_STATE,
  prepareCube,
  type DetailState,
} from "@/lib/restaurant/sales-detail";
import { addDays } from "@/lib/restaurant/cockpit-math";
import { FilterBar } from "@/components/restaurant/sales/detail/FilterBar";
import { KpiRow } from "@/components/restaurant/sales/detail/KpiRow";
import { DailyChart } from "@/components/restaurant/sales/detail/DailyChart";
import { DetailHeatmap } from "@/components/restaurant/sales/detail/DetailHeatmap";
import { DimensionPanel } from "@/components/restaurant/sales/detail/DimensionPanel";
import { ShiftCards } from "@/components/restaurant/sales/detail/ShiftCards";
import { moneyFmt } from "@/components/restaurant/sales/detail/format";

const ALL = [1, 2, 3, 4, 5, 6, 7];
const shifts: Array<Shift & { restaurant_id: string }> = [
  {
    restaurant_id: "L1",
    name: "Almuerzo",
    start_time: "00:00",
    end_time: "17:00",
    weekdays: ALL,
    active: true,
    sort_order: 1,
  },
  {
    restaurant_id: "L1",
    name: "Cena",
    start_time: "17:00",
    end_time: "24:00",
    weekdays: ALL,
    active: true,
    sort_order: 2,
  },
];
const rows = Array.from({ length: 7 }, (_, i) => addDays("2026-07-25", i))
  .flatMap((date, i) => [
    {
      date,
      t: "12:30",
      o: `${date}a`,
      net: 40 + i,
      cat: "De la parrilla",
      ch: "in_store",
      pay: "Link N1co",
    },
    {
      date,
      t: "19:00",
      o: `${date}b`,
      net: 60,
      cat: "Desayunos",
      ch: "takeaway",
      pay: "Efectivo",
    },
    {
      date,
      t: "20:00",
      o: `${date}c`,
      net: 25,
      cat: "Bebidas sin Licor",
      ch: null,
      pay: null,
    },
  ])
  .map((l) => ({
    sale_date: l.date,
    order_placed_at: new Date(`${l.date}T${l.t}:00-06:00`).toISOString(),
    location_id: "L1",
    check_id: l.o,
    raw_item_name: "x",
    quantity: 1,
    gross_revenue: l.net,
    currency: "USD",
    category: l.cat,
    sales_channel: l.ch,
    payment_type: l.pay,
    business_cutoff_min: 240,
  }));
const cube = buildDetailCube(rows as never, {
  timezone: "America/El_Salvador",
  currency: "USD",
  config: buildBusinessDayConfig(shifts, ["L1"]),
});
const prepared = prepareCube(cube);
const money = moneyFmt("USD");
const run = (over: Partial<DetailState> = {}) => {
  const state = { ...DEFAULT_STATE, ...over };
  return {
    state,
    view: computeDetail({
      prepared,
      state,
      targets: [],
      scope: { locationId: null, restaurantIds: ["L1"] },
      shiftsVisible: true,
    })!,
  };
};
const text = (el: React.ReactElement) =>
  renderToString(el)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
const noop = () => {};

function everything(over: Partial<DetailState> = {}) {
  const { state, view } = run(over);
  const channelView = run({ ...over, dim: "canal" }).view;
  const parts = [
    createElement(FilterBar, {
      state,
      cube,
      shiftsVisible: true,
      lastDay: cube.last_day,
      onChange: noop,
    }),
    createElement(KpiRow, { view, currency: "USD" }),
    createElement(DailyChart, {
      bars: view.daily,
      metric: state.chart,
      money: (n: number) => money(n),
      hasTarget: view.dailyTarget,
      onMetric: noop,
      onDay: noop,
    }),
    createElement(ShiftCards, {
      cards: view.shiftCards!,
      hours: { Almuerzo: "00:00–17:00" },
      selected: [],
      money,
      onToggle: noop,
    }),
    createElement(DetailHeatmap, {
      grid: view.heat,
      cross: view.cross,
      metric: "ventas",
      crossKey: "ninguno",
      selectedDays: [],
      selectedHours: [],
      money,
      onMetric: noop,
      onCross: noop,
      onCell: noop,
    }),
    createElement(DimensionPanel, {
      view,
      dim: "categoria",
      mode: "tarjetas",
      money,
      shiftsVisible: true,
      compareShort: view.compare.short,
      onDim: noop,
      onMode: noop,
      onToggle: noop,
      onClear: noop,
      onSeeDishes: noop,
    }),
    createElement(DimensionPanel, {
      view: channelView,
      dim: "canal",
      mode: "tabla",
      money,
      shiftsVisible: true,
      compareShort: view.compare.short,
      onDim: noop,
      onMode: noop,
      onToggle: noop,
      onClear: noop,
      onSeeDishes: noop,
    }),
  ];
  return parts.map(text).join(" ");
}

describe("acceptance 1 — Spanish only", () => {
  it("no English strings on the page; channel names are translated; Odoo names stay as they are", () => {
    const all = everything();
    for (const english of [
      "Overview",
      "Trends",
      "Channels",
      "Items",
      "Targets",
      "Revenue",
      "Orders",
      "Eat In",
      "To Go",
      "Unknown",
      "Payment",
      "Category",
      "More filters",
      "Edit targets",
      "AI recommendations",
      "Net sales",
      "Average ticket",
      "Best day",
      "Unique items",
      "Avg item price",
      "Lunch",
      "Dinner",
      "Apply",
      "Search",
    ]) {
      expect(all, english).not.toContain(english);
    }
    expect(all).toContain("Comer aquí");
    expect(all).toContain("Para llevar");
    expect(all).toContain("Sin canal");
    expect(all).toContain("De la parrilla");
  });
});

describe("acceptance 1 — payments", () => {
  it("«Sin forma de pago» for a line with none; Odoo's payment names stay as they are", () => {
    const { view } = run({ dim: "pago" });
    const t = text(
      createElement(DimensionPanel, {
        view,
        dim: "pago",
        mode: "tarjetas",
        money,
        shiftsVisible: true,
        compareShort: "x",
        onDim: noop,
        onMode: noop,
        onToggle: noop,
        onClear: noop,
        onSeeDishes: noop,
      })
    );
    expect(t).toContain("Sin forma de pago");
    expect(t).toContain("Link N1co");
    expect(t).toContain("Efectivo");
  });
});

describe("acceptance 2, 3 — what is gone", () => {
  it("no Targets tab, no Edit targets, no AI placeholder; Objetivos is a link", () => {
    const all = everything();
    expect(all).not.toMatch(
      /Targets|Edit targets|not active yet|recommendations/i
    );
    const html = renderToString(
      createElement(FilterBar, {
        state: DEFAULT_STATE,
        cube,
        shiftsVisible: true,
        lastDay: cube.last_day,
        onChange: noop,
      })
    );
    expect(html).toContain('href="/dashboard/restaurant/data/objetivos"');
    expect(html).toContain("Configuración › Objetivos");
  });
});

describe("the page", () => {
  it("five KPIs; best day; Δ is «—» without a comparable period (never 0%)", () => {
    const { view } = run();
    const t = text(createElement(KpiRow, { view, currency: "USD" }));
    for (const l of [
      "Ventas netas",
      "Tickets",
      "Ticket promedio",
      "Unidades",
      "Mejor día",
    ])
      expect(t).toContain(l);
    expect(t).toContain("vs sem. ant. —");
    expect(t).not.toContain("0%");
  });
  it("acceptance 6: 7 days = bars, 30 days = a straight line, no area", () => {
    const { view } = run();
    const bars = renderToString(
      createElement(DailyChart, {
        bars: view.daily,
        metric: "ventas",
        money: (n: number) => money(n),
        hasTarget: false,
        onMetric: noop,
        onDay: noop,
      })
    );
    expect((bars.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(14); // hit area + bar per day
    expect(bars).not.toContain("<polyline");
    const many = Array.from({ length: 30 }, (_, i) => ({
      date: addDays("2026-07-01", i),
      net: 100 + i,
      tickets: 10,
      target: null,
    }));
    const line = renderToString(
      createElement(DailyChart, {
        bars: many,
        metric: "ventas",
        money: (n: number) => money(n),
        hasTarget: false,
        onMetric: noop,
        onDay: noop,
      })
    );
    expect(line).toContain("<polyline");
    expect(line).not.toContain("<area");
    expect(line).not.toMatch(/ C\d/);
  });
  it("acceptance 5/T6: tiles and table show identical numbers", () => {
    const { view } = run({ dim: "canal" });
    const tiles = text(
      createElement(DimensionPanel, {
        view,
        dim: "canal",
        mode: "tarjetas",
        money,
        shiftsVisible: true,
        compareShort: "sem. ant.",
        onDim: noop,
        onMode: noop,
        onToggle: noop,
        onClear: noop,
        onSeeDishes: noop,
      })
    );
    const table = text(
      createElement(DimensionPanel, {
        view,
        dim: "canal",
        mode: "tabla",
        money,
        shiftsVisible: true,
        compareShort: "sem. ant.",
        onDim: noop,
        onMode: noop,
        onToggle: noop,
        onClear: noop,
        onSeeDishes: noop,
      })
    );
    for (const r of view.dimRows) {
      expect(tiles).toContain(money(r.net));
      expect(table).toContain(money(r.net));
      expect(tiles).toContain(`${r.tickets} tickets`);
    }
    expect(table).toContain("$/unid.");
    expect(tiles).not.toContain("$/unid.");
  });
  it("T6: a Δ chip is grey «≈» below 15% and «—» without data", () => {
    const { view } = run();
    const html = renderToString(
      createElement(DimensionPanel, {
        view,
        dim: "categoria",
        mode: "tarjetas",
        money,
        shiftsVisible: true,
        compareShort: "sem. ant.",
        onDim: noop,
        onMode: noop,
        onToggle: noop,
        onClear: noop,
        onSeeDishes: noop,
      })
    );
    expect(html).toContain("—");
    expect(html).not.toContain("bg-[#e7f6ee]");
    expect(html).not.toContain("bg-[#fdecec]");
  });
  it("a selection shows the summary chip with its sum and share, and the blue outline", () => {
    const { view } = run({ categories: ["De la parrilla", "Desayunos"] });
    const html = renderToString(
      createElement(DimensionPanel, {
        view,
        dim: "categoria",
        mode: "tarjetas",
        money,
        shiftsVisible: true,
        compareShort: "sem. ant.",
        onDim: noop,
        onMode: noop,
        onToggle: noop,
        onClear: noop,
        onSeeDishes: noop,
      })
    ).replace(/<!-- -->/g, "");
    expect(html).toMatch(
      /(De la parrilla \+ Desayunos|Desayunos \+ De la parrilla)/
    );
    expect(html).toContain('data-testid="sales-selection-chip"');
    expect(html).toContain("ring-[#1b40c8]");
  });
  it("shift cards show each shift's sales, share, tickets and ticket", () => {
    const { view } = run();
    const t = text(
      createElement(ShiftCards, {
        cards: view.shiftCards!,
        hours: {},
        selected: [],
        money,
        onToggle: noop,
      })
    );
    expect(t).toContain("Almuerzo");
    expect(t).toContain("Cena");
    expect(t).toMatch(/\d+% · \d+ tickets · ticket \$/);
  });
  it("with a single shift (or none) the Turno filter and dimension are not offered", () => {
    const { state, view } = run();
    const bar = renderToString(
      createElement(FilterBar, {
        state,
        cube,
        shiftsVisible: false,
        lastDay: cube.last_day,
        onChange: noop,
      })
    );
    expect(bar).not.toContain("Turno");
    const panel = text(
      createElement(DimensionPanel, {
        view,
        dim: "categoria",
        mode: "tarjetas",
        money,
        shiftsVisible: false,
        compareShort: "x",
        onDim: noop,
        onMode: noop,
        onToggle: noop,
        onClear: noop,
        onSeeDishes: noop,
      })
    );
    expect(panel).not.toContain("Turno");
  });
  it("the heatmap shows the busiest cell and the «Cruzar con» choice", () => {
    const { view } = run();
    const t = text(
      createElement(DetailHeatmap, {
        grid: view.heat,
        cross: [],
        metric: "ventas",
        crossKey: "ninguno",
        selectedDays: [],
        selectedHours: [],
        money,
        onMetric: noop,
        onCross: noop,
        onCell: noop,
      })
    );
    expect(t).toContain("Hora × día");
    expect(t).toContain("Pico:");
    expect(t).toContain("Cruzar con:");
    expect(t).toContain("Ticket prom.");
  });
});
