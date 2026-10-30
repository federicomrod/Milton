import { menuEditor } from "@/lib/i18n/es/menu-editor";
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
    expect(post.indexOf('can(actor, "recipes.edit")')).toBeGreaterThan(-1);
    expect(post.indexOf('can(actor, "recipes.edit")')).toBeLessThan(
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

  it("the dish yield route only changes the yield, behind the edit role", () => {
    const route = read("app/api/restaurant/recipes/dish-yield/route.ts");
    expect(route).toContain("authAndCompany");
    expect(route).toContain("confirmDishYield");
    const server = read("lib/restaurant/recipe-costing/dish-yield-server.ts");
    expect(server).toContain("actorCanSubmitForApproval");
    expect(server).not.toMatch(/\.insert\(|recipe_version_inputs|unit_cost/);
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
    // One list, filtered on the client; click highlights, Enter adds.
    expect(ui).toContain('role="listbox"');
    expect(ui).toContain("searchPickerOptions(options, query)");
    expect(ui).toContain('event.key === "Enter"');
    // The Spanish wording lives in lib/i18n/es/menu-editor.ts; the editor reads it by key.
    expect(menuEditor.picker.preparationPrefix).toBe("Preparación · ");
    expect(menuEditor.picker.notThere).toBe("¿No está? Agregar ingrediente");
    expect(menuEditor.picker.addAndUse).toBe("Agregar y usar");
    expect(menuEditor.picker.checkDuplicates).toBe(
      "Revisa que no esté ya en tu lista con otro nombre."
    );
    expect(menuEditor.picker.createPreparation).toBe("Crear preparación");
    expect(menuEditor.picker.createAndUse).toBe("Crear y usar");
    expect(menuEditor.lines.addPrice).toBe("Agregar precio");
    for (const k of [
      "d.picker.preparationPrefix",
      "d.picker.notThere",
      "d.picker.addAndUse",
      "d.picker.checkDuplicates",
      "d.picker.createPreparation",
      "d.picker.createAndUse",
      "d.lines.addPrice",
    ])
      expect(ui).toContain(k);
    // No path posts a free-typed name as a line.
    expect(ui).not.toContain("raw_name:");
    expect(ui).not.toContain("add_line");
    expect(ui).not.toMatch(/\busted\b/i);
  });
});
