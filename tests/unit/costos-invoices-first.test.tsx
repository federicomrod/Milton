// @vitest-environment jsdom
// Costos #323: «Últimas facturas» first, ONE slim setup line, tabs right after;
// «Revisar» opens the invoice in Compras once. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/restaurant/recipes-costing/PriceCatalogPanel", () => ({
  PriceCatalogPanel: () => <div>PANEL ARCHIVO</div>,
}));
vi.mock("@/components/restaurant/recipes-costing/ResetPanel", () => ({
  ResetPanel: () => <div>RESET</div>,
}));

import {
  CostsSetupSection,
  READ_MENU_HREF,
  setupDismissedKey,
} from "@/components/restaurant/costs/CostsSetupSection";
import {
  LatestInvoicesBox,
  invoiceTotalText,
} from "@/components/restaurant/costs/LatestInvoicesBox";
import {
  InvoicesPage,
  type InvoiceListItem,
} from "@/components/restaurant/InvoicesPage";
import { invoiceReviewHref } from "@/lib/restaurant/costs-tabs";
import type { LatestInvoices } from "@/lib/restaurant/costs-page-data";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockClear();
  window.history.replaceState(null, "", "/");
});

const row = (over: Partial<LatestInvoices["rows"][number]> = {}) => ({
  id: "i1",
  supplier_name: "Proveedor Uno",
  invoice_date: "2026-09-10",
  total_amount: 120 as number | null,
  currency: "USD",
  status: "needs_review",
  source_type: "image",
  notes: null,
  original_file_name: null,
  ...over,
});

describe("«Últimas facturas»", () => {
  it("shows proveedor, fecha, total, origen and estado; «N por revisar» is the pending count, not the rows shown", () => {
    render(
      <LatestInvoicesBox
        latest={{
          rows: [
            row(),
            row({
              id: "i2",
              source_type: "csv",
              status: "posted",
              total_amount: null,
            }),
            row({ id: "i3", original_file_name: "telegram-1.jpg" }),
          ],
          pendingCount: 7,
          firstPendingId: "i1",
        }}
        uploadHref="/x"
      />
    );
    expect(screen.getByTestId("latest-invoices-pending").textContent).toBe(
      "7 por revisar"
    );
    const rows = screen.getAllByTestId("latest-invoice-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Proveedor Uno");
    expect(rows[0].textContent).toContain("Foto");
    expect(rows[0].textContent).toContain("Por revisar");
    expect(rows[1].textContent).toContain("CSV");
    expect(rows[1].textContent).toContain("Publicada");
    expect(rows[2].textContent).toContain("Telegram");
  });

  it("a missing total reads «Sin precio», never $0", () => {
    render(
      <LatestInvoicesBox
        latest={{
          rows: [row({ total_amount: null })],
          pendingCount: 0,
          firstPendingId: null,
        }}
        uploadHref="/x"
      />
    );
    const text = screen.getByTestId("latest-invoices").textContent ?? "";
    expect(text).toContain("Sin precio");
    expect(text).not.toMatch(/\$\s?0/);
    expect(invoiceTotalText(null, "USD")).toBe("Sin precio");
    expect(invoiceTotalText(0, "USD")).toBe("Sin precio");
    expect(invoiceTotalText(120, "USD")).toContain("120");
  });

  it("«Revisar» links to Compras with the first pending invoice", () => {
    render(
      <LatestInvoicesBox
        latest={{ rows: [row()], pendingCount: 1, firstPendingId: "abc-1" }}
        uploadHref="/x"
        shellParams={{ location: "L1" }}
      />
    );
    const href = screen
      .getByRole("link", { name: "Revisar" })
      .getAttribute("href");
    expect(href).toBe(invoiceReviewHref("abc-1", { location: "L1" }));
    expect(href).toContain("tab=compras");
    expect(href).toContain("factura=abc-1");
    expect(href).toContain("location=L1");
  });

  it("no pending: no «Revisar» button", () => {
    render(
      <LatestInvoicesBox
        latest={{ rows: [row()], pendingCount: 0, firstPendingId: null }}
        uploadHref="/x"
      />
    );
    expect(screen.queryByRole("link", { name: "Revisar" })).toBeNull();
    expect(screen.getByTestId("latest-invoices-pending").textContent).toBe(
      "Nada por revisar"
    );
  });

  it("empty state with «Subir factura»", () => {
    render(
      <LatestInvoicesBox
        latest={{ rows: [], pendingCount: 0, firstPendingId: null }}
        uploadHref="/subir"
      />
    );
    expect(screen.getByTestId("latest-invoices-empty").textContent).toContain(
      "Aún no tienes facturas. Súbelas aquí o mándalas por Telegram."
    );
    expect(
      screen.getByRole("link", { name: "Subir factura" }).getAttribute("href")
    ).toBe("/subir");
  });
});

