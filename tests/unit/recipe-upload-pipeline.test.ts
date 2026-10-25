// «Sube tus recetas»: file → validated recipes → drafts. No network: the model
// is a fake. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";
import {
  buildPdf,
  buildRecipeWorkbook,
} from "./helpers/recipe-upload-fixtures";
import {
  FILE_TOO_BIG_MESSAGE,
  MAX_UPLOAD_BYTES,
  detectUploadKind,
  processRecipeFile,
} from "@/lib/restaurant/recipe-upload/process";
import { persistRecipes } from "@/lib/restaurant/recipe-upload/persist";
import { validateUploadResponse } from "@/lib/restaurant/recipe-upload/validate";
import {
  findApprovedDuplicate,
  loadApprovedDishes,
} from "@/lib/restaurant/recipe-upload/duplicates";
import { isPreparationName } from "@/lib/restaurant/recipe-upload/marker";
import type { RecipeChunk } from "@/lib/restaurant/recipe-upload/chunks";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
  resolveWriteCurrency: (a: string | undefined, b: string) => a ?? b,
}));
const mammothMock = vi.hoisted(() => ({ text: "" }));
vi.mock("mammoth", () => ({
  extractRawText: async () => ({ value: mammothMock.text }),
}));

const COMPANY = "co-1";
const LOCATION = "11111111-2222-3333-4444-555555555555";

function trackedDb(store: FakeStore, opts?: Parameters<typeof makeFakeDb>[1]) {
  const db = makeFakeDb(store, opts);
  const writes: Array<{ table: string; mode: string }> = [];
  const wrapped = {
    from(table: string) {
      const q = db.from(table) as Record<string, unknown>;
      for (const mode of ["insert", "update", "delete", "upsert"]) {
        const orig = q[mode] as (...a: unknown[]) => unknown;
        q[mode] = (...a: unknown[]) => {
          writes.push({ table, mode });
          return orig(...a);
        };
      }
      return q;
    },
  };
  return { admin: wrapped as unknown as SupabaseClient, writes };
}

function baseStore(): FakeStore {
  return {
    ingredients: [
      {
        id: "i-pollo",
        company_id: COMPANY,
        name: "Pollo",
        default_unit: "lb",
        archived_at: null,
      },
      {
        id: "i-cebolla",
        company_id: COMPANY,
        name: "Cebolla",
        default_unit: "unit",
        archived_at: null,
      },
    ],
    ingredient_cost_entries: [],
    ingredient_aliases: [],
    kitchen_staff: [],
    kitchen_recipe_drafts: [],
    kitchen_recipe_draft_lines: [],
    menu_items: [],
    recipe_versions: [],
    prepared_components: [],
    component_recipe_versions: [],
  };
}

const ing = (
  name: string,
  q: number | null,
  unit: string | null,
  confidence = "high"
) => ({ name, estimated_quantity: q, unit, confidence });

