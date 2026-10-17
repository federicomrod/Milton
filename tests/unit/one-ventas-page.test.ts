// There is ONE Ventas page (the old Detalle). Redirect, links, the ported
// «Lo que destaca» / read / leaders (pure, from the cube, following the filters),
// the blue heat scale, and no orange in the sales area. Synthetic data.
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
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
import {
  dimensionLeader,
  leaderLabel,
  salesFacts,
  salesRead,
} from "@/lib/restaurant/sales-detail-insights";
import { addDays } from "@/lib/restaurant/cockpit-math";
import { SALES_DETAIL_HREF, SALES_HREF } from "@/lib/restaurant/navigation";
import {
  flattenVentasParams,
  ventasRedirectHref,
} from "@/lib/restaurant/sales-ventas-url";
import {
  HEAT_EMPTY,
  heatColor,
  heatText,
} from "@/lib/restaurant/ui/heat-scale";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
describe("/sales/detalle forwards to /sales keeping every param", () => {
  it("?p=30d&canal=x → /dashboard/restaurant/sales?p=30d&canal=x", () => {
    expect(ventasRedirectHref({ p: "30d", canal: "x" })).toBe(
      "/dashboard/restaurant/sales?p=30d&canal=x"
    );
  });
  it("keeps repeated and unknown params; no params → the bare page", () => {
    expect(ventasRedirectHref({ cat: ["a", "b"], location: "L1" })).toBe(
      "/dashboard/restaurant/sales?cat=a&cat=b&location=L1"
    );
    expect(ventasRedirectHref({})).toBe("/dashboard/restaurant/sales");
  });
  it("the Cockpit's old ?period=month|last_7 becomes ?p=30d|7d", () => {
    expect(ventasRedirectHref({ period: "month", location: "L1" })).toBe(
      "/dashboard/restaurant/sales?location=L1&p=30d"
    );
    expect(ventasRedirectHref({ period: "last_7" })).toBe(
      "/dashboard/restaurant/sales?p=7d"
    );
    // an explicit p wins, and period is kept out of the way only when mapped
    expect(ventasRedirectHref({ p: "90d", period: "month" })).toBe(
      "/dashboard/restaurant/sales?p=90d&period=month"
    );
    expect(flattenVentasParams({ period: "month" }).p).toBe("30d");
  });
  it("the detalle route page really redirects", async () => {
    const redirect = vi.fn((href: string) => {
      throw new Error(`REDIRECT:${href}`);
    });
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ redirect }));
    const { default: Page } =
      await import("@/app/dashboard/restaurant/sales/detalle/page");
    await expect(
      Page({ searchParams: Promise.resolve({ p: "30d", canal: "x" }) })
    ).rejects.toThrow("REDIRECT:/dashboard/restaurant/sales?p=30d&canal=x");
    vi.doUnmock("next/navigation");
  });
});

describe("every Ventas link lands on /dashboard/restaurant/sales", () => {
  it("the export is kept and equal; the sidebar and the Cockpit use it", () => {
    expect(SALES_HREF).toBe("/dashboard/restaurant/sales");
    expect(SALES_DETAIL_HREF).toBe("/dashboard/restaurant/sales");
    const nav = read("lib/restaurant/navigation.ts");
    expect(nav).toMatch(/href: SALES_HREF/);
    expect(nav).not.toContain("/sales/detalle");
    expect(read("components/restaurant/cockpit/v2/CockpitV2.tsx")).toContain(
      "withShellParams(SALES_DETAIL_HREF"
    );
    expect(read("components/restaurant/shell/AskMiltonDrawer.tsx")).toContain(
      "SALES_HREF"
    );
  });
});

