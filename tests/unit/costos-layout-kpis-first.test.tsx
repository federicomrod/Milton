// @vitest-environment jsdom
// Costos layout: the 4 KPIs and the tabs come first; the cost setup is ONE
// compact row while incomplete (collapsed by default, remembered per company),
// one line when complete. Layout only. Synthetic data.
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/costs",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/restaurant/recipes-costing/PriceCatalogPanel", () => ({
  PriceCatalogPanel: () => (
    <div data-testid="price-catalog-panel">PANEL ARCHIVO</div>
  ),
}));
vi.mock("@/components/restaurant/recipes-costing/MenuReaderPanel", () => ({
  MenuReaderPanel: () => <div>MENU READER</div>,
}));
vi.mock("@/components/restaurant/recipes-costing/ResetPanel", () => ({
  ResetPanel: () => <div>RESET</div>,
}));

import {
  CostsSetupSection,
  nextStepText,
  setupOpenKey,
} from "@/components/restaurant/costs/CostsSetupSection";

const step = (
  id: string,
  label: string,
  done: boolean,
  action: string,
  href: string | null
) => ({
  id,
  label,
  done,
  action,
  href,
});
function workspace(complete: boolean) {
  const steps = [
    step(
      "excel",
      "Subir Excel de costos",
      true,
      "Continuar: subir tu Excel",
      null
    ),
    step(
      "ingredientes",
      "Precios de ingredientes",
      complete,
      "Continuar: completar 42 precios",
      "/dashboard/restaurant/menu/ingredientes?filtro=falta_precio"
    ),
    step(
      "preparaciones",
      "Preparaciones de los más vendidos",
      complete,
      "Continuar: revisar 3 preparaciones",
      "/dashboard/restaurant/menu/preparaciones"
    ),
    step(
      "platos",
      "Platos listos",
      complete,
      "Continuar: revisar 5 platos",
      "/dashboard/restaurant/menu/platos"
    ),
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
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => current }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
const draw = (extra: Partial<Parameters<typeof CostsSetupSection>[0]> = {}) => {
  // a distinct location per test: the module-level tab cache is shared
  n += 1;
  return render(
    <CostsSetupSection locationId={`loc-${n}`} companyId="co-1" {...extra} />
  );
};

describe("setup incomplete: one compact banner", () => {
  it("collapsed by default: one row with the progress, the next step, a button and «Ver detalle»; no checklist or file card", async () => {
    current = workspace(false);
    draw();
    const banner = await screen.findByTestId("costs-setup-banner");
    expect(banner.textContent).toContain("Configura tus costos · 1 de 4");
    expect(banner.textContent).toContain("Siguiente: Completar 42 precios");
    expect(banner.className).toMatch(/max-h-\[56px\]/);
    // the primary button is the same next-step action (the same link)
    const cta = screen.getByRole("link", { name: "Continuar" });
    expect(cta.getAttribute("href")).toBe(
      "/dashboard/restaurant/menu/ingredientes?filtro=falta_precio"
    );
    expect(
      screen
        .getByRole("button", { name: /Ver detalle/ })
        .getAttribute("aria-expanded")
    ).toBe("false");
    // nothing of the full block yet
    expect(screen.queryByTestId("costs-setup-detail")).toBeNull();
    // the file card stays mounted (hidden) so «Continuar» can open the picker
    const card = document.getElementById("costos-ultimo-archivo");
    expect(card?.parentElement?.className).toMatch(/\bhidden\b/);
  });

  it("«Ver detalle» expands the EXISTING checklist and «Último archivo» inline, unchanged", async () => {
    current = workspace(false);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalle/ }));
    const detail = await screen.findByTestId("costs-setup-detail");
    expect(detail.textContent).toContain("Subir Excel de costos");
    expect(detail.textContent).toContain("Precios de ingredientes");
    expect(detail.textContent).toContain("Último archivo");
    expect(detail.textContent).toContain("costos-prueba.xlsx");
    expect(screen.getByTestId("price-catalog-panel")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Ver detalle/ })
        .getAttribute("aria-expanded")
    ).toBe("true");
    // and closes again
    fireEvent.click(screen.getByRole("button", { name: /Ver detalle/ }));
    expect(screen.queryByTestId("costs-setup-detail")).toBeNull();
  });

  it("remembers open / closed per company in localStorage", async () => {
    current = workspace(false);
    const first = draw();
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalle/ }));
    expect(window.localStorage.getItem(setupOpenKey("co-1"))).toBe("1");
    first.unmount();
    draw();
    expect(await screen.findByTestId("costs-setup-detail")).toBeTruthy();
    cleanup();
    // another company is still collapsed
    window.localStorage.setItem(setupOpenKey("co-1"), "1");
    draw({ companyId: "co-2" });
    await screen.findByTestId("costs-setup-banner");
    expect(screen.queryByTestId("costs-setup-detail")).toBeNull();
  });

  it("an account with no data starts open (the setup is its next step), unless the person closed it", async () => {
    current = workspace(false);
    draw({ startOpen: true });
    expect(await screen.findByTestId("costs-setup-detail")).toBeTruthy();
  });

  it("a step that is not a link (the Excel upload) opens the detail", async () => {
    const ws = workspace(false);
    ws.menu_summary.setup.steps[0].done = false;
    ws.menu_summary.setup.done = 0;
    ws.menu_summary.setup.next = ws.menu_summary.setup.steps[0];
    current = ws;
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    await waitFor(() =>
      expect(screen.getByTestId("costs-setup-detail")).toBeTruthy()
    );
  });
});

