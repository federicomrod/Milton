// Dead-button fixes (source checks): one primary upload button, no orange in
// costing/import components, Cockpit drill-downs use Ventas' own params, the
// mobile menu reaches Configuración, a crumb without a handler is plain text.
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(process.cwd(), dir)).flatMap((f) => {
    const rel = join(dir, f);
    return statSync(join(process.cwd(), rel)).isDirectory()
      ? walk(rel)
      : /\.tsx?$/.test(f)
        ? [rel]
        : [];
  });

describe("one primary button in the «Último archivo» card", () => {
  const panel = read(
    "components/restaurant/recipes-costing/PriceCatalogPanel.tsx"
  );
  const preview = read(
    "components/restaurant/recipes-costing/RecipeImportPreview.tsx"
  );
  it("«Subir y preparar mis platos» is defined once and «Importar» is no longer a button", () => {
    expect(panel.match(/Subir y preparar mis platos/g)?.length).toBe(1);
    expect(preview).not.toMatch(/>\s*\{?busy \? "Importando…" : "Importar"/);
    expect(preview).not.toContain("<PrimaryBtn");
  });
  it("saves the prices first, then imports the recipes, and tells the parent once", () => {
    const fn = panel.slice(panel.indexOf("async function uploadAndPrepare"));
    const save = fn.indexOf("await save(");
    const imp = fn.indexOf("importRecipes()");
    expect(save).toBeGreaterThan(-1);
    expect(imp).toBeGreaterThan(save);
  });
  it("the primary button is brand blue; secondary buttons are white with a blue border", () => {
    const ui = read("components/restaurant/recipes-costing/ui.tsx");
    expect(ui).toMatch(
      /bg-\[#1B40C8\][^"]*text-white[^"]*hover:bg-\[#1535a6\]/
    );
    expect(ui).toMatch(/border-\[#1B40C8\] bg-white[^"]*text-\[#1B40C8\]/);
  });
});

describe("no orange in costing / import components", () => {
  it("recipes-costing, costs, menu, settings and the invoices page", () => {
    const files = [
      ...walk("components/restaurant/recipes-costing"),
      ...walk("components/restaurant/costs"),
      ...walk("components/restaurant/menu"),
      ...walk("components/restaurant/settings"),
      "components/restaurant/InvoicesPage.tsx",
      "components/restaurant/SuppliersPage.tsx",
    ];
    for (const f of files)
      expect(read(f), f).not.toMatch(/f28c28|e07b1|orange-/i);
  });
});

describe("dead buttons fixed", () => {
  it("Cockpit drill-downs open Ventas with p=custom&desde&hasta", () => {
    const src = read("components/restaurant/cockpit/v2/CockpitV2.tsx");
    expect(src).toContain("p=custom&desde=");
    expect(src).not.toMatch(/withShellParams\(SALES_DETAIL_HREF, \{[^}]*from,/);
  });
  it("the recipe price opens on one click", () => {
    const src = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(src).toContain("onClick={() => setEditingPrice(true)}");
  });
  it("the mobile menu includes Configuración and Cerrar sesión (the sidebar footer)", () => {
    const src = read("components/restaurant/RestaurantShell.tsx");
    expect(src.match(/<SidebarFooter/g)?.length).toBe(2);
  });
  it("the dish crumb is only a button when it has a handler", () => {
    const src = read("components/restaurant/menu/DrillView.tsx");
    expect(src).toContain("{onOpenRecipe ? (");
  });
  it("Objetivos days open on one click; no «Unir…» link that does not merge", () => {
    expect(
      read("components/restaurant/settings/ObjetivosForm.tsx")
    ).not.toContain("onDoubleClick");
    const editor = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(editor).not.toContain("Unir…");
    expect(editor).toContain("Ver ingrediente");
  });
  it("the Costos «Subir archivo de costos» link falls through to its hash when the section is not ready", () => {
    const src = read("components/restaurant/costs/CostsSetupSection.tsx");
    expect(src).toContain("if (!goToFileRef.current) return;");
  });
});