/** The fake model for the multi-tab workbook. */
async function workbookAi(chunk: RecipeChunk): Promise<unknown> {
  const t = chunk.text ?? "";
  if (t.startsWith("Hoja: Platos fuertes")) {
    return {
      recipes: [
        {
          dish_name: "Pollo encebollado",
          kind: "plato",
          portions: 6,
          yield_text: null,
          ingredients: [
            ing("Pollo", 3, "lb"),
            ing("Cebolla", 2, "unidad"),
            ing("Sal", null, null, "low"),
          ],
          overall_confidence: "high",
        },
        {
          dish_name: "Carne guisada",
          kind: "plato",
          portions: 8,
          yield_text: null,
          ingredients: [
            ing("Carne de res", 4, "lb"),
            ing("Achiote", 2, "cucharada"),
            ing("Tiempo: 1 h 30 min", null, null, "low"),
            ing(
              "* el achiote se puede cambiar por pimentón",
              null,
              null,
              "low"
            ),
          ],
          overall_confidence: "high",
        },
        {
          dish_name: "Pescado frito entero",
          kind: "plato",
          portions: 4,
          yield_text: "4 platos (1 pescado por plato)",
          ingredients: [
            ing("Pescado entero", 4, "unidad"),
            ing("Limón", 2, "unidad"),
          ],
          overall_confidence: "high",
        },
      ],
      ignored: [],
    };
  }
  if (t.startsWith("Hoja: Arroz con pollo")) {
    return {
      recipes: [
        {
          dish_name: "Arroz con pollo",
          kind: "plato",
          portions: 10,
          yield_text: null,
          ingredients: [ing("Arroz", 5, "lb"), ing("Pollo", 4, "lb")],
          overall_confidence: "high",
        },
      ],
      ignored: [],
    };
  }
  if (t.startsWith("Hoja: Salsas")) {
    return {
      recipes: [
        {
          dish_name: "Salsa roja",
          kind: "preparacion",
          portions: null,
          yield_text: "1 litro",
          ingredients: [ing("Tomate", 3, "lb"), ing("Chile", 4, "unidad")],
          overall_confidence: "high",
        },
        {
          dish_name: "Chimol",
          kind: "preparacion",
          portions: null,
          yield_text: "2 tazas",
          ingredients: [
            ing("Tomate", 2, "unidad"),
            ing("Cebolla", 1, "unidad"),
          ],
          overall_confidence: "high",
        },
      ],
      ignored: [],
    };
  }
  return {
    recipes: [],
    ignored: [
      {
        name: "Proveedores",
        reason: "no parece una receta: lista de proveedores",
      },
    ],
  };
}

const run = (
  admin: SupabaseClient,
  over: Partial<Parameters<typeof processRecipeFile>[0]> = {}
) =>
  processRecipeFile({
    admin,
    companyId: COMPANY,
    locationId: LOCATION,
    fileName: "recetas.xlsx",
    mime: "",
    buffer: buildRecipeWorkbook(),
    ai: workbookAi,
    ...over,
  });

