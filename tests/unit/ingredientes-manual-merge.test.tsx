// @vitest-environment jsdom
// Menú › Ingredientes: «Unir…» in the selection bar (2+ selected) opens
// «¿Cuál se conserva?», calls the existing merge route, and the merged names
// vanish at once. Unit-family mismatch shows a Spanish message. Archived
// ingredients are not offered in pickers. Made-up data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh, replace() {} }),
  usePathname: () => "/dashboard/restaurant/menu/ingredientes",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  IngredientesScreen,
  type IngredienteItem,
} from "@/components/restaurant/menu/IngredientesScreen";
import {
  clearIngredientOptionsCache,
  loadIngredientOptions,
} from "@/components/restaurant/recipes-costing/ingredient-options";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const ing = (
  id: string,
  name: string,
  over: Partial<IngredienteItem> = {}
): IngredienteItem => ({
  id,
  name,
  category: null,
  default_unit: "l",
  price: 4,
  price_unit: "l",
  price_date: "2026-07-01",
  price_entry_id: `e${id}`,
  recipeCount: 1,
  lineCount: 1,
  previous_price: null,
  source: "lista",
  supplier_id: null,
  supplier_name: null,
  inUse: true,
  archived: false,
  sold_net_sales: 10,
  uses: [],
  ...over,
});
const NO_GROUPS = { available: true, groups: [], members: [] };

let calls: Array<{ url: string; body: Record<string, unknown> | null }>;
let mergeResponse: { status: number; json: unknown };

