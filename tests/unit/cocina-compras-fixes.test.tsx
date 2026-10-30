// @vitest-environment jsdom
// Fixes from the app test: Compras Total never blank for price updates (app or
// Telegram), Costos hides «Últimas facturas» on Compras (and its Revisar goes
// to Compras elsewhere), Cocina «Necesita atención» has no red.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

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
import { KitchenAttentionFeed } from "@/components/restaurant/kitchen/KitchenAttentionFeed";
import {
  APP_PRICE_UPDATE_NOTE_PREFIX,
  PRICE_UPDATE_NOTE_PREFIX,
} from "@/lib/restaurant/price-update-note";
import { invoiceReviewHref } from "@/lib/restaurant/costs-tabs";
import type { LatestInvoices } from "@/lib/restaurant/costs-page-data";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const update = (
  id: string,
  notes: string,
  amounts: { total: number | null; priced: boolean },
  missing: ("quantity" | "unit")[] = []
): InvoiceListItem => ({
  id,
  supplier_id: null,
  supplier_name: "Proveedor Demo",
  invoice_number: id,
  invoice_date: "2026-10-30",
  due_date: null,
  currency: "USD",
  total_amount: null,
  status: "needs_review",
  source_type: "manual",
  notes,
  created_at: "2026-10-30T10:00:00Z",
  line_counts: { total: 1, matched: 0, approved: 0, unmatched: 1, pending: 1 },
  line_preview: [
    {
      name: "Producto",
      quantity: 1,
      unit: "unidad",
      unit_cost: amounts.priced ? 2 : null,
      matched: false,
      missing,
    },
  ],
  line_amounts: amounts,
});

describe("Compras: the Total of a kitchen draft is never blank", () => {
  it("shows qty × price, «Falta» (price said, quantity not) or «Sin precio»; the line says «Falta» for what was not said", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    );
    render(
      <InvoicesPage
        initialInvoices={[
          update("APP1", APP_PRICE_UPDATE_NOTE_PREFIX, {
            total: 7.5,
            priced: true,
          }),
          update("TG1", PRICE_UPDATE_NOTE_PREFIX, { total: 3.5, priced: true }),
          update(
            "QTY",
            APP_PRICE_UPDATE_NOTE_PREFIX,
            { total: null, priced: true },
            ["quantity"]
          ),
          update(
            "NONE",
            APP_PRICE_UPDATE_NOTE_PREFIX,
            { total: null, priced: false },
            ["quantity", "unit"]
          ),
        ]}
        suppliers={[]}
        ingredients={[]}
        companyCurrency="USD"
      />
    );
    const cells = screen
      .getAllByTestId("price-update-amount")
      .map((c) => (c.textContent ?? "").replace(/\s/g, " ").trim());
    expect(cells).toHaveLength(4);
    for (const c of cells) expect(c).not.toBe("");
    expect(cells[0]).toMatch(/7[.,]50/);
    expect(cells[1]).toMatch(/3[.,]50/);
    expect(cells[2]).toBe("Falta");
    expect(cells[3]).toBe("Sin precio");
    // The product column marks what was not said.
    const badges = screen
      .getAllByTestId("missing-badge")
      .map((b) => b.textContent);
    expect(badges).toEqual(
      expect.arrayContaining(["Falta (Cant.)", "Falta", "Sin precio"])
    );
  });
});

describe("Costos: «Últimas facturas»", () => {
  it("is not drawn on the Compras tab, and stays on the others", () => {
    const page = read("app/dashboard/restaurant/costs/page.tsx");
    const uses = page.match(
      /latestInvoices=\{tab === "compras" \? null : latestInvoices\}/g
    );
    expect(uses).toHaveLength(3);
    expect(page).not.toMatch(/latestInvoices=\{latestInvoices\}/);
  });

  it("its Revisar (any other tab) goes to Compras and opens the first pending one", () => {
    const latest: LatestInvoices = {
      rows: [
        {
          id: "newest",
          supplier_name: "Uno",
          invoice_date: "2026-10-30",
          total_amount: 10,
          currency: "USD",
          status: "approved",
          source_type: "image",
        } as LatestInvoices["rows"][number],
      ],
      pendingCount: 2,
      firstPendingId: "pending-1",
    };
    render(<LatestInvoicesCompact latest={latest} />);
    const link = screen.getByText("Revisar").closest("a");
    expect(link?.getAttribute("href")).toBe(invoiceReviewHref("pending-1"));
    expect(link?.getAttribute("href")).toContain("tab=compras");
    expect(link?.getAttribute("href")).toContain("factura=pending-1");
  });
});

describe("Cocina: «Necesita atención» has no red, green or orange", () => {
  it("uses the amarillo chip with Ink for «!» and no red classes", () => {
    const item = {
      id: "1",
      kind: "running_out" as const,
      title: "Queso fresco",
      detail: "Se agota",
      time_label: "hoy",
      action: "resolve" as const,
      action_label: "Resolver",
      report_ids: [],
      draft_id: null,
      latest_at: "2026-10-30T10:00:00Z",
    };
    const { container } = render(
      <KitchenAttentionFeed
        insights={
          {
            counts: { all: 1, running_out: 1, waste: 0, drafts: 0 },
            feed: [item],
            highlights: [],
            empty_feed: "",
          } as never
        }
        filter="all"
        onFilter={() => {}}
        shown={[item]}
        expanded
        onExpand={() => {}}
        onAction={() => {}}
        resolvingId={null}
        lang="es"
      />
    );
    const mark = screen.getByText("!");
    expect(mark.className).toContain("bg-[#FDE68A]");
    expect(mark.className).toContain("text-[#0F172A]");
    expect(container.innerHTML).not.toMatch(/red-|green-|orange-|emerald-/);
  });
});