describe("workbook → drafts", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = baseStore();
  });

  it("creates 6 drafts (4 platos + 2 preparaciones), ignores Proveedores", async () => {
    const { admin, writes } = trackedDb(store);
    const res = await run(admin);
    expect(res.errors).toEqual([]);
    expect(res.file).toBe("recetas.xlsx");
    expect(res.recipes_found).toBe(6);
    expect(res.drafts_created).toBe(6);
    expect(res.preparations.map((p) => p.dish_name)).toEqual([
      "Salsa roja",
      "Chimol",
    ]);
    expect(res.ignored_sections).toEqual([
      {
        name: "Proveedores",
        reason: "no parece una receta: lista de proveedores",
      },
    ]);

    const drafts = store.kitchen_recipe_drafts;
    expect(drafts).toHaveLength(6);
    expect(
      drafts.filter((d) => isPreparationName(d.dish_name as string))
    ).toHaveLength(2);
    expect(
      drafts.every(
        (d) => d.company_id === COMPANY && d.location_id === LOCATION
      )
    ).toBe(true);
    expect(drafts.every((d) => d.telegram_chat_id === 0)).toBe(true);
    const ids = drafts.map((d) => d.telegram_message_id as number);
    expect(ids.every((n) => n < 0)).toBe(true);
    expect(new Set(ids).size).toBe(6);
    // portions: written → draft; not written → awaiting_portions
    const byName = (n: string) => drafts.find((d) => d.dish_name === n)!;
    expect(byName("Pollo encebollado")).toMatchObject({
      portions: 6,
      status: "draft",
    });
    expect(byName("Salsa roja · preparación")).toMatchObject({
      portions: null,
      status: "awaiting_portions",
    });
    expect(byName("Arroz con pollo")).toMatchObject({ portions: 10 });

    // Sal stays without quantity; no line for Tiempo or the footnote
    const lines = store.kitchen_recipe_draft_lines;
    const sal = lines.find((l) => l.raw_name === "Sal")!;
    expect(sal.total_quantity).toBeNull();
    expect(
      lines.some(
        (l) =>
          /tiempo|achiote se puede/i.test(String(l.raw_name)) &&
          l.raw_name !== "Achiote"
      )
    ).toBe(false);
    expect(res.lines_without_quantity).toBe(1);
    // Known ingredients matched, unknown ones not
    expect(lines.find((l) => l.raw_name === "Pollo")!.ingredient_id).toBe(
      "i-pollo"
    );

    // Only drafts, lines and the author row are written
    const tables = new Set(writes.map((w) => w.table));
    expect([...tables].sort()).toEqual([
      "kitchen_recipe_draft_lines",
      "kitchen_recipe_drafts",
      "kitchen_staff",
    ]);
  });

  it("an approved dish uploaded again: draft pointed at it, nothing existing edited", async () => {
    store.menu_items.push({
      id: "m-arroz",
      company_id: COMPANY,
      name: "Arroz con Pollo",
    });
    store.recipe_versions.push({
      menu_item_id: "m-arroz",
      company_id: COMPANY,
      status: "approved",
    });
    store.prepared_components.push({
      id: "c-chimol",
      company_id: COMPANY,
      name: "chimol",
    });
    store.component_recipe_versions.push({
      component_id: "c-chimol",
      company_id: COMPANY,
      status: "approved",
    });
    const { admin, writes } = trackedDb(store);
    const res = await run(admin, {
      ai: async (chunk) => {
        const raw = (await workbookAi(chunk)) as {
          recipes: Array<{ dish_name: string }>;
        };
        raw.recipes.forEach((r) => {
          if (r.dish_name === "Arroz con pollo")
            r.dish_name = "arroz con pollo";
        });
        return raw;
      },
    });
    expect(res.drafts_created).toBe(6);
    expect(res.duplicates.map((d) => d.dish_name).sort()).toEqual([
      "Chimol",
      "arroz con pollo",
    ]);
    const arroz = store.kitchen_recipe_drafts.find(
      (d) => d.dish_name === "arroz con pollo"
    )!;
    expect(arroz.menu_item_id).toBe("m-arroz");
    const chimol = store.kitchen_recipe_drafts.find(
      (d) => d.dish_name === "Chimol · preparación"
    )!;
    expect(chimol.menu_item_id ?? null).toBeNull();

    const forbidden = [
      "recipes",
      "recipe_versions",
      "menu_items",
      "menu_recipe_inputs",
      "ingredient_cost_entries",
      "prepared_components",
      "component_recipe_versions",
    ];
    expect(writes.filter((w) => forbidden.includes(w.table))).toEqual([]);
    expect(store.recipe_versions).toHaveLength(1);
    expect(store.menu_items).toHaveLength(1);
  });

  it("retries a message-id collision (23505) instead of losing the draft", async () => {
    let first = true;
    const { admin } = trackedDb(store, {
      fail: (table, mode) => {
        if (table === "kitchen_recipe_drafts" && mode === "insert" && first) {
          first = false;
          return { code: "23505", message: "duplicate" };
        }
        return false;
      },
    });
    const res = await run(admin);
    expect(res.drafts_created).toBe(6);
    expect(res.errors).toEqual([]);
  });

  it("company and location come from the caller", async () => {
    const { admin } = trackedDb(store);
    await run(admin, {
      companyId: "co-9",
      locationId: "99999999-0000-0000-0000-000000000000",
    });
    expect(
      store.kitchen_recipe_drafts.every(
        (d) =>
          d.company_id === "co-9" &&
          d.location_id === "99999999-0000-0000-0000-000000000000"
      )
    ).toBe(true);
    expect(store.kitchen_staff[0]).toMatchObject({
      company_id: "co-9",
      location_id: "99999999-0000-0000-0000-000000000000",
    });
  });

  it("returns Spanish errors and no drafts when the model fails", async () => {
    const { admin } = trackedDb(store);
    const res = await run(admin, {
      ai: async () => {
        throw new Error("boom");
      },
    });
    expect(res.drafts_created).toBe(0);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(store.kitchen_recipe_drafts).toHaveLength(0);
  });
});

