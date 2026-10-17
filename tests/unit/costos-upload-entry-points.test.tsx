// @vitest-environment jsdom
// Every «upload cost file» entry point on Costos opens the file picker on the
// first click, and «Subir factura» is a brand-blue secondary (no orange).
// Layout/behaviour only. Synthetic data.
import { readFileSync } from "fs";
import { join } from "path";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const openPicker = vi.fn();
const panelState: { props: { onImportPending?: (n: number | null) => void } } =
  {
    props: {},
  };
let pathname = "/dashboard/restaurant/costs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => pathname,
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
vi.mock("@/components/restaurant/recipes-costing/MenuReaderPanel", () => ({
  MenuReaderPanel: () => <div>MENU READER</div>,
}));
vi.mock("@/components/restaurant/recipes-costing/ResetPanel", () => ({
  ResetPanel: () => <div>RESET</div>,
}));

import { CostsSetupSection } from "@/components/restaurant/costs/CostsSetupSection";
import { EmptyState } from "@/components/restaurant/shell/EmptyState";

const step = (
  id: string,
  label: string,
  done: boolean,
  href: string | null
) => ({
  id,
  label,
  done,
  action: id === "excel" ? "Continuar: subir tu Excel" : "Continuar",
  href,
});
const steps = [
  step("excel", "Subir Excel de costos", false, null),
  step("ingredientes", "Precios de ingredientes", false, "/x"),
  step("preparaciones", "Preparaciones", false, "/y"),
  step("platos", "Platos", false, "/z"),
];
const workspace = {
  menu_summary: {
    setup: { steps, done: 0, total: 4, next: steps[0], complete: false },
  },
  latest_upload: null,
  batches: [],
  reset: null,
  actor: { can_submit: true },
};

let n = 0;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  openPicker.mockClear();
  pathname = "/dashboard/restaurant/costs";
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => workspace }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const draw = () => {
  n += 1;
  return render(
    <>
      <CostsSetupSection locationId={`loc-up-${n}`} companyId="co-1" />
      <EmptyState
        text="Aún no tienes costos."
        actions={[
          {
            href: "/dashboard/restaurant/costs#costos-ultimo-archivo",
            label: "Subir archivo de costos",
            primary: true,
            opensCostsPicker: true,
          },
        ]}
      />
    </>
  );
};

describe("Costos upload entry points open the file picker on the first click", () => {
  it("«Continuar» in the banner", async () => {
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("«Continuar: subir tu Excel» in the opened detail", async () => {
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalle/ }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Continuar: subir tu Excel" })[0]
    );
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("the checklist row «Elegir archivo»", async () => {
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalle/ }));
    fireEvent.click(screen.getByRole("button", { name: /Elegir archivo/ }));
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("the empty-state «Subir archivo de costos» (already on Costos): no navigation, picker opens", async () => {
    draw();
    await screen.findByRole("button", { name: "Continuar" });
    const link = screen.getByRole("link", { name: "Subir archivo de costos" });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false); // default prevented: the picker handled it
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("the Menú link (another page) navigates to Costos instead", async () => {
    pathname = "/dashboard/restaurant/menu";
    draw();
    await screen.findByRole("button", { name: "Continuar" });
    const link = screen.getByRole("link", { name: "Subir archivo de costos" });
    expect(link.getAttribute("href")).toBe(
      "/dashboard/restaurant/costs#costos-ultimo-archivo"
    );
    expect(fireEvent.click(link)).toBe(true);
    expect(openPicker).not.toHaveBeenCalled();
  });
});

describe("after «1. Guardar precios» the checklist points at «2. Importar recetas»", () => {
  it("«Continuar» says what is next and scrolls the import button into view", async () => {
    draw();
    await screen.findByRole("button", { name: "Continuar" });
    const button = document.createElement("button");
    button.id = "importar-recetas";
    button.focus = vi.fn();
    document.body.appendChild(button);
    act(() => panelState.props.onImportPending?.(12));
    expect(screen.getByTestId("costs-setup-banner").textContent).toContain(
      "Siguiente: Importar recetas (12 platos)"
    );
    expect(screen.getByTestId("costs-setup-banner").textContent).not.toContain(
      "revisar 0"
    );
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    vi.useRealTimers();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(button.focus).toHaveBeenCalled();
    expect(openPicker).not.toHaveBeenCalled();
    button.remove();
  });
});

describe("«Subir factura» is a brand-blue secondary", () => {
  const page = readFileSync(
    join(process.cwd(), "app/dashboard/restaurant/costs/page.tsx"),
    "utf8"
  );
  it("white background, #1B40C8 border and text, #f6f8fe hover, blue focus ring", () => {
    const at = page.indexOf('"Upload invoice", "Subir factura"');
    const link = page.slice(Math.max(0, at - 600), at);
    expect(link).toContain("border-[#1B40C8]");
    expect(link).toContain("bg-white");
    expect(link).toContain("text-[#1B40C8]");
    expect(link).toContain("hover:bg-[#f6f8fe]");
    expect(link).toContain("focus-visible:ring-[#1B40C8]");
  });
  it("no orange anywhere on the Costos page or its tabs", () => {
    for (const file of [
      "app/dashboard/restaurant/costs/page.tsx",
      "components/restaurant/costs/CostsArea.tsx",
      "components/restaurant/costs/CostsSetupSection.tsx",
      "components/restaurant/InvoicesPage.tsx",
      "components/restaurant/SuppliersPage.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(/f28c28|e07b17|orange-/i);
    }
  });
  it("the «Elegir archivo de costos» button is brand-blue", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "components/restaurant/recipes-costing/PriceCatalogPanel.tsx"
      ),
      "utf8"
    );
    expect(src).toMatch(/border-\[#1B40C8\][^"]*text-\[#1B40C8\]/);
  });
});