const inv = (over: Partial<InvoiceListItem> = {}): InvoiceListItem => ({
  id: "inv-a",
  supplier_id: null,
  supplier_name: "Proveedor Uno",
  invoice_number: "F-1",
  invoice_date: "2026-09-10",
  due_date: null,
  currency: "USD",
  total_amount: 10,
  status: "needs_review",
  source_type: "image",
  notes: null,
  created_at: "2026-09-10T10:00:00Z",
  line_counts: { total: 1, matched: 0, approved: 0, unmatched: 1, pending: 1 },
  ...over,
});

describe("Compras: ?factura= opens the review once", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ invoice: inv(), lines: [], events: [] }),
      }))
    );
  });

  it("opens that invoice, then removes the param keeping the others", async () => {
    window.history.replaceState(
      null,
      "",
      "/dashboard/restaurant/costs?tab=compras&location=L1&factura=inv-a"
    );
    render(
      <InvoicesPage initialInvoices={[inv()]} suppliers={[]} ingredients={[]} />
    );
    await waitFor(() =>
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
          String(c[0]).includes("inv-a")
        )
      ).toBe(true)
    );
    expect(screen.getByRole("button", { name: "Ocultar" })).toBeTruthy();
    expect(window.location.pathname + window.location.search).toBe(
      "/dashboard/restaurant/costs?tab=compras&location=L1"
    );
  });

  it("without the param nothing opens", () => {
    render(
      <InvoicesPage initialInvoices={[inv()]} suppliers={[]} ingredients={[]} />
    );
    expect(screen.getByRole("button", { name: "Revisar" })).toBeTruthy();
  });

  it("the list and review come before the add forms (folded in «Agregar factura»)", () => {
    render(
      <InvoicesPage initialInvoices={[inv()]} suppliers={[]} ingredients={[]} />
    );
    const html = document.body.innerHTML;
    expect(html.indexOf("Proveedor")).toBeLessThan(
      html.indexOf("Agregar factura")
    );
    const details = document.getElementById("subir-factura");
    expect(details?.tagName).toBe("DETAILS");
    expect(details?.hasAttribute("open")).toBe(false);
  });
});

// --- setup line -------------------------------------------------------------

const step = (
  id: string,
  label: string,
  done: boolean,
  href: string | null
) => ({
  id,
  label,
  done,
  action: `Continuar: ${label.toLowerCase()}`,
  href,
});
function workspace(complete: boolean) {
  const steps = [
    step("excel", "Subir Excel", true, null),
    step("ingredientes", "Precios", complete, "/p"),
    step("preparaciones", "Preparaciones", complete, "/q"),
    step("platos", "Platos", complete, "/r"),
  ];
  const done = steps.filter((s) => s.done).length;
  return {
    menu_summary: {
      setup: {
        steps,
        done,
        total: 4,
        next: steps.find((s) => !s.done) ?? null,
        complete: done === 4,
      },
    },
    latest_upload: {
      id: "u1",
      filename: "costos-prueba.xlsx",
      created_at: "2026-09-01T10:00:00Z",
      has_candidate_blocks: false,
    },
    batches: [],
    reset: null,
    actor: { can_submit: true },
  };
}
let current = workspace(false);
let n = 100;
const draw = (companyId = "co-1") => {
  n += 1;
  return render(
    <CostsSetupSection locationId={`loc-d-${n}`} companyId={companyId} />
  );
};

