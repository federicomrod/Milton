// R1-18: Menú › Resumen drawn (server-rendered) and where the setup went. Synthetic.
import { costs as esCosts } from "@/lib/i18n/es/costs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { ResumenCockpit } from "@/components/restaurant/recipes-costing/ResumenScreen";
import {
  computeResumen,
  resumenRange,
  type ResumenData,
} from "@/lib/restaurant/menu-resumen";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

const variant = (
  n: number,
  cost: number | null,
  status: "aprobado" | "estimado" | "falta_precio" | "sin_receta"
) => ({
  key: String(n),
  product_id: n,
  locations: null,
  unit_cost: cost,
  covered: status === "aprobado",
  status,
});
function dataWith(costed: number, total: number): ResumenData {
  const dishes = Array.from({ length: total }, (_, i) => ({
    id: `d${i}`,
    name: `Plato ${i}`,
    variants: [
      i < costed
        ? variant(i, 3 + (i % 4), "aprobado")
        : variant(i, null, i % 2 ? "sin_receta" : "falta_precio"),
    ],
  }));
  return {
    currency: "USD",
    first_day: "2026-07-01",
    last_day: "2026-07-31",
    dishes,
    days: dishes.map((d, i) => ({
      d: "2026-07-31",
      l: null,
      p: i,
      n: 100 - i,
      u: 10,
    })),
  };
}
const draw = (
  d: ResumenData,
  over: Partial<Parameters<typeof ResumenCockpit>[0]> = {}
) => {
  const view = computeResumen(d, resumenRange("month", d.last_day!));
  return renderToString(
    createElement(ResumenCockpit, {
      view,
      currency: "USD",
      period: "month",
      onPeriod() {},
      monthText: "Julio 2026",
      missingPriceIngredients: 42,
      latestUpload: {
        filename: "costos.xlsx",
        created_at: "2026-09-10T12:00:00Z",
      },
      now: Date.parse("2026-10-14T12:00:00Z"),
      ...over,
    })
  );
};

