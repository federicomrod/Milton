// @vitest-environment jsdom
// #313 UI: a Telegram price update is a price, never a purchase. Compras row,
// review panel and the «Últimas facturas» card show the «Actualización de
// precio» label and no invoice amount.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  InvoicesPage,
  type InvoiceListItem,
} from "@/components/restaurant/InvoicesPage";
import { LatestInvoicesCompact } from "@/components/restaurant/costs/LatestInvoicesCompact";
import { PRICE_UPDATE_NOTE_PREFIX } from "@/lib/restaurant/price-update-note";

const PU_NOTE = `${PRICE_UPDATE_NOTE_PREFIX}\nAguacate Test`;

const item = (
  id: string,
  over: Partial<InvoiceListItem> = {}
): InvoiceListItem => ({
  id,
  supplier_id: null,
  supplier_name: `Proveedor ${id}`,
  invoice_number: id,
  invoice_date: "2026-03-04",
  due_date: null,
  currency: "USD",
  total_amount: 10,
  status: "needs_review",
  source_type: "manual",
  notes: null,
  created_at: "2026-03-04T10:00:00Z",
  line_counts: { total: 1, matched: 1, approved: 1, unmatched: 0, pending: 0 },
  line_preview: [],
  ...over,
});

const priceUpdate = (over: Partial<InvoiceListItem> = {}) =>
  item("pu1", { notes: PU_NOTE, total_amount: 5.75, ...over });

const detailLine = (over: Record<string, unknown> = {}) => ({
  id: "ln1",
  invoice_id: "pu1",
  supplier_id: null,
  ingredient_id: "ing1",
  supplier_item_name: "Aguacate Test",
  supplier_sku: null,
  description: "Aguacate Test",
  quantity: 1,
  unit: "lb",
  unit_cost: 1.5,
  line_total: 1.5,
  tax_amount: null,
  normalized_unit: null,
  normalized_unit_cost: null,
  match_status: "matched",
  review_status: "approved",
  notes: null,
  ...over,
});

let invoicesAfterRefresh: InvoiceListItem[] = [];

beforeEach(() => {
  (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
    vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/approve")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            posted_lines: 1,
            skipped_lines: [],
            next_steps: "",
          }),
        };
      }
      if (u === "/api/restaurant/invoices") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ invoices: invoicesAfterRefresh }),
        };
      }
      const m = u.match(/invoices\/([^/?]+)$/);
      const id = m ? decodeURIComponent(m[1]) : "pu1";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          invoice:
            id === "pu1"
              ? priceUpdate({ id })
              : item(id, { total_amount: 120 }),
          lines: [detailLine()],
          events: [],
        }),
      };
    })
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

const renderPage = (invoices: InvoiceListItem[]) =>
  render(
    <InvoicesPage
      initialInvoices={invoices}
      suppliers={[]}
      ingredients={[]}
      companyCurrency="USD"
    />
  );

const totalCells = () => {
  const list = Array.from(document.querySelectorAll("table")).find(
    (t) => t.querySelector("th")?.textContent?.trim() === "Proveedor"
  );
  return Array.from(list?.querySelectorAll("tbody > tr") ?? [])
    .filter((tr) => tr.querySelectorAll(":scope > td").length === 8)
    .map((tr) => tr.querySelectorAll(":scope > td")[4]);
};

