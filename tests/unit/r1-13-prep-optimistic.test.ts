import { describe, expect, it } from "vitest";
import { withPreparationApproved } from "@/lib/restaurant/recipe-costing/preparation-optimistic";
import type { PreparationsOverview } from "@/lib/restaurant/recipe-costing/preparations-server";

const impact = { dishes: 0, net_sales: 0, share_pct: 0 };
const row = (id: string, status: "borrador" | "aprobada" | "sin_receta") => ({
  component_id: id,
  name: `Prep ${id}`,
  status,
  open_note: null,
  yield_to_confirm: false,
  impact,
  impact_label: "",
});
const overview = (): PreparationsOverview => ({
  rows: [row("a", "borrador"), row("b", "borrador"), row("c", "aprobada")],
  drafts: 2,
  approved: 1,
});

describe("Preparaciones: approve is shown at once and undone on error", () => {
  it("marks the row approved and moves the counters", () => {
    const next = withPreparationApproved(overview(), "a", true);
    expect(next.rows.find((r) => r.component_id === "a")?.status).toBe(
      "aprobada"
    );
    expect(next.drafts).toBe(1);
    expect(next.approved).toBe(2);
    // Order and the other rows are untouched.
    expect(next.rows.map((r) => r.component_id)).toEqual(["a", "b", "c"]);
  });

  it("rolls back to a draft with the original counters", () => {
    const done = withPreparationApproved(overview(), "a", true);
    const undone = withPreparationApproved(done, "a", false);
    expect(undone).toEqual(overview());
  });

  it("an unknown id changes nothing", () => {
    expect(withPreparationApproved(overview(), "zzz", true)).toEqual(
      overview()
    );
  });
});
