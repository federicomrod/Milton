// Speed fix 1: the legacy CFO dashboard layout does no KPI, data-status or
// chat work on restaurant pages (Cockpit → Menú used to trigger all of it).

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "app/dashboard/layout.tsx"),
  "utf8"
);

describe("dashboard layout on restaurant pages", () => {
  it("skips the legacy KPI load and the data-status fetch there", () => {
    const kpis = src.slice(src.indexOf("// Load selected KPIs"));
    expect(kpis.indexOf("if (onRestaurant) return;")).toBeGreaterThan(-1);
    expect(kpis.indexOf("if (onRestaurant) return;")).toBeLessThan(
      kpis.indexOf('fetch("/api/kpis/calculate"')
    );
    const status = src.slice(
      src.indexOf("Restaurant pages don't use the legacy")
    );
    expect(status.indexOf("if (onRestaurant) return;")).toBeLessThan(
      status.indexOf("refreshDataStatus();")
    );
    expect(src).toContain('pathname?.startsWith("/dashboard/restaurant")');
  });

  it("loads the legacy chat lazily, so restaurant pages never download it", () => {
    expect(src).not.toMatch(/^import MiltonChat from/m);
    expect(src).toContain(
      'dynamic(() => import("@/components/dashboard/miltonchat")'
    );
    expect(src).toContain("{!onRestaurant && (");
  });

  it("keeps the redirect exemption for restaurant pages", () => {
    expect(src).toContain('if (pathname.startsWith("/dashboard/restaurant"))');
  });
});
