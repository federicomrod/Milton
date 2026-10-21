// @vitest-environment jsdom
// The prices screens follow the server's answer (canEditPrices): when it is
// false the controls are disabled and the Spanish reason shows.
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  PriceCatalogPanel,
  type PriceCatalogPanelHandle,
} from "@/components/restaurant/recipes-costing/PriceCatalogPanel";
import { SuppliersPage } from "@/components/restaurant/SuppliersPage";
import { InvoicesPage } from "@/components/restaurant/InvoicesPage";

const REASON = "Tu rol no puede cambiar precios.";

beforeEach(() => {
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        draft: null,
        open: [],
        conflicts: [],
        invoices: [],
      }),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("canEditPrices = false", () => {
  it("price catalog: the file button is disabled and the reason shows", () => {
    const ref = createRef<PriceCatalogPanelHandle>();
    render(<PriceCatalogPanel ref={ref} embedded canEditPrices={false} />);
    const button = screen
      .getByText("Elegir archivo de costos")
      .closest("button");
    expect(button?.disabled).toBe(true);
    expect(screen.getByText(REASON)).toBeTruthy();
    ref.current?.openPicker();
    expect(HTMLInputElement.prototype.click).not.toHaveBeenCalled();
  });

  it("suppliers: Agregar proveedor is disabled and the reason shows", () => {
    render(<SuppliersPage suppliers={[]} canEditPrices={false} />);
    expect(
      (
        screen
          .getByText("Agregar proveedor")
          .closest("button") as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByText(REASON)).toBeTruthy();
  });

  it("invoices: the entry cards are replaced by the reason", () => {
    render(
      <InvoicesPage
        initialInvoices={[]}
        suppliers={[]}
        ingredients={[]}
        canEditPrices={false}
      />
    );
    expect(screen.getByText(REASON)).toBeTruthy();
    expect(screen.queryByText("Crear factura a mano")).toBeNull();
  });

  it("stay editable when the server says yes", () => {
    render(<SuppliersPage suppliers={[]} canEditPrices />);
    expect(
      (
        screen
          .getByText("Agregar proveedor")
          .closest("button") as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(screen.queryByText(REASON)).toBeNull();
  });
});
