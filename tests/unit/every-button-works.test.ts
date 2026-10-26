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

describe("two separate steps in the «Último archivo» card", () => {
  const panel = read(
    "components/restaurant/recipes-costing/PriceCatalogPanel.tsx"
  );
  const preview = read(
    "components/restaurant/recipes-costing/RecipeImportPreview.tsx"
  );
  it("«1. Guardar precios» and «2. Importar recetas (N platos)» are two buttons; the old names are gone", () => {
    expect(panel).toContain("1. Guardar precios");
    expect(preview).toContain("2. Importar recetas (");
    expect(panel).not.toContain("Subir y preparar mis platos");
    expect(preview).not.toContain(': "Importar"');
  });
  it("after step 1 the import button is scrolled into view and the panel is not restarted", () => {
    expect(panel).toContain("onPricesSaved?.()");
    expect(panel).toContain("IMPORT_RECIPES_BUTTON_ID");
    expect(panel).toContain("scrollIntoView");
  });
  it("step 2 is the primary button once step 1 is done, white with a blue border before", () => {
    expect(preview).toContain("primary ? PrimaryBtn : GhostBtn");
    const ui = read("components/restaurant/recipes-costing/ui.tsx");
    expect(ui).toMatch(
      /bg-\[var\(--brand-blue\)\][^"]*text-white[^"]*hover:bg-\[var\(--brand-blue-hover\)\]/
    );
    expect(ui).toMatch(
      /border-\[var\(--brand-blue\)\] bg-white[^"]*text-\[var\(--brand-blue\)\]/
    );
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
