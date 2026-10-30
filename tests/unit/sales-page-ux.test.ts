import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { SALES_DETAIL_HREF, SALES_HREF } from "@/lib/restaurant/navigation";
import { buildCockpitSalesAggregate } from "@/lib/restaurant/cockpit-aggregates";
import {
  buildSalesInsights,
  salesDayStatsFromRows,
} from "@/lib/restaurant/sales-insights";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const SALES_REACT = [
  "app/dashboard/restaurant/sales/page.tsx",
  "app/dashboard/restaurant/sales/detalle/page.tsx",
  "components/restaurant/sales/detail/SalesDetailV2.tsx",
  "components/restaurant/sales/detail/FilterBar.tsx",
  "components/restaurant/sales/detail/KpiRow.tsx",
  "components/restaurant/sales/detail/DailyChart.tsx",
  "components/restaurant/sales/detail/DetailHeatmap.tsx",
  "components/restaurant/sales/detail/DimensionPanel.tsx",
  "components/restaurant/sales/detail/ShiftCards.tsx",
  "components/restaurant/sales/detail/PlatosTab.tsx",
];

const SALES_COPY = [
  ...SALES_REACT,
  "lib/restaurant/sales-insights.ts",
  "lib/restaurant/sales-detail-insights.ts",
];

function spanishSlots(src: string): string[] {
  const out: string[] = [];
  const re =
    /t\(\s*(?:lang|"es"|RESTAURANT_COCKPIT_DEFAULT_LANGUAGE)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push(m[2]);
  }
  return out;
}

describe("One Ventas page", () => {
  it("Ventas is the old Detalle; /sales/detalle only forwards; both links land on /sales", () => {
    expect(SALES_HREF).toBe("/dashboard/restaurant/sales");
    expect(SALES_DETAIL_HREF).toBe(SALES_HREF);
    const sales = read("app/dashboard/restaurant/sales/page.tsx");
    const detalle = read("app/dashboard/restaurant/sales/detalle/page.tsx");
    expect(sales).toContain("SalesDetailV2");
    expect(sales).toContain("getDictionary(lang).sales.page.title");
    expect(read("lib/i18n/es/sales.ts")).toContain('title: "Ventas"');
    expect(sales).not.toContain("loadCockpitPageModel");
    expect(sales).not.toContain("explorerRows");
    expect(detalle).toContain("redirect(");
    expect(detalle).not.toContain("SalesDetailV2");
    expect(
      read("components/restaurant/sales/detail/SalesDetailV2.tsx")
    ).toContain("/api/restaurant/sales-detail");
  });

  it("the old Understand / Explore page is gone", () => {
    for (const gone of [
      "components/restaurant/sales/SalesUnderstand.tsx",
      "components/restaurant/sales/SalesExplore.tsx",
      "components/restaurant/sales/SalesHighlights.tsx",
      "components/restaurant/sales/SalesPageLive.tsx",
      "components/restaurant/sales/SalesInterpretation.tsx",
      "components/restaurant/sales/SalesInterpretationUpgrade.tsx",
      "components/restaurant/sales/SalesRankedBars.tsx",
      "lib/restaurant/sales-page-data.ts",
    ]) {
      expect(existsSync(join(process.cwd(), gone)), gone).toBe(false);
    }
  });

  it("does not put KPI aggregation in React", () => {
    for (const file of SALES_REACT) {
      const src = read(file);
      expect(src, file).not.toContain("classifySaleLine");
      expect(src, file).not.toContain("buildCockpitSalesAggregate");
      expect(src, file).not.toContain("findPeakSlot");
      expect(src, file).not.toContain("lunchVsDinner");
      expect(src, file).not.toContain("rankCategories(");
    }
  });

  it("the skeleton matches the layout (filter bar, five KPIs, chart + heatmap)", () => {
    const loading = read("app/dashboard/restaurant/sales/loading.tsx");
    expect(loading).toContain("PageSkeleton");
    expect(loading).toContain("lg:grid-cols-5");
    expect(loading).toContain("lg:grid-cols-[1.25fr_1fr]");
    expect(loading).not.toContain("SalesInterpretation");
  });
});

describe("Spanish completeness for Ventas", () => {
  it("ships the Spanish copy of the ported pieces", () => {
    expect(
      existsSync(
        join(process.cwd(), "components/restaurant/sales/detail/Highlights.tsx")
      )
    ).toBe(false);
    expect(read("lib/i18n/es/sales.ts")).toContain("Lo que más pesa:");
  });

  it("does not put English chrome in t() Spanish slots", () => {
    const banned = [
      /\bOverview\b/,
      /Not available yet/,
      /See details$/,
      /What stands out/,
      /Ask Milton about/,
    ];
    for (const file of SALES_COPY) {
      const src = read(file);
      for (const es of spanishSlots(src)) {
        for (const pattern of banned) {
          expect(es, `${file}: ${es}`).not.toMatch(pattern);
        }
      }
    }
  });
});

describe("existing aggregate totals stay on the same net definition", () => {
  it("July-style tip line is excluded from net and added on the tips line", () => {
    const rows: CockpitFactRow[] = [
      {
        sale_date: "2026-07-15",
        raw_item_name: "Pupusa",
        quantity: 1,
        gross_revenue: 85923.59,
        discount_amount: 0,
        check_id: "casa",
        currency: "USD",
        sales_channel: "in_store",
        payment_type: "card",
        category: "Mains",
      },
      {
        sale_date: "2026-07-15",
        raw_item_name: "Propina",
        quantity: 1,
        gross_revenue: 20,
        discount_amount: 0,
        check_id: "casa",
        currency: "USD",
      },
    ];
    const agg = buildCockpitSalesAggregate(rows, { currency: "USD" });
    expect(agg.revenue.net_sales + agg.revenue.tips).toBe(85943.59);
    expect(agg.revenue.net_sales).toBe(85923.59);
    expect(agg.revenue.tips).toBe(20);
    const insights = buildSalesInsights(
      agg,
      "es",
      salesDayStatsFromRows(rows, { currency: "USD" })
    );
    expect(insights.availability).toBe("insufficient");
    expect(insights.summaries.map((s) => s.id)).toEqual([
      "channels",
      "payments",
      "categories",
    ]);
    expect(insights.summaries.every((s) => !s.value.includes("USD"))).toBe(
      true
    );
    expect(
      insights.summaries.find((s) => s.id === "channels")?.value
    ).toContain("En salón");
    expect(insights.highlights.some((h) => h.id === "daypart")).toBe(false);
    expect(insights.highlights.length).toBeLessThanOrEqual(3);
  });
});

describe("one «Preguntar a Milton» per page (R1-16c)", () => {
  it("Ventas uses the header's own button (no second one); Cocina hides it for its contextual one", () => {
    expect(read("app/dashboard/restaurant/sales/page.tsx")).toContain(
      "OperatingPageHeader"
    );
    expect(read("app/dashboard/restaurant/sales/page.tsx")).not.toContain(
      "hideAskButton"
    );
    expect(
      read("components/restaurant/kitchen/KitchenPageChrome.tsx")
    ).toContain("hideAskButton={!!periodAskQuestion}");
    expect(
      read("components/restaurant/shell/OperatingPageHeader.tsx")
    ).toContain("hideAskButton ? null");
  });
});
