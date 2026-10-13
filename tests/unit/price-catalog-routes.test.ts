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
    expect(apply).not.toMatch(/createIngredients\(/); // goes through persistSavedRows
  });

  it("mounts the panel on Resumen, in Spanish with tú", () => {
    expect(
      read("components/restaurant/recipes-costing/ResumenScreen.tsx")
    ).toContain("<PriceCatalogPanel />");
    const panel = read(
      "components/restaurant/recipes-costing/PriceCatalogPanel.tsx"
    );
    expect(panel).toContain("Lista de precios de tus ingredientes");
    expect(panel).toContain("No se guarda nada hasta que lo confirmes");
    expect(panel).toContain("Revisé estas unidades");
    expect(panel).toContain("Encontramos dos costos");
    expect(panel).not.toMatch(/\busted\b/i);
  });
});
