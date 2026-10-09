import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Layout regression for GitHub #85 — Revenue tab KPIs must sit above the
// fold. These are source-level checks because the unit suite runs in node
// without a React renderer. Filter logic and target math are asserted
// unchanged so a layout-only PR cannot silently rewrite them.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const explorer = read("components/restaurant/RestaurantSalesExplorer.tsx");
const cockpitPage = read(
  "app/(restaurant-cockpit)/dashboard/restaurant/page.tsx"
);

function sliceBetween(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
}

describe("RestaurantSalesExplorer compact Revenue-tab chrome (#85)", () => {
  it("defaults the targets editor to collapsed, even when none are set", () => {
    expect(explorer).not.toContain("useState(!anyTargetSet)");
    expect(explorer).toMatch(
      /const \[targetsOpen,\s*setTargetsOpen\]\s*=\s*useState\(false\)/
    );
  });

  it("exposes targets as a compact toolbar control, not a default-open card", () => {
    expect(explorer).toContain("Add targets");
    expect(explorer).toContain("Edit targets");
    expect(explorer).toContain("Hide targets");
    expect(explorer).toContain('id="targets"');
  });

  it("keeps date range and channel on the compact toolbar", () => {
    const toolbar = sliceBetween(
      explorer,
      "Compact toolbar:",
      'id="more-filters-panel"'
    );
    expect(toolbar).toContain("<DateRangeControls");
    expect(toolbar).toContain("Channel:");
    expect(toolbar).toContain("<ChannelChip");
    expect(toolbar).toContain("countLabel={formatChipQuantity");
    expect(toolbar).not.toContain("count={");
    expect(toolbar).toContain("More filters");
    expect(explorer).toContain("Date range:");
  });

  it("hides item-level filters behind a More filters panel", () => {
    const panel = sliceBetween(
      explorer,
      'id="more-filters-panel"',
      "</div>\n        )}"
    );
    expect(panel).toContain("Search item name");
    expect(panel).toContain("Min units");
    expect(panel).toContain("Min revenue");
    expect(panel).toContain("Avg price ≥");
    expect(panel).toContain("Avg price ≤");

    const toolbar = sliceBetween(
      explorer,
      "Compact toolbar:",
      'id="more-filters-panel"'
    );
    expect(toolbar).not.toContain("Search item name");
    expect(toolbar).not.toContain("Min units");
    expect(toolbar).not.toContain("Min revenue");
  });

  it("shows a count on More filters when item-level filters are active", () => {
    expect(explorer).toContain("moreFilterCount");
    expect(explorer).toContain("More filters");
  });

  it("renders active-filter pills only when a filter is set", () => {
    expect(explorer).toContain("if (pills.length === 0) return null");
    expect(explorer).not.toContain("Showing all POS sales");
  });

  it("renders Overview KPI cards after the compact toolbar, not after an open targets card", () => {
    const iToolbar = explorer.indexOf("Compact toolbar:");
    const iTargetsBtn = explorer.indexOf("Add targets");
    const iOverview = explorer.indexOf('id="overview"');
    const iRevenueKpi = explorer.indexOf('label="Revenue"');
    expect(iToolbar).toBeGreaterThan(0);
    expect(iTargetsBtn).toBeGreaterThan(iToolbar);
    expect(iOverview).toBeGreaterThan(iTargetsBtn);
    expect(iRevenueKpi).toBeGreaterThan(iOverview);
  });
});

describe("RestaurantSalesExplorer filter logic and target math are unchanged", () => {
  it("still POSTs targets to /api/restaurant/targets", () => {
    expect(explorer).toContain('fetch("/api/restaurant/targets"');
    expect(explorer).toContain('method: "POST"');
    expect(explorer).toContain("JSON.stringify({ targets: payload })");
  });

  it("still scales flow targets by selectedDays and leaves avg ticket unmultiplied", () => {
    expect(explorer).toContain("out.revenue = targets.revenue * selectedDays");
    expect(explorer).toContain("out.orders = targets.orders * selectedDays");
    expect(explorer).toContain(
      "out.units_sold = targets.units_sold * selectedDays"
    );
    expect(explorer).toContain("out.avg_ticket = targets.avg_ticket");
    expect(explorer).toContain("// ratio — not multiplied");
  });

  it("still applies row-level filters before item-level filters", () => {
    expect(explorer).toContain("Stage 1: row-level filtering (non-date).");
    expect(explorer).toContain("Stage 2: item-level filters.");
    expect(explorer).toContain("function aggregate(");
  });

  it("still hides target variance when a non-date filter is active", () => {
    expect(explorer).toContain(
      "const showTargetVariance = anyTargetSet && !nonDateFiltersActive"
    );
  });
});

describe("Revenue tab page chrome is trimmed without dropping copy", () => {
  it("still explains live vs sample mode in the header", () => {
    expect(cockpitPage).toContain(
      "Using uploaded POS data from Supabase. Recipe costing is pending until menu items, recipes, and supplier costs are linked."
    );
    expect(cockpitPage).toContain("Import POS Sales");
    expect(cockpitPage).toContain("Costing is pending until");
  });

  it("still mounts RestaurantSalesExplorer on the Revenue tab", () => {
    expect(cockpitPage).toContain(
      "<RestaurantSalesExplorer rows={rows} initialTargets={targets} />"
    );
  });
});
