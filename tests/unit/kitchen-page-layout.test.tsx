// @vitest-environment jsdom
// Cocina layout: section order, QR, Recetas outside tabs, no Reportes bar
// table, empty «Para que sepas», upload from «Subir recetas».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { KitchenInsights } from "@/lib/restaurant/kitchen-insights";
import { KitchenHighlights } from "@/components/restaurant/kitchen/KitchenHighlights";
import { resetKitchenQrLoad } from "@/components/restaurant/kitchen/KitchenConnectCard";
import { draftSourceLabel } from "@/lib/restaurant/kitchen-draft-source";
import { UPLOAD_AUTHOR_NAME } from "@/lib/restaurant/recipe-upload/constants";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/kitchen",
  useSearchParams: () => new URLSearchParams(),
}));

import { KitchenPageLive } from "@/components/restaurant/kitchen/KitchenPageLive";

const QR = {
  deep_link: "https://t.me/bot?start=abc",
  qr_svg: "<svg></svg>",
  qr_png_data_url: "data:image/png;base64,aaa",
};

const LOCATIONS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Centro" },
];

function insights(over: Partial<KitchenInsights> = {}): KitchenInsights {
  return {
    availability: "empty",
    headline:
      "0 productos por agotarse · 0 reportes de merma · 0 borradores de receta por revisar",
    today_running_out: 0,
    today_waste: 0,
    pending_drafts: 0,
    feed: [],
    feed_total: 0,
    counts: { all: 0, running_out: 0, waste: 0, drafts: 0 },
    highlights: [],
    summaries: [
      {
        id: "running_out",
        label: "Se agota",
        value: "0 productos",
        hint: "",
        extra: null,
        pending_value: false,
        explore_tab: "running_out",
        segments: [],
      },
      {
        id: "waste",
        label: "Merma",
        value: "0 reportes hoy",
        hint: "0 en el periodo",
        extra: "Valor de la merma:",
        pending_value: true,
        explore_tab: "waste",
        segments: [],
      },
      {
        id: "drafts",
        label: "Recetas en borrador",
        value: "0 por confirmar",
        hint: "Nada cuenta en costos hasta que las confirmes",
        extra: null,
        pending_value: false,
        explore_tab: "drafts",
        segments: [],
      },
    ],
    explore: {
      running_out: [],
      waste: [],
      drafts: [],
      staff: [],
      history: [],
      waste_total_products: 0,
    },
    period_ask_question: "¿Qué necesita atención en la cocina ahora?",
    pending_recipes_label: "Pendiente de recetas",
    empty_feed: "Nada necesita atención en la cocina ahora.",
    insightFacts: [],
    ...over,
  };
}

function mockFetch(drafts: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const ok = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
      });
      if (url === "/api/restaurant/kitchen/qr" && method === "GET") {
        return ok({
          locations: [
            {
              location_id: LOCATIONS[0].id,
              name: "Centro",
              has_active_qr: false,
              qr_created_at: null,
              active_staff_count: 0,
            },
          ],
        });
      }
      if (url === "/api/restaurant/kitchen/qr" && method === "POST") {
        return ok(QR);
      }
      if (url.startsWith("/api/restaurant/kitchen/recipe-drafts")) {
        return ok({ drafts });
      }
      if (url.startsWith("/api/restaurant/kitchen/reports")) {
        return ok({ reports: [] });
      }
      if (url === "/api/restaurant/kitchen/recipe-upload") {
        return ok({
          recipes_found: 1,
          drafts_created: 1,
          duplicates: [],
          preparations: [],
          ignored_sections: [],
          lines_without_quantity: 0,
          errors: [],
        });
      }
      if (url === "/api/restaurant/kitchen/ingredients") {
        return ok({ ingredients: [] });
      }
      if (url === "/api/restaurant/menu-items") {
        return ok({ menu_items: [] });
      }
      if (url === "/api/restaurant/prepared-components") {
        return ok({ components: [] });
      }
      return ok({});
    })
  );
}

function renderPage(
  over: Partial<KitchenHighlightsProps> & { insights?: KitchenInsights } = {}
) {
  const model = over.insights ?? insights();
  return render(
    <KitchenPageLive
      insights={model}
      lang="es"
      canManage
      canManageDrafts
      locations={LOCATIONS}
    >
      <KitchenHighlights
        highlights={model.highlights}
        empty={model.empty_feed}
        lang="es"
      />
    </KitchenPageLive>
  );
}

type KitchenHighlightsProps = {
  insights?: KitchenInsights;
};

beforeEach(() => {
  resetKitchenQrLoad();
  sessionStorage.clear();
  mockFetch();
});
afterEach(() => {
  cleanup();
  resetKitchenQrLoad();
  vi.unstubAllGlobals();
});

function mainSectionIds(): string[] {
  const main = screen.getByTestId("kitchen-main");
  return [...main.querySelectorAll("[data-testid]")]
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((id) =>
      [
        "kitchen-headline",
        "kitchen-connect",
        "kitchen-connect-compact",
        "kitchen-summaries-slot-md",
        "kitchen-attention",
        "kitchen-recipes",
        "kitchen-summaries-slot-mobile",
        "kitchen-explore",
      ].includes(id)
    );
}

