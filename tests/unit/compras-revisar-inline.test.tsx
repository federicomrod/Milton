// @vitest-environment jsdom
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
import { INVOICE_TELEGRAM_NOTE } from "@/lib/restaurant/price-update-note";

const scrollSpy = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

const item = (
  n: number,
  over: Partial<InvoiceListItem> = {}
): InvoiceListItem => ({
  id: `inv${n}`,
  supplier_id: null,
  supplier_name: `Proveedor ${n}`,
  invoice_number: `F-${n}`,
  invoice_date: "2026-03-04",
  due_date: null,
  currency: "USD",
  total_amount: 10,
  status: "posted",
  source_type: "manual",
  notes: null,
  created_at: "2026-03-04T10:00:00Z",
  line_counts: { total: 1, matched: 1, approved: 1, unmatched: 0, pending: 0 },
  line_preview: [],
  ...over,
});

const detailLine = (id: string) => ({
  id,
  invoice_id: "x",
  supplier_id: null,
  ingredient_id: null,
  supplier_item_name: "Harina",
  supplier_sku: null,
  description: "Harina",
  quantity: 1,
  unit: "kg",
  unit_cost: 1.95,
  line_total: 1.95,
  tax_amount: null,
  normalized_unit: null,
  normalized_unit_cost: null,
  match_status: "unmatched",
  review_status: "pending",
  notes: null,
});

