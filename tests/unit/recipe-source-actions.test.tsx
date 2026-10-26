// @vitest-environment jsdom
// The recipe page shows «Usar la receta de otro plato» and «Copiar receta de…»
// as visible blue buttons, one helper line, and one searchable picker.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  RECIPE_SOURCE_HELP,
  useRecipeSourceActions,
} from "@/components/restaurant/recipes-costing/RecipeSourceActions";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function Harness(props: {
  onUse?: (id: string) => void;
  onCopied?: () => void;
}) {
  const { buttons, helper, panel } = useRecipeSourceActions({
    odooProductId: 7,
    odooName: "Churrasco Típico 6 oz Eventos",
    menuItems: [
      { id: "m-self", name: "Churrasco Típico 6 oz Eventos" },
      { id: "m-1", name: "Churrasco Típico 6 oz" },
      { id: "m-2", name: "Pollo asado" },
    ],
    currentMenuItemId: "m-self",
    onUse: props.onUse ?? (() => undefined),
    onCopied: props.onCopied ?? (() => undefined),
  });
  return (
    <div>
      {buttons}
      {helper}
      {panel}
    </div>
  );
}

function mockFetch(
  handler: (
    url: string,
    init?: RequestInit
  ) => { status: number; body: unknown }
) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const out = handler(url, init);
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      json: async () => out.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RecipeSourceActions", () => {
  it("shows both buttons and the exact helper line", () => {
    render(<Harness />);
    const use = screen.getByRole("button", {
      name: "Usar la receta de otro plato",
    });
    const copy = screen.getByRole("button", { name: "Copiar receta de…" });
    for (const b of [use, copy]) expect(b.className).toContain("border");
    expect(screen.getByTestId("recipe-source-help").textContent).toBe(
      "Usar la receta de otro plato: ambos comparten la misma receta (un cambio afecta a los dos). Copiar receta: crea una copia independiente como borrador para que la ajustes y la apruebes."
    );
    expect(RECIPE_SOURCE_HELP).toContain("copia independiente");
  });

  it("«Usar la receta» searches platos (never itself) and links the pick", () => {
    const onUse = vi.fn();
    render(<Harness onUse={onUse} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Usar la receta de otro plato" })
    );
    expect(screen.queryByRole("option", { name: /Eventos/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar plato"), {
      target: { value: "pollo" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: /Pollo asado/ }));
    expect(onUse).toHaveBeenCalledWith("m-2");
  });

  it("«Copiar receta de…» lists approved first and copies on pick", async () => {
    const onCopied = vi.fn();
    const fetchMock = mockFetch((url, init) =>
      init?.method === "POST"
        ? { status: 200, body: { lines_copied: 3 } }
        : {
            status: 200,
            body: {
              candidates: [
                {
                  menu_item_id: "m-1",
                  name: "Churrasco Típico 6 oz",
                  status: "aprobada",
                  line_count: 3,
                },
                {
                  menu_item_id: "m-2",
                  name: "Pollo asado",
                  status: "borrador",
                  line_count: 2,
                },
              ],
            },
          }
    );
    render(<Harness onCopied={onCopied} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar receta de…" }));
    const first = await screen.findAllByRole("option");
    expect(first[0].textContent).toContain("Churrasco Típico 6 oz");
    expect(first[0].textContent).toContain("Aprobada");
    fireEvent.click(first[0]);
    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({
      odoo_product_id: 7,
      source_menu_item_id: "m-1",
    });
    expect(JSON.parse(String(post[1]!.body)).mode).toBeUndefined();
  });

  it("asks before touching a draft that has lines, then sends the chosen mode", async () => {
    const onCopied = vi.fn();
    const fetchMock = mockFetch((url, init) => {
      if (init?.method !== "POST")
        return {
          status: 200,
          body: {
            candidates: [
              {
                menu_item_id: "m-1",
                name: "Churrasco Típico 6 oz",
                status: "aprobada",
                line_count: 3,
              },
            ],
          },
        };
      const mode = JSON.parse(String(init.body)).mode;
      return mode
        ? { status: 200, body: { lines_copied: 3 } }
        : {
            status: 409,
            body: { needs_mode: true, draft_line_count: 2, error: "x" },
          };
    });
    render(<Harness onCopied={onCopied} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar receta de…" }));
    fireEvent.click((await screen.findAllByRole("option"))[0]);
    const choice = await screen.findByTestId("copy-choice");
    expect(choice.textContent).toContain("ya tiene 2 líneas");
    expect(onCopied).not.toHaveBeenCalled();
    for (const label of [
      "Reemplazar las líneas del borrador",
      "Agregar al final",
      "Cancelar",
    ]) {
      expect(
        screen.getAllByRole("button", { name: label }).length
      ).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByRole("button", { name: "Agregar al final" }));
    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    const posts = fetchMock.mock.calls.filter(([, i]) => i?.method === "POST");
    expect(JSON.parse(String(posts[1][1]!.body)).mode).toBe("append");
  });
});

describe("recipe page wiring", () => {
  it("the editor shows the buttons next to «+ Agregar ingrediente» and PlatoScreen no longer hides it in ⋯", () => {
    const editor = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    const plato = read("components/restaurant/recipes-costing/PlatoScreen.tsx");
    expect(editor).toContain("sourceButtons");
    expect(editor).toContain("sourceHelper");
    expect(plato).toContain("useRecipeSourceActions");
    expect(plato).not.toMatch(
      /<DropdownMenuItem[^>]*>\s*Usar la receta de otro plato/
    );
    // The empty state («Sin receta») offers both actions too.
    expect(plato).toContain("sourceActions.buttons");
  });
});
