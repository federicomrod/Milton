import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { formatServerTiming } from "@/lib/restaurant/cockpit-timing";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("cockpit timing (#134)", () => {
  it("formats Server-Timing marks the Network tab can show", () => {
    expect(
      formatServerTiming([
        { name: "proxy", dur: 120.44 },
        { name: "rpc", dur: 88, desc: "rpc" },
      ])
    ).toBe('proxy;dur=120.4, rpc;dur=88;desc="rpc"');
  });

  it("logs every cockpit / tab step Fede was asked to read", () => {
    const pageData = read("lib/restaurant/cockpit-page-data.ts");
    const chrome = read("lib/restaurant/shell-context-server.ts");
    const rollup = read("lib/restaurant/cockpit-pos-rollup.ts");
    const proxy = read("proxy.ts");
    const sales = read("app/dashboard/restaurant/sales/page.tsx");
    const salesDetalle = read(
      "app/dashboard/restaurant/sales/detalle/page.tsx"
    );
    const salesPageData = read("lib/restaurant/sales-page-data.ts");
    const menu = read("app/dashboard/restaurant/menu/page.tsx");
    const costs = read("app/dashboard/restaurant/costs/page.tsx");
    expect(chrome).toContain('timeCockpitStep("chrome"');
    expect(pageData).toMatch(/timeCockpitStep\(\s*"scope"/);
    expect(pageData).toContain('timeCockpitStep("currency"');
    expect(pageData).toContain('timeCockpitStep("timezone"');
    expect(pageData).toContain('timeCockpitStep("pos-connection"');
    expect(rollup).toContain('logCockpitTiming("rpc"');
    expect(pageData).toContain('logCockpitTiming("tabs"');
    expect(read("lib/restaurant/cockpit-pos-product-rollup.ts")).toContain(
      'logCockpitTiming("product-rpc"'
    );
    expect(read("lib/restaurant/profitability-server.ts")).toContain(
      'logCockpitTiming("tabs-pos"'
    );
    expect(pageData).toContain('logCockpitTiming("sales"');
    expect(pageData).toContain('timeCockpitStep("costs"');
    expect(pageData).toContain("loadBothPeriodCostKpis");
    expect(pageData).toContain("periods:");
    expect(read("lib/restaurant/cockpit-insights-ai.ts")).toContain(
      'logCockpitTiming("insights"'
    );
    expect(sales).toMatch(/timeCockpitStep\(\s*"sales-route"/);
    expect(salesDetalle).toMatch(/timeCockpitStep\(\s*"sales-detalle-route"/);
    expect(salesPageData).toMatch(/timeCockpitStep\(\s*"sales-pos-rows"/);
    expect(salesPageData).toContain('logCockpitTiming("sales-page"');
    expect(menu).toContain("loadMenuAreaModel");
    expect(costs).toMatch(/timeCockpitStep\(\s*"costs-route"/);
    expect(proxy).toContain('console.info("[cockpit-timing] proxy"');
    expect(proxy).toContain("Server-Timing");
    expect(read("instrumentation.ts")).toContain("installCockpitServerTiming");
  });
});
