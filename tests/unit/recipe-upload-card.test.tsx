// @vitest-environment jsdom
// «Sube tus recetas»: the card, the one-at-a-time upload, the summary, the
// image resize and the Menú shortcut. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { RecipeUploadCard } from "@/components/restaurant/kitchen/RecipeUploadCard";
import {
  UploadRecipesLink,
  uploadRecipesHref,
} from "@/components/restaurant/menu/UploadRecipesLink";
import { shrinkImage } from "@/lib/restaurant/recipe-upload-client";

const locations = [{ id: "loc-1", name: "Centro" }];
type Pending = { resolve: (r: unknown) => void; name: string; loc: unknown };
let pending: Pending[] = [];
let sent: string[] = [];

const result = (over: Record<string, unknown> = {}) => ({
  recipes_found: 0,
  drafts_created: 0,
  duplicates: [],
  preparations: [],
  ignored_sections: [],
  lines_without_quantity: 0,
  errors: [],
  ...over,
});
const ok = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

beforeEach(() => {
  pending = [];
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((resolve) => {
          const form = init.body as FormData;
          const f = form.get("file") as File;
          sent.push(f.name);
          pending.push({ resolve, name: f.name, loc: form.get("location_id") });
        })
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pick = (files: File[]) =>
  fireEvent.change(screen.getByTestId("recipe-upload-input"), {
    target: { files },
  });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the card", () => {
  it("shows the title, the sub-line and the button", () => {
    render(<RecipeUploadCard canManage locations={locations} />);
    expect(screen.getByText("Sube tus recetas")).toBeTruthy();
    expect(
      screen.getByText(
        "Excel, Word, PDF o una foto. Milton prepara los borradores y tú los apruebas."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Elegir archivos" })
    ).toBeTruthy();
    const input = screen.getByTestId("recipe-upload-input") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(
      ".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg,.webp"
    );
    expect(screen.queryByLabelText("Local")).toBeNull();
  });

  it("is hidden without the manage-drafts flag", () => {
    const { container } = render(
      <RecipeUploadCard canManage={false} locations={locations} />
    );
    expect(container.textContent).toBe("");
  });

  it("asks for the location only when there is more than one", () => {
    render(
      <RecipeUploadCard
        canManage
        locations={[...locations, { id: "loc-2", name: "Norte" }]}
      />
    );
    expect(screen.getByLabelText("Local")).toBeTruthy();
  });
});

describe("uploading", () => {
  it("sends the files one at a time, a row each, and a failure does not stop the next", async () => {
    const onDone = vi.fn();
    render(
      <RecipeUploadCard canManage locations={locations} onDone={onDone} />
    );
    pick([
      new File(["a"], "uno.xlsx"),
      new File(["b"], "dos.docx"),
      new File(["c"], "tres.pdf"),
    ]);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(sent).toEqual(["uno.xlsx"]);
    expect(pending[0].loc).toBe("loc-1");
    expect(screen.getAllByText("Leyendo…")).toHaveLength(1);

    pending[0].resolve(ok(result({ recipes_found: 6, drafts_created: 6 })));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(sent).toEqual(["uno.xlsx", "dos.docx"]);
    expect(screen.getByText("✓ 6 recetas")).toBeTruthy();

    pending[1].resolve(
      ok({ error: "Este tipo de archivo no se puede leer." }, 415)
    );
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(
      screen.getByText("✗ Este tipo de archivo no se puede leer.")
    ).toBeTruthy();

    pending[2].resolve(ok(result({ recipes_found: 1, drafts_created: 1 })));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.getByText("✓ 1 receta")).toBeTruthy();
    expect(screen.getByTestId("recipe-upload-summary").textContent).toContain(
      "Leí 7 recetas de 3 archivos: 7 borradores para revisar."
    );
  });

  it("a network error is a row error, then the next file goes", async () => {
    render(<RecipeUploadCard canManage locations={locations} />);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.reject(new Error("net"))
    );
    pick([new File(["a"], "uno.xlsx"), new File(["b"], "dos.csv")]);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(
      screen.getByText("✗ No pude leer este archivo. Inténtalo de nuevo.")
    ).toBeTruthy();
    expect(sent).toEqual(["dos.csv"]);
  });

  it("shows the mixed summary lines, and no extra line when zero", async () => {
    render(<RecipeUploadCard canManage locations={locations} />);
    pick([new File(["a"], "uno.xlsx")]);
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(
      ok(
        result({
          recipes_found: 3,
          drafts_created: 3,
          ignored_sections: [{ name: "Proveedores", reason: "x" }],
          preparations: [{ dish_name: "Salsa roja" }, { dish_name: "Chimol" }],
          lines_without_quantity: 1,
        })
      )
    );
    const box = await screen.findByTestId("recipe-upload-summary");
    expect(box.textContent).toContain(
      "1 hoja no parecía receta (Proveedores)."
    );
    expect(box.textContent).toContain(
      "2 son preparaciones (Salsa roja, Chimol)."
    );
    expect(box.textContent).toContain(
      "1 ingrediente sin cantidad: complétalo al revisar."
    );
    expect(box.textContent).not.toContain("ya tienen una receta aprobada");
  });

  it("rejects a non-image over 4 MB in the browser, without a request", async () => {
    render(<RecipeUploadCard canManage locations={locations} />);
    pick([new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.pdf")]);
    await screen.findByText(
      "✗ Este archivo pesa más de 4 MB. Divídelo en partes o sube las páginas como fotos."
    );
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("images are shrunk in the browser", () => {
  it("caps the long side at 1600 px and saves JPEG at 0.82", async () => {
    const drawn: number[] = [];
    let quality = 0;
    let type = "";
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 3000, close: () => {} }))
    );
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag !== "canvas") return realCreate(tag);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (
            _b: unknown,
            _x: number,
            _y: number,
            w: number,
            h: number
          ) => drawn.push(w, h),
        }),
        toBlob: (cb: (b: Blob) => void, t: string, q: number) => {
          type = t;
          quality = q;
          cb(new Blob(["jpeg"], { type: "image/jpeg" }));
        },
      };
      return canvas as unknown as HTMLElement;
    }) as typeof document.createElement);
    const out = await shrinkImage(
      new File(["raw"], "foto.png", { type: "image/png" })
    );
    vi.restoreAllMocks();
    expect(drawn).toEqual([1600, 1200]);
    expect(type).toBe("image/jpeg");
    expect(quality).toBe(0.82);
    expect(out.name).toBe("foto.jpg");
    expect(out.type).toBe("image/jpeg");
  });

  it("falls back to the original file when it cannot be decoded", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("no");
      })
    );
    const file = new File(["raw"], "foto.png", { type: "image/png" });
    expect(await shrinkImage(file)).toBe(file);
  });
});

describe("Menú shortcut", () => {
  it("goes to Cocina › Recetas en borrador", () => {
    expect(uploadRecipesHref("loc-1")).toBe(
      "/dashboard/restaurant/kitchen?tab=drafts&location=loc-1#explorar"
    );
  });
  it("shows with the kitchen.drafts flag", () => {
    render(
      <UploadRecipesLink
        actor={{ can_submit: false, capabilities: { "kitchen.drafts": true } }}
      />
    );
    expect(screen.getByText("Subir recetas")).toBeTruthy();
  });
  it("is hidden when the flag is false, even if can_submit is true", () => {
    render(
      <UploadRecipesLink
        actor={{ can_submit: true, capabilities: { "kitchen.drafts": false } }}
      />
    );
    expect(screen.queryByText("Subir recetas")).toBeNull();
  });
  it("falls back to can_submit without capabilities", () => {
    const { rerender } = render(
      <UploadRecipesLink actor={{ can_submit: true }} />
    );
    expect(screen.getByText("Subir recetas")).toBeTruthy();
    rerender(<UploadRecipesLink actor={{ can_submit: false }} />);
    expect(screen.queryByText("Subir recetas")).toBeNull();
  });
});
