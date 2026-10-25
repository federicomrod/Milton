// @vitest-environment jsdom
// «Lee tu menú y estima costos»: one gate (recipes.edit), never hidden.
// Synthetic data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { MenuReaderCard } from "@/components/restaurant/menu/MenuReaderCard";
import { canEditRecipes } from "@/components/restaurant/menu/estimate-overlay";
import { menuReaderHref } from "@/lib/restaurant/menu-links";

const jsonRes = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (over: Partial<Parameters<typeof MenuReaderCard>[0]> = {}) =>
  render(
    <MenuReaderCard
      canEdit
      noRecipeDishes={3}
      locationId={null}
      onDone={() => undefined}
      {...over}
    />
  );

describe("MenuReaderCard", () => {
  it("allowed: title, intro, count, «Leer mi menú» opens the inputs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonRes({ available: true, eligible: 0 }))
    );
    card();
    expect(
      screen.getByRole("heading", { name: "Lee tu menú y estima costos" })
    ).toBeTruthy();
    expect(screen.getByText("3 platos sin receta")).toBeTruthy();
    expect(document.getElementById("leer-menu")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/turestaurante/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leer mi menú" }));
    expect(screen.getByPlaceholderText(/turestaurante/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Leer menú" })).toBeTruthy();
  });

  it("singular count", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonRes({ available: true, eligible: 0 }))
    );
    card({ noRecipeDishes: 1 });
    expect(screen.getByText("1 plato sin receta")).toBeTruthy();
  });

  it("without recipes.edit the card is visible, the button disabled, with the reason", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    card({ canEdit: false });
    expect(
      (
        screen.getByRole("button", {
          name: "Leer mi menú",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByText(/Tu rol no puede editar recetas\./)).toBeTruthy();
    expect(
      screen.getByText(/Pídele a la persona dueña o administradora/)
    ).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });

  it("eligible dishes: the primary «Estimar con Milton» appears", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonRes({ available: true, eligible: 4 }))
    );
    card();
    const b = await screen.findByRole("button", { name: "Estimar con Milton" });
    expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it("every dish has a recipe: slim line with «Leer menú de nuevo»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonRes({ available: true, eligible: 0 }))
    );
    card({ noRecipeDishes: 0 });
    expect(screen.getByText(/Todos tus platos tienen receta/)).toBeTruthy();
    expect(screen.queryByText("Lee tu menú y estima costos")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leer menú de nuevo" }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/turestaurante/)).toBeTruthy()
    );
  });

  it("slim line is disabled with a reason without recipes.edit", () => {
    card({ noRecipeDishes: 0, canEdit: false });
    expect(
      (
        screen.getByRole("button", {
          name: "Leer menú de nuevo",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByText(/Tu rol no puede editar recetas\./)).toBeTruthy();
  });
});

describe("one gate: recipes.edit", () => {
  it("canEditRecipes reads only capabilities[recipes.edit]", () => {
    expect(canEditRecipes({ capabilities: { "recipes.edit": true } })).toBe(
      true
    );
    expect(canEditRecipes({ capabilities: { "recipes.edit": false } })).toBe(
      false
    );
    expect(canEditRecipes({})).toBe(false);
  });

  it("the Costos link targets the card's anchor", () => {
    expect(menuReaderHref()).toBe("/dashboard/restaurant/menu#leer-menu");
  });

  it("no MenuReaderPanel/EstimateWithMilton usage is gated on can_submit", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(n)) files.push(p);
      }
    };
    walk(join(process.cwd(), "components"));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const tag of ["<MenuReaderPanel", "<EstimateWithMilton"]) {
        let i = src.indexOf(tag);
        while (i !== -1) {
          const end = src.indexOf("/>", i);
          expect(src.slice(i, end), `${f} ${tag}`).not.toContain("can_submit");
          i = src.indexOf(tag, i + 1);
        }
      }
    }
    for (const f of [
      "components/restaurant/recipes-costing/MenuReaderPanel.tsx",
      "components/restaurant/menu/EstimateWithMilton.tsx",
      "components/restaurant/menu/MenuReaderCard.tsx",
    ])
      expect(readFileSync(join(process.cwd(), f), "utf8")).not.toContain(
        "can_submit"
      );
  });
});