describe("Compras list row", () => {
  it("a pending price update keeps its label in Total, with «Sin precio» when its line has none (never blank, never summed prices)", () => {
    renderPage([priceUpdate()]);
    const cell = totalCells()[0];
    expect(
      within(cell as HTMLElement).getByTestId("price-update-label")
    ).toBeTruthy();
    expect(cell.textContent).toBe("Sin precioActualización de precio");
    expect(document.body.textContent).not.toContain("5.75");
    expect(cell.textContent).not.toContain("$0");
  });

  it("a real invoice keeps its amount", () => {
    renderPage([item("a", { total_amount: 120 })]);
    expect(totalCells()[0].textContent).toContain("120.00");
  });

  it("sorting by Total puts the price update last in both directions", () => {
    renderPage([
      priceUpdate({ id: "pu1", invoice_date: "2026-03-05" }),
      item("a", { total_amount: 50 }),
      item("b", { total_amount: 120 }),
    ]);
    const th = screen.getByRole("button", { name: /Total/ });
    const order = () => totalCells().map((c) => c.textContent);
    fireEvent.click(th);
    expect(order()[2]).toContain("Actualiz");
    fireEvent.click(th);
    expect(order()[2]).toContain("Actualiz");
  });

  it("a posted price update is not listed (initial data and refresh)", () => {
    renderPage([priceUpdate({ status: "posted" }), item("a")]);
    expect(screen.queryByTestId("price-update-label")).toBeNull();
    expect(totalCells()).toHaveLength(1);
  });
});

describe("Review panel", () => {
  it("hides the Total, keeps line prices, says «Aprobar precios»; message after posting and the row leaves", async () => {
    renderPage([priceUpdate(), item("a")]);
    const puRow = screen.getByText("Proveedor pu1").closest("tr")!;
    fireEvent.click(within(puRow).getByRole("button", { name: "Revisar" }));
    const panel = await screen.findByTestId("invoice-review-row");
    const btn = await within(panel).findByRole("button", {
      name: "Aprobar precios",
    });
    expect(within(panel).queryByText("Total")).toBeNull();
    expect(within(panel).queryByText("Publicar factura")).toBeNull();
    expect(panel.textContent).toContain("1.50");
    expect(panel.textContent).not.toContain("5.75");

    invoicesAfterRefresh = [item("a")];
    fireEvent.click(btn);
    const msg = await screen.findByTestId("price-update-posted");
    expect(msg.textContent).toBe(
      "Precios actualizados. Los ves en Menú › Ingredientes."
    );
    // the row left the list but the message stays until the panel is closed
    await waitFor(() => expect(totalCells()).toHaveLength(1));
    expect(screen.getByTestId("price-update-posted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByTestId("price-update-posted")).toBeNull();
  });

  it("a real invoice still says «Publicar factura» and shows its Total", async () => {
    renderPage([item("a", { total_amount: 120 })]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    const panel = await screen.findByTestId("invoice-review-row");
    await within(panel).findByText("Publicar factura");
    expect(within(panel).getByText("Total")).toBeTruthy();
  });

  it("a missing or zero line price still reads «Sin precio», never $0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          invoice: priceUpdate(),
          lines: [detailLine({ unit_cost: 0, line_total: 0 })],
          events: [],
        }),
      }))
    );
    renderPage([priceUpdate()]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    const panel = await screen.findByTestId("invoice-review-row");
    await within(panel).findByText("Aprobar precios");
    expect(within(panel).getAllByText("Sin precio").length).toBeGreaterThan(0);
    expect(panel.textContent).not.toContain("$0");
  });
});

describe("Últimas facturas card", () => {
  const latest = (rows: Record<string, unknown>[]) =>
    ({
      rows: rows.map((r) => ({
        id: "x",
        supplier_name: "Proveedor Test",
        invoice_date: "2026-03-04",
        total_amount: 5.75,
        currency: "USD",
        status: "needs_review",
        source_type: "manual",
        notes: null,
        original_file_name: null,
        ...r,
      })),
      pendingCount: rows.length,
      firstPendingId: "x",
    }) as never;

  it("a pending price update shows the label and no amount", () => {
    render(
      <LatestInvoicesCompact latest={latest([{ id: "pu1", notes: PU_NOTE }])} />
    );
    expect(screen.getByText("Actualización de precio")).toBeTruthy();
    expect(document.body.textContent).not.toContain("5.75");
    expect(document.body.textContent).not.toContain("Sin precio");
  });

  it("a real invoice keeps its total", () => {
    render(
      <LatestInvoicesCompact
        latest={latest([{ id: "i1", total_amount: 120 }])}
      />
    );
    expect(document.body.textContent).toContain("120");
  });
});
