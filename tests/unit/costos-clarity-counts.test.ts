// Costos clarity, Part A: one set of counts (no double counting), the
// «Borrador» status and the Platos period. Invented data only.
import { describe, expect, it } from "vitest";
import {
  computeResumen,
  resumenRange,
  type ResumenData,
  type ResumenVariant,
} from "@/lib/restaurant/menu-resumen";
import { menuDishKpis } from "@/lib/restaurant/costing/menu-summary";
import { problemCounts } from "@/lib/restaurant/costing/problem-counts";
import {
  groupStatusDisplay,
  rollupLeaves,
  worstStatus,
} from "@/lib/restaurant/costing/rollup";
import {
  DISH_STATUSES,
  DISH_STATUS_LABELS,
} from "@/lib/restaurant/costing/dish-status";
import {
  MENU_DRAFT_NOTE,
  dishStateFrom,
  resolveDishState,
} from "@/lib/restaurant/costing/dish-state";
import { parseDishStatusFilter, platosHref } from "@/lib/restaurant/menu-links";
import { defaultPlatosPeriod } from "@/lib/restaurant/recipe-costing/workspace-server";

const v = (
  n: number,
  cost: number | null,
  status: ResumenVariant["status"]
): ResumenVariant => ({
  key: String(n),
  product_id: n,
  locations: null,
  unit_cost: cost,
  covered: status === "aprobado",
  status,
});

// Churrasco: 6 oz approved + 6 oz Eventos without recipe (the mixed dish).
const data: ResumenData = {
  currency: "USD",
  first_day: "2026-10-01",
  last_day: "2026-10-26",
  dishes: [
    {
      id: "c",
      name: "Parrillada Demo",
      variants: [v(1, 5, "aprobado"), v(2, null, "sin_receta")],
    },
    { id: "p", name: "Pasta", variants: [v(3, 3, "aprobado")] },
    { id: "s", name: "Sopa", variants: [v(4, null, "sin_receta")] },
    { id: "b", name: "Tostada", variants: [v(5, null, "borrador")] },
    { id: "f", name: "Nacatamal", variants: [v(6, null, "falta_precio")] },
  ],
  days: [
    { d: "2026-10-20", l: null, p: 1, n: 300, u: 30 },
    { d: "2026-10-20", l: null, p: 2, n: 100, u: 10 },
    { d: "2026-10-20", l: null, p: 3, n: 200, u: 20 },
    { d: "2026-10-20", l: null, p: 4, n: 150, u: 15 },
    { d: "2026-10-20", l: null, p: 5, n: 50, u: 5 },
    { d: "2026-10-20", l: null, p: 6, n: 200, u: 20 },
    // outside the month: must not count
    { d: "2026-09-10", l: null, p: 4, n: 999, u: 99 },
  ],
};
const range = resumenRange("month", "2026-10-26");
const view = computeResumen(data, range);

describe("one count, no double counting (mixed dish)", () => {
  const churrasco = view.dishes.find((d) => d.name === "Parrillada Demo")!;

  it("the mixed dish keeps «Aprobado 1 de 2»", () => {
    expect(churrasco.approved_count).toBe(1);
    expect(churrasco.variant_count).toBe(2);
    expect(groupStatusDisplay(churrasco).label).toBe("Aprobado 1 de 2");
  });

  it("counts once, in Sin receta, with only the Eventos sales", () => {
    expect(churrasco.pending_status).toBe("sin_receta");
    expect(churrasco.pending_sales).toBe(100);
    // Sopa (150) + Churrasco's Eventos variant (100) out of 1000 of food sales
    expect(view.food_sales).toBe(1000);
    expect(view.counts.sin_receta.dishes).toBe(2);
    expect(view.counts.sin_receta.share).toBeCloseTo(250 / 1000, 6);
  });

  it("coverage + Σ bucket shares never exceed 100%", () => {
    const c = view.counts;
    const shares =
      c.falta_precio.share +
      c.estimado.share +
      c.borrador.share +
      c.sin_receta.share;
    expect(view.kpis.coverage_pct / 100 + shares).toBeLessThanOrEqual(1.000001);
    // here every non-covered sale is in exactly one bucket: it adds up to 100
    expect(view.kpis.coverage_pct / 100 + shares).toBeCloseTo(1, 6);
  });

  it("«Platos con problema» = dishes in falta_precio + borrador + sin_receta", () => {
    expect(view.counts.problem_count).toBe(4);
    expect(view.kpis.problem_count).toBe(4);
    expect(view.counts.borrador.dishes).toBe(1);
    expect(view.counts.falta_precio.dishes).toBe(1);
  });
});

describe("Resumen, Platos KPIs and the reader card agree", () => {
  it("the same helper gives the same numbers for the same period", () => {
    const menuDishes = view.dishes.map((d) => ({ ...d }));
    const platos = menuDishKpis({
      totals: {
        food_cost_pct: null,
        gross_margin: null,
        coverage_pct: 0,
        problem_count: 999, // the old per-product total is not used
      },
      menu_dishes: menuDishes,
    } as never);
    expect(platos.problem_count).toBe(view.kpis.problem_count);
    expect(platos.no_recipe_dishes).toBe(view.counts.sin_receta.dishes);
    expect(platos.missing_price_dishes).toBe(view.counts.falta_precio.dishes);
    expect(platos.draft_dishes).toBe(view.counts.borrador.dishes);
    // the reader card's «N platos sin receta» is counts.sin_receta.dishes
    expect(problemCounts(menuDishes, view.food_sales).sin_receta.dishes).toBe(
      view.counts.sin_receta.dishes
    );
  });
});

