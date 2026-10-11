import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SALES_DETAIL_HREF, SALES_HREF } from "@/lib/restaurant/navigation";
import { buildCockpitSalesAggregate } from "@/lib/restaurant/cockpit-aggregates";
import { buildSalesInsights } from "@/lib/restaurant/sales-insights";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const SALES_REACT = [
  "components/restaurant/sales/SalesUnderstand.tsx",
  "components/restaurant/sales/SalesExplore.tsx",
  "components/restaurant/sales/SalesHighlights.tsx",
  "components/restaurant/sales/SalesRankedBars.tsx",
  "components/restaurant/sales/SalesInterpretation.tsx",
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
    expect(sales).toContain("SalesUnderstand");
    expect(sales).toContain("SalesExplore");
    expect(sales).not.toContain("RestaurantSalesExplorer");
    expect(detalle).toContain("<SalesHero");
    expect(detalle).toContain("<RestaurantSalesExplorer");
    expect(detalle).toContain('id="categorias"');
  });

  it("honours the cockpit period contract on Sales", () => {
    const page = read("app/dashboard/restaurant/sales/page.tsx");
    const chrome = read("components/restaurant/sales/SalesPageChrome.tsx");
    const loader = read("lib/restaurant/sales-page-data.ts");
    expect(loader).toContain("parseCockpitPeriodPreset");
    expect(loader).toContain("resolveCockpitPeriod");
    expect(loader).toContain("filterRowsForSalesPeriod");
    expect(loader).toContain("buildCockpitSalesAggregate");
    expect(chrome).toContain("CockpitPeriodControl");
    expect(page).not.toContain("shownPeriodFromSales");
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
    expect(loading).not.toContain("Reading your latest restaurant numbers");
  });
});

describe("Spanish completeness for Sales (#130)", () => {
  it("ships the required Spanish operator copy", () => {
    const understand = read("components/restaurant/sales/SalesUnderstand.tsx");
    const explore = read("components/restaurant/sales/SalesExplore.tsx");
    const highlights = read("components/restaurant/sales/SalesHighlights.tsx");
    expect(highlights).toContain("Lo que destaca");
    expect(understand).toContain("Ventas netas");
    expect(understand).toContain("Cuándo se vende");
    expect(explore).toContain("Canales");
    expect(explore).toContain("Categorías");
    expect(explore).toContain("Pagos");
    expect(explore).toContain("Ver todas");
    expect(read("components/restaurant/sales/SalesDetailLink.tsx")).toContain(
      "Ver detalles"
    );
    expect(read("lib/restaurant/sales-insights.ts")).toContain(
      "La lectura de Milton"
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
    const insights = buildSalesInsights(agg, "es");
    expect(insights.summaries[0].value).toBe("$85,923.59");
    expect(insights.summaries[0].value).not.toContain("USD");
  });
});
