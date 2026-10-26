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
  within,
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
import type { KitchenExploreTab } from "@/lib/restaurant/kitchen-explore";

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

function mockFetch(
  drafts: unknown[] = [],
  qrGet: { has_active_qr?: boolean; fail?: boolean } = {},
  reports: unknown[] = []
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const ok = (body: unknown, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => body,
      });
      if (url === "/api/restaurant/kitchen/qr" && method === "GET") {
        if (qrGet.fail) return ok({ error: "boom" }, 500);
        return ok({
          locations: [
            {
              location_id: LOCATIONS[0].id,
              name: "Centro",
              has_active_qr: qrGet.has_active_qr ?? false,
              qr_created_at: qrGet.has_active_qr
                ? "2026-10-01T00:00:00Z"
                : null,
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
        return ok({ reports });
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
  over: {
    insights?: KitchenInsights;
    canManage?: boolean;
    canManageDrafts?: boolean;
    initialTab?: KitchenExploreTab;
  } = {}
) {
  const model = over.insights ?? insights();
  const manage = over.canManage ?? true;
  return render(
    <KitchenPageLive
      insights={model}
      lang="es"
      canManage={manage}
      canManageDrafts={over.canManageDrafts ?? manage}
      locations={LOCATIONS}
      initialTab={over.initialTab}
    >
      <KitchenHighlights
        highlights={model.highlights}
        empty={model.empty_feed}
        lang="es"
      />
    </KitchenPageLive>
  );
}

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

const oneFeedItem = {
  id: "f1",
  kind: "waste" as const,
  title: "Aguacate",
  detail: "Merma reportada",
  time_label: "Hoy 10:00",
  action: "view_reports" as const,
  action_label: "Ver reportes",
  report_ids: ["r1"],
  draft_id: null,
  latest_at: "2026-10-26T10:00:00Z",
};

describe("Cocina section order", () => {
  it("puts the summary, cards, attention, Recetas and Historial in that order; Recetas is outside the tabs", async () => {
    renderPage({
      insights: insights({
        feed: [oneFeedItem],
        feed_total: 1,
        counts: { all: 1, running_out: 0, waste: 1, drafts: 0 },
      }),
    });
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

describe("QR when has_active_qr is not cached this session", () => {
  it("lets the owner generate a new QR and says it replaces the previous one", async () => {
    mockFetch([], { has_active_qr: true });
    renderPage();
    const generate = await screen.findAllByTestId("kitchen-qr-generate");
    expect(generate[0].textContent).toContain("Generar QR nuevo");
    expect(generate[0].textContent).toContain("Esto reemplaza el QR anterior.");
    expect(screen.queryByTestId("kitchen-qr")).toBeNull();
    expect(screen.queryByRole("button", { name: /Descargar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Compartir/ })).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Generar QR nuevo" })[0]
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("kitchen-qr").length).toBeGreaterThan(0)
    );
    const posts = (
      fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (c) => c[0] === "/api/restaurant/kitchen/qr" && c[1]?.method === "POST"
    );
    expect(posts.length).toBeGreaterThan(0);
  });

  it("tells a non-owner to ask the owner, with no disabled buttons", async () => {
    mockFetch([], { has_active_qr: true });
    renderPage({ canManage: false });
    const ask = await screen.findAllByTestId("kitchen-qr-ask-owner");
    expect(ask[0].textContent).toContain(
      "Pide al dueño que te comparta el QR."
    );
    expect(screen.queryByTestId("kitchen-qr-generate")).toBeNull();
    expect(screen.queryByRole("button", { name: /Descargar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Generar/ })).toBeNull();
    const connectCards = screen.getAllByTestId("kitchen-connect");
    for (const card of connectCards) {
      expect(card.querySelector("button[disabled]")).toBeNull();
    }
  });

  it("retries the QR GET after a failed load instead of caching the failure", async () => {
    mockFetch([], { fail: true });
    const first = renderPage();
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "No se pudo cargar el QR de cocina."
      )
    );
    first.unmount();
    mockFetch();
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByTestId("kitchen-qr").length).toBeGreaterThan(0)
    );
  });
});

describe("Necesita atención hoy", () => {
  it("renders nothing when the feed and highlights are both empty", () => {
    renderPage();
    expect(screen.queryByTestId("kitchen-attention")).toBeNull();
    expect(
      screen.queryByText("Nada necesita atención en la cocina ahora.")
    ).toBeNull();
    expect(screen.queryByText("Necesita atención hoy")).toBeNull();
  });
});

describe("Recetas review rows", () => {
  it("shows Rechazar plus the approved and missing-portions badges", async () => {
    mockFetch([
      {
        id: "d-approved",
        dish_name: "Pozole",
        portions: 8,
        status: "draft",
        confidence: "high",
        per_portion_cost: null,
        currency: "MXN",
        created_at: "2026-10-18T10:00:00Z",
        staff_name: "Ana",
        location_name: "Centro",
        approved_exists: true,
        lines: [],
      },
      {
        id: "d-portions",
        dish_name: "Tacos al pastor",
        portions: null,
        status: "awaiting_portions",
        confidence: "low",
        per_portion_cost: null,
        currency: "MXN",
        created_at: "2026-10-18T11:00:00Z",
        staff_name: "Luis",
        location_name: "Centro",
        approved_exists: false,
        lines: [],
      },
    ]);
    renderPage();
    const pozole = await screen.findByText("Pozole");
    const pozoleRow = pozole.closest(
      "[data-testid=kitchen-draft-row]"
    ) as HTMLElement;
    expect(pozoleRow.textContent).toContain("Ya existe una receta aprobada");
    expect(
      within(pozoleRow).getByRole("button", { name: "Rechazar" })
    ).toBeTruthy();
    const tacos = screen.getByText("Tacos al pastor");
    const tacosRow = tacos.closest(
      "[data-testid=kitchen-draft-row]"
    ) as HTMLElement;
    expect(tacosRow.textContent).toContain("Faltan porciones");
    fireEvent.click(
      within(pozoleRow).getByRole("button", { name: "Rechazar" })
    );
    await waitFor(() =>
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
          (c) =>
            c[0] ===
              "/api/restaurant/kitchen/recipe-drafts/d-approved/reject" &&
            c[1]?.method === "POST"
        )
      ).toBe(true)
    );
  });
});

