import { beforeEach, describe, expect, it } from "vitest";
import {
  invalidateEstimateProbe,
  loadEstimateProbe,
} from "@/lib/restaurant/menu-estimate-probe-cache";
import {
  clearTabs,
  markTabsStale,
  TAB_FRESH_MS,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";

let calls = 0;
const probe =
  (n = 1) =>
  async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return { eligible: n };
  };
beforeEach(() => {
  invalidateEstimateProbe();
  calls = 0;
});

describe("estimate probe cache", () => {
  it("two mounts at once share one read; a mount right after reuses it", async () => {
    const [a, b] = await Promise.all([
      loadEstimateProbe("loc", probe()),
      loadEstimateProbe("loc", probe()),
    ]);
    expect(a).toEqual(b);
    await loadEstimateProbe("loc", probe());
    expect(calls).toBe(1);
  });
  it("is keyed by restaurant", async () => {
    await loadEstimateProbe("a", probe());
    await loadEstimateProbe("b", probe());
    expect(calls).toBe(2);
  });
  it("is stale after the Menú freshness window", async () => {
    await loadEstimateProbe("loc", probe(), Date.now());
    // the entry was written "now"; asking again TAB_FRESH_MS + 1 later re-reads
    await loadEstimateProbe("loc", probe(), Date.now() + TAB_FRESH_MS + 1);
    expect(calls).toBe(2);
  });
  it("markTabsStale() and clearTabs() and an explicit invalidation re-read", async () => {
    await loadEstimateProbe("loc", probe());
    markTabsStale();
    await loadEstimateProbe("loc", probe());
    expect(calls).toBe(2);
    clearTabs();
    await loadEstimateProbe("loc", probe());
    expect(calls).toBe(3);
    invalidateEstimateProbe();
    await loadEstimateProbe("loc", probe());
    expect(calls).toBe(4);
  });
  it("a read that was on its way when a save happened is not cached", async () => {
    const slow = loadEstimateProbe("loc", probe(1));
    markTabsStale();
    await slow;
    await loadEstimateProbe("loc", probe(2));
    expect(calls).toBe(2);
  });
  it("a failed read is not cached and is not kept in flight", async () => {
    await expect(
      loadEstimateProbe("loc", async () => {
        calls++;
        throw new Error("probe");
      })
    ).rejects.toThrow();
    await loadEstimateProbe("loc", probe());
    expect(calls).toBe(2);
  });
});
