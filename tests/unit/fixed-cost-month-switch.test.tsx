// @vitest-environment jsdom
// The month switcher (Sofia, mandatory): the chevrons give press feedback and
// the label follows the click at once, the content under a new month is a
// skeleton (never the old month's numbers under the new label), the future
// month is disabled with the tooltip «Mes futuro», and the neighbours are
// fetched ahead. Demo data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
const prefetch = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, prefetch, refresh() {}, replace() {} }),
}));

// While a month loads, React reports the transition as pending.
let forcePending = false;
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useTransition: () =>
      forcePending
        ? ([true, (cb: () => void) => cb()] as const)
        : actual.useTransition(),
  };
});

import { FixedCostsTab } from "@/components/restaurant/costs/FixedCostsTab";

const MONTH = "2026-11-01";
const view = (month = MONTH) =>
  ({
    month,
    currency: "USD",
    locationId: null,
    lines: [
      {
        location_id: null,
        month,
        category: "planilla",
        label: "Nómina demo",
        amount: 21400,
        pct_of_sales: null,
        currency: "USD",
        source: "upload",
        status: "confirmed",
        repeats: false,
        split_rule: null,
      },
    ],
    groupShares: {},
    groupImpuestosPct: null,
    openDays: 26,
    margin: { sales: 100000, foodCost: 30000 },
    marginReason: null,
    breakEven: null,
    lastMonth: {},
  }) as never;

function show(month = MONTH, current = MONTH) {
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ draft: null }), { status: 200 })
  );
  render(
    <FixedCostsTab
      view={view(month)}
      history={[]}
      locationName={null}
      shellParams={{ location: "loc-1" }}
      currentMonth={current}
    />
  );
}

beforeEach(() => {
  push.mockClear();
  prefetch.mockClear();
  forcePending = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("month switcher", () => {
  it("‹ goes to the previous month in place (other params kept) and the neighbours are prefetched", () => {
    show();
    expect(prefetch).toHaveBeenCalledWith(
      "/dashboard/restaurant/costs?location=loc-1&month=2026-10"
    );
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(push).toHaveBeenCalledWith(
      "/dashboard/restaurant/costs?location=loc-1&month=2026-10"
    );
  });

  it("the chevrons are 44px targets with hover and press states", () => {
    show();
    const prev = screen.getByRole("button", { name: "Mes anterior" });
    expect(prev.className).toContain("h-11");
    expect(prev.className).toContain("w-11");
    expect(prev.className).toContain("hover:bg-[#F1F3F7]");
    expect(prev.className).toContain("hover:text-[#151c2c]");
    expect(prev.className).toContain("active:");
  });

  it("the future month is disabled with the tooltip «Mes futuro» and never navigates", () => {
    show();
    const next = screen.getByRole("button", { name: "Mes siguiente" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.parentElement?.getAttribute("title")).toBe("Mes futuro");
    fireEvent.click(next);
    expect(push).not.toHaveBeenCalled();
    expect(prefetch).not.toHaveBeenCalledWith(
      expect.stringContaining("month=2026-12")
    );
  });

  it("an older month's › is enabled and has no tooltip", () => {
    show("2026-10-01", MONTH);
    const next = screen.getByRole("button", { name: "Mes siguiente" });
    expect(next.getAttribute("aria-disabled")).toBeNull();
    expect(next.parentElement?.getAttribute("title")).toBeNull();
    fireEvent.click(next);
    expect(push).toHaveBeenCalledWith(
      "/dashboard/restaurant/costs?location=loc-1&month=2026-11"
    );
  });

  it("while a month loads: the label is the new month and a skeleton replaces every number", () => {
    forcePending = true;
    show();
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    expect(screen.getByTestId("fixed-costs-month").textContent).toBe(
      "Octubre 2026"
    );
    expect(screen.getByTestId("fixed-skeleton")).toBeTruthy();
    expect(screen.getByTestId("fixed-skeleton-aside")).toBeTruthy();
    // never the old month's numbers under the new label
    expect(screen.queryByTestId("fixed-row-planilla")).toBeNull();
    expect(screen.queryByTestId("fixed-total")).toBeNull();
    expect(screen.queryByTestId("break-even-value")).toBeNull();
    expect(document.body.textContent).not.toContain("$21,400");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Costos fijos · octubre 2026"
    );
  });
});