describe("other file kinds", () => {
  it("docx: Sopa de res and Pasteles de carne", async () => {
    mammothMock.text = [
      "Sopa de res (Porciones: 8)",
      "1/2 lb de carne",
      "1/4 cucharada de sal",
      "1 cucharadita de pimienta",
      "1 manojo de cilantro",
      "2 litros de agua",
      "2 zanahorias",
      "",
      "",
      "",
      "Pasteles de carne",
      "Rinde: 20 pasteles (porción = 3 unidades)",
      "1 lb de masa",
    ].join("\n");
    const store = baseStore();
    const { admin } = trackedDb(store);
    const res = await processRecipeFile({
      admin,
      companyId: COMPANY,
      locationId: LOCATION,
      fileName: "libro.docx",
      mime: "",
      buffer: Buffer.from("x"),
      ai: async () => ({
        recipes: [
          {
            dish_name: "Sopa de res",
            kind: "plato",
            portions: 8,
            yield_text: null,
            ingredients: [
              ing("Carne", "1/2" as unknown as number, "lb"),
              ing("Sal", 0.25, "cucharada"),
              ing("Pimienta", 1, "cucharadita"),
              ing("Cilantro", 1, "manojo"),
              ing("Agua", 2, "litros"),
              ing("Zanahorias", 2, null),
            ],
            overall_confidence: "high",
          },
          {
            dish_name: "Pasteles de carne",
            kind: "plato",
            portions: 20,
            yield_text: "20 pasteles (porción = 3 unidades)",
            ingredients: [ing("Masa", 1, "lb")],
            overall_confidence: "high",
          },
        ],
        ignored: [],
      }),
    });
    expect(res.drafts_created).toBe(2);
    const lines = store.kitchen_recipe_draft_lines;
    expect(lines.find((l) => l.raw_name === "Carne")!.total_quantity).toBe(0.5);
    expect(lines.find((l) => l.raw_name === "Zanahorias")).toMatchObject({
      total_quantity: 2,
      unit: "unidad",
    });
    expect(lines.find((l) => l.raw_name === "Sal")!.total_quantity).toBe(0.25);
  });

  it("text PDF: two pages, two drafts, no pdf_file", async () => {
    const buffer = buildPdf([
      [
        "Yuca frita con chicharron",
        "Porciones: 4",
        "Yuca 3 lb",
        "Chicharron 1 lb",
      ],
      ["Panes con pollo", "Rinde: 12 panes", "Pan 12 unidad", "Pollo 2 lb"],
    ]);
    const kinds: string[] = [];
    const store = baseStore();
    const { admin } = trackedDb(store);
    const res = await processRecipeFile({
      admin,
      companyId: COMPANY,
      locationId: LOCATION,
      fileName: "r.pdf",
      mime: "application/pdf",
      buffer,
      ai: async (chunk) => {
        kinds.push(chunk.kind);
        const yuca = chunk.text!.includes("Yuca frita");
        return {
          recipes: [
            {
              dish_name: yuca ? "Yuca frita con chicharrón" : "Panes con pollo",
              kind: "plato",
              portions: yuca ? 4 : 12,
              yield_text: null,
              ingredients: yuca
                ? [ing("Yuca", 3, "lb"), ing("Chicharrón", 1, "lb")]
                : [ing("Pan", 12, "unidad"), ing("Pollo", 2, "lb")],
              overall_confidence: "high",
            },
          ],
          ignored: [],
        };
      },
    });
    expect(kinds).toEqual(["text", "text"]);
    expect(res.drafts_created).toBe(2);
    expect(
      store.kitchen_recipe_drafts
        .map((d) => d.portions as number)
        .sort((a, b) => a - b)
    ).toEqual([4, 12]);
  });

  it("scanned PDF is sent once as a pdf_file", async () => {
    const buffer = buildPdf([
      ["Hola mundo con suficiente texto para contar aqui"],
      [],
    ]);
    const seen: string[] = [];
    const { admin } = trackedDb(baseStore());
    await processRecipeFile({
      admin,
      companyId: COMPANY,
      locationId: LOCATION,
      fileName: "r.pdf",
      mime: "",
      buffer,
      ai: async (chunk) => {
        seen.push(chunk.kind);
        return { recipes: [], ignored: [] };
      },
    });
    expect(seen).toEqual(["pdf_file"]);
  });

  it("image: Pupusas revueltas, pinch of salt and (opcional) kept", async () => {
    const store = baseStore();
    const { admin } = trackedDb(store);
    const res = await processRecipeFile({
      admin,
      companyId: COMPANY,
      locationId: LOCATION,
      fileName: "foto.jpg",
      mime: "image/jpeg",
      buffer: Buffer.from([255, 216, 255]),
      ai: async (chunk) => {
        expect(chunk.kind).toBe("image");
        return {
          recipes: [
            {
              dish_name: "Pupusas revueltas",
              kind: "plato",
              portions: 10,
              yield_text: "10 unidades",
              ingredients: [
                ing("Masa", 2, "lb"),
                ing("sal", null, "pizca", "low"),
                ing("loroco (opcional)", 50, "g"),
              ],
              overall_confidence: "medium",
            },
          ],
          ignored: [],
        };
      },
    });
    expect(res.drafts_created).toBe(1);
    expect(store.kitchen_recipe_drafts[0]).toMatchObject({
      portions: 10,
      status: "draft",
    });
    const lines = store.kitchen_recipe_draft_lines;
    expect(lines.find((l) => l.raw_name === "sal")!.total_quantity).toBeNull();
    expect(lines.some((l) => l.raw_name === "loroco (opcional)")).toBe(true);
  });
});