describe("Se agota includes 86", () => {
  it("lists running_out and 86 reports and labels the type Se agota", async () => {
    mockFetch([], {}, [
      {
        id: "ro1",
        report_type: "running_out",
        text: "Tortillas",
        media_kind: null,
        created_at: "2026-10-26T10:00:00Z",
        staff_name: "Ana",
        location_name: "Centro",
      },
      {
        id: "e86",
        report_type: "86",
        text: "Salmón",
        media_kind: null,
        created_at: "2026-10-26T11:00:00Z",
        staff_name: "Luis",
        location_name: "Centro",
      },
      {
        id: "w1",
        report_type: "waste",
        text: "Aguacate tirado",
        media_kind: null,
        created_at: "2026-10-26T12:00:00Z",
        staff_name: "Ana",
        location_name: "Centro",
      },
    ]);
    renderPage({
      initialTab: "running_out",
      insights: insights({
        today_running_out: 2,
        explore: {
          running_out: [
            {
              key: "tortillas",
              rank: 1,
              label: "Tortillas",
              count: 1,
              bar_pct: 100,
              last_label: "Hoy",
              estimated_value: null,
              pending_value: false,
            },
          ],
          waste: [],
          drafts: [],
          staff: [],
          history: [],
          waste_total_products: 0,
        },
      }),
    });
    fireEvent.click(screen.getByTestId("kitchen-explore-running_out"));
    await waitFor(() => expect(screen.getByText("Tortillas")).toBeTruthy());
    expect(screen.getByText("Salmón")).toBeTruthy();
    expect(screen.queryByText("Aguacate tirado")).toBeNull();
    const typeFilter = screen.getByLabelText("Filtrar por tipo");
    expect(typeFilter.textContent).toContain("Se agota");
    expect(typeFilter.textContent).not.toContain("Se acaba");
  });
});