describe("setup line", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => current }))
    );
  });

  it("incomplete: one row with progress, Continuar, Ver detalle, Leer tu menú → and no reader", async () => {
    current = workspace(false);
    draw();
    const banner = await screen.findByTestId("costs-setup-banner");
    expect(banner.textContent).toContain("Configura tus costos · 1 de 4");
    expect(banner.textContent).toContain("Siguiente:");
    expect(screen.getByRole("link", { name: "Continuar" })).toBeTruthy();
    const link = screen.getAllByRole("link", { name: "Leer tu menú →" })[0];
    expect(link.getAttribute("href")).toBe(READ_MENU_HREF);
    expect(READ_MENU_HREF).toBe("/dashboard/restaurant/menu#leer-menu");
    expect(screen.queryByText(/Leer tu menú web/)).toBeNull();
    expect(screen.queryByTestId("costs-setup-detail")).toBeNull();
  });

  it("«Ocultar» folds to the one-line summary and is remembered per company", async () => {
    current = workspace(false);
    const first = draw();
    fireEvent.click(await screen.findByRole("button", { name: "Ocultar" }));
    expect(screen.getByTestId("costs-setup-folded")).toBeTruthy();
    expect(screen.queryByTestId("costs-setup-banner")).toBeNull();
    expect(window.localStorage.getItem(setupDismissedKey("co-1"))).toBe("1");
    first.unmount();
    draw();
    expect(await screen.findByTestId("costs-setup-folded")).toBeTruthy();
    cleanup();
    draw("co-2");
    expect(await screen.findByTestId("costs-setup-banner")).toBeTruthy();
  });

  it("complete: «Costos configurados · archivo de hace N días · Subir nuevo · Ver detalle»", async () => {
    current = workspace(true);
    draw();
    const folded = await screen.findByTestId("costs-setup-folded");
    expect(folded.textContent).toContain("Costos configurados");
    expect(folded.textContent).toContain("archivo de hace");
    expect(screen.getByRole("button", { name: "Subir nuevo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ver detalle/ }));
    expect(
      (await screen.findByTestId("costs-setup-detail")).textContent
    ).toContain("Último archivo");
  });

  it("the web-menu reader is gone from the section source", () => {
    const src = read("components/restaurant/costs/CostsSetupSection.tsx");
    expect(src).not.toContain("MenuReaderPanel");
    expect(src).not.toContain("Leer tu menú web");
  });
});

// --- page order -------------------------------------------------------------

describe("the page order", () => {
  it("header, KPIs, Últimas facturas, setup line, tabs", async () => {
    vi.resetModules();
    vi.doMock("@/lib/restaurant/cockpit-page-data", () => ({
      loadMenuAreaModel: async () => ({ profitability: null }),
    }));
    vi.doMock("@/lib/restaurant/shell-context-server", () => ({
      loadRestaurantShellChrome: async () => ({ lang: "es" }),
    }));
    vi.doMock("@/lib/restaurant/cockpit-timing", () => ({
      timeCockpitStep: async (_n: string, fn: () => Promise<unknown>) => fn(),
    }));
    vi.doMock("@/lib/restaurant/costs-page-data", () => ({
      loadCostsKpiExtras: async () => ({
        purchases: { last30: null, previous30: null },
        currency: "USD",
        supplierCount: 2,
        suppliersWithPendingInvoices: 1,
      }),
      loadLatestInvoices: async () => ({
        rows: [row()],
        pendingCount: 1,
        firstPendingId: "i1",
      }),
      loadInvoicesTabData: async () => null,
      loadSuppliersTabData: async () => null,
    }));
    vi.doMock("@/lib/restaurant/auth-user", () => ({
      getCachedAuthUser: async () => ({ id: "u1" }),
      getCachedCompanyId: async () => "co-1",
    }));
    vi.doMock("@/components/restaurant/costs/CostsFileWorkspace", () => ({
      CostsFileWorkspace: () => createElement("div", null, "FILE-WORKSPACE"),
    }));
    vi.doMock("@/components/restaurant/shell/OperatingPageHeader", () => ({
      OperatingPageHeader: ({ title }: { title: string }) =>
        createElement("h1", null, `HEADER-${title}`),
    }));
    const { default: Page } =
      await import("@/app/dashboard/restaurant/costs/page");
    const html = renderToString(
      await Page({ searchParams: Promise.resolve({}) })
    );
    const at = (s: string) => html.indexOf(s);
    expect(at("Precios que subieron")).toBeGreaterThan(at("HEADER-"));
    // Two-column layout: tabs and invoices are both present
    expect(at("Últimas facturas")).toBeGreaterThan(-1);
    expect(at("Cambios de precio")).toBeGreaterThan(-1);
    // File workspace comes after tabs
    expect(at("FILE-WORKSPACE")).toBeGreaterThan(at("Cambios de precio"));
    // «con facturas pendientes» links to Compras
    expect(html).toMatch(
      /href="[^"]*tab=compras[^"]*"[^>]*>[\s\S]*?con facturas pendientes/
    );
  });
});
