// @vitest-environment jsdom
// An APPROVED recipe: one calm muted line, no red box, no orange banner; the
// ingredient's price can be typed; «Crear versión nueva» lives in the ⋯ menu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { RecipeLinesEditor } from "@/components/restaurant/recipes-costing/RecipeLinesEditor";
import { loadEditor } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  memoryEditorState,
} from "./helpers/memory-editor-store";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function approvedState() {
  const s = memoryEditorState({
    ingredients: [
      { id: "i-1", name: "Chimicurri de prueba", default_unit: "oz" },
    ],
    entries: [],
    version: { id: "v1", status: "approved", kind: "dish", menu_item_id: "m1" },
    inputs: [
      {
        id: "l1",
        input_type: "ingredient",
        ingredient_id: "i-1",
        component_id: null,
        quantity: 2,
        unit: "oz",
        unit_cost: null,
        cost_source: null,
      },
    ],
    link: { id: "link-1", menu_item_id: "m1", evidence: {} },
  });
  const r = await loadEditor({
    store: createMemoryEditorStore(s),
    companyId: "co-1",
    odooProductId: 7,
    locationId: null,
    userId: "u1",
  });
  if (!r.ok) throw new Error("no state");
  return r.state;
}

describe("an approved recipe with a line that has no price", () => {
  it("shows one muted line, no red box, no orange banner; the price can be typed; «Crear versión nueva» is not on the page (it is in the ⋯ menu)", async () => {
    const state = await approvedState();
    expect(state.editable).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => state }))
    );
    const { container } = render(
      <RecipeLinesEditor
        odooProductId={7}
        locationId={null}
        portionCostLabel={null}
        onEdited={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("Ingredientes por porción")).toBeTruthy()
    );
    // one calm line
    expect(
      screen.getByText(
        "Receta aprobada · para cambiar cantidades, crea una versión nueva"
      )
    ).toBeTruthy();
    // no red box, no orange banner
    expect(container.querySelector(".bg-\\[\\#fdecec\\]")).toBeNull();
    expect(screen.queryByTestId("approved-pending-banner")).toBeNull();
    expect(container.textContent).not.toContain(
      "Corrige el precio del ingrediente"
    );
    // the ingredient's price field works on an approved recipe
    const price = screen.getByPlaceholderText("Precio") as HTMLInputElement;
    expect(price.disabled).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Agregar precio",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    // quantity and unit stay locked
    expect((screen.getByDisplayValue("2") as HTMLInputElement).disabled).toBe(
      true
    );
    // «Crear versión nueva» only inside the ⋯ menu (closed: not on the page)
    expect(screen.queryByText("Crear versión nueva")).toBeNull();
    expect(screen.getByLabelText("Más acciones de la receta")).toBeTruthy();
  });

  it("source: «Crear versión nueva» is a menu item, not a button; the 4 price controls ignore the read-only lock", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
      ),
      "utf8"
    );
    expect(src).toMatch(
      /<DropdownMenuItem[\s\S]{0,160}new_version[\s\S]{0,80}d\.lines\.newVersion/
    );
    expect(src).not.toMatch(
      /<(PrimaryBtn|GhostBtn)[^>]*>\s*\{d\.lines\.newVersion/
    );
    expect(readFileSync("lib/i18n/es/menu-editor.ts", "utf8")).toContain(
      'newVersion: "Crear versión nueva"'
    );
    expect(src).not.toContain("approved-pending-banner");
    expect(src).toContain(
      'const priceEditable = line.kind === "ingredient" ? canFixPrice : editable;'
    );
    expect(src).toContain("canFixPrice={!busy}");
    expect(src).not.toMatch(/placeholder="Precio"\s*disabled=\{!editable\}/);
  });
});
