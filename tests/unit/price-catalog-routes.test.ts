import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("price catalog routes and screen", () => {
  const routes = [
    "app/api/restaurant/recipes/price-catalog/route.ts",
    "app/api/restaurant/recipes/price-catalog/conflicts/route.ts",
    "app/api/restaurant/recipes/price-catalog/conflicts/[id]/route.ts",
  ];

  it("takes the company and user from auth, never from the request", () => {
    for (const file of routes) {
      const src = read(file);
      expect(src, file).toContain("authAndCompany");
      expect(src, file).not.toMatch(/company_id/);
      expect(src, file).not.toMatch(/searchParams\.get\(["']company/);
    }
  });

  it("previews without writing and checks migration 039 before saving", () => {
    const src = read("app/api/restaurant/recipes/price-catalog/route.ts");
    const preview = src.slice(
      src.indexOf('if (mode === "preview")'),
      src.indexOf("const repo = createSupabaseCostWorkbookRepo")
    );
    expect(preview).not.toContain("applyPriceCatalog");
    expect(preview).not.toContain("repo.");
    expect(src).toContain("hasPriceCatalog039");
    expect(src).toContain('|| "USD"');
    expect(src).toContain("resolveCompanyCurrency");
  });

  it("never lets a client set a price except a validated override", () => {
    const apply = read("lib/restaurant/price-catalog/apply.ts");
    expect(apply).toContain("validCost");
    expect(apply).toContain("isUnit");
    // Priced rows go through persistSavedRows. The one direct create is a
    // person's pick on an unclear row: it never carries a price itself (the
    // price is a separate cost entry with the file's provenance).
    expect(apply.match(/createIngredients\(/g) ?? []).toHaveLength(1);
    const direct = apply.slice(apply.indexOf("createIngredients("));
    expect(direct.slice(0, 400)).toContain("currentUnitCost: null");
  });

  it("mounts the panel on Resumen, in Spanish with tú", () => {
    // R1-18: step 1 of the setup lives at the top of Costos now (same panel).
    const resumen = read(
      "components/restaurant/costs/CostsSetupSection.tsx"
    ).replace(/\s+/g, " ");
    expect(resumen).toContain("<PriceCatalogPanel");
    expect(resumen).toContain("embedded onUploaded={() => void onUploaded()}");
    expect(resumen).toContain("onRecipesImported={onResetDone}");
    // The copy lives in the Spanish dictionary (the panel reads it with useT).
    const panel =
      read("components/restaurant/recipes-costing/PriceCatalogPanel.tsx") +
      read("lib/i18n/es/menu-workspace.ts");
    expect(panel).toContain("Subir Excel de costos");
    // B4: no explanatory paragraph on the page.
    expect(panel).not.toContain("Lo que no esté claro no te frena");
    expect(panel).toContain("1. Guardar precios");
    expect(panel).toContain("Puedes decidir algunas cosas ahora (opcional)");
    expect(panel).toContain("Revisé estas unidades");
    expect(panel).toContain("Encontramos dos costos");
    expect(panel).not.toMatch(/\busted\b/i);
  });
});
