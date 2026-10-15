// Plato por plato view model: the dish queue in sales order, which dish
// opens first, "Saltar por ahora", and the main button per role.

import { describe, expect, it } from "vitest";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import { primaryAction } from "@/lib/restaurant/recipe-costing/plato";
import {
  buildRecipeCostingWorkspace,
  type RecipeEditorView,
  type WorkspaceVersion,
} from "@/lib/restaurant/recipe-costing/workspace";
import { parseCostingView } from "@/lib/restaurant/recipe-costing/workspace-server";

function product(
  id: number,
  name: string,
  net: number,
  partial: Partial<RankedPosProduct> = {}
): RankedPosProduct {
  const classification = partial.classification ?? "plato_preparado";
  const treatment = partial.treatment ?? classification;
  return {
    odoo_product_id: id,
    odoo_name: name,
    net_sales: net,
    share_of_net_sales: net / 100,
    share_of_food_sales: net / 100,
    units_sold: 10,
    category: null,
    is_combo: false,
    components: [],
    excluded_parts: [],
    classification_label: "",
    suggested_treatment: null,
    in_food_sales: TREATMENT_RULES[treatment].in_food_sales,
    link_state: "sin_vincular",
    link_state_label: "",
    menu_item_id: null,
    counts_toward_coverage: false,
    ...partial,
    classification,
    treatment,
  };
}

const version = (
  menu: string,
  status: "approved" | "in_review",
  notes: string | null = null
): WorkspaceVersion => ({
  id: `v-${menu}`,
  recipe_id: `r-${menu}`,
  menu_item_id: menu,
  version_number: 1,
  status,
  effective_date: null,
  source_type: "import",
  notes,
});

function ws(selected: number | null = null) {
  return buildRecipeCostingWorkspace({
    companyId: "co",
    companyName: null,
    currency: "USD",
    periodLabel: null,
    view: "plato",
    actor: { user_id: "u", role: "owner", is_milton_staff: false },
    products: [
      product(1, "Pollo", 40, {
        link_state: "confirmado",
        menu_item_id: "m1",
      }),
      product(2, "Sopa", 30, { link_state: "sugerido", menu_item_id: "m2" }),
      product(3, "Combo", 15, { is_combo: true, classification: "combo" }),
      product(4, "Flan", 10, { link_state: "sugerido", menu_item_id: "m4" }),
      product(5, "Propina", 3, { classification: "excluido" }),
      product(6, "Taco", 2),
    ],
    links: [],
    versions: [
      version("m1", "approved"),
      version("m2", "in_review"),
      version("m4", "in_review", "Lista para aprobar"),
    ],
    menuItems: [],
    batches: [],
    coveragePct: 0,
    netSales: 97,
    coveredNetSales: 40,
    selectedOdooProductId: selected,
  });
}

describe("Plato por plato queue", () => {
  it("lists only dishes that take a recipe, top sellers first, with their state", () => {
    const w = ws();
    expect(w.plato_queue.map((r) => [r.odoo_name, r.status])).toEqual([
      ["Pollo", "listo"],
      ["Sopa", "borrador"],
      ["Flan", "por_aprobar"],
      ["Taco", "sin_receta"],
    ]);
    expect(w.plato_progress).toMatchObject({ done: 1, total: 4 });
    expect(w.plato_progress.label).toBe("1 de 4 platos aprobados");
  });

  it("opens the first dish still to do and points to the next one", () => {
    const w = ws();
    expect(w.editor?.odoo_product_id).toBe(2);
    expect(w.editor?.next_odoo_product_id).toBe(4);
    expect(w.editor?.review_index).toBe(2);
    expect(w.editor?.review_total).toBe(4);
  });

  it("Saltar por ahora wraps around and never lands on an approved dish", () => {
    const w = ws(6);
    expect(w.editor?.next_odoo_product_id).toBe(2);
  });

  it("the open dish carries the link and the recipe as separate states", () => {
    const w = ws(4);
    expect(w.editor).toMatchObject({
      link_state: "sugerido",
      recipe_status: "por_aprobar",
    });
    const done = ws(1);
    expect(done.editor).toMatchObject({
      link_state: "confirmado",
      recipe_status: "aprobada",
    });
  });

  it("old Vincular and Validar links open Plato por plato", () => {
    expect(parseCostingView("vincular")).toBe("plato");
    expect(parseCostingView("validar")).toBe("plato");
    expect(parseCostingView("plato")).toBe("plato");
    expect(parseCostingView("preparaciones")).toBe("preparaciones");
    expect(parseCostingView(null)).toBe("resumen");
  });
});

describe("main button per role", () => {
  const editor = (over: Partial<RecipeEditorView> = {}) =>
    ({
      link_state: "sugerido",
      recipe_status: "borrador",
      checklist: { ready: true, blockers: [] },
      ...over,
    }) as unknown as RecipeEditorView;
  const actor = (
    role: string,
    can_approve: boolean,
    can_submit = true,
    staff = false
  ) => ({
    user_id: "u",
    role,
    is_milton_staff: staff,
    can_approve,
    can_submit,
    needs_client_confirmation: staff && !["owner", "admin"].includes(role),
  });

  // R1-09b (C7): one primary button, "Aprobar"; the list on the left
  // replaces "siguiente" and "saltar".
  it("owner and admin: Aprobar, only when the checklist passes", () => {
    expect(primaryAction(actor("owner", true), editor(), true)).toMatchObject({
      label: "Aprobar",
      enabled: true,
    });
    const blocked = primaryAction(
      actor("admin", true),
      editor({
        checklist: {
          ready: false,
          blockers: ["Hay líneas pendientes. No dejes ninguna en $0."],
        } as RecipeEditorView["checklist"],
      }),
      true
    );
    expect(blocked).toMatchObject({ enabled: false });
    // What blocks it lives in the button's tooltip (C3).
    expect(blocked?.hint).toMatch(/pendientes/);
  });

  it("Milton staff see Aprobar (the dialog asks how the client confirmed)", () => {
    expect(
      primaryAction(actor("member", true, true, true), editor(), true)?.label
    ).toBe("Aprobar");
  });

  it("manager: Enviar a aprobación; once sent, no button", () => {
    expect(primaryAction(actor("manager", false), editor(), true)?.label).toBe(
      "Enviar a aprobación"
    );
    expect(
      primaryAction(
        actor("manager", false),
        editor({ recipe_status: "por_aprobar" }),
        true
      )
    ).toBeNull();
  });

  it("an approved recipe with a suggested link only asks to confirm the link", () => {
    expect(
      primaryAction(
        actor("owner", true),
        editor({ recipe_status: "aprobada" }),
        true
      )?.label
    ).toBe("Aprobar");
    expect(
      primaryAction(
        actor("owner", true),
        editor({ recipe_status: "aprobada", link_state: "confirmado" }),
        true
      )
    ).toBeNull();
  });

  it("a viewer gets no button", () => {
    expect(
      primaryAction(actor("viewer", false, false), editor(), true)
    ).toBeNull();
  });
});