beforeEach(() => {
  scrollSpy.mockClear();
  (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
    scrollSpy;
  fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (String(url).endsWith("/lines") && init?.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          line: {
            ...detailLine("ln1"),
            review_status: "approved",
            match_status: "matched",
          },
        }),
      };
    }
    if (String(url).endsWith("/approve")) {
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
    const m = String(url).match(/invoices\/([^/?]+)$/);
    const id = m ? decodeURIComponent(m[1]) : "inv1";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        invoice: { ...item(1), id, status: "needs_review", notes: null },
        lines: [detailLine("ln1")],
        events: [],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const seven = () => [1, 2, 3, 4, 5, 6, 7].map((n) => item(n));

function renderPage(
  invoices: InvoiceListItem[],
  props: { canEditPrices?: boolean } = {}
) {
  return render(
    <InvoicesPage
      initialInvoices={invoices}
      suppliers={[]}
      ingredients={[]}
      companyCurrency="USD"
      {...props}
    />
  );
}

const revisarButtons = () => screen.getAllByRole("button", { name: "Revisar" });

describe("Compras: Revisar inline", () => {
  it("opens the review right under the clicked row", async () => {
    renderPage(seven());
    const btn = revisarButtons()[2];
    fireEvent.click(btn);
    const panel = await screen.findByTestId("invoice-review-row");
    const row3 = btn.closest("tr")!;
    expect(row3.nextElementSibling).toBe(panel);
    expect(row3.parentElement).toBe(panel.parentElement);
    expect(row3.parentElement!.tagName).toBe("TBODY");
    await within(panel).findByText("Publicar factura");
    expect(within(panel).getByText("Descripción")).toBeTruthy();
    const open = screen.getByRole("button", { name: "Ocultar" });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(open.getAttribute("aria-controls")).toBe(panel.id);
    expect(scrollSpy).toHaveBeenCalled();
    expect(row3.className).toContain("bg-[#eef2fd]");
  });

  it("Ocultar, switching rows and Cerrar", async () => {
    renderPage(seven());
    fireEvent.click(revisarButtons()[0]);
    await screen.findByTestId("invoice-review-row");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(screen.queryByTestId("invoice-review-row")).toBeNull();

    fireEvent.click(revisarButtons()[0]);
    await screen.findByTestId("invoice-review-row");
    fireEvent.click(revisarButtons()[0]); // now the second row (first is Ocultar)
    await waitFor(() =>
      expect(screen.getAllByTestId("invoice-review-row")).toHaveLength(1)
    );
    const panel = screen.getByTestId("invoice-review-row");
    expect(panel.previousElementSibling!.textContent).toContain("Proveedor 2");

    const cerrar = await within(panel).findByRole("button", { name: "Cerrar" });
    fireEvent.click(cerrar);
    expect(screen.queryByTestId("invoice-review-row")).toBeNull();
  });

  it("?factura=<id> opens inline; an unknown id shows the panel above the table", async () => {
    window.history.replaceState({}, "", "/?factura=inv4");
    renderPage(seven());
    const panel = await screen.findByTestId("invoice-review-row");
    expect(panel.previousElementSibling!.textContent).toContain("Proveedor 4");
    expect(scrollSpy).toHaveBeenCalled();
    cleanup();

    window.history.replaceState({}, "", "/?factura=desconocida");
    renderPage(seven());
    const fb = await screen.findByTestId("invoice-review-fallback");
    expect(screen.queryByTestId("invoice-review-row")).toBeNull();
    const table = document.querySelector("table")!;
    expect(
      fb.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await within(fb).findByText("Publicar factura");
  });

  it("approval still posts to the same endpoints", async () => {
    renderPage([item(1, { status: "needs_review" })]);
    fireEvent.click(revisarButtons()[0]);
    const panel = await screen.findByTestId("invoice-review-row");
    await within(panel).findByText("Publicar factura");
    // Fetch URLs / methods used by the panel
    const calls = () =>
      fetchMock.mock.calls.map((c) => [String(c[0]), c[1]?.method ?? "GET"]);
    expect(calls()).toContainEqual(["/api/restaurant/invoices/inv1", "GET"]);
    const aprobar = await within(panel).findAllByRole("button", {
      name: /Aprobar/,
    });
    fireEvent.click(aprobar[0]);
    await waitFor(() =>
      expect(calls()).toContainEqual([
        "/api/restaurant/invoices/inv1/lines",
        "POST",
      ])
    );
    const publish = await within(panel).findByText("Publicar factura");
    await waitFor(() =>
      expect((publish.closest("button") as HTMLButtonElement).disabled).toBe(
        false
      )
    );
    fireEvent.click(publish);
    await waitFor(() =>
      expect(calls()).toContainEqual([
        "/api/restaurant/invoices/inv1/approve",
        "POST",
      ])
    );
  });

  it("read-only users still open the panel, edits disabled", async () => {
    renderPage([item(1, { status: "needs_review" })], { canEditPrices: false });
    fireEvent.click(revisarButtons()[0]);
    const panel = await screen.findByTestId("invoice-review-row");
    const publish = await within(panel).findByText("Publicar factura");
    expect((publish.closest("button") as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});

describe("Compras: Productos column", () => {
  it("matched name, unmatched marker, +N más, Sin precio, Sin productos", () => {
    renderPage([
      item(1, {
        line_counts: {
          total: 1,
          matched: 1,
          approved: 0,
          unmatched: 0,
          pending: 1,
        },
        line_preview: [
          {
            name: "Harina de trigo",
            quantity: 1,
            unit: "kg",
            unit_cost: 1.95,
            matched: true,
          },
        ],
      }),
      item(2, {
        line_counts: {
          total: 3,
          matched: 1,
          approved: 0,
          unmatched: 2,
          pending: 3,
        },
        line_preview: [
          {
            name: "Sal fina",
            quantity: 2.5,
            unit: "kg",
            unit_cost: 1,
            matched: false,
          },
          {
            name: "Aceite",
            quantity: null,
            unit: null,
            unit_cost: null,
            matched: true,
          },
        ],
      }),
      item(3, {
        line_counts: {
          total: 0,
          matched: 0,
          approved: 0,
          unmatched: 0,
          pending: 0,
        },
      }),
    ]);
    const items = screen.getAllByTestId("invoice-product-item");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/^Harina de trigo · 1 kg · .*1\.95$/);
    expect(items[0].textContent).not.toContain("sin asignar");
    expect(items[1].textContent).toContain("Sal fina");
    expect(items[1].textContent).toContain("sin asignar");
    expect(items[1].textContent).toContain("2.5 kg");
    expect(items[2].textContent).toBe("Aceite · Sin precio");
    expect(screen.getByText("+1 más")).toBeTruthy();
    expect(screen.getAllByText("Sin productos")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/\$0\.00/);
    expect(document.body.textContent).not.toMatch(/USD\s?0\.00/);
    expect(document.body.textContent).not.toMatch(/(?<!\d)0[.,]00/);
    const headers = [...document.querySelectorAll("thead th")].map((t) =>
      (t.textContent ?? "").trim()
    );
    expect(headers.slice(0, 3)).toEqual([
      "Proveedor",
      "Productos",
      "Nº de factura",
    ]);
  });
});

describe("Compras: Estado", () => {
  it("one chip per row, source as text, explanation once only if Por revisar", () => {
    const tg = item(1, {
      status: "needs_review",
      notes: INVOICE_TELEGRAM_NOTE,
      original_file_name: "telegram-1.jpg",
      source_type: "image",
    });
    renderPage([tg, item(2), item(3, { status: "needs_review" })]);
    expect(screen.getAllByTestId("invoice-status-chip")).toHaveLength(3);
    expect(screen.queryAllByTestId("telegram-label")).toHaveLength(0);
    expect(screen.getAllByText("por Telegram")).toHaveLength(1);
    expect(screen.getAllByTestId("review-explanation")).toHaveLength(1);
    expect(screen.getByTestId("review-explanation").textContent).toContain(
      "el precio aún no cuenta"
    );
    const chips = screen.getAllByTestId("invoice-status-chip");
    expect(chips[0].getAttribute("title")).toBe(
      "El precio no se aplica hasta que alguien lo apruebe."
    );
    expect(chips[1].getAttribute("title")).toBe(
      "Los precios ya están aplicados a tus costos y platos."
    );
    expect(chips[0].className).toContain("text-[#1B40C8]");
  });

  it("no explanation when every row is Publicada", () => {
    renderPage([item(1), item(2)]);
    expect(screen.queryByTestId("review-explanation")).toBeNull();
  });
});

describe("Compras: never $0", () => {
  it("a unit cost of 0 (or negative) reads «Sin precio» in Productos; a total of 0 in the list too", () => {
    renderPage([
      item(1, {
        total_amount: 0,
        line_preview: [
          { name: "Sal", quantity: 1, unit: "kg", unit_cost: 0, matched: true },
          {
            name: "Aceite",
            quantity: 1,
            unit: "l",
            unit_cost: -2,
            matched: true,
          },
        ],
      }),
    ]);
    const items = screen.getAllByTestId("invoice-product-item");
    expect(items[0].textContent).toBe("Sal · 1 kg · Sin precio");
    expect(items[1].textContent).toBe("Aceite · 1 l · Sin precio");
    const row = items[0].closest("tr")!;
    expect(row.textContent).toContain("Sin precio");
    expect(row.textContent).not.toMatch(/\$\s?0/);
    expect(row.textContent).not.toMatch(/USD\s?0\.00/);
    expect(row.textContent).not.toMatch(/(?<!\d)0[.,]00/);
  });
});

describe("Compras: Revisar panel Origen and Agregar línea", () => {
  const openPanel = async (inv: InvoiceListItem) => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        invoice: inv,
        lines: [detailLine("ln1")],
        events: [],
      }),
    }));
    renderPage([inv]);
    fireEvent.click(revisarButtons()[0]);
    return screen.findByTestId("invoice-review-row");
  };

  const cases: [string, Partial<InvoiceListItem>, string][] = [
    [
      "Telegram",
      {
        source_type: "image",
        original_file_name: "telegram-9.jpg",
        notes: INVOICE_TELEGRAM_NOTE,
      },
      "Telegram",
    ],
    ["Telegram (manual source)", { notes: INVOICE_TELEGRAM_NOTE }, "Telegram"],
    ["Foto", { source_type: "image" }, "Foto"],
    ["Foto (pdf)", { source_type: "pdf" }, "Foto"],
    ["CSV", { source_type: "csv" }, "CSV / Excel"],
    ["Excel", { source_type: "xlsx" }, "CSV / Excel"],
    ["Manual", { source_type: "manual" }, "Manual"],
  ];
  for (const [name, over, expected] of cases) {
    it(`Origen reads «${expected}» (${name})`, async () => {
      const panel = await openPanel(
        item(1, { status: "needs_review", ...over })
      );
      await within(panel).findByText("Publicar factura");
      expect(within(panel).getByTestId("invoice-origin").textContent).toBe(
        expected
      );
    });
  }

  it("the Agregar línea form stays collapsed until «+ Agregar línea» is clicked", async () => {
    const panel = await openPanel(item(1, { status: "needs_review" }));
    await within(panel).findByText("Publicar factura");
    const FORM_FIELD = /Descripción \(texto de la línea/;
    expect(within(panel).queryByText(FORM_FIELD)).toBeNull();
    const toggle = within(panel).getByRole("button", {
      name: "+ Agregar línea",
    });
    fireEvent.click(toggle);
    expect(await within(panel).findByText(FORM_FIELD)).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: /^Agregar línea$/ })
    ).toBeTruthy();
  });

  it("the line-level Pendiente chip is brand blue", async () => {
    const panel = await openPanel(item(1, { status: "needs_review" }));
    const chip = await within(panel).findByText("Pendiente");
    expect(chip.className).toContain("bg-[#E7EDFD]");
    expect(chip.className).toContain("text-[#1B40C8]");
  });
});

