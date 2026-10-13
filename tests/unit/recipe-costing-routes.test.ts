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

    const confirm = read("app/api/restaurant/pos/links/confirm/route.ts");
    expect(confirm).toContain("confirmPosLinkForCompany");
    expect(confirm).toContain("authAndCompany");

    const ui = read("components/restaurant/recipes-costing/ResumenScreen.tsx");
    expect(ui).toContain("coverage.coverage_label");
    expect(ui).not.toMatch(/coverage_pct\s*[+\-*/]/);
    expect(ui).not.toMatch(/net_sales\s*[+\-*/]/);

    // Plato por plato replaces Vincular + Validar: one screen per dish.
    const plato = read("components/restaurant/recipes-costing/PlatoScreen.tsx");
    expect(plato).toContain("RecipeLinesEditor");
    expect(plato).toContain("Costo por porción");
    expect(plato).toContain("editor.margin_label");
    expect(plato).not.toMatch(/qty\s*\*\s*unit_cost/);
    expect(plato).not.toMatch(/pos_price\s*[-*/]/);
    expect(plato).toContain("Cuadra con Excel");
    expect(plato).toContain("Saltar por ahora");
    expect(plato).toContain("Usar la receta de otro plato");
  });

  it("matches the approved Recetas y costeo chrome", () => {
    const workspace = read(
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx"
    );
    expect(workspace).toContain("CostingHeader");
    expect(workspace).not.toMatch(/\["resumen", "Resumen"\]/);
    expect(workspace).toContain('view === "menu-costeado"');
    expect(workspace).not.toContain("|| data.menu_costeado");

    const header = read(
      "components/restaurant/recipes-costing/CostingHeader.tsx"
    );
    expect(header).toContain("Preguntar a Milton");
    expect(header).toContain("odooSyncLabel");
    expect(header).toContain("Recetas y costeo");
    expect(header).toContain("Plato por plato");

    const resumen = read(
      "components/restaurant/recipes-costing/ResumenScreen.tsx"
    );
    expect(resumen).toContain("Tu menú en Odoo");
    expect(resumen).toContain("Stepper");

    expect(
      read("components/restaurant/recipes-costing/RecipeLinesEditor.tsx")
    ).toContain("+ Agregar ingrediente");

    const menuPage = read("app/dashboard/restaurant/menu/page.tsx");
    expect(menuPage).toContain("/dashboard/restaurant/menu/recetas");
    expect(menuPage).not.toContain("UNMATCHED POS ITEMS");
    expect(menuPage).not.toContain("Create menu item");
  });

  it("does not add vercel, CI or secret files", () => {
    const files = [
      "app/api/restaurant/pos/links/confirm/route.ts",
      "app/api/restaurant/recipes/approve/route.ts",
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      expect(src).not.toMatch(/VERCEL_|SUPABASE_SERVICE_ROLE|vercel\.json/);
    }
  });
});
