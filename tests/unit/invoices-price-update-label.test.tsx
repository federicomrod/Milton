// @vitest-environment jsdom
// Compras: a draft created from a Telegram price update carries a neutral
// «Actualización de precio» label so it does not look like a purchase.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  InvoicesPage,
  type InvoiceListItem,
} from "@/components/restaurant/InvoicesPage";
import { PRICE_UPDATE_NOTE_PREFIX } from "@/lib/restaurant/price-update-note";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (id: string, notes: string | null): InvoiceListItem => ({
  id,
  supplier_id: null,
  supplier_name: "Proveedor Demo",
  invoice_number: id,
  invoice_date: "2026-03-04",
  due_date: null,
  currency: "USD",
  total_amount: 20,
  status: "needs_review",
  source_type: "image",
  notes,
  created_at: "2026-03-04T10:00:00Z",
  line_counts: { total: 1, matched: 0, approved: 0, unmatched: 1, pending: 1 },
});

describe("price update label", () => {
  it("shows once, in gray, only for rows whose notes start with the prefix", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    );
    render(
      <InvoicesPage
        initialInvoices={[
          row("A", `${PRICE_UPDATE_NOTE_PREFIX}\nLíneas sin precio: sal`),
          row("B", "AI extraction notes: borrosa"),
          row("C", `nota previa. ${PRICE_UPDATE_NOTE_PREFIX}`),
          row("D", null),
        ]}
        suppliers={[]}
        ingredients={[]}
        companyCurrency="USD"
      />
    );
    const labels = screen.getAllByTestId("price-update-label");
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe("Actualización de precio");
    expect(labels[0].className).toContain("text-[#6b7280]");
  });
});
