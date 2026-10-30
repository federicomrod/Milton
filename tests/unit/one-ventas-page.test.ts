// There is ONE Ventas page (the old Detalle). Redirect, links, the ported
// leaders (pure, from the cube, following the filters),
// the blue heat scale, and no orange in the sales area. Synthetic data.
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { es } from "@/lib/i18n/es";
import {
  dimensionLeader,
  leaderLabel,
} from "@/lib/restaurant/sales-detail-insights";
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
    expect(src).toContain("s0.states.leaders");
    expect(es.sales.detail.states.leaders).toBe("Lo que más pesa:");
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

describe("the Ventas header and the Cockpit v1 pieces are brand blue, not orange", () => {
  const FILES = [
    "components/restaurant/shell/OperatingPageHeader.tsx",
    "components/restaurant/shell/DateRangeControl.tsx",
    "components/restaurant/cockpit/CockpitTabs.tsx",
    "components/restaurant/cockpit/CockpitChannelBreakdown.tsx",
    "components/restaurant/cockpit/CockpitHeroChart.tsx",
    "components/restaurant/cockpit/CockpitInsightsCard.tsx",
    "components/restaurant/cockpit/CockpitOnboardingChip.tsx",
  ];
  it("no orange-*, #f28c28 or hsl(24 …) in them", () => {
    for (const f of FILES)
      expect(read(f), f).not.toMatch(/orange-\d|#f28c28|#F28C28|hsl\(24/);
  });
  it("the focus rings, the active tab, the channel bar and the hero line use #1B40C8", () => {
    expect(
      read("components/restaurant/shell/OperatingPageHeader.tsx")
    ).toContain("focus-visible:ring-[#1B40C8]");
    expect(read("components/restaurant/shell/DateRangeControl.tsx")).toContain(
      "focus-visible:ring-[#1B40C8]"
    );
    expect(read("components/restaurant/cockpit/CockpitTabs.tsx")).toContain(
      "border-[#1B40C8]"
    );
    expect(
      read("components/restaurant/cockpit/CockpitChannelBreakdown.tsx")
    ).toContain("bg-[#1B40C8]");
    expect(
      read("components/restaurant/cockpit/CockpitHeroChart.tsx")
    ).toContain('stroke="#1B40C8"');
  });
});
