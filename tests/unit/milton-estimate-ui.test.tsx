// @vitest-environment jsdom
// «Estimado por Milton» (#212) on screen: the run button on the menu reader,
// the muted overlay on Platos / the dish, the Resumen line and the editor
// badge. Estimates never enter the real columns. Synthetic data only.
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/menu/platos",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/restaurant/recipes-costing/TreatmentPanel", () => ({
  TreatmentControl: () => <div>TREATMENT</div>,
}));
vi.mock("@/components/restaurant/recipes-costing/LastFileRecipe", () => ({
  LastFileDialog: () => null,
  useLastFileRecipe: () => ({
    lookup: null,
    refresh: () => undefined,
  }),
}));
vi.mock(
  "@/components/restaurant/recipes-costing/RecipeLinesEditor",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    RecipeLinesEditor: () => <div>EDITOR</div>,
  })
);

import { MenuReaderPanel } from "@/components/restaurant/recipes-costing/MenuReaderPanel";
import { PlatoScreen } from "@/components/restaurant/recipes-costing/PlatoScreen";
import { MenuDishesScreen } from "@/components/restaurant/menu/MenuDishesScreen";
import { ResumenCockpit } from "@/components/restaurant/recipes-costing/ResumenScreen";
import {
  estimateText,
  extraEstimatedDishes,
  extraEstimatedLabel,
  overlayAllowed,
} from "@/components/restaurant/menu/estimate-overlay";
import { estimatedPriceMessage } from "@/components/restaurant/recipes-costing/RecipeLinesEditor";
import type { DishEstimateRow } from "@/lib/restaurant/menu-reading/estimate";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import {
  computeResumen,
  resumenRange,
  type ResumenData,
} from "@/lib/restaurant/menu-resumen";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function estimate(over: Partial<DishEstimateRow> = {}): DishEstimateRow {
  return {
    menu_item_id: "m1",
    lines: [
      {
        raw_name: "Salmón",
        ingredient_id: null,
        qty: 120,
        unit: "g",
        price_source: "estimado",
        unit_price: 0.02,
        price_unit: "g",
        price_estimate_id: "pe1",
        line_cost: 2.4,
        confidence: "media",
      },
      {
        raw_name: "Arroz",
        ingredient_id: "i2",
        qty: 80,
        unit: "g",
        price_source: "real",
        unit_price: 0.005,
        price_unit: "g",
        price_estimate_id: null,
        line_cost: 0.4,
        confidence: "alta",
      },
      {
        raw_name: "Salsa secreta",
        ingredient_id: null,
        qty: 10,
        unit: "ml",
        price_source: null,
        unit_price: null,
        price_unit: null,
        price_estimate_id: null,
        line_cost: null,
        confidence: null,
      },
    ],
    portion_note: null,
    est_cost: 4.2,
    currency: "USD",
    model: "m",
    used_as_draft_at: null,
    updated_at: null,
    odoo_product_id: 1,
    location_id: null,
    ...over,
  };
}

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MenuReaderPanel · Estimar con Milton", () => {
  const mount = (canEdit = true) =>
    render(
      <MenuReaderPanel
        canEdit={canEdit}
        busyExternal={false}
        locationId={null}
        onDone={() => undefined}
        embedded
      />
    );

  it("shows the button and help text when there are eligible drafts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonRes({ available: true, eligible: 7 }))
    );
    mount();
    expect(
      await screen.findByRole("button", { name: "Estimar con Milton" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Milton estima cuánto lleva cada plato y cuánto cuesta cada ingrediente en tu país. Son aproximaciones para que veas por dónde van tus márgenes; tú las validas."
      )
    ).toBeTruthy();
  });

  it("hides it when nothing is eligible, when unavailable, and without permission", async () => {
    const fetchMock = vi.fn(() => jsonRes({ available: true, eligible: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Estimar con Milton")).toBeNull();
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonRes({ available: false, eligible: 9 }))
    );
    mount();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("Estimar con Milton")).toBeNull();
    cleanup();

    const noPerm = vi.fn(() => jsonRes({ available: true, eligible: 9 }));
    vi.stubGlobal("fetch", noPerm);
    mount(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("Estimar con Milton")).toBeNull();
    expect(noPerm).not.toHaveBeenCalled();
  });

  it("runs chunks of 5, shows progress and stops at 20; one skipped dish does not stop the loop", async () => {
    let n = 0;
    const bodies: Array<Record<string, unknown>> = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST")
        return jsonRes({ available: true, eligible: 30 });
      bodies.push(JSON.parse(String(init.body)));
      const results = Array.from({ length: 5 }, (_, i) => ({
        menu_item_id: `m${n * 5 + i}`,
        name: `Plato ${n * 5 + i}`,
        est_cost: 3,
        est_margin_pct: 50,
        skipped_reason: n === 0 && i === 2 ? "sin_datos" : null,
      }));
      n += 1;
      const answer = jsonRes({ done: false, remaining: 10, results });
      // hold the 2nd call to read the progress text
      return n === 2 ? gate.then(() => answer) : answer;
    });
    vi.stubGlobal("fetch", fetchMock);
    const done = vi.fn();
    render(
      <MenuReaderPanel
        canEdit
        busyExternal={false}
        locationId={null}
        onDone={done}
        onEstimated={done}
        embedded
      />
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Estimar con Milton" })
    );
    expect(
      await screen.findByText(
        "Estimando 6 de 20 platos (los que más venden primero)…"
      )
    ).toBeTruthy();
    release!();
    expect(
      await screen.findByText(
        "Listo: 19 platos estimados. 1 plato quedó sin estimar."
      )
    ).toBeTruthy();
    const posts = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(posts).toHaveLength(4);
    expect(done).toHaveBeenCalledTimes(1);
    for (const b of bodies) expect(b.limit as number).toBeLessThanOrEqual(20);
  });

  it("shows the missing-migration note in gray on 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) =>
        init?.method === "POST"
          ? jsonRes(
              {
                error:
                  "Falta aplicar la actualización de la base de datos (062).",
              },
              503
            )
          : jsonRes({ available: true, eligible: 3 })
      )
    );
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Estimar con Milton" })
    );
    const note = await screen.findByText(
      "Falta aplicar la actualización de la base de datos (062)."
    );
    expect(note.className).toContain("text-[#6b7280]");
    expect(note.className).not.toMatch(/c03535|red-/);
  });
});