describe("setup complete: today's one-line summary", () => {
  it("shows «Costos configurados · archivo de hace N días · Subir nuevo» and no banner", async () => {
    current = workspace(true);
    draw();
    const folded = await screen.findByTestId("costs-setup-folded");
    expect(folded.textContent).toContain("Costos configurados");
    expect(folded.textContent).toContain("archivo de hace");
    expect(screen.getByRole("button", { name: "Subir nuevo" })).toBeTruthy();
    expect(screen.queryByTestId("costs-setup-banner")).toBeNull();
  });
});

describe("helpers", () => {
  it("nextStepText turns the action into the banner's «Siguiente»", () => {
    expect(nextStepText("Continuar: completar 42 precios")).toBe(
      "Completar 42 precios"
    );
    expect(nextStepText("Continuar: subir tu Excel")).toBe("Subir tu Excel");
  });
});

describe("the page: header, 4 KPIs, tabs (file workspace for picker)", () => {
  it("renders KPI cards, then tabs; file workspace present after tabs", async () => {
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
      loadCostsKpiExtras: async () => null,
      loadInvoicesTabData: async () => null,
      loadSuppliersTabData: async () => null,
      loadLatestInvoices: async () => null,
    }));
    vi.doMock("@/lib/restaurant/auth-user", () => ({
      getCachedAuthUser: async () => ({ id: "u1" }),
      getCachedCompanyId: async () => "co-1",
    }));
    vi.doMock("@/components/restaurant/costs/CostsFileWorkspace", () => ({
      CostsFileWorkspace: () =>
        createElement(
          "div",
          { "data-testid": "file-workspace" },
          "FILE-WORKSPACE"
        ),
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
    const at = (needle: string) => html.indexOf(needle);
    const header = at("HEADER-");
    const kpi = at("Compras");
    const workspace = at("FILE-WORKSPACE");
    const tabs = at("Cambios de precio");
    expect(header).toBeGreaterThan(-1);
    expect(kpi).toBeGreaterThan(header);
    // Two-column layout: tabs come right after KPIs
    expect(tabs).toBeGreaterThan(kpi);
    // File workspace comes after tabs
    expect(workspace).toBeGreaterThan(tabs);
    // all four KPI cards precede the tabs
    for (const label of [
      "Compras",
      "Costo de comida",
      "Precios que subieron",
      "Proveedores",
    ]) {
      expect(at(label), label).toBeGreaterThan(-1);
      expect(at(label), label).toBeLessThan(tabs);
    }
  });
});
