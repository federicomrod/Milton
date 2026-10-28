// R1-15k: the «Posibles duplicados» banner (presentation). Synthetic.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DuplicatesBanner } from "@/components/restaurant/menu/IngredientDuplicates";

const cand = (
  id: string,
  name: string,
  price: number | null,
  date: string | null,
  recipes: number
) => ({
  id,
  name,
  price,
  priceUnit: "oz",
  priceDate: date,
  priceSourced: price !== null,
  priceEntryId: price !== null ? `e${id}` : null,
  recipeCount: recipes,
  lineCount: recipes,
});
const q = (over: Record<string, unknown> = {}): any => ({
  available: true,
  queue: [
    {
      key: "1,2,3",
      ids: ["1", "2", "3"],
      score: 0.9,
      source: "name",
      storedId: null,
      skipped: false,
      skippedAt: null,
    },
    {
      key: "4,5",
      ids: ["4", "5"],
      score: 0.8,
      source: "name",
      storedId: null,
      skipped: false,
      skippedAt: null,
    },
  ],
  index: 0,
  current: {
    key: "1,2,3",
    ids: ["1", "2", "3"],
    score: 0.9,
    source: "name",
    storedId: null,
    skipped: false,
    skippedAt: null,
  },
  candidates: [
    cand("1", "ACEITE DE OLIVA", 0.42, "2026-10-12", 4),
    cand("2", "ACEITE DE OIVA", 0.38, "2026-09-02", 2),
    cand("3", "ACEITE OLIVIA", null, null, 1),
  ],
  survivorId: "1",
  plan: {
    survivorId: "1",
    loserIds: ["2", "3"],
    linesReassigned: 3,
    priceOptions: [
      { entryId: "e1", price: 0.42, unit: "oz", from: "ACEITE DE OLIVA" },
      { entryId: "e2", price: 0.38, unit: "oz", from: "ACEITE DE OIVA" },
    ],
    priceConflict: true,
    defaultEntryId: "e1",
  },
  chosenEntry: "e1",
  flagged: new Set(["1", "2", "3"]),
  merges: [],
  toast: null,
  busy: false,
  canAskAi: true,
  dismissToast() {},
  move() {},
  jumpTo() {},
  setSurvivor() {},
  setEntry() {},
  decide: async () => {},
  merge: async () => {},
  undo: async () => {},
  askAi: async () => {},
  ...over,
});
const draw = (qq: any, canEdit = true) =>
  renderToString(
    createElement(DuplicatesBanner, {
      q: qq,
      canEdit,
      money: (n: number, u: string | null) => `$${n}/${u}`,
    })
  ).replace(/<!-- -->/g, "");

describe("DuplicatesBanner", () => {
  it("shows the queue position, the three cards, who stays and what the merge does", () => {
    const html = draw(q());
    expect(html).toContain("Posibles duplicados · 2 grupos");
    expect(html).toContain("1 de 2");
    expect(html).toContain("ACEITE DE OLIVA");
    expect(html).toContain("Se conserva");
    expect(html).toContain("Sin precio");
    expect(html).toContain("3 líneas de receta se reasignan");
    expect(html).toContain("los nombres quedan como alias");
  });
  it("a price conflict is a picker, not an average; no conflict, no picker", () => {
    expect(draw(q())).toContain("Precio que se conserva");
    expect(
      draw(q({ plan: { ...q().plan, priceConflict: false } }))
    ).not.toContain("Precio que se conserva");
  });
  it("the three actions are there", () => {
    const html = draw(q());
    for (const label of ["Unir", "No son iguales", "Ahora no"])
      expect(html).toContain(label);
  });
  it("before 051 it says it is not available and disables the actions", () => {
    const html = draw(q({ available: false }));
    expect(html).toContain("Esto aún no está disponible en tu cuenta.");
    expect(html).toMatch(/disabled=""[^>]*>\s*Unir/);
  });
  it("shows nothing at all when there is nothing to show", () => {
    expect(
      draw(
        q({
          queue: [],
          current: null,
          plan: null,
          candidates: [],
          canAskAi: false,
        })
      )
    ).toBe("");
  });
  it("the merge history offers Deshacer only for merges not yet undone, and a toast offers it right after a merge", () => {
    const html = draw(
      q({
        toast: { message: "Unido en X", undoMergeId: "m1" },
        merges: [
          {
            id: "m1",
            survivorId: "1",
            survivorName: "X",
            loserNames: ["Y"],
            createdAt: "2026-10-15T10:00:00Z",
            undone: false,
          },
          {
            id: "m0",
            survivorId: "1",
            survivorName: "Z",
            loserNames: ["W"],
            createdAt: "2026-10-14T10:00:00Z",
            undone: true,
          },
        ],
      })
    );
    expect(html).toContain("Unido en X");
    expect(html).toContain("Deshacer");
    expect(html).toContain("Historial de uniones (1)");
  });
});
