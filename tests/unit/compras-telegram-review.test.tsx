// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  InvoicesPage,
  parseMissingSections,
  type InvoiceListItem,
} from "@/components/restaurant/InvoicesPage";
import { INVOICE_TELEGRAM_NOTE } from "@/lib/restaurant/price-update-note";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTES = `${INVOICE_TELEGRAM_NOTE}\nLíneas sin precio (leídas de la foto): sal, aceite\nLíneas sin cantidad: harina`;

const item = (over: Partial<InvoiceListItem>): InvoiceListItem => ({
  id: "inv1",
  supplier_id: null,
  supplier_name: "Proveedor Demo",
  invoice_number: "F-1",
  invoice_date: "2026-03-04",
  due_date: null,
  currency: "USD",
  total_amount: null,
  status: "needs_review",
  source_type: "image",
  notes: null,
  created_at: "2026-03-04T10:00:00Z",
  line_counts: { total: 2, matched: 0, approved: 0, unmatched: 2, pending: 2 },
  ...over,
});

const line = (id: string, unit_cost: number | null, line_total: number) => ({
  id,
  invoice_id: "inv1",
  supplier_id: null,
  ingredient_id: null,
  supplier_item_name: id,
  supplier_sku: null,
  description: id,
  quantity: 1,
  unit: "kg",
  unit_cost,
  line_total,
  tax_amount: null,
  normalized_unit: null,
  normalized_unit_cost: null,
  match_status: "unmatched",
  review_status: "pending",
  notes: null,
});

function renderPage(inv: InvoiceListItem, lines: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        invoice: { ...inv, notes: inv.notes },
        lines,
        events: [],
      }),
    }))
  );
  render(
    <InvoicesPage
      initialInvoices={[inv]}
      suppliers={[]}
      ingredients={[]}
      companyCurrency="USD"
    />
  );
}

describe("Compras: Telegram invoices", () => {
  it("parses missing sections", () => {
    expect(parseMissingSections(NOTES)).toEqual([
      { label: "Sin precio", items: ["sal", "aceite"] },
      { label: "Sin cantidad", items: ["harina"] },
    ]);
  });

  it("detail shows notes, badges, Sin precio and no fake total", async () => {
    renderPage(item({ notes: NOTES }), [
      line("Sal", null, 0),
      line("Aceite", 2, 4),
    ]);
    fireEvent.click(screen.getByText("Revisar"));
    await waitFor(() => screen.getByText("Notas de Milton"));
    expect(screen.getByTestId("milton-notes").textContent).toContain(
      "Líneas sin precio (leídas de la foto): sal, aceite"
    );
    expect(screen.getAllByText("Sin precio").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Sin cantidad")).toHaveLength(1);
    // total is not computable: never "$0.00"
    expect(screen.getAllByText("Incompleto").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
    // the list row now shows «por Telegram» as text; the chip lives in the panel only
    expect(screen.getAllByTestId("telegram-label").length).toBe(1);
  });

  it("Telegram label by file name and by price-update prefix", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <InvoicesPage
        initialInvoices={[
          item({ id: "a", original_file_name: "telegram-123.jpg" }),
          item({
            id: "b",
            notes:
              "Actualización de precio enviada por Telegram (nota de voz o mensaje). Revísala antes de aprobar.",
          }),
          item({ id: "c" }),
        ]}
        suppliers={[]}
        ingredients={[]}
        companyCurrency="USD"
      />
    );
    // no grey Telegram chip in the list: the source is secondary text
    expect(screen.queryAllByTestId("telegram-label")).toHaveLength(0);
    expect(
      screen.getAllByTestId("invoice-source").map((e) => e.textContent)
    ).toEqual(["por Telegram", "por Telegram", "por foto"]);
    expect(screen.getAllByTestId("price-update-label")).toHaveLength(1);
    expect(screen.getAllByText("Sin precio").length).toBe(3);
  });
});
