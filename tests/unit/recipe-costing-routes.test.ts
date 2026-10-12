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

    const vincular = read(
      "components/restaurant/recipes-costing/VincularScreen.tsx"
    );
    expect(vincular).toContain("preview_lines");
    expect(vincular).toContain("Costo Milton");
    expect(vincular).toContain("Generar sugerencias desde tu archivo");
    expect(vincular).not.toMatch(/qty\s*\*\s*unit_cost/);
    expect(vincular).toContain("display_state_label");
    expect(vincular).toContain("Confirmar vínculo");
    expect(vincular).toContain("Compartir receta");
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
    expect(header).toContain("Paso 2 de 4");

    const resumen = read(
      "components/restaurant/recipes-costing/ResumenScreen.tsx"
    );
    expect(resumen).toContain("Tu menú en Odoo");
    expect(resumen).toContain("Stepper");

    const validar = read(
      "components/restaurant/recipes-costing/ValidarScreen.tsx"
    );
    expect(validar).toContain("+ Agregar ingrediente");
    expect(validar).toContain("Margen con el costo actual");
    expect(validar).not.toContain("Solo lo incierto, por pestaña");

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