describe("validateUploadResponse", () => {
  const text = "Sopa\nSal,1/2,cucharada\nAgua,2,litros\nPorciones: 6";
  it("nulls a quantity that is not written in the text", () => {
    const out = validateUploadResponse(
      {
        recipes: [
          {
            dish_name: "Sopa",
            kind: "plato",
            portions: 6,
            yield_text: null,
            ingredients: [
              ing("Sal", 0.5, "cucharada"),
              ing("Agua", 2, "litros"),
              ing("Pimienta", 37, "g"),
            ],
            overall_confidence: "high",
          },
        ],
      },
      text
    );
    const lines = out.recipes[0].ingredients;
    expect(lines.find((l) => l.name === "Sal")!.estimated_quantity).toBe(0.5);
    expect(lines.find((l) => l.name === "Agua")!.estimated_quantity).toBe(2);
    const pimienta = lines.find((l) => l.name === "Pimienta")!;
    expect(pimienta.estimated_quantity).toBeNull();
    expect(pimienta.confidence).toBe("low");
  });

  it("does not apply the guard to images, and nulls invented portions on text", () => {
    const raw = {
      recipes: [
        {
          dish_name: "X",
          portions: 99,
          ingredients: [ing("A", 37, "g")],
          overall_confidence: "high",
        },
      ],
    };
    expect(
      validateUploadResponse(raw, null).recipes[0].ingredients[0]
        .estimated_quantity
    ).toBe(37);
    expect(validateUploadResponse(raw, null).recipes[0].portions).toBe(99);
    const onText = validateUploadResponse(raw, "X\nA 5 g").recipes[0];
    expect(onText.portions).toBeNull();
  });

  it("drops non-ingredient lines and recipes without lines", () => {
    const out = validateUploadResponse(
      {
        recipes: [
          {
            dish_name: "Vacía",
            ingredients: [
              ing("Porciones: 6", null, null),
              ing("Costo total", 5, "g"),
            ],
            overall_confidence: "high",
          },
        ],
      },
      "Porciones: 6 Costo total 5"
    );
    expect(out.recipes).toEqual([]);
    expect(out.ignored).toEqual([
      { name: "Vacía", reason: "no encontré ingredientes" },
    ]);
  });

  it("garbage in, nothing out", () => {
    expect(validateUploadResponse(null, "x")).toEqual({
      recipes: [],
      ignored: [],
    });
    expect(validateUploadResponse("hola", "x")).toEqual({
      recipes: [],
      ignored: [],
    });
  });
});

describe("duplicates", () => {
  it("folds accents, case, spaces and the preparation marker", () => {
    const approved = [{ menu_item_id: "m1", name: "Pollo  Encebollado" }];
    expect(
      findApprovedDuplicate("pollo encebollado · preparación", approved)
    ).toEqual(approved[0]);
    expect(findApprovedDuplicate("Pollo asado", approved)).toBeNull();
    expect(
      findApprovedDuplicate("Árroz", [{ menu_item_id: "m", name: "arroz" }])
    ).not.toBeNull();
  });

  it("loadApprovedDishes only counts approved versions of this company", async () => {
    const store = baseStore();
    store.menu_items.push(
      { id: "a", company_id: COMPANY, name: "Aprobado" },
      { id: "b", company_id: COMPANY, name: "En revisión" },
      { id: "c", company_id: "other", name: "Ajeno" }
    );
    store.recipe_versions.push(
      { menu_item_id: "a", company_id: COMPANY, status: "approved" },
      { menu_item_id: "b", company_id: COMPANY, status: "in_review" },
      { menu_item_id: "c", company_id: "other", status: "approved" }
    );
    const { admin } = trackedDb(store);
    expect(await loadApprovedDishes(admin, COMPANY)).toEqual([
      { menu_item_id: "a", name: "Aprobado" },
    ]);
  });
});