// A dish with no recipe and no sales cost, as the Platos screens receive it.
function workspace(over: {
  unit_cost?: number | null;
  confirmed?: boolean;
  excel_total?: number | null;
  has_approved_version?: boolean;
  canEdit?: boolean;
}): RecipeCostingWorkspace {
  const product = {
    odoo_product_id: 1,
    odoo_name: "Poke de salmón",
    share_label: "12%",
    is_combo: false,
    treatment: "plato_preparado",
    treatment_label: "Plato",
    classification: "plato_preparado",
    menu_item_id: null,
    confirmed: over.confirmed ?? false,
    in_food_sales: true,
    pos_price_label: null,
    can_undo: false,
  };
  return {
    currency: "USD",
    actor: {
      can_submit: over.canEdit ?? true,
      capabilities: { "recipes.edit": over.canEdit ?? true },
    },
    products: [product],
    plato_queue: [],
    selected: product,
    selected_dish: {
      unit_cost: over.unit_cost ?? null,
      avg_net_price: 11,
      excel_total: over.excel_total ?? null,
      has_approved_version: over.has_approved_version ?? false,
      link_confirmed: over.confirmed ?? false,
      status: "sin_receta",
      status_label: "Sin receta",
      lines_missing_price: 0,
      food_cost_pct: null,
      unit_margin: null,
    },
    editor: null,
    treatment_options: [],
    menu_items: [],
    menu_dishes: null,
  } as unknown as RecipeCostingWorkspace;
}

const platoProps = {
  locationId: null,
  busy: false,
  onSelect: () => undefined,
  onEdited: () => undefined,
  onPost: (() => undefined) as never,
  onConfirm: () => undefined,
  onOpenPreparation: () => undefined,
};

