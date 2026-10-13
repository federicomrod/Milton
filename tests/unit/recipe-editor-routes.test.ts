import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("recipe editor route and screen", () => {
  const route = read("app/api/restaurant/recipes/editor/route.ts");

  it("takes company and user from auth and checks the role before any edit", () => {
    expect(route).toContain("authAndCompany");
    expect(route).not.toMatch(
      /body\.company_id|searchParams\.get\(["']company/
    );
    const post = route.slice(route.indexOf("export async function POST"));
    expect(post.indexOf("actorCanSubmitForApproval")).toBeGreaterThan(-1);
    expect(post.indexOf("actorCanSubmitForApproval")).toBeLessThan(
      post.indexOf("applyEdit(")
    );
  });

  it("only exports HTTP handlers (Next.js rejects other route exports)", () => {
    const exports = [
      ...route.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm),
    ].map((m) => m[1]);
    for (const name of exports) {
      expect(["GET", "POST", "dynamic", "runtime"]).toContain(name);
    }
  });

  it("never inserts an ingredient except through the explicit create action", () => {
    const service = read("lib/restaurant/recipe-costing/editor-service.ts");
    const calls = [...service.matchAll(/store\.createIngredient\(/g)];
    expect(calls).toHaveLength(1);
    const around = service.slice(
      service.indexOf('case "create_ingredient"'),
      service.indexOf('case "set_price"')
    );
    expect(around).toContain("store.createIngredient(");
    expect(service).not.toContain(".ilike(");
    const store = read("lib/restaurant/recipe-costing/editor-store.ts");
    expect(store).not.toContain(".ilike(");
    expect(store.match(/from\("ingredients"\)\s*\.insert/g) ?? []).toHaveLength(
      1
    );
  });

  it("the old fix route no longer edits lines, only the preparation yield", () => {
    const fix = read("app/api/restaurant/recipes/review/fix/route.ts");
    for (const field of ["quantity", "unit_cost", "add_line"]) {
      expect(fix).toContain(`"${field}"`);
    }
    expect(fix).toContain("status: 400");
    const screen = read(
      "components/restaurant/recipes-costing/PlatoScreen.tsx"
    );
    expect(screen).not.toContain("add_line");
    expect(screen).not.toContain("unit_cost:");
  });

  it("the picker is a list over ingredients and preparations, with an explicit create step", () => {
    const ui = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(ui).toContain('optgroup label="Ingredientes"');
    expect(ui).toContain('optgroup label="Preparaciones"');
    expect(ui).toContain("¿No está? Agregar ingrediente");
    expect(ui).toContain("Agregar y usar");
    expect(ui).toContain("Esto agrega un ingrediente nuevo a tu lista");
    expect(ui).toContain("Sin precio queda pendiente, nunca en $0.");
    expect(ui).toContain("Crear preparación");
    expect(ui).toContain("Crear y usar");
    expect(ui).toContain("Agregar precio");
    // No path posts a free-typed name as a line.
    expect(ui).not.toContain("raw_name:");
    expect(ui).not.toContain("add_line");
    expect(ui).not.toMatch(/\busted\b/i);
  });
});
