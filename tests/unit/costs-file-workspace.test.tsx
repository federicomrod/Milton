// @vitest-environment jsdom
// CostsFileWorkspace: always mounted; first picker click opens the panel
// without a `hidden` ancestor; pending work auto-opens; one file-section id.

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
import {
  CostsDesktopRightColumn,
  CostsTabletCardsRow,
} from "@/components/restaurant/costs/CostsDesktopRightColumn";
import {
  COSTS_FILE_ANCHOR,
  OPEN_COSTS_PICKER_EVENT,
} from "@/lib/restaurant/costs-picker";

const nextStep = {
  id: "excel",
  label: "Subir Excel de costos",
  done: false,
  href: null,
  action: "Continuar: subir tu Excel",
};

function workspace(over: Record<string, unknown> = {}) {
  return {
    menu_summary: {
      setup: {
        steps: [nextStep],
        done: 0,
        total: 4,
        next: nextStep,
        complete: false,
      },
    },
    latest_upload: null,
    batches: [],
    reset: null,
    actor: { can_submit: true },
    upload_draft_pending: false,
    ...over,
  };
}

let current = workspace();

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  openPicker.mockClear();
  current = workspace();
  window.localStorage.clear();
  window.location.hash = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => current,
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function hasHiddenAncestor(el: Element | null): boolean {
  let node: Element | null = el;
  while (node) {
    if (
      node.classList.contains("hidden") ||
      (node instanceof HTMLElement && node.hidden)
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

describe("CostsFileWorkspace visibility", () => {
  it("stays mounted and closed by default", async () => {
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    const root = await screen.findByTestId("costs-file-workspace");
    expect(root.getAttribute("data-open")).toBe("false");
    expect(root.classList.contains("hidden")).toBe(false);
  });

  it("one OPEN_COSTS_PICKER_EVENT shows the file card and opens the picker", async () => {
    current = workspace();
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    const panel = await screen.findByTestId("price-catalog-panel");

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("true")
    );
    expect(hasHiddenAncestor(panel)).toBe(false);
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("stays closed on load after a file is uploaded (3/4 done, nothing pending), and Cerrar is available once opened", async () => {
    current = workspace({
      menu_summary: {
        setup: {
          steps: [nextStep],
          done: 3,
          total: 4,
          next: nextStep,
          complete: false,
        },
      },
      latest_upload: {
        id: "u1",
        filename: "costos-prueba.xlsx",
        created_at: "2026-09-01T10:00:00Z",
        has_candidate_blocks: true,
      },
      upload_draft_pending: false,
    });
    render(<CostsFileWorkspace locationId="loc-idle" companyId="co-1" />);
    await screen.findByTestId("price-catalog-panel");
    expect(
      screen.getByTestId("costs-file-workspace").getAttribute("data-open")
    ).toBe("false");

    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("true")
    );
    expect(screen.getByLabelText("Cerrar")).toBeTruthy();
  });

  it("auto-opens when upload_draft_pending is already set", async () => {
    current = workspace({ upload_draft_pending: true });
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("true")
    );
    expect(screen.getByTestId("price-catalog-panel")).toBeTruthy();
  });

  it("becomes visible if URL hash is #costos-ultimo-archivo", async () => {
    window.location.hash = "#costos-ultimo-archivo";
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("true")
    );
  });

  it("Cerrar hides it when idle (no work in progress)", async () => {
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    await screen.findByTestId("price-catalog-panel");
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("true")
    );

    fireEvent.click(screen.getByLabelText("Cerrar"));

    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("false")
    );
  });

  it("stays visible with pending import, no Cerrar button", async () => {
    render(<CostsFileWorkspace locationId="loc-1" companyId="co-1" />);
    await screen.findByTestId("price-catalog-panel");
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("true")
    );

    act(() => panelState.props.onImportPending?.(5));

    await waitFor(() => expect(screen.queryByLabelText("Cerrar")).toBeNull());
    expect(
      screen.getByTestId("costs-file-workspace").getAttribute("data-open")
    ).toBe("true");
  });

  it("Más acciones is reachable when there is reset data or batches", async () => {
    current = workspace({
      batches: [
        {
          id: "b1",
          filename: "costos-prueba.xlsx",
          uploads: 1,
          batch_ids: ["batch-1"],
        },
      ],
      reset: { prompt: "RESET", warning: null },
    });
    render(<CostsFileWorkspace locationId="loc-more" companyId="co-1" />);
    await screen.findByTestId("price-catalog-panel");
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COSTS_PICKER_EVENT));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("costs-file-workspace").getAttribute("data-open")
      ).toBe("true")
    );
    expect(screen.getByLabelText("Más acciones")).toBeTruthy();
  });

  it("there is exactly one #costos-ultimo-archivo in the Costos chrome", async () => {
    render(
      <>
        <CostsFileWorkspace locationId="loc-ids" companyId="co-1" />
        <CostsDesktopRightColumn
          latestInvoices={null}
          locationId="loc-ids"
          shellParams={{}}
        />
        <CostsTabletCardsRow
          latestInvoices={null}
          locationId="loc-ids"
          shellParams={{}}
        />
      </>
    );
    await screen.findByTestId("price-catalog-panel");
    expect(document.querySelectorAll(`#${COSTS_FILE_ANCHOR}`)).toHaveLength(1);
  });
});