// ---------------------------------------------------------------------------
// «Lo que destaca», the read, the leaders: pure, from the cube, with the filters
// ---------------------------------------------------------------------------
const TZ = "America/El_Salvador";
const ALL = [1, 2, 3, 4, 5, 6, 7];
const shift = (
  name: string,
  s: string,
  e: string,
  order: number
): Shift & { restaurant_id: string } => ({
  restaurant_id: "L1",
  name,
  start_time: s,
  end_time: e,
  weekdays: ALL,
  active: true,
  sort_order: order,
});
const SEED = [
  shift("Almuerzo", "00:00", "17:00", 1),
  shift("Cena", "17:00", "24:00", 2),
];
interface L {
  date: string;
  time: string;
  order: string;
  net: number;
  ch?: string;
}
const rowsOf = (lines: L[]) =>
  lines.map((l) => ({
    sale_date: l.date,
    order_placed_at: new Date(`${l.date}T${l.time}:00-06:00`).toISOString(),
    location_id: "L1",
    check_id: l.order,
    raw_item_name: "x",
    is_tip: false,
    quantity: 1,
    gross_revenue: l.net,
    currency: "USD",
    category: "Platos",
    sales_channel: l.ch ?? "in_store",
    payment_type: "Efectivo",
    business_cutoff_min: 240,
  }));
function view(
  lines: L[],
  over: Partial<DetailState> = {},
  shiftsVisible = true
) {
  const cube = buildDetailCube(rowsOf(lines) as never, {
    timezone: TZ,
    currency: "USD",
    config: buildBusinessDayConfig(SEED, ["L1"]),
  });
  return computeDetail({
    prepared: prepareCube(cube),
    state: { ...DEFAULT_STATE, ...over },
    targets: [],
    scope: { locationId: null, restaurantIds: ["L1"] },
    shiftsVisible,
  })!;
}
// Sat 25 Jul – Fri 31 Jul 2026: lunch in salón every day; dinner in salón; a big
// delivery order on Wednesday 29 at 13:00.
function week(): L[] {
  const out: L[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays("2026-07-25", i);
    out.push({ date, time: "12:30", order: `${date}-a`, net: 40 });
    out.push({
      date,
      time: "19:30",
      order: `${date}-b`,
      net: i === 6 ? 150 : 60,
    });
  }
  out.push({
    date: "2026-07-29",
    time: "13:00",
    order: "big",
    net: 300,
    ch: "delivery",
  });
  return out;
}
const fmt = {
  money: (n: number) => `$${Math.round(n)}`,
  day: (ymd: string) => ymd,
  hour: (h: number) => `${h}h`,
};

describe("«Lo que destaca» comes from the cube and follows the filters", () => {
  it("max 3 facts: best day, peak hour slot, top shift", () => {
    const facts = salesFacts(view(week()), fmt);
    expect(facts.length).toBeLessThanOrEqual(3);
    expect(facts.map((f) => f.id)).toEqual([
      "mejor_dia",
      "hora_fuerte",
      "turno",
    ]);
    // the best day is the one with the delivery order (40+60+300 = 400)
    expect(facts[0].body).toContain("2026-07-29");
    expect(facts[0].body).toContain("$400");
    // the peak slot is Wednesday 13h (the 300 order)
    expect(facts[1].body).toContain("miércoles");
    expect(facts[1].body).toContain("13h");
    // the top shift is Almuerzo or Cena with its share
    expect(facts[2].body).toMatch(/^(Almuerzo|Cena) · \d+% de las ventas/);
  });
  it("a channel filter changes the facts (the delivery order is filtered out)", () => {
    const inStore = salesFacts(view(week(), { channels: ["in_store"] }), fmt);
    expect(inStore[0].body).toContain("2026-07-31"); // Friday: 40 + 150
    expect(inStore[0].body).toContain("$190");
    expect(inStore[1].body).not.toContain("miércoles a las 13h");
    const delivery = salesFacts(view(week(), { channels: ["delivery"] }), fmt);
    expect(delivery[0].body).toContain("2026-07-29");
    expect(delivery[0].body).toContain("$300");
  });
  it("without shifts the third fact is the lunch / dinner split; no sales → no facts", () => {
    const facts = salesFacts(view(week(), {}, false), { ...fmt });
    // with shiftsVisible=false there are no shift cards
    expect(facts[2].id).toBe("franja");
    expect(facts[2].body).toMatch(
      /Antes de las 16h: \d+% · desde las 16h: \d+%/
    );
    expect(salesFacts(view(week(), { channels: ["nope"] }), fmt)).toEqual([]);
  });
});

