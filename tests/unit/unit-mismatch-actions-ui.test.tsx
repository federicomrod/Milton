// @vitest-environment jsdom
// «Unidad distinta» on an approved recipe line (12 onza vs $0.235/unidad):
// «Definir conversión» and «Corregir unidad del precio» each call their
// endpoint once, the editor is re-read / replaced, and the line shows a cost
// with no page reload. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { RecipeLinesEditor } from "@/components/restaurant/recipes-costing/RecipeLinesEditor";
import { UnitConversionForm } from "@/components/restaurant/recipes-costing/UnitConversionForm";
import { clearEditors } from "@/lib/restaurant/recipe-costing/editor-cache";
import { invalidatePickerOptions } from "@/lib/restaurant/recipe-costing/picker-cache";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";

beforeEach(() => {
  clearEditors();
  invalidatePickerOptions();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function state(costed: boolean): EditorState {
  const line = {
    key: "l1",
    input_id: "l1",
    kind: "ingredient",
    ingredient_id: "i-1",
    component_id: null,
    name: "POLLO DE PRUEBA",
    raw_name: "POLLO DE PRUEBA",
    source_row: null,
    qty: 12,
    unit: "oz",
    unit_cost: costed ? 0.235 : null,
    amount: costed ? 2.82 : null,
    price: { unit_cost: 0.235, unit: "unit", date: null, source: "manual" },
    pending: !costed,
    flags: costed ? [] : ["pendiente_unidad"],
    legacy_price: null,
    reasons: [],
    possible_match: null,
    evidence_index: null,
    unit_question: null,
    excel_unit_cost: null,
  };
  return {
    editable: false,
    locked_reason: "approved",
    version_id: "v1",
    lines: [line],
    options: [],
    pending: costed ? 0 : 1,
    total_cost: costed ? 2.82 : null,
  } as unknown as EditorState;
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function mount(fetchMock: ReturnType<typeof vi.fn>, productId: number) {
  vi.stubGlobal("fetch", fetchMock);
  return render(
    <RecipeLinesEditor
      odooProductId={productId}
      locationId={null}
      portionCostLabel={null}
      onEdited={() => {}}
    />
  );
}

const calls = (m: ReturnType<typeof vi.fn>, url: string, method: string) =>
  m.mock.calls.filter(
    ([u, init]) =>
      String(u).startsWith(url) && (init?.method ?? "GET") === method
  );

describe("«Unidad distinta» actions", () => {
  it("«Definir conversión»: one POST, then the editor is re-read and the line shows a cost", async () => {
    let saved = false;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (
        String(url).startsWith("/api/restaurant/ingredients/unit-conversions")
      )
        return ok({ conversion: { id: "c1" } });
      if (String(url).startsWith("/api/restaurant/recipes/editor")) {
        return ok(state(saved));
      }
      throw new Error(`unexpected ${url} ${init?.method}`);
    });
    mount(f, 101);
    await waitFor(() =>
      expect(screen.getByText("Unidad distinta")).toBeTruthy()
    );
    expect(screen.queryByText("$2.82")).toBeNull();
    // The question is already open under the line: no extra click.
    expect(screen.getByTestId("unit-question").textContent).toContain(
      "¿Cuántas unit lleva 1 oz de POLLO DE PRUEBA?"
    );
    fireEvent.change(screen.getByLabelText(/Cuántos/), {
      target: { value: "0.5" },
    });
    saved = true;
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getAllByText(/\$2\.82/).length).toBeGreaterThan(0)
    );
    const posts = calls(
      f,
      "/api/restaurant/ingredients/unit-conversions",
      "POST"
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1].body))).toMatchObject({
      ingredient_id: "i-1",
      from_unit: "oz",
      to_unit: "unit",
      factor: 0.5,
    });
    // initial read + exactly one refetch after saving
    expect(calls(f, "/api/restaurant/recipes/editor", "GET")).toHaveLength(2);
    expect(screen.queryByText("Unidad distinta")).toBeNull();
  });

  it("«Corregir unidad del precio»: one POST to the editor with correct_unit, the line shows a cost", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/restaurant/recipes/editor")) {
        return ok(init?.method === "POST" ? state(true) : state(false));
      }
      throw new Error(`unexpected ${url}`);
    });
    mount(f, 102);
    await waitFor(() =>
      expect(screen.getByText("Unidad distinta")).toBeTruthy()
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Corregir unidad del precio" })
    );
    fireEvent.click(
      within(screen.getByTestId("correct-price-unit")).getByRole("button", {
        name: "Guardar",
      })
    );
    await waitFor(() =>
      expect(screen.getAllByText(/\$2\.82/).length).toBeGreaterThan(0)
    );
    const posts = calls(f, "/api/restaurant/recipes/editor", "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1].body))).toMatchObject({
      action: "set_price",
      ingredient_id: "i-1",
      unit: "oz",
      unit_cost: 0.235,
      correct_unit: true,
    });
    expect(screen.queryByText("Unidad distinta")).toBeNull();
  });
});

describe("UnitConversionForm when migration 056 is missing", () => {
  it("shows a gray note, no alert, and no Guardar button", async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ unavailable: true, error: "falta 056" }),
    }));
    vi.stubGlobal("fetch", f);
    const onSaved = vi.fn();
    render(
      <UnitConversionForm
        ingredientId="i-1"
        ingredientName="POLLO"
        unitA="oz"
        unitB="unit"
        onSaved={onSaved}
      />
    );
    fireEvent.change(screen.getByLabelText(/Cuántos/), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const note = await screen.findByText(
      "Las conversiones aún no están activas en este ambiente."
    );
    expect(note.className).toContain("text-gray-500");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
