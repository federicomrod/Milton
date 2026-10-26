// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  SuppliersPage,
  formatSupplierDate,
  type SupplierRow,
} from "@/components/restaurant/SuppliersPage";

afterEach(cleanup);

const row = (over: Partial<SupplierRow> = {}): SupplierRow => ({
  id: "s1",
  name: "Distribuidora Demo",
  status: "active",
  contact_name: "Ana López",
  email: "ana@demo.test",
  phone: "+503 2222 3333",
  notes: null,
  address: null,
  payment_terms: null,
  tax_id: null,
  ingredient_count: 4,
  latest_cost_date: "2026-03-05",
  total_spend: 83,
  currency: "USD",
  ...over,
});

describe("Proveedores: Spanish text", () => {
  it("card labels, status chip, currency and DD/MM/AAAA date", () => {
    render(
      <SuppliersPage
        suppliers={[row(), row({ id: "s2", name: "Otro", status: "archived" })]}
      />
    );
    const t = document.body.textContent ?? "";
    expect(t).toContain("Activo");
    expect(t).toContain("Archivado");
    expect(t).toContain("ingredientes");
    expect(t).toContain("última compra");
    expect(t).toContain("gasto total");
    expect(t).toContain("05/03/2026");
    expect(t).toMatch(/USD\s?83/);
    expect(t).not.toMatch(
      /ACTIVE|ARCHIVED|ingredients|last purchase|total spend/
    );
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
    // only the active one can be archived, and it is a bordered button
    const archive = screen.getByRole("button", { name: "Archivar" });
    expect(archive.className).toContain("border");
    expect(archive.className).toContain("hover:bg-[#E7EDFD]");
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("the edit form is in Spanish; the status payload values stay active / archived", () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ supplier: row() }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SuppliersPage suppliers={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    for (const label of [
      /Nombre \*/,
      "Estado",
      "Nombre de contacto",
      "Correo",
      "Teléfono",
      "Condiciones de pago",
      "Dirección",
      "Notas",
    ])
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByPlaceholderText("contacto@proveedor.com")).toBeTruthy();
    expect(screen.getByPlaceholderText("30 días")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Calle Arce 100, San Salvador")
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Notas opcionales…")).toBeTruthy();
    const options = [...document.querySelectorAll("option")].map((o) => [
      o.value,
      o.textContent,
    ]);
    expect(options).toEqual([
      ["active", "Activo"],
      ["archived", "Archivado"],
    ]);
    expect(
      screen.getByRole("button", { name: /Guardar cambios/ })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cancelar/ })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("formatSupplierDate", () => {
    expect(formatSupplierDate("2026-12-31")).toBe("31/12/2026");
    expect(formatSupplierDate("raro")).toBe("raro");
  });
});