describe("PlatoScreen · estimate overlay", () => {
  it("shows the muted estimate with the badge, never in the real columns", () => {
    render(
      <PlatoScreen
        {...platoProps}
        data={workspace({})}
        estimates={[estimate()]}
      />
    );
    expect(
      screen.getByText("≈ $4.20 costo estimado · ≈ 62% margen estimado")
    ).toBeTruthy();
    expect(screen.getAllByText("Estimado por Milton").length).toBeGreaterThan(
      0
    );
    // The real Costo / Margen stay as before.
    expect(screen.getAllByText("Sin precio").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("Precio estimado")).toBeTruthy();
    expect(screen.getByText("Real")).toBeTruthy();
  });

  it("says «≈ Sin precio» when the estimate has no cost", () => {
    render(
      <PlatoScreen
        {...platoProps}
        data={workspace({})}
        estimates={[estimate({ est_cost: null })]}
      />
    );
    expect(screen.getByText("≈ Sin precio")).toBeTruthy();
    expect(screen.queryByText(/\$0\.00 costo/)).toBeNull();
  });

  it.each([
    ["a real cost", { unit_cost: 3.5 }],
    ["an approved recipe", { has_approved_version: true }],
    ["a confirmed link", { confirmed: true }],
    ["an Excel recipe", { excel_total: 4 }],
  ])("shows no overlay with %s", (_n, over) => {
    render(
      <PlatoScreen
        {...platoProps}
        data={workspace(over)}
        estimates={[estimate()]}
      />
    );
    expect(screen.queryByText(/costo estimado/)).toBeNull();
    expect(screen.queryByText("Usar como borrador")).toBeNull();
  });

  it("hides «Usar como borrador» without recipes.edit", () => {
    render(
      <PlatoScreen
        {...platoProps}
        data={workspace({ canEdit: false })}
        estimates={[estimate()]}
      />
    );
    expect(screen.getByText(/costo estimado/)).toBeTruthy();
    expect(screen.queryByText("Usar como borrador")).toBeNull();
  });

  it("renders exactly as before without estimates", () => {
    const { container } = render(
      <PlatoScreen {...platoProps} data={workspace({})} />
    );
    expect(container.textContent).not.toMatch(/Estimado por Milton|estimado/);
  });

  it("posts «Usar como borrador» once and refreshes", async () => {
    const fetchMock = vi.fn(() => jsonRes({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const edited = vi.fn();
    const changed = vi.fn();
    render(
      <PlatoScreen
        {...platoProps}
        onEdited={edited}
        onEstimateChanged={changed}
        data={workspace({})}
        estimates={[estimate()]}
      />
    );
    const btn = screen.getByRole("button", { name: "Usar como borrador" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/restaurant/recipes/menu/estimate/use");
    expect(JSON.parse(String(init.body))).toEqual({ menu_item_id: "m1" });
    expect(edited).toHaveBeenCalled();
  });

  it("shows the server's 409 message in gray", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonRes(
          {
            error: "Este plato ya tiene receta aprobada; Milton no la cambia.",
          },
          409
        )
      )
    );
    render(
      <PlatoScreen
        {...platoProps}
        data={workspace({})}
        estimates={[estimate()]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Usar como borrador" }));
    const note = await screen.findByText(
      "Este plato ya tiene receta aprobada; Milton no la cambia."
    );
    expect(note.className).toContain("text-[#6b7280]");
  });
});

function dishesWorkspace(opts: {
  cost_total?: number | null;
  source?: "excel" | "menu" | "name";
  cost_status?: string;
}): RecipeCostingWorkspace {
  const dish = {
    id: "d1",
    stored: true,
    name: "Hamburguesa clásica",
    category: null,
    source: opts.source ?? "menu",
    status: "confirmed",
    excluded_reason: null,
    variants: [
      {
        odoo_product_id: 1,
        key: "1",
        sales_scope: null,
        saved: true,
        name: "Hamburguesa clásica",
        size: null,
        size_unit: null,
        side: null,
        sides: [],
        cooking_point: null,
        channel: "salón",
        is_promo: false,
        units: 10,
        net_sales: 100,
        unit_cost: null,
        cost_total: null,
        margin: null,
        food_cost_pct: null,
        cost_basis: null,
        status: "sin_receta",
        covered: false,
      },
    ],
    units: 10,
    net_sales: 100,
    share_of_food_sales: 1,
    cost_known_sales: 0,
    cost_total: opts.cost_total ?? null,
    food_cost_pct: null,
    margin: null,
    margin_pct: null,
    coverage: 0,
    cost_status: opts.cost_status ?? "sin_receta",
    approved_count: 0,
    variant_count: 1,
    base_odoo_product_id: 1,
    base_portion_qty: null,
    excel_total: null,
    excel_diff_flag: false,
  };
  return {
    currency: "USD",
    period_label: null,
    view_location_id: null,
    actor: { can_submit: true, capabilities: { "recipes.edit": true } },
    item_groups: null,
    restaurants: [],
    menu_dishes: {
      dishes: [dish],
      excluded: [],
      stored: true,
      unsaved_variant_count: 0,
      variant_count: 1,
      excluded_variant_count: 0,
      kpis: {
        food_cost_pct: null,
        gross_margin: null,
        coverage_pct: 0,
        covered_dishes: 0,
        partial_dishes: 0,
        dish_count: 1,
        problem_count: 1,
        missing_price_dishes: 0,
        no_recipe_dishes: 1,
      },
    },
  } as unknown as RecipeCostingWorkspace;
}

describe("MenuDishesScreen · estimate overlay", () => {
  const mountList = (
    ws: RecipeCostingWorkspace,
    estimates: DishEstimateRow[]
  ) =>
    render(
      <MenuDishesScreen
        data={ws}
        onOpenDish={() => undefined}
        estimates={estimates}
      />
    );

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonRes({ available: true, eligible: 2 }))
    );
  });

  it("puts the estimate in its own muted line, not in Margen / Costo %", () => {
    mountList(dishesWorkspace({}), [estimate()]);
    const overlay = screen.getByTestId("dish-estimate");
    expect(overlay.textContent).toContain("Estimado por Milton");
    expect(overlay.textContent).toContain(
      "≈ $4.20 costo estimado · ≈ 58% margen estimado"
    );
    // avg price here is 100 / 10 = 10 → (10 - 4.2) / 10
    const row = overlay.closest("tr")!;
    const cells = row.querySelectorAll("td");
    expect(cells[2].textContent).toBe("—");
    expect(cells[3].textContent).toBe("—");
  });

  it("says «≈ Sin precio» when the estimate has no cost", () => {
    mountList(dishesWorkspace({}), [estimate({ est_cost: null })]);
    expect(screen.getByTestId("dish-estimate").textContent).toContain(
      "≈ Sin precio"
    );
  });

  it("shows nothing for an Excel dish, a dish with a real cost, an approved one or a used estimate", () => {
    for (const [ws, est] of [
      [dishesWorkspace({ source: "excel" }), estimate()],
      [dishesWorkspace({ cost_total: 20 }), estimate()],
      [dishesWorkspace({ cost_status: "aprobado" }), estimate()],
      [dishesWorkspace({}), estimate({ used_as_draft_at: "2026-07-01" })],
    ] as const) {
      mountList(ws, [est]);
      expect(screen.queryByTestId("dish-estimate")).toBeNull();
      cleanup();
    }
  });

  it("offers «Estimar con Milton» next to dishes without recipe", async () => {
    mountList(dishesWorkspace({}), []);
    expect(
      await screen.findByRole("button", { name: "Estimar con Milton" })
    ).toBeTruthy();
  });

  it("renders as before with no estimates", () => {
    mountList(dishesWorkspace({}), []);
    expect(screen.queryByTestId("dish-estimate")).toBeNull();
  });
});