describe("the one-paragraph read", () => {
  it("is deterministic text with the period's numbers, and follows the filters", () => {
    const all = salesRead(view(week()), fmt)!;
    expect(all).toContain("vendiste");
    expect(all).toContain("tickets");
    expect(all).toMatch(/ticket promedio de \$/);
    expect(all).toContain("Mejor día:");
    const filtered = salesRead(view(week(), { channels: ["in_store"] }), fmt)!;
    expect(filtered).not.toBe(all);
    expect(salesRead(view(week(), { channels: ["nope"] }), fmt)).toBeNull();
  });
  it("makes no AI call (pure; the page only offers the header's ask button)", () => {
    const src = read("lib/restaurant/sales-detail-insights.ts");
    expect(src).not.toMatch(/openai|fetch\(|OPENAI/i);
    expect(
      read("components/restaurant/sales/detail/Highlights.tsx")
    ).not.toMatch(/openai|fetch\(|openAskMilton/i);
  });
});

describe("the leader of each dimension", () => {
  it("«En salón · 94.2%»: the row with the most sales", () => {
    const rows = [
      { label: "Delivery", net: 50, share: 5.8 },
      { label: "En salón", net: 810, share: 94.2 },
    ];
    expect(leaderLabel(dimensionLeader(rows)!)).toBe("En salón · 94.2%");
    expect(dimensionLeader([])).toBeNull();
    expect(dimensionLeader([{ label: "x", net: 0, share: 0 }])).toBeNull();
  });
  it("is a one-line summary at the top of the Desglose tab, not separate cards", () => {
    const src = read("components/restaurant/sales/detail/SalesDetailV2.tsx");
    expect(src).toContain('data-testid="dimension-leaders"');
    expect(src).toContain("Lo que más pesa:");
    expect(src).toContain('state.tab !== "desglose"');
  });
});

// ---------------------------------------------------------------------------
// Blue, never orange
// ---------------------------------------------------------------------------
describe("heat scale", () => {
  it("0 → the lightest blue, 1 → the darkest, empty → grey; never an orange hue", () => {
    expect(heatColor(0)).toBe("rgba(27,64,200,0.08)");
    expect(heatColor(1)).toBe("rgba(27,64,200,0.92)");
    expect(heatColor(null)).toBe(HEAT_EMPTY);
    expect(HEAT_EMPTY).toBe("#f2f3f6");
    const alphas = [0, 0.25, 0.5, 0.75, 1].map((i) =>
      Number(heatColor(i).match(/,([\d.]+)\)$/)![1])
    );
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
    for (const i of [0, 0.3, 0.6, 1, 2, -1, Number.NaN]) {
      const c = heatColor(i);
      expect(c).toMatch(/^rgba\(27,64,200,/); // the brand blue, always
      expect(c).not.toMatch(/hsl\(24|#f28c28|orange/i);
    }
    expect(heatText(0.1)).toBe("#151c2c");
    expect(heatText(0.9)).toBe("#ffffff");
  });
  it("both heatmaps use it", () => {
    expect(
      read("components/restaurant/sales/detail/DetailHeatmap.tsx")
    ).toContain("heatColor(");
    const cockpit = read("components/restaurant/cockpit/SalesHeatmap.tsx");
    expect(cockpit).toContain("heatColor(");
    expect(cockpit).toContain("heatText(");
    expect(cockpit).not.toMatch(/hsl\(24/);
  });
  it("the Cockpit chart's baseline is neutral grey, dashed", () => {
    const charts = read("components/restaurant/cockpit/v2/charts.tsx");
    expect(charts).not.toContain("#f28c28");
    expect(charts).toMatch(/stroke="#8a92a3"\s*strokeDasharray="5 4"/);
  });
});

describe("no orange in the sales area", () => {
  const walk = (dir: string): string[] =>
    readdirSync(join(process.cwd(), dir)).flatMap((f) => {
      const p = `${dir}/${f}`;
      return statSync(join(process.cwd(), p)).isDirectory() ? walk(p) : [p];
    });
  it("components/restaurant/sales/** and app/dashboard/restaurant/sales/** have no orange-*, #f28c28 or hsl(24", () => {
    const files = [
      ...walk("components/restaurant/sales"),
      ...walk("app/dashboard/restaurant/sales"),
      "lib/restaurant/ui/heat-scale.ts",
      "components/restaurant/cockpit/SalesHeatmap.tsx",
    ].filter((f) => /\.(tsx?|css)$/.test(f));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/orange-\d|#f28c28|#F28C28|hsl\(24/);
    }
  });
});
