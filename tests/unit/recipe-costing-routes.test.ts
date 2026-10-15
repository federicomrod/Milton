import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("recipe costing routes", () => {
  it("keeps company on the server and coverage out of React", () => {
    const costing = read("app/api/restaurant/recipes/costing/route.ts");
    expect(costing).toContain("authAndCompany");
    expect(costing).toContain("loadRecipeCostingWorkspace");
    expect(costing).not.toMatch(/searchParams\.get\(["']company_id["']\)/);

    const confirm = read("app/api/restaurant/recipes/plato/confirm/route.ts");
    expect(confirm).toContain("confirmPlato");
    expect(confirm).toContain("authAndCompany");

    // Resumen reads the shared loader's summary; no KPI math in React.
    const ui = read("components/restaurant/recipes-costing/ResumenScreen.tsx");
    expect(ui).toContain("data.menu_summary");
    expect(ui).not.toMatch(/coverage_pct\s*[+\-*/]/);
    expect(ui).not.toMatch(/net_sales\s*[+\-*/]/);

    // Platos: list + detail, numbers from the loader, one recipe editor.
    const plato = read("components/restaurant/recipes-costing/PlatoScreen.tsx");
    expect(plato).toContain("RecipeLinesEditor");
    expect(plato).toContain("data.selected_dish");
    expect(plato).not.toMatch(/qty\s*\*\s*unit_cost/);
    expect(plato).not.toMatch(/pos_price\s*[-*/]/);
    expect(plato).toContain("Excel:");
    expect(plato).not.toContain("Saltar por ahora");
    // C6: once, inside the dish's "⋯" menu.
    expect(plato.match(/Usar la receta de otro plato/g)?.length).toBe(1);
  });

  it("matches the approved Menú chrome (R1-09b)", () => {
    const workspace = read(
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx"
    );
    // B2 / B13: no breadcrumb header and no separate "menú costeado".
    expect(workspace).not.toContain("CostingHeader");
    expect(workspace).not.toContain('view === "menu-costeado"');

    const resumen = read(
      "components/restaurant/recipes-costing/ResumenScreen.tsx"
    );
    // R1-18: the setup checklist moved to Costos; Resumen is the cockpit.
    expect(read("components/restaurant/costs/CostsSetupSection.tsx")).toContain(
      "Configura tus costos"
    );
    expect(resumen).not.toContain("Configura tu menú");
    expect(resumen).not.toContain("Tu menú en Odoo");
    expect(resumen).not.toContain("Quién aprueba");
    expect(resumen).not.toContain("Generar sugerencias");

    expect(
      read("components/restaurant/recipes-costing/RecipeLinesEditor.tsx")
    ).toContain("+ Agregar ingrediente");

    const menuPage = read("app/dashboard/restaurant/menu/page.tsx");
    expect(menuPage).toContain("MenuWorkspacePage");
    expect(menuPage).not.toContain("UNMATCHED POS ITEMS");
    expect(menuPage).not.toContain("Create menu item");
  });

  it("does not add vercel, CI or secret files", () => {
    const files = [
      "app/api/restaurant/recipes/plato/confirm/route.ts",
      "app/api/restaurant/recipes/dish-yield/route.ts",
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      expect(src).not.toMatch(/VERCEL_|SUPABASE_SERVICE_ROLE|vercel\.json/);
    }
  });
});
