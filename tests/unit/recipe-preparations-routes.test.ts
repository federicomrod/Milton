import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Preparaciones routes and screen", () => {
  it("approve checks the approval role before touching anything", () => {
    const src = read(
      "app/api/restaurant/recipes/preparations/approve/route.ts"
    );
    expect(src).toContain("authAndCompany");
    expect(src).toContain("actorCanApprove(");
    expect(src.indexOf("actorCanApprove(")).toBeLessThan(
      src.indexOf("approvePreparation(")
    );
    expect(src).not.toMatch(/body\.company_id/);
  });

  it("list takes the company from auth", () => {
    const src = read("app/api/restaurant/recipes/preparations/route.ts");
    expect(src).toContain("authAndCompany");
    expect(src).not.toMatch(/searchParams\.get\(["']company/);
  });

  it("route files export only HTTP handlers", () => {
    for (const file of [
      "app/api/restaurant/recipes/preparations/route.ts",
      "app/api/restaurant/recipes/preparations/approve/route.ts",
      "app/api/restaurant/recipes/editor/route.ts",
    ]) {
      const names = [
        ...read(file).matchAll(/^export (?:async )?(?:function|const) (\w+)/gm),
      ].map((m) => m[1]);
      for (const name of names) {
        expect(["GET", "POST", "dynamic", "runtime"], file).toContain(name);
      }
    }
  });

  it("the store writes preparation lines only to the preparation's own version tables", () => {
    const store = read("lib/restaurant/recipe-costing/editor-store.ts");
    expect(store).toContain('table: "component_recipe_version_inputs"');
    expect(store).toContain('fk: "component_recipe_version_id"');
    expect(store).toMatch(/\.eq\("status", "in_review"\)/);
  });

  it("screen copy is Spanish with tú and orders by impact", () => {
    const ui = read(
      "components/restaurant/recipes-costing/PreparacionesScreen.tsx"
    );
    expect(ui).toContain("Preparaciones de tu cocina");
    expect(ui).toContain("Empieza por las que desbloquean más ventas");
    expect(ui).toContain("Confirmar rendimiento");
    expect(ui).toContain("Aprobar preparación");
    expect(ui).toContain("Solo el dueño o un admin aprueba");
    expect(ui).not.toMatch(/\busted\b/i);
    const server = read("lib/restaurant/recipe-costing/preparations-server.ts");
    expect(server).toContain("b.impact.net_sales - a.impact.net_sales");
  });
});