describe("Resumen · separate estimates line", () => {
  const data: ResumenData = {
    currency: "USD",
    first_day: "2026-07-01",
    last_day: "2026-07-31",
    dishes: [
      {
        id: "d1",
        name: "Poke de salmón",
        variants: [
          {
            key: "1",
            product_id: 1,
            locations: null,
            unit_cost: null,
            covered: false,
            status: "sin_receta",
          },
        ],
      },
    ],
    days: [{ d: "2026-07-31", l: null, p: 1, n: 100, u: 10 }],
  };
  const view = computeResumen(data, resumenRange("month", "2026-07-31"));
  const draw = (extra: number) =>
    renderToString(
      createElement(ResumenCockpit, {
        view,
        currency: "USD",
        period: "month",
        onPeriod: () => undefined,
        monthText: "Julio",
        missingPriceIngredients: 0,
        latestUpload: null,
        now: 0,
        extraEstimated: extra,
      })
    );

  it("says how many dishes more have an approximate margin, only when N > 0", () => {
    expect(draw(3)).toContain(
      "Con estimados de Milton: 3 platos más con margen aproximado"
    );
    expect(draw(0)).not.toContain("Con estimados de Milton");
  });

  it("leaves the real numbers untouched", () => {
    const strip = (h: string) =>
      h.replace(/<p[^>]*resumen-estimates-line[^>]*>.*?<\/p>/, "");
    expect(strip(draw(3))).toBe(draw(0));
  });

  it("counts only dishes with an estimate cost and no real cost", () => {
    const rows = [
      { product_id: 1, cost_status: "sin_receta", coverage: 0 },
      { product_id: 2, cost_status: "aprobado", coverage: 1 },
      { product_id: 3, cost_status: "falta_precio", coverage: 0 },
      { product_id: 4, cost_status: "sin_receta", coverage: 0 },
    ];
    const est = [
      estimate({ odoo_product_id: 1 }),
      estimate({ odoo_product_id: 2 }),
      estimate({ odoo_product_id: 3, est_cost: null }),
    ];
    expect(extraEstimatedDishes(est, rows)).toBe(1);
    expect(extraEstimatedDishes([], rows)).toBe(0);
    expect(extraEstimatedLabel(1)).toBe(
      "Con estimados de Milton: 1 plato más con margen aproximado"
    );
  });
});

