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
      loadEstimateProbe("co", "loc", probe()),
      loadEstimateProbe("co", "loc", probe()),
    ]);
    expect(a).toEqual(b);
    await loadEstimateProbe("co", "loc", probe());
    expect(calls).toBe(1);
  });
  it("is keyed by restaurant", async () => {
    await loadEstimateProbe("co", "a", probe());
    await loadEstimateProbe("co", "b", probe());
    expect(calls).toBe(2);
  });
  it("two companies with no location never share an answer", async () => {
    const a = await loadEstimateProbe("co-a", null, probe(3));
    const b = await loadEstimateProbe("co-b", null, probe(9));
    expect(a).toEqual({ eligible: 3 });
    expect(b).toEqual({ eligible: 9 });
    expect(calls).toBe(2);
    // and each one is still cached for itself
    expect(await loadEstimateProbe("co-a", null, probe(0))).toEqual({
      eligible: 3,
    });
    expect(calls).toBe(2);
  });
  it("without a company id nothing is cached or shared", async () => {
    await loadEstimateProbe(null, null, probe());
    await loadEstimateProbe(undefined, null, probe());
    expect(calls).toBe(2);
  });
  it("is stale after the Menú freshness window", async () => {
    await loadEstimateProbe("co", "loc", probe(), Date.now());
    // the entry was written "now"; asking again TAB_FRESH_MS + 1 later re-reads
    await loadEstimateProbe(
      "co",
      "loc",
      probe(),
      Date.now() + TAB_FRESH_MS + 1
    );
    expect(calls).toBe(2);
  });
  it("markTabsStale() and clearTabs() and an explicit invalidation re-read", async () => {
    await loadEstimateProbe("co", "loc", probe());
    markTabsStale();
    await loadEstimateProbe("co", "loc", probe());
    expect(calls).toBe(2);
    clearTabs();
    await loadEstimateProbe("co", "loc", probe());
    expect(calls).toBe(3);
    invalidateEstimateProbe();
    await loadEstimateProbe("co", "loc", probe());
    expect(calls).toBe(4);
  });
  it("a read that was on its way when a save happened is not cached", async () => {
    const slow = loadEstimateProbe("co", "loc", probe(1));
    markTabsStale();
    await slow;
    await loadEstimateProbe("co", "loc", probe(2));
    expect(calls).toBe(2);
  });
  it("a failed read is not cached and is not kept in flight", async () => {
    await expect(
      loadEstimateProbe("co", "loc", async () => {
        calls++;
        throw new Error("probe");
      })
    ).rejects.toThrow();
    await loadEstimateProbe("co", "loc", probe());
    expect(calls).toBe(2);
  });
});
