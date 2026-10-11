import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  toExplorerRow,
  type PosSalesItemRow,
} from "@/lib/restaurant/supabase-sales";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("cockpit load split (#134)", () => {
  it("the cockpit page streams the executive strip before tab bodies", () => {
    const page = read("app/(restaurant-cockpit)/dashboard/restaurant/page.tsx");
    expect(page).toContain("loadCockpitExecutiveFast");
    expect(page).toContain("CockpitPeriodShell");
    expect(page).toContain("CockpitBothCostKpis");
    expect(page).toContain("CockpitTabsFromModel");
    expect(page).toContain("<DeferredSalesTab");
    expect(page).not.toContain("loadCockpitExecutivePage");
    expect(page).not.toContain("explorerRows");
  });

  it("Sales / Costs / Menu do not reload the full cockpit model", () => {
    expect(read("app/dashboard/restaurant/sales/page.tsx")).not.toContain(
      "loadCockpitPageModel"
    );
    expect(read("app/dashboard/restaurant/sales/page.tsx")).not.toContain(
      "explorerRows"
    );
    const salesLoader = read("lib/restaurant/sales-page-data.ts");
    expect(salesLoader).toContain("loadCockpitExecutiveFast");
    expect(salesLoader).toContain("loadCachedPosSalesRows");
    expect(salesLoader).not.toContain("loadCockpitPageModel");
    expect(salesLoader).not.toContain("explorerRows");
    expect(read("app/dashboard/restaurant/costs/page.tsx")).toContain(
      "loadMenuAreaModel"
    );
    expect(read("app/dashboard/restaurant/costs/page.tsx")).not.toContain(
      "loadCockpitPageModel"
    );
    expect(read("app/dashboard/restaurant/menu/page.tsx")).toContain(
      "loadCachedPosSalesRows"
    );
  });

  it("tabs profitability no longer preloads every POS row", () => {
    const cache = read("lib/restaurant/pos-read-cache.ts");
    expect(cache).toContain(
      "fetchProfitabilityData(supabase, companyId, selected)"
    );
    expect(cache).not.toMatch(
      /loadCachedProfitability[\s\S]*loadCachedPosSalesRows/
    );
    expect(read("lib/restaurant/profitability-server.ts")).toContain(
      "fetchCockpitPosProductRollup"
    );
    expect(read("lib/restaurant/cockpit-page-data.ts")).toContain(
      "profitability.posSource"
    );
  });

  it("briefing reuses profitability check counts instead of a second POS walk", () => {
    const src = read("lib/restaurant/briefing-context.ts");
    expect(src).toContain("distinct_check_count");
    expect(src).not.toContain('.select("check_id")');
  });

  it("an 8k-row explorer payload is megabytes — the reason we defer it", () => {
    const rows = Array.from({ length: 8_000 }, (_, i) =>
      toExplorerRow({
        id: `pos-${i}`,
        company_id: "co",
        location_id: "loc",
        menu_item_id: null,
        sale_date: "2026-07-15",
        order_id: `o-${i}`,
        check_id: `c-${i}`,
        raw_item_name: "Pupusa revuelta con queso",
        quantity: 1,
        gross_revenue: 12.5,
        net_revenue: 12.5,
        currency: "USD",
        sales_channel: "in_store",
        payment_type: "card",
        category: "mains",
        sub_category: null,
        is_tip: false,
        discount_amount: 0,
      } satisfies PosSalesItemRow)
    );
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    expect(bytes).toBeGreaterThan(1_000_000);
  });
});