describe("Resumen is the menu's cockpit", () => {
  const partial = draw(dataWith(2, 20));
  const t = text(partial);
  it("has the range control (7 días / mes / 90 días), the four KPIs, Top platos, Mejor/Peor margen and Pendientes", () => {
    for (const l of [
      "7 días",
      "Julio 2026",
      "90 días",
      "Costo de comida",
      "Margen bruto",
      "Ventas con costo",
      "Platos con problema",
      "Top platos por ventas",
      "Mejor margen",
      "Peor margen",
      "Pendientes",
      "Ir a Costos →",
    ])
      expect(t).toContain(l);
    expect(t).toContain("solo ventas con costo");
    expect(t).toContain("2 de 20 platos costeados");
    expect(t).not.toContain("Canal"); // channel per dish is not in the existing read
  });
  it("shows no setup block: no checklist, Excel, recetas importadas, Costos por decidir, menú web, Empezar de nuevo", () => {
    for (const gone of [
      "Configura tu menú",
      "Configura tus costos",
      "Subir Excel",
      "Elegir archivo",
      "Recetas de tu archivo",
      "Deshacer lote",
      "Costos por decidir",
      "Leer tu menú web",
      "Empezar de nuevo",
    ])
      expect(t).not.toContain(gone);
    const src = read("components/restaurant/recipes-costing/ResumenScreen.tsx");
    for (const comp of [
      "PriceCatalogPanel",
      "MenuReaderPanel",
      "ResetPanel",
      "RecipeImportPreview",
    ])
      expect(src).not.toContain(comp);
    // The one thing Resumen does carry: the reader as a card (not an accordion).
    expect(src).toContain("MenuReaderCard");
  });
  it("with 2 costed dishes: both margin cards show the empty state and «margen de 2 de 20 platos»; no $0 / 0% for a missing price", () => {
    expect(t).toContain("margen de 2 de 20 platos");
    expect(t).toContain("Sin ranking hasta tener al menos 3 platos con costo.");
    expect(t).toContain("margen —");
    expect(partial).not.toMatch(/\$0(?![.,\d])/);
    expect(t).not.toContain(" 0%");
  });
  it("with 3+ costed dishes the rankings appear, only costed dishes", () => {
    const html = draw(dataWith(6, 20));
    const s = text(html);
    expect(s).not.toContain("Sin ranking hasta");
    expect(s).toContain("margen de 6 de 20 platos");
    // 3 + 3 ranked rows are costed dishes (Plato 0..5), never an uncosted one
    const best = text(
      html.slice(
        html.indexOf('data-testid="menu-resumen-best"'),
        html.indexOf('data-testid="menu-resumen-worst"')
      )
    );
    const worst = text(
      html.slice(
        html.indexOf('data-testid="menu-resumen-worst"'),
        html.indexOf('data-testid="menu-resumen-pendientes"')
      )
    );
    for (const block of [best, worst]) {
      // the first three are the ranked rows (a fourth mention may be the «revisa precio» note)
      const names = [...block.matchAll(/Plato (\d+)/g)]
        .map((m) => Number(m[1]))
        .slice(0, 3);
      expect(names).toHaveLength(3);
      expect(names.every((n) => n < 6)).toBe(true);
    }
  });
  it("Pendientes: counts, share of sales, links with the right filter, ONE button to Costos", () => {
    expect(partial).toContain(
      'href="/dashboard/restaurant/menu/ingredientes?filtro=falta_precio"'
    );
    expect(partial).toContain(
      'href="/dashboard/restaurant/menu/platos?estado=sin_receta"'
    );
    expect(partial).toContain('href="/dashboard/restaurant/costs?tab=precios"');
    expect(t).toContain("42 Ingredientes sin precio");
    expect(t).toContain("Platos sin receta");
    expect(t).toContain("Hace 34 días · costos.xlsx");
    expect((partial.match(/Ir a Costos →/g) ?? []).length).toBe(1);
  });
  it("estimated dishes show the «IA» chip and a link to the Estimado filter", () => {
    const d = dataWith(4, 6);
    d.dishes[0].variants = [variant(0, 3, "estimado")];
    const html = draw(d);
    expect(html).toContain(
      'href="/dashboard/restaurant/menu/platos?estado=estimado"'
    );
    expect(text(html)).toContain("Costos estimados por IA");
    expect(html).toContain(">IA<");
  });
  it("everything costed: «Platos bajo objetivo», «Menú completo» and the file age", () => {
    const html = draw(dataWith(5, 5), { missingPriceIngredients: 0 });
    const s = text(html);
    expect(s).toContain("Platos bajo objetivo");
    expect(s).toContain("Menú completo");
    expect(s).toContain("sobre el 100% de ventas");
    expect(s).toContain("Hace 34 días");
  });
  it("loading shows the skeleton, not numbers; an empty range says so", () => {
    expect(
      renderToString(
        createElement(ResumenCockpit, {
          view: null,
          currency: "USD",
          period: "month",
          onPeriod() {},
          monthText: "Mes",
          missingPriceIngredients: 0,
          latestUpload: null,
          now: 0,
        })
      )
    ).toContain("menu-resumen-loading");
    const d = dataWith(2, 3);
    const empty = renderToString(
      createElement(ResumenCockpit, {
        view: computeResumen(d, { from: "2020-01-01", to: "2020-01-02" }),
        currency: "USD",
        period: "7d",
        onPeriod() {},
        monthText: "Julio 2026",
        missingPriceIngredients: 0,
        latestUpload: null,
        now: 0,
      })
    );
    expect(text(empty)).toContain(
      "Todavía no hay ventas de platos en este rango."
    );
  });
  it("the brand blue, not the old orange", () => {
    expect(partial).toContain("#1b40c8");
    expect(partial).not.toContain("#f28c28");
  });
});

describe("the setup moved to Costos, same components", () => {
  const costs = read("app/dashboard/restaurant/costs/page.tsx");
  const section = read("components/restaurant/costs/CostsSetupSection.tsx");
  it("Costos mounts the file workspace (with setup section), tabs come after KPIs", () => {
    expect(costs).toContain("<CostsFileWorkspace");
    // Two-column layout: tabs come right after KPIs
    expect(costs.indexOf("<CostsKpiCard")).toBeLessThan(
      costs.indexOf("<CostsAreaTabs")
    );
    // File workspace (containing setup) comes after tabs
    expect(costs.indexOf("<CostsAreaTabs")).toBeLessThan(
      costs.indexOf("<CostsFileWorkspace")
    );
  });
  it("it reuses the existing panels and endpoints (upload → prepare dishes, undo batch, reset, menu reader)", () => {
    for (const c of [
      "PriceCatalogPanel",
      "ResetPanel",
      "prepareDishesFromUpload",
    ])
      expect(section).toContain(c);
    expect(section).toContain("/api/restaurant/costs/batches/${batchId}/undo");
    expect(esCosts.setup.configureShort).toBe("Configura tus costos");
    expect(esCosts.setup.lastFile).toBe("Último archivo");
    expect(section).toContain("st.configure");
    expect(section).toContain("st.lastFile");
    // The menu reader moved to the Resumen card; Costos only links to it.
    expect(section).not.toContain("Leer tu menú web (opcional)");
    expect(esCosts.setup.costsConfigured).toBe("Costos configurados");
    expect(section).toContain("st.costsConfigured");
    expect(
      read("lib/restaurant/recipe-costing/prepare-from-upload.ts")
    ).toContain("/api/restaurant/recipes/suggestions");
  });
  it("the Menú workspace no longer carries the upload handlers", () => {
    const ws = read(
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx"
    );
    expect(ws).not.toContain("runSuggestions");
    expect(ws).not.toContain("onUndoBatch");
  });
});
