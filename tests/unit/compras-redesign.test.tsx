// @vitest-environment jsdom
// Costos › Compras: Spanish, one primary blue button per card, light-blue
// disabled state, no orange; the buttons call the right endpoints.
// Synthetic data only.
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));

import { InvoicesPage } from "@/components/restaurant/InvoicesPage";

const src = readFileSync(
  join(process.cwd(), "components/restaurant/InvoicesPage.tsx"),
  "utf8"
);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ invoices: [] }),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draw = () =>
  render(
    <InvoicesPage
      initialInvoices={[]}
      suppliers={[]}
      ingredients={[]}
      companyCurrency="USD"
    />
  );

describe("Compras cards", () => {
  it("keeps the three cards, in Spanish", () => {
    draw();
    for (const title of [
      "Subir CSV / Excel",
      "Subir factura (foto)",
      "Crear factura a mano",
    ])
      expect(screen.getByText(title)).toBeTruthy();
    for (const label of [
      "Proveedor",
      "Nº de factura",
      "Fecha",
      "Moneda",
      "Total",
      "Notas",
    ])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText("Columnas esperadas")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /Upload invoices|Extract with AI|Create invoice|Expected columns|Invoice #/
    );
  });

  it("one primary button per card; disabled until there is something to send", () => {
    draw();
    const upload = screen.getByRole("button", { name: "Subir facturas" });
    const read = screen.getByRole("button", { name: /Leer con IA/ });
    const create = screen.getByRole("button", { name: "Crear factura" });
    for (const b of [upload, read, create]) {
      expect(b.className).toContain("bg-[#1B40C8]");
      expect(b.className).toContain("disabled:bg-[#b9c7f0]");
    }
    expect((upload as HTMLButtonElement).disabled).toBe(true);
    expect((read as HTMLButtonElement).disabled).toBe(true);
  });

  it("uploading a CSV posts to the invoices upload endpoint (company comes from auth)", async () => {
    draw();
    const input = document.querySelector(
      'input[type="file"][accept=".csv,.xlsx,.xls"]'
    ) as HTMLInputElement;
    const file = new File(["a,b"], "facturas.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    const upload = screen.getByRole("button", { name: "Subir facturas" });
    expect((upload as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(upload);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/restaurant/invoices/upload");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).body as FormData).get("file")).toBeTruthy();
  });

  it("the photo card only accepts images (the endpoint cannot read a PDF)", () => {
    draw();
    const photo = document.querySelector(
      'input[type="file"][accept^="image/"]'
    ) as HTMLInputElement;
    expect(photo.accept).not.toContain("pdf");
  });
});

describe("Compras source rules", () => {
  it("no orange and no text under 12px", () => {
    expect(src).not.toMatch(/f28c28|e07b1|orange-/i);
    expect(src).not.toMatch(/text-\[(9|10|11|11\.5)px\]/);
  });
  it("posting an invoice refreshes every page that shows prices", () => {
    const at = src.indexOf("const postInvoice");
    const body = src.slice(at, at + 1400);
    expect(body).toContain("markTabsStale()");
    expect(body).toContain("router.refresh()");
  });
  it("the invoice endpoints write the price only through ingredient_cost_entries", () => {
    const approve = readFileSync(
      join(process.cwd(), "lib/restaurant/invoices/approve-invoice.ts"),
      "utf8"
    );
    expect(approve).toContain('.from("ingredient_cost_entries")');
    expect(approve).not.toMatch(/update\(\{[^}]*current_unit_cost/);
  });
});