describe("Cocina section order", () => {
  it("puts the summary, cards, attention, Recetas and Historial in that order; Recetas is outside the tabs", async () => {
    renderPage();
    expect(mainSectionIds()).toEqual([
      "kitchen-headline",
      "kitchen-connect",
      "kitchen-summaries-slot-md",
      "kitchen-attention",
      "kitchen-recipes",
      "kitchen-summaries-slot-mobile",
      "kitchen-explore",
    ]);
    const explore = screen.getByTestId("kitchen-explore");
    expect(explore.contains(screen.getByTestId("kitchen-recipes"))).toBe(false);
    expect(explore.textContent).toContain("Historial y análisis");
    expect(explore.textContent).toContain("Se agota");
    expect(explore.textContent).toContain("Merma");
    expect(explore.textContent).toContain("Historial");
    expect(explore.textContent).not.toContain("Recetas en borrador");
    expect(explore.textContent).not.toContain("Equipo de cocina");
    expect(screen.getByTestId("kitchen-recipes").textContent).toContain(
      "Recetas para revisar"
    );
    expect(screen.getByRole("button", { name: "Subir recetas" })).toBeTruthy();
  });

  it("does not render the per-product Reportes bar table", () => {
    renderPage();
    expect(screen.queryByTestId("kitchen-ranked")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Último reporte/);
  });
});

describe("QR and equipo", () => {
  it("shows the QR when no cook is linked", async () => {
    renderPage();
    expect(screen.getAllByText("Conecta tu cocina").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getAllByTestId("kitchen-qr").length).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId("kitchen-connect-compact")).toBeNull();
  });

  it("compacts to Equipo de cocina once a cook is linked", async () => {
    renderPage({
      insights: insights({
        explore: {
          running_out: [],
          waste: [],
          drafts: [],
          staff: [
            {
              id: "c1",
              name: "Ana Pérez",
              reports: 1,
              last_label: "Hoy",
              is_active: true,
            },
          ],
          history: [],
          waste_total_products: 0,
        },
      }),
    });
    expect(
      screen.getAllByTestId("kitchen-connect-compact").length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Equipo de cocina/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("AP").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Mostrar QR" }).length
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("kitchen-connect")).toBeNull();
  });
});

describe("Para que sepas", () => {
  it("renders nothing when highlights are empty — no empty box", () => {
    const { container } = render(
      <KitchenHighlights
        highlights={[]}
        empty="Nada necesita atención"
        lang="es"
      />
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("kitchen-highlights")).toBeNull();
    expect(screen.queryByText("Nada necesita atención")).toBeNull();
    expect(screen.queryByText("Lo que destaca")).toBeNull();
  });

  it("lists facts under Necesita atención hoy when they exist", () => {
    renderPage({
      insights: insights({
        highlights: [
          {
            id: "most_reported",
            title: "Más reportado",
            value: "Aguacate · 4 reportes",
            hint: "",
            facts: {},
          },
        ],
      }),
    });
    const box = screen.getByTestId("kitchen-highlights");
    expect(box.textContent).toContain("Para que sepas");
    expect(box.textContent).toContain("Aguacate · 4 reportes");
    expect(screen.getByTestId("kitchen-attention").contains(box)).toBe(true);
  });
});

describe("Subir recetas from the new button", () => {
  it("opens the existing file picker and still uploads", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("kitchen-recipes-upload"));
    const input = screen.getByTestId("recipe-upload-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, {
      target: { files: [new File(["a"], "recetas.xlsx")] },
    });
    await waitFor(() =>
      expect(screen.getByTestId("recipe-upload-summary").textContent).toContain(
        "borrador"
      )
    );
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(
        (c) =>
          c[0] === "/api/restaurant/kitchen/recipe-upload" &&
          c[1]?.method === "POST"
      )
    ).toBe(true);
  });

  it("does not hide the file picker with display:none on an ancestor", () => {
    renderPage();
    const input = screen.getByTestId("recipe-upload-input");
    let node: HTMLElement | null = input;
    while (node) {
      expect(node.style.display).not.toBe("none");
      if (node.className && /\bhidden\b/.test(String(node.className))) {
        expect(node.getAttribute("data-testid")).toBe("recipe-upload-input");
      }
      node = node.parentElement;
    }
  });
});

describe("draft source from existing data", () => {
  it("uses the file sentinel or «Nota de voz de …»", () => {
    expect(draftSourceLabel(UPLOAD_AUTHOR_NAME)).toBe("Archivo subido");
    expect(draftSourceLabel("Ana")).toBe("Nota de voz de Ana");
    expect(draftSourceLabel("")).toBe("Archivo subido");
  });
});

describe("copy", () => {
  it("uses tú and plato, never platillo", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("platillo");
    expect(text).toContain("tú los apruebas");
  });
});
