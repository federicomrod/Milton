// @vitest-environment jsdom
// One refresh of the Costos setup = ONE request, however many hosts are
// mounted (they are all rendered and only hidden with CSS) and whoever asks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  CostsDesktopRightColumn,
  CostsMobileBannerHost,
  CostsMobileBelow,
  CostsTabletCardsRow,
} from "@/components/restaurant/costs/CostsDesktopRightColumn";
import { COSTS_SETUP_REFRESH_EVENT } from "@/lib/restaurant/costs-picker";
import { fetchSetup } from "@/lib/restaurant/costs-setup-client";
import {
  clearTabs,
  menuTabKey,
  refreshTab,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";

let calls = 0;
beforeEach(() => {
  clearTabs();
  calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 15));
      return { ok: true, json: async () => ({ menu_summary: null }) };
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountFourHosts() {
  const props = { latestInvoices: null, locationId: "loc-1", shellParams: {} };
  render(
    <>
      <CostsDesktopRightColumn {...props} />
      <CostsTabletCardsRow {...props} />
      <CostsMobileBelow {...props} />
      <CostsMobileBannerHost locationId="loc-1" />
    </>
  );
}

describe("Costos setup refresh", () => {
  it("the first load of the four hosts is one request", async () => {
    mountFourHosts();
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
  });

  it("the event with four hosts mounted plus a reload() is exactly one request", async () => {
    mountFourHosts();
    await new Promise((r) => setTimeout(r, 60));
    calls = 0;
    const key = menuTabKey("resumen", { location: "loc-1" });
    await act(async () => {
      // what CostsSetupSection does: reload() and the event, together
      const reload = refreshTab(key, () => fetchSetup("loc-1"));
      window.dispatchEvent(new Event(COSTS_SETUP_REFRESH_EVENT));
      await reload;
    });
    expect(calls).toBe(1);
  });

  it("a refresh after the first one finished is a new request (it ignores freshness)", async () => {
    const key = menuTabKey("resumen", { location: "loc-1" });
    await refreshTab(key, () => fetchSetup("loc-1"));
    await refreshTab(key, () => fetchSetup("loc-1"));
    expect(calls).toBe(2);
  });
});