describe("Compras: the Revisar panel never shows $0", () => {
  const ZERO = /(?<!\d)0[.,]00/;
  const openWith = async (
    lines: Array<Record<string, unknown>>,
    invOver: Partial<InvoiceListItem> = {}
  ) => {
    const inv = item(1, { status: "needs_review", ...invOver });
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ invoice: inv, lines, events: [] }),
    }));
    renderPage([inv]);
    fireEvent.click(revisarButtons()[0]);
    const panel = await screen.findByTestId("invoice-review-row");
    await within(panel).findByText("Publicar factura");
    return panel;
  };
  const line = (over: Record<string, unknown>) => ({
    ...detailLine("ln1"),
    ...over,
  });
  const expectNoZero = (panel: HTMLElement) => {
    expect(panel.textContent).not.toContain("USD 0.00");
    expect(panel.textContent).not.toContain("$0.00");
    expect(panel.textContent ?? "").not.toMatch(ZERO);
  };

  it("unit_cost 0 and line_total 0: «Sin precio» in both cells", async () => {
    const panel = await openWith([line({ unit_cost: 0, line_total: 0 })], {
      total_amount: null,
    });
    expectNoZero(panel);
    expect(
      within(panel).getAllByText("Sin precio").length
    ).toBeGreaterThanOrEqual(2);
  });

  it("unit_cost 0 but line_total 5: the unit cost reads «Sin precio», the total is real", async () => {
    const panel = await openWith([line({ unit_cost: 0, line_total: 5 })], {
      total_amount: null,
    });
    expectNoZero(panel);
    expect(within(panel).getAllByText("Sin precio").length).toBeGreaterThan(0);
    expect(panel.textContent).toContain("5.00");
  });

  it("total_amount null with lines that add up to 0: «Incompleto», never $0", async () => {
    const panel = await openWith(
      [
        line({ id: "a", unit_cost: 0, line_total: 0 }),
        line({ id: "b", unit_cost: null, line_total: 0 }),
      ],
      { total_amount: null }
    );
    expectNoZero(panel);
    expect(panel.textContent).toContain("Incompleto");
  });
});
