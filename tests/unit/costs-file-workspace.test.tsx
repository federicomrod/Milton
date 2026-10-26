// @vitest-environment jsdom
// CostsFileWorkspace: hidden by default, visible when picker/workflow active,
// with a "Cerrar" button that works when idle.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle } from "react";

const openPicker = vi.fn();
const panelState: {
  props: { onImportPending?: (n: number | null) => void };
} = {
  props: {},
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/restaurant/recipes-costing/PriceCatalogPanel", () => ({
  PriceCatalogPanel: forwardRef<{ openPicker: () => void }, object>(
    function PanelMock(props, ref) {
      useEffect(() => {
        panelState.props = props as typeof panelState.props;
      });
      useImperativeHandle(ref, () => ({ openPicker }));
      return <div data-testid="price-catalog-panel">PANEL</div>;
    }
  ),
}));

vi.mock("@/components/restaurant/recipes-costing/ResetPanel", () => ({
  ResetPanel: () => <div>RESET</div>,
}));

import { CostsFileWorkspace } from "@/components/restaurant/costs/CostsFileWorkspace";
import { OPEN_COSTS_PICKER_EVENT } from "@/lib/restaurant/costs-picker";

const workspace = {
  menu_summary: {
    setup: {
      steps: [],
      done: 0,
      total: 4,
      next: null,
      complete: false,
    },
  },
  latest_upload: null,
  batches: [],
  reset: null,
  actor: { can_submit: true },
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  openPicker.mockClear();
  window.localStorage.clear();
  window.location.hash = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => workspace }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CostsFileWorkspace visibility", () => {
  it("hidden by default", () => {
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    expect(screen.queryByTestId("costs-file-workspace")).toBeNull();
  });

  it("becomes visible on OPEN_COSTS_PICKER_EVENT", async () => {
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    expect(screen.queryByTestId("costs-file-workspace")).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });

    await waitFor(() =>
      expect(screen.getByTestId("costs-file-workspace")).toBeTruthy()
    );
    // Workspace is visible (not hidden)
    const workspace = screen.getByTestId("costs-file-workspace");
    expect(workspace.className).not.toMatch(/\bhidden\b/);
  });

  it("becomes visible if URL hash is #costos-ultimo-archivo", () => {
    window.location.hash = "#costos-ultimo-archivo";
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    expect(screen.getByTestId("costs-file-workspace")).toBeTruthy();
  });

  it("Cerrar button hides it when idle (no work in progress)", async () => {
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });

    await waitFor(() =>
      expect(screen.getByTestId("costs-file-workspace")).toBeTruthy()
    );

    const closeButton = screen.getByLabelText("Cerrar");
    fireEvent.click(closeButton);

    await waitFor(() =>
      expect(screen.queryByTestId("costs-file-workspace")).toBeNull()
    );
  });

  it("stays visible with pending import, no Cerrar button", async () => {
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });

    await waitFor(() =>
      expect(screen.getByTestId("costs-file-workspace")).toBeTruthy()
    );

    // Simulate import pending
    act(() => panelState.props.onImportPending?.(5));

    // Cerrar button should not be visible when work is in progress
    await waitFor(() => expect(screen.queryByLabelText("Cerrar")).toBeNull());

    // Workspace still visible
    expect(screen.getByTestId("costs-file-workspace")).toBeTruthy();
  });
});
