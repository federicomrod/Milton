// @vitest-environment jsdom
// The note about unresolved price choices shows near the open choices and near
// «2. Importar recetas», and only while there are unresolved choices.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PriceCatalogPanel } from "@/components/restaurant/recipes-costing/PriceCatalogPanel";
import { RecipeImportPreview } from "@/components/restaurant/recipes-costing/RecipeImportPreview";
import { PENDING_PRICE_CHOICES_NOTE } from "@/components/restaurant/recipes-costing/pending-price-note";

const openConflict = {
  id: "c1",
  name: "Ingrediente de prueba",
  catalog: { unitCost: 2, unit: "kg" },
  candidates: [{ unitCost: 3, unit: "kg", recipes: 1 }],
};

function stubFetch(conflicts: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes("/recipes/import")
          ? {
              rows: [],
              dishes: 2,
              matching: 0,
              preparations: 0,
              ingredients_new: 0,
              ingredients_reused: 0,
              linked: 0,
              skipped: 0,
            }
          : { draft: null, open: [], conflicts },
    }))
  );
}

const base = {
  draftToken: "t",
  initialImported: null,
  locationId: null,
  busyExternal: false,
  onImported: () => {},
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pending price choices note", () => {
  it("renders near the open choices when there are some", async () => {
    stubFetch([openConflict]);
    render(<PriceCatalogPanel embedded />);
    await screen.findByText(/Costos por decidir \(1\)/);
    expect(screen.getByText(PENDING_PRICE_CHOICES_NOTE)).toBeTruthy();
  });

  it("does not render when there are no open choices", async () => {
    stubFetch([]);
    render(<PriceCatalogPanel embedded />);
    await screen.findByRole("button", { name: /Elegir archivo de costos/ });
    expect(screen.queryByText(PENDING_PRICE_CHOICES_NOTE)).toBeNull();
  });

  it("renders near the import button only with pending choices", async () => {
    stubFetch([]);
    const { rerender } = render(
      <RecipeImportPreview {...base} hasPendingPriceChoices />
    );
    const button = await screen.findByRole("button", {
      name: /2\. Importar recetas/,
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(PENDING_PRICE_CHOICES_NOTE)).toBeTruthy();
    rerender(<RecipeImportPreview {...base} hasPendingPriceChoices={false} />);
    expect(screen.queryByText(PENDING_PRICE_CHOICES_NOTE)).toBeNull();
  });
});
