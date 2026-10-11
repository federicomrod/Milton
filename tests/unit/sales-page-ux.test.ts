import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
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
  "components/restaurant/sales/SalesUnderstand.tsx",
  "components/restaurant/sales/SalesExplore.tsx",
  "components/restaurant/sales/SalesHighlights.tsx",
  "components/restaurant/sales/SalesRankedBars.tsx",
  "components/restaurant/sales/SalesInterpretation.tsx",
  "components/restaurant/sales/DeferredSalesExplorer.tsx",
  "components/restaurant/sales/SalesPageLive.tsx",
  "components/restaurant/sales/SalesPeriodAskButton.tsx",
  "components/restaurant/sales/SalesContextualAsk.tsx",
  "components/restaurant/sales/SalesInvestigateFacts.tsx",
  "app/dashboard/restaurant/sales/page.tsx",
  "app/dashboard/restaurant/sales/detalle/page.tsx",
];

const SALES_COPY = [
  ...SALES_REACT,
  "lib/restaurant/sales-insights.ts",
  "components/restaurant/sales/SalesPageChrome.tsx",
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

describe("Sales page IA (#130)", () => {
  it("keeps the thin Sales route and adds detalle without deleting the explorer", () => {
    expect(SALES_HREF).toBe("/dashboard/restaurant/sales");
    expect(SALES_DETAIL_HREF).toBe("/dashboard/restaurant/sales/detalle");
    const sales = read("app/dashboard/restaurant/sales/page.tsx");
    const detalle = read("app/dashboard/restaurant/sales/detalle/page.tsx");
    expect(sales).toContain("SalesPageLive");
    expect(sales).not.toContain("<SalesUnderstand");
    expect(sales).not.toContain("<SalesExplore");
    expect(read("components/restaurant/sales/SalesPageLive.tsx")).toContain(
      "SalesUnderstand"
    );
    expect(read("components/restaurant/sales/SalesPageLive.tsx")).toContain(
      "onOpenExplore"
    );
    expect(sales).not.toContain("RestaurantSalesExplorer");
    expect(sales).not.toContain("explorerRows");
    expect(sales).not.toContain("loadCockpitPageModel");
    expect(detalle).toContain("<SalesHero");
    expect(detalle).toContain("DeferredSalesExplorer");
    expect(detalle).not.toContain("sales.explorerRows");
    expect(detalle).toContain("mismo periodo que el encabezado");
    expect(detalle).toContain('id="categorias"');
    expect(
      read("components/restaurant/sales/DeferredSalesExplorer.tsx")
    ).toContain("/api/restaurant/cockpit-sales");
  });

  it("honours the cockpit period contract on Sales", () => {
    const page = read("app/dashboard/restaurant/sales/page.tsx");
    const chrome = read("components/restaurant/sales/SalesPageChrome.tsx");
    const loader = read("lib/restaurant/sales-page-data.ts");
    expect(loader).toContain("loadCockpitExecutiveFast");
    expect(loader).toContain("loadCachedPosSalesRows");
    expect(loader).not.toContain("loadCockpitPageModel");
    expect(loader).toContain("parseCockpitPeriodPreset");
    expect(loader).toContain("resolveCockpitPeriod");
    expect(loader).toContain("filterRowsForSalesPeriod");
    expect(loader).toContain("salesDayStatsFromRows");
    expect(loader).toContain("buildCockpitSalesAggregate");
    expect(chrome).toContain("CockpitPeriodControl");
    expect(page).not.toContain("shownPeriodFromSales");
    expect(
      read("components/restaurant/sales/DeferredSalesExplorer.tsx")
    ).toContain("inInclusiveRange");
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

  it("streams interpretation and keeps slot-sized skeletons", () => {
    const page = read("app/dashboard/restaurant/sales/page.tsx");
    const loading = read("app/dashboard/restaurant/sales/loading.tsx");
    expect(page).toContain("<Suspense");
    expect(page).toContain("SalesInterpretationUpgrade");
    expect(loading).toContain("PageSkeleton");
    expect(loading).toContain("lg:grid-cols-3");
    expect(loading).not.toContain("Reading your latest restaurant numbers");
    expect(loading).not.toContain('label="explorer"');
  });
});

describe("Spanish completeness for Sales (#130)", () => {
  it("ships the required Spanish operator copy", () => {
    const understand = read("components/restaurant/sales/SalesUnderstand.tsx");
    const explore = read("components/restaurant/sales/SalesExplore.tsx");
    const highlights = read("components/restaurant/sales/SalesHighlights.tsx");
    const chrome = read("components/restaurant/sales/SalesPageChrome.tsx");
    const periodAsk = read(
      "components/restaurant/sales/SalesPeriodAskButton.tsx"
    );
    expect(highlights).toContain("Lo que destaca");
    expect(highlights).not.toContain("Preguntar a Milton");
    expect(highlights).not.toContain("openAskMilton");
    expect(chrome).toContain("SalesPeriodAskButton");
    expect(periodAsk).toContain("Preguntar a Milton sobre este periodo");
    expect(understand).toContain("Ventas netas");
    expect(understand).toContain("Cuándo se vende");
    expect(understand).toContain("sales-ask-milton-heatmap");
    expect(explore).toContain("Canales");
    expect(explore).toContain("Categorías");
    expect(explore).toContain("Pagos");
    expect(explore).toContain("Ver todas");
    expect(read("components/restaurant/sales/SalesDetailLink.tsx")).toContain(
      "Ver detalles"
    );
    expect(read("app/dashboard/restaurant/sales/detalle/page.tsx")).toContain(
      "SalesInvestigateFacts"
    );
    expect(read("app/dashboard/restaurant/sales/detalle/page.tsx")).toContain(
      "sales-ask-milton-detail"
    );
    expect(read("lib/restaurant/sales-insights.ts")).toContain(
      "La lectura de Milton"
    );
    expect(read("lib/restaurant/sales-insights.ts")).toContain(
      "Día más fuerte"
    );
    expect(read("lib/restaurant/sales-insights.ts")).toContain(
      "Franja más fuerte"
    );
    expect(read("lib/restaurant/sales-insights.ts")).toContain(
      "Almuerzo vs cena"
    );
    expect(read("lib/restaurant/sales-insights.ts")).toContain("por promedio");
    expect(read("lib/restaurant/sales-insights.ts")).toContain(
      "MAX_SALES_HIGHLIGHTS = 3"
    );
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
        check_id: "ranchos",
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
        check_id: "ranchos",
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