beforeEach(() => {
  calls = [];
  refresh.mockClear();
  clearIngredientOptionsCache();
  mergeResponse = {
    status: 200,
    json: { ok: true, result: { merge_id: "m1" } },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (String(url).includes("/duplicates/merge"))
        return {
          ok: mergeResponse.status < 400,
          status: mergeResponse.status,
          json: async () => mergeResponse.json,
        };
      return { ok: true, status: 200, json: async () => ({ ingredients: [] }) };
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function screenWith(items: IngredienteItem[]) {
  return render(
    <IngredientesScreen
      items={items}
      suppliers={[]}
      currency="USD"
      initialSelectedId={null}
      initialFilter="todos"
      itemGroups={NO_GROUPS as never}
      archiveAvailable
      duplicates={{
        available: true,
        stored: [],
        notDuplicates: [],
        merges: [],
      }}
    />
  );
}
const select = (name: string) =>
  fireEvent.click(screen.getByLabelText(`Seleccionar ${name}`));
const THREE = () => [
  ing("1", "ACEITE", { price: 4, recipeCount: 3, lineCount: 3 }),
  ing("2", "ACEOTE", { price: 4, price_entry_id: "e2" }),
  ing("3", "ACIETE", {
    price: 5,
    price_entry_id: "e3",
    price_date: "2026-06-01",
  }),
  ing("4", "Sal"),
];

describe("«Unir…» in the selection bar", () => {
  it("appears only with 2 or more selected", () => {
    screenWith(THREE());
    select("ACEITE");
    expect(screen.queryByRole("button", { name: "Unir…" })).toBeNull();
    select("ACEOTE");
    expect(screen.getByRole("button", { name: "Unir…" })).toBeTruthy();
  });

  it("merges 3 selected items into the chosen survivor, with the chosen price, via the existing route", async () => {
    screenWith(THREE());
    for (const n of ["ACEITE", "ACEOTE", "ACIETE"]) select(n);
    fireEvent.click(screen.getByRole("button", { name: "Unir…" }));
    const dialog = screen.getByTestId("manual-merge-dialog");
    expect(within(dialog).getByText("¿Cuál se conserva?")).toBeTruthy();
    // cards: name, price, recipe count
    expect(within(dialog).getByTitle("ACEITE").textContent).toMatch(
      /3 recetas/
    );
    // pre-pick: has a price, newest price, more recipes → ACEITE
    expect(
      within(dialog).getByTitle("ACEITE").getAttribute("aria-pressed")
    ).toBe("true");
    // the person picks ACEOTE instead
    fireEvent.click(within(dialog).getByTitle("ACEOTE"));
    // different prices: pick, never average
    const priceSelect = within(dialog).getByLabelText("Precio que se conserva");
    expect(priceSelect).toBeTruthy();
    fireEvent.change(priceSelect, { target: { value: "e3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unir" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/duplicates/merge"))).toBe(true)
    );
    const merge = calls.find((c) => c.url.includes("/duplicates/merge"))!;
    expect(merge.url).toBe("/api/restaurant/ingredients/duplicates/merge");
    expect(merge.body).toMatchObject({
      survivor_id: "2",
      chosen_cost_entry_id: "e3",
    });
    expect((merge.body!.loser_ids as string[]).sort()).toEqual(["1", "3"]);
    // the merged names vanish right away, the survivor stays, the page re-reads
    await waitFor(() =>
      expect(screen.queryByTestId("manual-merge-dialog")).toBeNull()
    );
    expect(screen.queryByLabelText("Seleccionar ACEITE")).toBeNull();
    expect(screen.queryByLabelText("Seleccionar ACIETE")).toBeNull();
    expect(screen.getByLabelText("Seleccionar ACEOTE")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    // with an undo
    expect(screen.getByText(/Unido en ACEOTE/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeTruthy();
  });

  it("a unit-family mismatch shows the Spanish message and does not call the route", () => {
    screenWith([
      ing("1", "ACEITE", { default_unit: "l", price_unit: "l" }),
      ing("2", "ACEITUNA", { default_unit: "kg", price_unit: "kg" }),
    ]);
    select("ACEITE");
    select("ACEITUNA");
    fireEvent.click(screen.getByRole("button", { name: "Unir…" }));
    const dialog = screen.getByTestId("manual-merge-dialog");
    expect(within(dialog).getByRole("alert").textContent).toMatch(
      /No se pueden unir ingredientes de familias de unidad distintas/
    );
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Unir",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(calls.some((c) => c.url.includes("/duplicates/merge"))).toBe(false);
  });

  it("an error from the database (22023) is shown in the dialog, not swallowed", async () => {
    mergeResponse = {
      status: 400,
      json: { error: "Los ingredientes son de familias de unidad distintas." },
    };
    screenWith(THREE());
    select("ACEITE");
    select("ACEOTE");
    fireEvent.click(screen.getByRole("button", { name: "Unir…" }));
    fireEvent.click(
      within(screen.getByTestId("manual-merge-dialog")).getByRole("button", {
        name: "Unir",
      })
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("familias de unidad distintas");
    // nothing vanished
    expect(screen.getByTestId("manual-merge-dialog")).toBeTruthy();
    expect(screen.getByLabelText("Seleccionar ACEITE")).toBeTruthy();
  });

  it("a merge clears the 60 s ingredient list used by the pickers", async () => {
    await loadIngredientOptions();
    await loadIngredientOptions();
    const before = calls.filter((c) =>
      c.url.includes("/api/restaurant/ingredients?")
    ).length;
    expect(before).toBe(1); // cached
    screenWith(THREE());
    select("ACEITE");
    select("ACEOTE");
    fireEvent.click(screen.getByRole("button", { name: "Unir…" }));
    fireEvent.click(
      within(screen.getByTestId("manual-merge-dialog")).getByRole("button", {
        name: "Unir",
      })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await loadIngredientOptions();
    expect(
      calls.filter((c) => c.url.includes("/api/restaurant/ingredients?")).length
    ).toBe(2);
  });
});

describe("archived ingredients are not offered in pickers", () => {
  it("the Reventa picker asks only for active ingredients", async () => {
    await loadIngredientOptions();
    expect(calls[0].url).toBe("/api/restaurant/ingredients?activos=1");
    expect(
      read("components/restaurant/recipes-costing/TreatmentPanel.tsx")
    ).toContain("loadIngredientOptions");
  });
  it("the list route filters archived_at when asked (and tolerates a missing column)", () => {
    const src = read("app/api/restaurant/ingredients/route.ts");
    expect(src).toContain('"activos") === "1"');
    expect(src).toContain('is("archived_at", null)');
    expect(src).toMatch(/archived_at/);
  });
});