describe("rollupLeaves pending_* fields", () => {
  const leaf = (
    key: string,
    status:
      | "aprobado"
      | "estimado"
      | "borrador"
      | "sin_receta"
      | "falta_precio",
    sales: number
  ) => ({
    key,
    units: 1,
    net_sales: sales,
    cost_total: status === "aprobado" ? 1 : null,
    covered: status === "aprobado",
    status,
  });
  it("worst non-approved status: falta_precio > estimado > borrador > sin_receta", () => {
    expect(worstStatus(["sin_receta", "borrador"])).toBe("borrador");
    expect(worstStatus(["borrador", "estimado"])).toBe("estimado");
    expect(worstStatus(["estimado", "falta_precio"])).toBe("falta_precio");
  });
  it("pending_sales, pending_status and pending_sales_by_status", () => {
    const r = rollupLeaves([
      leaf("a", "aprobado", 60),
      leaf("b", "borrador", 30),
      leaf("c", "sin_receta", 10),
    ]);
    expect(r.pending_sales).toBe(40);
    expect(r.pending_status).toBe("borrador");
    expect(r.pending_sales_by_status).toEqual({ borrador: 30, sin_receta: 10 });
    expect(r.problem_count).toBe(2);
  });
  it("every leaf approved: no pending status", () => {
    const r = rollupLeaves([leaf("a", "aprobado", 60)]);
    expect(r.pending_status).toBeNull();
    expect(r.pending_sales).toBe(0);
  });
});

describe("«Borrador» status", () => {
  const base = {
    has_version: true,
    line_count: 0,
    missing: 0,
    total: null,
    approved: false,
    confirmed: false,
    treatment: "plato" as never,
    in_food_sales: true,
    avg_net_price: 10,
  };
  it("an in_review version with no lines is Borrador: not covered, no COGS", () => {
    const s = dishStateFrom({ ...base, in_review: true });
    expect(s).toMatchObject({
      status: "borrador",
      status_label: "Borrador",
      covered: false,
      in_cogs: false,
      unit_cost: null,
    });
    expect(s.reason).toBeNull();
  });
  it("notes «Borrador desde el menú» adds the «desde el menú» reason", () => {
    const s = resolveDishState({
      versions: [
        {
          id: "v1",
          version_number: 1,
          status: "in_review",
          effective_date: null,
          notes: MENU_DRAFT_NOTE,
        },
      ],
      link: { link_state: "confirmado" },
      treatment: "plato" as never,
      lines: [],
      units_sold: 5,
      net_sales: 50,
    });
    expect(s.status).toBe("borrador");
    expect(s.reason).toBe("desde_el_menu");
    expect(s.status_label).toBe("Borrador");
    expect(s.covered).toBe(false);
  });
  it("an empty draft from «Crear receta» is Borrador without the menu note", () => {
    const s = resolveDishState({
      versions: [
        {
          id: "v1",
          version_number: 1,
          status: "in_review",
          effective_date: null,
          notes: "Receta nueva",
        },
      ],
      link: null,
      treatment: "plato" as never,
      lines: [],
      units_sold: 0,
      net_sales: 0,
    });
    expect(s.status).toBe("borrador");
    expect(s.reason).toBeNull();
  });
  it("no version stays Sin receta; a draft with lines keeps today's rule", () => {
    expect(dishStateFrom({ ...base, has_version: false }).status).toBe(
      "sin_receta"
    );
    expect(
      dishStateFrom({
        ...base,
        line_count: 2,
        total: 4,
        in_review: true,
      }).status
    ).toBe("estimado");
    expect(
      dishStateFrom({
        ...base,
        line_count: 2,
        missing: 1,
        in_review: true,
      }).status
    ).toBe("falta_precio");
  });
  it("is a status with its label, accepted by the links, and there is no «parcial»", () => {
    expect(DISH_STATUS_LABELS.borrador).toBe("Borrador");
    expect(DISH_STATUSES).toContain("borrador");
    expect(parseDishStatusFilter("borrador,sin_receta")).toEqual([
      "borrador",
      "sin_receta",
    ]);
    expect(parseDishStatusFilter("parcial")).toEqual([]);
    expect(platosHref(["borrador"])).toBe(
      "/dashboard/restaurant/menu/platos?estado=borrador"
    );
    expect(DISH_STATUSES.map(String)).not.toContain("parcial");
  });
});

describe("Platos period default", () => {
  const fake = (rows: Array<{ sale_date: string }>, error = false) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
    chain.limit = async () => ({
      data: rows,
      error: error ? { message: "boom" } : null,
    });
    return { from: () => chain } as never;
  };
  it("is Resumen's month: first day of the last sales day's month → last day", async () => {
    const p = await defaultPlatosPeriod(
      fake([{ sale_date: "2026-10-26" }]),
      "co"
    );
    expect(p).toEqual({
      ...resumenRange("month", "2026-10-26"),
      label: "Octubre 2026",
    });
  });
  it("no sales (or a failed read): null = all history", async () => {
    expect(await defaultPlatosPeriod(fake([]), "co")).toBeNull();
    expect(await defaultPlatosPeriod(fake([], true), "co")).toBeNull();
  });
});
