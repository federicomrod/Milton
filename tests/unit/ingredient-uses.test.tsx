// @vitest-environment jsdom
// "Se usa en": one list for the detail and every counter. Made-up data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

import {
  computeIngredientUses,
  type IngredientUsesInput,
  type UsesLine,
} from "@/lib/restaurant/ingredient-uses";
import { usageFromUses, usageState } from "@/lib/restaurant/ingredient-usage";
import { UsesList } from "@/components/restaurant/menu/IngredientesScreen";

const ing = (id: string, quantity = 1, unit = "kg"): UsesLine => ({
  input_type: "ingredient",
  ingredient_id: id,
  component_id: null,
  quantity,
  unit,
});
const comp = (id: string): UsesLine => ({
  input_type: "component",
  ingredient_id: null,
  component_id: id,
  quantity: 1,
  unit: "portion",
});
const v = (
  id: string,
  n: number,
  status = "approved",
  source_type?: string
) => ({
  id,
  version_number: n,
  status,
  source_type,
});

function base(over: Partial<IngredientUsesInput> = {}): IngredientUsesInput {
  return {
    dishes: new Map(),
    dishVersions: new Map(),
    dishInputsByVersionId: new Map(),
    legacyDishLines: new Map(),
    components: new Map(),
    componentVersions: new Map(),
    componentInputsByVersionId: new Map(),
    legacyComponentLines: new Map(),
    drafts: [],
    aliases: new Map(),
    mergedInto: new Map(),
    ...over,
  };
}
const dish = (name: string, odoo: number | null = 1) => ({
  name,
  odooProductId: odoo,
});

describe("computeIngredientUses", () => {
  it("lists a direct approved dish once even with two lines", () => {
    const out = computeIngredientUses(
      base({
        dishes: new Map([["d1", dish("Ensalada", 7)]]),
        dishVersions: new Map([["d1", [v("v1", 1)]]]),
        dishInputsByVersionId: new Map([
          ["v1", [ing("RAB", 1), ing("RAB", 2)]],
        ]),
      })
    );
    const list = out.get("RAB")!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "plato",
      statusLabel: "Aprobada",
      qty: 3,
      unit: "kg",
      via: null,
    });
    expect(list[0].href).toContain("producto=7");
  });

  it("lists preparation and the dishes that use it, nested and cycle safe", () => {
    const out = computeIngredientUses(
      base({
        dishes: new Map([["d1", dish("Taco")]]),
        dishVersions: new Map([["d1", [v("v1", 1)]]]),
        dishInputsByVersionId: new Map([["v1", [comp("P")]]]),
        components: new Map([
          ["P", { name: "Salsa" }],
          ["Q", { name: "Base" }],
        ]),
        componentVersions: new Map([
          ["P", [v("p1", 1)]],
          ["Q", [v("q1", 1)]],
        ]),
        componentInputsByVersionId: new Map([
          ["p1", [comp("Q")]],
          ["q1", [ing("RAB"), comp("P")]],
        ]),
      })
    );
    const names = out.get("RAB")!.map((e) => `${e.kind}:${e.name}`);
    expect(names.sort()).toEqual(
      ["plato:Taco", "preparacion:Base", "preparacion:Salsa"].sort()
    );
    const taco = out.get("RAB")!.find((e) => e.name === "Taco")!;
    expect(taco.via).toBe("a través de la preparación Salsa");
  });

  it("lists in-review, kitchen-draft version, pending draft and Excel recipes", () => {
    const out = computeIngredientUses(
      base({
        dishes: new Map([
          ["a", dish("En revision")],
          ["b", dish("De cocina")],
          ["c", dish("Excel")],
        ]),
        dishVersions: new Map([
          ["a", [v("a1", 1, "in_review")]],
          ["b", [v("b1", 1, "in_review", "kitchen_draft")]],
        ]),
        dishInputsByVersionId: new Map([
          ["a1", [ing("RAB")]],
          ["b1", [ing("RAB")]],
        ]),
        legacyDishLines: new Map([["c", [ing("RAB")]]]),
        drafts: [
          {
            id: "dr",
            dish_name: "Borrador",
            lines: [
              {
                ingredient_id: "RAB",
                raw_name: "rabano",
                quantity: 2,
                unit: "kg",
              },
            ],
          },
        ],
      })
    );
    const by = Object.fromEntries(
      out.get("RAB")!.map((e) => [e.name, e.statusLabel])
    );
    expect(by).toEqual({
      "En revision": "En revisión",
      "De cocina": "Borrador de cocina",
      Excel: "Del Excel",
      Borrador: "Borrador de cocina",
    });
  });

  it("matches a draft line through an alias and a merged duplicate", () => {
    const out = computeIngredientUses(
      base({
        drafts: [
          {
            id: "d1",
            dish_name: "Alias",
            lines: [
              {
                ingredient_id: null,
                raw_name: "Rábano  rojo",
                quantity: 1,
                unit: "kg",
              },
            ],
          },
          {
            id: "d2",
            dish_name: "Unido",
            lines: [
              { ingredient_id: "OLD", raw_name: "x", quantity: 1, unit: "kg" },
            ],
          },
        ],
        aliases: new Map([["RABANO ROJO", "RAB"]]),
        mergedInto: new Map([["OLD", "RAB"]]),
      })
    );
    const list = out.get("RAB")!;
    expect(list.find((e) => e.name === "Alias")!.via).toContain("por el alias");
    expect(list.find((e) => e.name === "Unido")!.via).toBe("ingrediente unido");
    expect(out.has("OLD")).toBe(false);
  });

  it("only lists recipes it was given (company scoping is the loader's)", () => {
    expect(computeIngredientUses(base()).size).toBe(0);
  });
});

describe("counters", () => {
  const out = computeIngredientUses(
    base({
      dishes: new Map([["a", dish("Revision")]]),
      dishVersions: new Map([["a", [v("a1", 1, "in_review")]]]),
      dishInputsByVersionId: new Map([["a1", [ing("RAB")]]]),
    })
  );
  const usage = usageFromUses(out);
  it("counter equals list length and in-review counts as in use", () => {
    expect(usage.usesCount.get("RAB")).toBe(out.get("RAB")!.length);
    expect(usageState("RAB", usage, new Set()).inUse).toBe(true);
    expect(usageState("ZZZ", usage, new Set()).inUse).toBe(false);
  });
});

describe("UsesList", () => {
  afterEach(cleanup);
  it("shows the empty text only for a truly empty list", () => {
    render(<UsesList usedIn={[]} />);
    expect(screen.getByText("Ningún plato usa este ingrediente.")).toBeTruthy();
  });
  it("fails closed when usage cannot be read", () => {
    render(<UsesList usedIn={null} />);
    expect(screen.getByText("No pude leer dónde se usa.")).toBeTruthy();
    expect(screen.queryByText(/Ningún plato/)).toBeNull();
  });
  it("renders entries with status chip and link", () => {
    const out = computeIngredientUses(
      base({
        dishes: new Map([["a", dish("Revision", 5)]]),
        dishVersions: new Map([["a", [v("a1", 1, "in_review")]]]),
        dishInputsByVersionId: new Map([["a1", [ing("RAB")]]]),
      })
    );
    render(<UsesList usedIn={out.get("RAB")!} />);
    expect(screen.getByText("En revisión")).toBeTruthy();
    expect(
      screen.getByText("Revision").closest("a")?.getAttribute("href")
    ).toContain("producto=5");
  });
});