describe("detectUploadKind", () => {
  it.each([
    ["a.xlsx", "", "xlsx"],
    ["a.XLS", "application/vnd.ms-excel", "xlsx"],
    ["a.csv", "text/csv", "csv"],
    ["a.docx", "", "docx"],
    ["a.pdf", "application/pdf", "pdf"],
    ["a.png", "image/png", "image"],
    ["a.jpg", "", "image"],
    ["a.jpeg", "image/jpeg", "image"],
    ["a.webp", "image/webp", "image"],
  ])("%s → %s", (name, mime, kind) => {
    expect(detectUploadKind(name, mime)).toEqual({ ok: true, kind });
  });

  it("old .doc and unknown types give the exact Spanish errors", () => {
    expect(detectUploadKind("a.doc", "application/msword")).toEqual({
      ok: false,
      error: "Guarda el archivo como .docx y vuelve a subirlo.",
    });
    expect(detectUploadKind("a.exe", "application/x-msdownload")).toEqual({
      ok: false,
      error:
        "Este tipo de archivo no lo leo todavía. Usa Excel, Word, PDF, CSV o una foto.",
    });
    expect(detectUploadKind("a.txt", "text/plain").ok).toBe(false);
  });
});

describe("processRecipeFile never throws", () => {
  it("too big", async () => {
    const { admin } = trackedDb(baseStore());
    const res = await processRecipeFile({
      admin,
      companyId: COMPANY,
      locationId: LOCATION,
      fileName: "a.pdf",
      mime: "application/pdf",
      buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
    });
    expect(res.errors).toEqual([FILE_TOO_BIG_MESSAGE]);
    expect(res.drafts_created).toBe(0);
  });

  it("corrupt pdf / docx / unknown type", async () => {
    const { admin } = trackedDb(baseStore());
    for (const [fileName, buffer] of [
      ["a.pdf", Buffer.from("not a pdf")],
      ["a.docx", Buffer.from("not a docx")],
      ["a.bin", Buffer.from("x")],
    ] as const) {
      const res = await processRecipeFile({
        admin,
        companyId: COMPANY,
        locationId: LOCATION,
        fileName,
        mime: "",
        buffer,
        ai: async () => ({ recipes: [], ignored: [] }),
      });
      expect(res.file).toBe(fileName);
      expect(res.drafts_created).toBe(0);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors.every((e) => /[a-záéíóú]/i.test(e))).toBe(true);
    }
  });
});

describe("volume words are kept as written", () => {
  it("«2 tazas leche» stores unit tazas / quantity 2; an unmapped non-volume word stores null", async () => {
    const store = baseStore();
    const { admin } = trackedDb(store);
    const res = await persistRecipes({
      admin,
      companyId: COMPANY,
      locationId: LOCATION,
      recipes: [
        {
          dish_name: "Atol",
          kind: "plato",
          portions: 4,
          yield_text: null,
          ingredients: [
            {
              name: "Leche",
              estimated_quantity: 2,
              unit: "tazas",
              confidence: "high",
            },
            {
              name: "Sal",
              estimated_quantity: 1,
              unit: "pizca",
              confidence: "high",
            },
          ],
          overall_confidence: "high",
        },
      ],
    });
    expect(res.drafts_created).toBe(1);
    const lines = store.kitchen_recipe_draft_lines;
    const leche = lines.find((l) => l.raw_name === "Leche")!;
    expect(leche.unit).toBe("tazas");
    expect(Number(leche.total_quantity)).toBe(2);
    expect(lines.find((l) => l.raw_name === "Sal")!.unit).toBeNull();
  });
});
