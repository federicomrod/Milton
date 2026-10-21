// @vitest-environment jsdom
// PUYAZO is bought by lb and used per orden: the line asks «¿Cuántas lb lleva
// 1 orden de PUYAZO?» inline, saves the answer once, and the dish refreshes
// with no reload. Synthetic data only.
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

const NINE = [
  "g",
  "kg",
  "ml",
  "l",
  "pza (pieza)",
  "unidad",
  "oz",
  "lb",
  "orden",
];

function state(costed: boolean): EditorState {
  const line = {
    key: "l1",
    input_id: "l1",
    kind: "ingredient",
    ingredient_id: "i-p",
    component_id: null,
    name: "PUYAZO",
    raw_name: "PUYAZO",
    source_row: null,
    qty: 2,
    unit: "orden",
    unit_cost: costed ? 4 : null,
    amount: costed ? 8 : null,
    price: { unit_cost: 8, unit: "lb", date: null, source: "manual" },
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
    editable: true,
    locked_reason: null,
    version_id: null,
    lines: [line],
    options: [],
    pending: costed ? 0 : 1,
    total_cost: costed ? 8 : null,
  } as unknown as EditorState;
}

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
const CONV = "/api/restaurant/ingredients/unit-conversions";
const EDITOR = "/api/restaurant/recipes/editor";
const calls = (m: ReturnType<typeof vi.fn>, url: string, method: string) =>
  m.mock.calls.filter(
    ([u, init]) =>
      String(u).startsWith(url) && (init?.method ?? "GET") === method
  );

function mount(f: ReturnType<typeof vi.fn>, productId: number) {
  vi.stubGlobal("fetch", f);
  return render(
    <RecipeLinesEditor
      odooProductId={productId}
      locationId={null}
      portionCostLabel={null}
      onEdited={() => {}}
    />
  );
}

describe("PUYAZO: lb price, orden line", () => {
  it("asks the question, saves one conversion, and refreshes without reload", async () => {
    let saved = false;
    const f = vi.fn(async (url: string) => {
      if (String(url).startsWith(CONV)) return ok({ conversion: { id: "c1" } });
      if (String(url).startsWith(EDITOR)) return ok(state(saved));
      throw new Error(`unexpected ${url}`);
    });
    mount(f, 201);
    const q = await screen.findByTestId("unit-question");
    expect(q.textContent).toBe("¿Cuántas lb lleva 1 orden de PUYAZO?");
    expect(screen.getByText(/Sin precio/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Cuántos/), {
      target: { value: "0.5" },
    });
    saved = true;
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getAllByText(/\$8/).length).toBeGreaterThan(0)
    );
    expect(screen.queryByText(/Sin precio/)).toBeNull();
    const posts = calls(f, CONV, "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1].body))).toEqual({
      ingredient_id: "i-p",
      from_unit: "orden",
      to_unit: "lb",
      factor: 0.5,
    });
    expect(screen.queryByTestId("unit-question")).toBeNull();
  });

  it("409 unavailable shows the gray note", async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).startsWith(CONV))
        return {
          ok: false,
          status: 409,
          json: async () => ({ unavailable: true }),
        };
      return ok(state(false));
    });
    mount(f, 202);
    await screen.findByTestId("unit-question");
    fireEvent.change(screen.getByLabelText(/Cuántos/), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const note = await screen.findByText(
      "Las conversiones aún no están activas en este ambiente."
    );
    expect(note.className).toContain("text-gray-500");
  });

  it("the line dropdown and the price editor both offer exactly the nine units", async () => {
    const f = vi.fn(async () => ok(state(false)));
    mount(f, 203);
    const lineSelect = await screen.findByLabelText("Unidad de la línea");
    const labels = (el: HTMLElement) =>
      within(el)
        .getAllByRole("option")
        .map((o) => o.textContent);
    expect(labels(lineSelect)).toEqual(NINE);
    fireEvent.click(screen.getByText("editar precio"));
    expect(labels(screen.getByLabelText("Unidad del precio"))).toEqual(NINE);
  });

  it("a price in a unit that does not convert opens the question, not an error", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith(EDITOR) && init?.method === "POST")
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error:
              "¿Cuántas lb lleva 1 taza? Dime la equivalencia y guardo el precio.",
            conversion: {
              ingredient_id: "i-p",
              ingredient_name: "PUYAZO",
              from_unit: "orden",
              to_unit: "lb",
            },
          }),
        };
      return ok({
        ...state(true),
        lines: [{ ...state(true).lines[0], flags: [] }],
      });
    });
    mount(f, 204);
    await screen.findByLabelText("Unidad de la línea");
    fireEvent.click(screen.getByText("editar precio"));
    fireEvent.change(screen.getByPlaceholderText("Precio"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Unidad del precio"), {
      target: { value: "orden" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const q = await screen.findByTestId("unit-question");
    expect(q.textContent).toBe("¿Cuántas lb lleva 1 orden de PUYAZO?");
    expect(screen.queryByText(/No puedo guardar/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
