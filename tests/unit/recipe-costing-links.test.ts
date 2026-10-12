import { describe, expect, it } from "vitest";
import { unlinkedPosProduct } from "@/lib/restaurant/pos-product-links";
import {
  changeLinkResult,
  confirmLinkResult,
  undoConfirmedLinkResult,
  undoTouchesApprovedOrManual,
} from "@/lib/restaurant/recipe-costing/link-actions";

const boundEvidence = {
  tab: "PLATOS",
  block_name: "Pupusa revuelta",
  lines: [
    {
      raw_name: "Masa",
      qty: 1,
      unit: "porción",
      unit_cost: 0.4,
      pending: false,
    },
  ],
};

const base = unlinkedPosProduct({
  company_id: "co-a",
  odoo_product_id: 1102,
  odoo_name: "Pupusas revueltas",
});

describe("confirm and undo POS links", () => {
  it("records confirmed_by, confirmed_at and confirmed_how", () => {
    const suggested = {
      ...base,
      menu_item_id: "menu-1",
      link_state: "sugerido" as const,
      evidence: boundEvidence,
    };
    const result = confirmLinkResult(suggested, {
      confirmed_by: "user-1",
      confirmed_at: "2026-10-12T18:00:00.000Z",
      confirmed_how: "en_pantalla",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link.link_state).toBe("confirmado");
    expect(result.link.confirmed_by).toBe("user-1");
    expect(result.link.confirmed_at).toBe("2026-10-12T18:00:00.000Z");
    expect(result.link.confirmed_how).toBe("en_pantalla");
    expect(result.link.menu_item_id).toBe("menu-1");
  });

  it("refuses Confirmado without who / when / how", () => {
    const result = confirmLinkResult(base, {
      confirmed_by: "user-1",
      confirmed_at: "2026-10-12T18:00:00.000Z",
      confirmed_how: "",
    });
    expect(result.ok).toBe(false);
  });

  it("undoes a confirmation back to Sugerido and never reports touching Aprobada or manual data", () => {
    const suggested = {
      ...base,
      menu_item_id: "menu-1",
      link_state: "sugerido" as const,
      evidence: boundEvidence,
    };
    const confirmed = confirmLinkResult(suggested, {
      confirmed_by: "user-1",
      confirmed_at: "2026-10-12T18:00:00.000Z",
      confirmed_how: "whatsapp",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    const undone = undoConfirmedLinkResult(confirmed.link);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.link.link_state).toBe("sugerido");
    expect(undone.link.confirmed_by).toBeNull();
    expect(undone.link.confirmed_at).toBeNull();
    expect(undone.link.confirmed_how).toBeNull();
    expect(undone.link.menu_item_id).toBe("menu-1");
    expect(undone.link.evidence.block_name).toBe("Pupusa revuelta");
    expect(Array.isArray(undone.link.evidence.lines)).toBe(true);
    expect(undoTouchesApprovedOrManual({ recipe_status: "in_review" })).toBe(
      false
    );
    expect(undoTouchesApprovedOrManual({ recipe_status: "approved" })).toBe(
      true
    );
    expect(undoTouchesApprovedOrManual({ recipe_source_type: "manual" })).toBe(
      true
    );
    expect(undoTouchesApprovedOrManual({ cost_source_type: "manual" })).toBe(
      true
    );
  });

  it("change link goes back to Sugerido and keeps an undo snapshot", () => {
    const confirmed = confirmLinkResult(
      {
        ...base,
        menu_item_id: "menu-1",
        link_state: "sugerido",
        evidence: boundEvidence,
      },
      {
        confirmed_by: "user-1",
        confirmed_at: "2026-10-12T18:00:00.000Z",
        confirmed_how: "en_pantalla",
      }
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    const changed = changeLinkResult(confirmed.link, {
      menu_item_id: "menu-2",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.link.link_state).toBe("sugerido");
    expect(changed.link.menu_item_id).toBe("menu-2");
    expect(changed.link.confirmed_how).toBeNull();
    const undone = undoConfirmedLinkResult({
      ...changed.link,
      link_state: "confirmado",
      confirmed_by: "user-1",
      confirmed_at: "2026-10-12T19:00:00.000Z",
      confirmed_how: "en_pantalla",
    });
    expect(undone.ok).toBe(true);
  });

  it("refuses to confirm a name-only leftover without recipe lines", () => {
    const result = confirmLinkResult(
      {
        ...base,
        menu_item_id: "menu-1",
        link_state: "sugerido",
        evidence: { block_name: "Parrillada Pinolera (3 personas)" },
      },
      {
        confirmed_by: "user-1",
        confirmed_at: "2026-10-12T18:00:00.000Z",
        confirmed_how: "en_pantalla",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no trae la receta/i);
  });
});
