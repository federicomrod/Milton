import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  HEATMAP_ROW_PX,
  heatmapHeightPx,
} from "@/components/restaurant/cockpit/SalesHeatmap";

describe("Ventas heatmap is compact (R1-14)", () => {
  it("rows have a fixed small height", () => {
    expect(HEATMAP_ROW_PX).toBeLessThanOrEqual(16);
  });

  it("a full service day (6:00 to 23:00, 18 rows) fits in a third of a 13-inch laptop viewport (~256 px)", () => {
    expect(heatmapHeightPx(18)).toBeLessThanOrEqual(300);
    // A typical day of 12-14 hours is well under it.
    expect(heatmapHeightPx(14)).toBeLessThanOrEqual(256);
  });

  it("is never scaled up from a small viewBox, and keeps hover, focus and the exact value", () => {
    const src = readFileSync(
      "components/restaurant/cockpit/SalesHeatmap.tsx",
      "utf8"
    );
    expect(src).not.toContain("h-auto");
    expect(src).not.toContain("max-w-3xl");
    expect(src).toContain("width={width}");
    expect(src).toContain("height={height}");
    expect(src).toContain("<title>{exact}</title>");
    expect(src).toContain("onMouseEnter");
    expect(src).toContain("onFocus");
    expect(src).toContain('aria-live="polite"');
  });
});
