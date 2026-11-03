// @vitest-environment jsdom
// Sofia's decisions on #480, on screen: a cook's recipe editor is read-only and
// shows quantities only; «Confirmar 1 unidad» / «Deshacer» and its history in
// Preparaciones; the Ingredientes tab is not shown to kitchen roles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/menu/platos",
  useSearchParams: () => new URLSearchParams(),
}));

// The detail's own editor is replaced by one that reports a fixed state.
let reported: unknown = null;
vi.mock(
  "@/components/restaurant/recipes-costing/RecipeLinesEditor",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    RecipeLinesEditor: (p: { onState?: (s: unknown) => void }) => {
      useEffect(() => {
        p.onState?.(reported);
      }, [p]);
      return <div>EDITOR</div>;
    },
  })
);

import { MenuAreaTabs } from "@/components/restaurant/recipes-costing/MenuAreaTabs";
import { PreparationDetail } from "@/components/restaurant/recipes-costing/PreparacionesScreen";
import { clearEditors } from "@/lib/restaurant/recipe-costing/editor-cache";

beforeEach(() => clearEditors());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Menú tabs", () => {
  it("kitchen roles do not get the Ingredientes tab", () => {
    render(<MenuAreaTabs lang="es" showIngredientes={false} />);
    expect(screen.queryByText("Ingredientes")).toBeNull();
    expect(screen.getByText("Platos")).toBeTruthy();
  });
  it("everyone else does", () => {
    render(<MenuAreaTabs lang="es" />);
    expect(screen.getByText("Ingredientes")).toBeTruthy();
  });
});

const prepState = (over: Record<string, unknown> = {}, prep = {}) => ({
  editable: true,
  locked_reason: null,
  version_id: "cv1",
  lines: [],
  options: [],
  pending: 0,
  total_cost: 12,
  preparation: {
    component_id: "c1",
    name: "Salsa demo",
    status: "borrador",
    yield: { value: 1, unit: "unit", confirmed: false, source: "assumed" },
    cost_per_output_unit: 12,
    yield_missing: true,
    yield_confirmed_default: false,
    yield_history: [],
    checklist: {
      has_lines: true,
      lines_resolved: true,
      costs_known: true,
      yield_confirmed: false,
      ready: false,
      blockers: [],
    },
    ...prep,
  },
  ...over,
});
const actor = {
  can_submit: true,
  can_approve: false,
  needs_client_confirmation: false,
} as never;

function mountDetail() {
  return render(
    <PreparationDetail
      componentId="c1"
      actor={actor}
      onChanged={() => {}}
      onOpen={() => {}}
      name="Salsa demo"
      onApproveStart={() => {}}
      onApproveFailed={() => {}}
    />
  );
}

describe("«Confirmar 1 unidad» in Preparaciones", () => {
  it("is offered on a flagged prep at 1 and posts confirm_yield", async () => {
    reported = prepState();
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", f);
    mountDetail();
    const btn = await screen.findByTestId("confirm-one-unit");
    expect(btn.textContent).toBe("Confirmar 1 unidad");
    fireEvent.click(btn);
    await waitFor(() => expect(f).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/restaurant/recipes/editor");
    expect(JSON.parse(String(init.body))).toEqual({
      component_id: "c1",
      action: "confirm_yield",
    });
  });

  it("not offered when the yield is already measured or the editor is read-only", async () => {
    reported = prepState(
      {},
      { yield: { value: 6.5, unit: "kg", confirmed: true, source: null } }
    );
    vi.stubGlobal("fetch", vi.fn());
    const a = mountDetail();
    await screen.findByText("EDITOR");
    await waitFor(() =>
      expect(screen.queryByTestId("confirm-one-unit")).toBeNull()
    );
    a.unmount();

    reported = prepState({ editable: false, role_read_only: true });
    mountDetail();
    await screen.findByText("EDITOR");
    expect(screen.queryByTestId("confirm-one-unit")).toBeNull();
  });

  it("after confirming: «Deshacer confirmación» and the history with who and when", async () => {
    reported = prepState(
      {},
      {
        yield: {
          value: 1,
          unit: "unit",
          confirmed: true,
          source: "confirmed_default",
        },
        yield_missing: false,
        yield_confirmed_default: true,
        yield_history: [
          {
            at: "2026-11-03T10:00:00Z",
            by_name: "Ana Demo",
            action: "confirm",
            value: 1,
            unit: "unit",
          },
        ],
      }
    );
    vi.stubGlobal("fetch", vi.fn());
    mountDetail();
    expect(await screen.findByTestId("undo-confirm-one-unit")).toBeTruthy();
    expect(screen.queryByTestId("confirm-one-unit")).toBeNull();
    const h = screen.getByTestId("yield-history");
    expect(h.textContent).toContain("Ana Demo confirmó 1 unidad");
  });

  it("a cook (money hidden) sees no cost line in the detail", async () => {
    reported = prepState(
      { money_hidden: true, editable: false, role_read_only: true },
      { cost_per_output_unit: null }
    );
    vi.stubGlobal("fetch", vi.fn());
    mountDetail();
    await screen.findByText("EDITOR");
    expect(document.body.textContent).not.toMatch(/\$|Costo por|cuesta/i);
  });
});

describe("the editor table for a cook", () => {
  it("shows ingredient, quantity and unit; no price or contribution column", async () => {
    clearEditors();
    const state = {
      editable: false,
      role_read_only: true,
      money_hidden: true,
      locked_reason: "Tu rol no puede editar recetas.",
      version_id: "v1",
      options: [],
      pending: 0,
      total_cost: null,
      lines: [
        {
          key: "l1",
          input_id: "l1",
          kind: "ingredient",
          ingredient_id: "i1",
          component_id: null,
          name: "Tomate demo",
          raw_name: "Tomate demo",
          source_row: null,
          qty: 16,
          unit: "oz",
          unit_cost: null,
          amount: null,
          price: null,
          pending: false,
          flags: [],
          reasons: [],
          possible_match: null,
          evidence_index: null,
          unit_question: null,
          excel_unit_cost: null,
          legacy_price: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => state }))
    );
    // The real editor, not the mock above.
    const { RecipeLinesEditor } = await vi.importActual<
      typeof import("@/components/restaurant/recipes-costing/RecipeLinesEditor")
    >("@/components/restaurant/recipes-costing/RecipeLinesEditor");
    render(
      <RecipeLinesEditor
        odooProductId={55}
        locationId={null}
        portionCostLabel={null}
        onEdited={() => {}}
      />
    );
    await screen.findByText("Tomate demo");
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads.some((t) => /precio/i.test(t ?? ""))).toBe(false);
    expect(heads.some((t) => /aporte/i.test(t ?? ""))).toBe(false);
    expect(screen.queryByText("Agregar ingrediente")).toBeNull();
    expect(screen.queryByTestId("dish-total-row")).toBeNull();
    expect(screen.getByText("Tu rol no puede editar recetas.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$/);
  });
});
