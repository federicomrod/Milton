import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Menu area loader (#128 review N2)", () => {
  it("the Menu page does not call the full cockpit model", () => {
    const page = read("app/dashboard/restaurant/menu/page.tsx");
    expect(page).not.toContain("loadCockpitPageModel");
    expect(page).toContain("loadMenuAreaModel");
  });

  it("loadMenuAreaModel skips the full dashboard POS read", () => {
    const src = read("lib/restaurant/cockpit-page-data.ts");
    const start = src.indexOf("export async function loadMenuAreaModel");
    expect(start).toBeGreaterThan(-1);
    const fn = src.slice(start);
    expect(fn).toContain("fetchProfitabilityData");
    expect(fn).not.toContain("fetchRealRestaurantDashboardData");
  });
});