describe("pure helpers", () => {
  it("formats the estimate and never invents a margin", () => {
    expect(estimateText({ est_cost: 4.2 }, "USD", 11).text).toBe(
      "≈ $4.20 costo estimado · ≈ 62% margen estimado"
    );
    expect(estimateText({ est_cost: 4.2 }, "USD", null).text).toBe(
      "≈ $4.20 costo estimado"
    );
    expect(estimateText({ est_cost: null }, "USD", 11).text).toBe(
      "≈ Sin precio"
    );
  });
  it("hides the overlay with any real source", () => {
    const e = estimate();
    expect(overlayAllowed(e, { real_cost: null })).toBe(true);
    expect(overlayAllowed(e, { real_cost: 0 })).toBe(false);
  });
});

describe("RecipeLinesEditor · estimate badge and price message", () => {
  const src = read(
    "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
  );
  it("badges flagged lines and keeps the estimate out of the line cost", () => {
    expect(src).toContain("FLAG_MILTON_ESTIMATE");
    expect(src).toContain("Estimado por Milton");
    expect(src).toContain("milton_price_estimate");
    expect(src).toMatch(/"Sin precio"/);
  });
  it("words the estimated price in the company currency", () => {
    expect(
      estimatedPriceMessage({ unit_price: 3.5, unit: "unidad" }, "USD")
    ).toBe(
      "Precio estimado ≈ $3.50 / unidad. Registra el precio real (factura o Costos) para aprobar."
    );
    expect(
      estimatedPriceMessage({ unit_price: 0.02, unit: "g" }, "USD")
    ).toContain("≈ $0.0200 / gramo");
  });
});

describe("no orange", () => {
  it.each([
    "components/restaurant/menu/EstimateWithMilton.tsx",
    "components/restaurant/menu/estimate-overlay.ts",
    "components/restaurant/recipes-costing/EstimatePanel.tsx",
  ])("%s has no orange / amber / yellow", (file) => {
    expect(read(file)).not.toMatch(/orange|amber|yellow/i);
  });
});
