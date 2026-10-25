import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  checkMenuUrl,
  isBlockedAddress,
  publicOnlyLookup,
  MenuFetchError,
} from "@/lib/restaurant/menu-reading/safe-fetch";
import { htmlToText } from "@/lib/restaurant/menu-reading/html-text";
import { readMenuSource } from "@/lib/restaurant/menu-reading/sources";
import {
  chunkMenuText,
  extractMenuDishes,
  parseMenuDishes,
  type MenuDish,
} from "@/lib/restaurant/menu-reading/extract";
import {
  matchMenuComponent,
  matchPosDishToMenu,
  sizeOf,
  stripSize,
} from "@/lib/restaurant/menu-reading/match";
import {
  MENU_DRAFT_EXISTS_REASON,
  FLAG_FROM_MENU,
  FLAG_NEW_SUGGESTED,
  HAS_RECIPE_REASON,
  NO_COMPONENTS_REASON,
  decisionsByPlato,
  planMenuDrafts,
  type MenuDraftProduct,
} from "@/lib/restaurant/menu-reading/drafts";
import {
  menuReadSummary,
  menuReadSummaryLines,
} from "@/lib/restaurant/menu-reading/summary";
import {
  canConfirmSuggestedLink,
  isBoundSuggestion,
  isMenuSuggestion,
  parseSuggestionEvidence,
} from "@/lib/restaurant/recipe-costing/evidence";
import { needsTypedQuantity } from "@/lib/restaurant/recipe-costing/editor";

// A made-up restaurant. No client data in this repo.
const SYNTHETIC_HTML = `<!doctype html><html><head><title>La Ceiba</title>
<style>.x{color:red}</style><script>window.track()</script></head>
<body><nav>Inicio | Menú</nav>
<section><h2>Platos fuertes</h2>
<div class="dish"><h3>Parrillada La Ceiba</h3>
<p>Lomito, chorizo, pollo, queso frito, frijoles y tortillas</p>
<span>2 personas $24.00</span> <span>3 personas $33.00</span></div>
<div class="dish"><h3>Pollo Encebollado</h3><p>Pollo a la plancha con cebolla, arroz y ensalada</p><span>$9.50</span></div>
</section><footer>Abierto de 8&nbsp;a 10 &amp; domingos</footer></body></html>`;

const DISHES: MenuDish[] = [
  {
    name: "Parrillada La Ceiba",
    section: "Platos fuertes",
    price: null,
    description: "Lomito, chorizo, pollo, queso frito, frijoles y tortillas",
    variants: [
      { label: "2 personas", price: 24 },
      { label: "3 personas", price: 33 },
    ],
    components: [
      "lomito",
      "chorizo",
      "pollo",
      "queso frito",
      "frijoles",
      "tortillas",
    ],
  },
  {
    name: "Pollo Encebollado",
    section: "Platos fuertes",
    price: 9.5,
    description: "Pollo a la plancha con cebolla, arroz y ensalada",
    variants: [],
    components: ["pollo a la plancha", "cebolla", "arroz", "ensalada"],
  },
  {
    name: "Sopa del día",
    section: "Entradas",
    price: 4,
    description: null,
    variants: [],
    components: [],
  },
  {
    name: "Café americano",
    section: "Bebidas",
    price: null,
    description: "Café de altura",
    variants: [
      { label: "8 oz", price: 1.5 },
      { label: "12 oz", price: 2 },
    ],
    components: ["café"],
  },
];

const CATALOG = {
  ingredients: [
    { id: "i-chorizo", name: "CHORIZO", default_unit: "unit" },
    { id: "i-tortilla", name: "TORTILLAS", default_unit: "unit" },
    { id: "i-pollo", name: "POLLO", default_unit: "lb" },
  ],
  preparations: [
    { id: "p-queso", name: "Queso frito" },
    { id: "p-frijoles", name: "Frijoles" },
  ],
};

describe("menu URL safety", () => {
  it("accepts a public https page and adds https:// when missing", () => {
    expect(checkMenuUrl("https://example.com/menu").toString()).toBe(
      "https://example.com/menu"
    );
    expect(checkMenuUrl("example.com/es/menu").protocol).toBe("https:");
  });

  it.each([
    ["http://example.com/menu", "https://"],
    ["ftp://example.com", "https://"],
    ["file:///etc/passwd", "https://"],
    ["https://user:pw@example.com", "usuario"],
    ["https://example.com:8443/menu", "puerto"],
    ["https://localhost/menu", "pública"],
    ["https://localhost./menu", "pública"],
    ["https://intranet/menu", "pública"],
    ["https://printer.local/menu", "pública"],
    ["https://127.0.0.1/menu", "no con una IP"],
    ["https://10.1.2.3/", "no con una IP"],
    ["https://169.254.169.254/latest/meta-data", "no con una IP"],
    ["https://192.168.1.1/", "no con una IP"],
    ["https://[::1]/", "no con una IP"],
    ["https://[::ffff:10.0.0.1]/", "no con una IP"],
    ["https://[::ffff:7f00:1]/", "no con una IP"],
    ["https://[::ffff:a9fe:a9fe]/", "no con una IP"],
    ["https://[fd00::1]/", "no con una IP"],
    // Public addresses too: a menu lives at a name.
    ["https://8.8.8.8/", "no con una IP"],
    ["https://[2606:4700::1111]/", "no con una IP"],
    // Other spellings of 127.0.0.1 the URL parser normalises.
    ["https://2130706433/", "no con una IP"],
    ["https://0x7f.1/", "no con una IP"],
  ])("rejects %s", (url, message) => {
    expect(() => checkMenuUrl(url)).toThrow(MenuFetchError);
    expect(() => checkMenuUrl(url)).toThrow(new RegExp(message));
  });

  it("blocks private, loopback, link-local and metadata addresses", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "224.0.0.1",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1", // the same, as the URL parser writes it
      "::ffff:a9fe:a9fe", // 169.254.169.254
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      "93.184.216.34",
      "8.8.8.8",
      "172.32.0.1",
      "2606:4700::1111",
      "::ffff:8.8.8.8",
      "::ffff:808:808",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("refuses a name that resolves to a loopback address at connect time", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      publicOnlyLookup("localhost", { all: true }, (e) => resolve(e))
    );
    expect(err?.code).toBe("EBLOCKED");
  });
});

describe("reading the menu text", () => {
  it("turns a menu page into lines of plain text", () => {
    const text = htmlToText(SYNTHETIC_HTML);
    expect(text).toContain("Parrillada La Ceiba");
    expect(text).toContain(
      "Lomito, chorizo, pollo, queso frito, frijoles y tortillas"
    );
    expect(text).toContain("Abierto de 8 a 10 & domingos");
    expect(text).not.toContain("window.track");
    expect(text).not.toContain("color:red");
  });

  it("explains a page with no menu text (built with JavaScript)", async () => {
    await expect(
      readMenuSource(
        { kind: "url", url: "https://example.com" },
        {
          fetchPage: async () => ({
            url: "https://example.com/",
            contentType: "text/html",
            body: '<html><body><div id="root"></div><script>app()</script></body></html>',
          }),
        }
      )
    ).rejects.toThrow(/Pega el texto del menú/);
  });

  it("reads pasted text as is", async () => {
    const menu = await readMenuSource({
      kind: "text",
      text: htmlToText(SYNTHETIC_HTML),
    });
    expect(menu.kind).toBe("text");
    expect(menu.source_ref).toBeNull();
  });

  it("splits long menus on line breaks", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Plato ${i} $${i}`).join(
      "\n"
    );
    const chunks = chunkMenuText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n")).toBe(text);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });

  it("keeps only well-formed dishes from the AI answer", () => {
    const dishes = parseMenuDishes(
      JSON.stringify({
        dishes: [
          {
            name: "Pupusa revuelta",
            price: "$1.25",
            components: ["masa", "chicharrón", "masa"],
          },
          { name: "", price: 3 },
          { price: 4 },
          "nope",
          {
            name: "Horchata",
            price: -1,
            variants: [{ label: "16 oz", price: 2 }, { price: 1 }],
          },
        ],
      })
    );
    expect(dishes.map((d) => d.name)).toEqual(["Pupusa revuelta", "Horchata"]);
    expect(dishes[0].price).toBe(1.25);
    expect(dishes[0].components).toEqual(["masa", "chicharrón"]);
    expect(dishes[1].price).toBeNull();
    expect(dishes[1].variants).toEqual([{ label: "16 oz", price: 2 }]);
    expect(parseMenuDishes("not json")).toEqual([]);
  });

  it("calls the AI once per chunk and drops repeated dishes", async () => {
    let calls = 0;
    const dishes = await extractMenuDishes("Parrillada\nPollo", async () => {
      calls += 1;
      return { dishes: [DISHES[1], DISHES[1]] };
    });
    expect(calls).toBe(1);
    expect(dishes).toHaveLength(1);
  });
});

describe("matching POS dishes to the menu", () => {
  it("reads sizes in names", () => {
    expect(sizeOf("Parrillada La Ceiba 3P")).toBe("3p");
    expect(sizeOf("Parrillada (2 personas)")).toBe("2p");
    expect(sizeOf("Café 12 oz")).toBe("12oz");
    expect(sizeOf("Pollo Encebollado")).toBeNull();
    expect(sizeOf("Antojitos (dos personas)")).toBe("2p");
    expect(sizeOf("Pastel tres leches")).toBeNull();
    expect(stripSize("Pastel tres leches")).toBe("Pastel tres leches");
    expect(stripSize("Parrillada La Ceiba (3 personas)")).toBe(
      "Parrillada La Ceiba"
    );
  });

  it("matches by name and picks the size variant", () => {
    const hit = matchPosDishToMenu(
      { name: "PARRILLADA LA CEIBA 3P", price: 33 },
      DISHES
    );
    expect(hit?.dish.name).toBe("Parrillada La Ceiba");
    expect(hit?.variant?.label).toBe("3 personas");
    const coffee = matchPosDishToMenu(
      { name: "Cafe Americano 12oz", price: null },
      DISHES
    );
    expect(coffee?.variant?.label).toBe("12 oz");
  });

  it("uses the price to pick the variant when the POS name has no size", () => {
    const hit = matchPosDishToMenu(
      { name: "Parrillada La Ceiba", price: 24 },
      DISHES
    );
    expect(hit?.variant?.label).toBe("2 personas");
  });

  it("does not suggest when unsure", () => {
    expect(
      matchPosDishToMenu({ name: "Lomo saltado", price: 9.5 }, DISHES)
    ).toBeNull();
    // Two dishes with the same name and no price to decide: not clear.
    const twice: MenuDish[] = [
      { ...DISHES[1], section: "Almuerzos", price: 7 },
      { ...DISHES[1], section: "Cena", price: 11 },
    ];
    expect(
      matchPosDishToMenu({ name: "Pollo Encebollado", price: null }, twice)
    ).toBeNull();
    expect(
      matchPosDishToMenu({ name: "Pollo Encebollado", price: 11 }, twice)?.dish
        .section
    ).toBe("Cena");
  });

  it("suggests existing ingredients and preparations, never creates", () => {
    expect(matchMenuComponent("chorizo", CATALOG)).toEqual({
      kind: "ingredient",
      id: "i-chorizo",
      name: "CHORIZO",
    });
    expect(matchMenuComponent("queso frito", CATALOG)).toEqual({
      kind: "component",
      id: "p-queso",
      name: "Queso frito",
    });
    expect(matchMenuComponent("frijoles", CATALOG)?.id).toBe("p-frijoles");
    expect(matchMenuComponent("lomito", CATALOG)).toBeNull();
  });
});

describe("menu drafts", () => {
  const product = (over: Partial<MenuDraftProduct>): MenuDraftProduct => ({
    odoo_product_id: 1,
    odoo_name: "Parrillada La Ceiba 2P",
    pos_price: 24,
    link_state: "sin_vincular",
    has_recipe: false,
    ...over,
  });

  const plan = (products: MenuDraftProduct[]) =>
    planMenuDrafts({
      products,
      dishes: DISHES,
      catalog: CATALOG,
      menuSourceId: "src-1",
      menuUrl: "https://example.com/menu",
    });

  it("drafts components with pending quantities, never $0, never created", () => {
    const [decision] = plan([product({})]);
    expect(decision.kind).toBe("draft");
    if (decision.kind !== "draft") return;
    const lines = decision.evidence.lines as Array<Record<string, unknown>>;
    expect(lines.map((l) => l.raw_name)).toEqual(DISHES[0].components);
    for (const line of lines) {
      expect(line.qty).toBeNull();
      expect(line.unit_cost).toBeNull();
      expect(line.pending).toBe(true);
      expect(line.flags).toContain(FLAG_FROM_MENU);
    }
    const lomito = lines.find((l) => l.raw_name === "lomito")!;
    expect(lomito.flags).toContain(FLAG_NEW_SUGGESTED);
    expect(lomito.ingredient_match).toBeNull();
    const queso = lines.find((l) => l.raw_name === "queso frito")!;
    expect(queso.sub_recipe_match).toBe("Queso frito");
    expect(decision.new_components).toBe(1); // only lomito is not in the list
    expect(decision.evidence.menu_variant).toBe("2 personas");
    expect(decision.evidence.menu_description).toBe(DISHES[0].description);
  });

  it("the Excel wins: a plato that already has a recipe is left alone, Confirmado or not", () => {
    const [withRecipe, confirmedWithRecipe] = plan([
      product({ has_recipe: true }),
      product({
        odoo_product_id: 2,
        link_state: "confirmado",
        has_recipe: true,
      }),
    ]);
    expect(withRecipe).toMatchObject({
      kind: "omitido",
      reason: HAS_RECIPE_REASON,
      code: "has_recipe",
    });
    expect(confirmedWithRecipe).toMatchObject({
      kind: "omitido",
      code: "has_recipe",
    });
  });

  it("a Confirmado link with no recipe (or only an empty / rejected version) still gets a draft", () => {
    // has_recipe is false by the one rule: no version, a version with 0 lines
    // or a rejected one all arrive here as has_recipe: false.
    const [confirmed] = plan([
      product({ link_state: "confirmado", has_recipe: false }),
    ]);
    expect(confirmed.kind).toBe("draft");
    if (confirmed.kind !== "draft") return;
    expect((confirmed.evidence.lines as unknown[]).length).toBe(
      DISHES[0].components.length
    );
  });

  it("a pending menu draft keeps its own reason", () => {
    const [existing] = plan([product({ menu_draft: true })]);
    expect(existing).toMatchObject({
      kind: "omitido",
      reason: MENU_DRAFT_EXISTS_REASON,
      code: "draft_exists",
    });
  });

  it("several POS products of the same plato count once", () => {
    const decisions = plan([
      product({ odoo_product_id: 1, plato_key: "item:m1" }),
      product({ odoo_product_id: 2, plato_key: "item:m1" }),
      product({ odoo_product_id: 3, plato_key: "item:m1" }),
      product({
        odoo_product_id: 4,
        odoo_name: "Lomo saltado",
        plato_key: "item:m2",
      }),
    ]);
    const platos = decisionsByPlato(decisions);
    expect(platos).toHaveLength(2);
    expect(platos.map((d) => d.kind).sort()).toEqual([
      "draft",
      "no_encontrado",
    ]);
  });

  it("reports dishes not on the menu and dishes with no description", () => {
    const [missing, soup] = plan([
      product({ odoo_name: "Lomo saltado", pos_price: 12 }),
      product({ odoo_product_id: 3, odoo_name: "Sopa del dia", pos_price: 4 }),
    ]);
    expect(missing.kind).toBe("no_encontrado");
    expect(soup).toMatchObject({
      kind: "omitido",
      reason: NO_COMPONENTS_REASON,
    });
  });

  it("a menu draft is a Sugerido suggestion with its menu text, not an Excel one", () => {
    const [decision] = plan([product({})]);
    if (decision.kind !== "draft") throw new Error("expected a draft");
    const view = parseSuggestionEvidence(decision.evidence);
    expect(isMenuSuggestion(view)).toBe(true);
    expect(isBoundSuggestion(view)).toBe(false);
    expect(canConfirmSuggestedLink(view)).toBe(true);
    expect(view.pending).toBe(true);
    expect(view.milton_cost).toBeNull();
    expect(view.menu?.description).toBe(DISHES[0].description);
    expect(view.lines.every((line) => line.unit_cost === null)).toBe(true);
    // The editor asks for a quantity before the line becomes a recipe line.
    expect(needsTypedQuantity(view.lines[0])).toBe(true);
    expect(needsTypedQuantity({ flags: [FLAG_FROM_MENU], qty: 2 })).toBe(false);
    expect(needsTypedQuantity({ flags: [], qty: 0 })).toBe(false);
  });

  it("summarises the run: one short line per non-zero count, numbers from the fields", () => {
    const result = {
      dishes_read: 12,
      drafted: 3,
      skipped_has_recipe: 4,
      skipped_no_ingredients: 2,
      skipped_draft_exists: 1,
      not_on_menu: 5,
      failed: 1,
      new_components: 0,
    };
    const lines = menuReadSummaryLines(result);
    expect(lines.map((l) => l.text)).toEqual([
      "Leí 12 platos en tu menú.",
      "Preparé 3 borradores de receta. Las cantidades quedan pendientes: tú las escribes.",
      "4 platos ya tienen receta: no los cambié.",
      "2 platos del menú no dicen qué llevan: no pude armar el borrador. Usa «Estimar con Milton».",
      "1 plato ya tenía un borrador del menú.",
      "5 platos sin receta no aparecen en el menú.",
      "No pude preparar 1 plato. Intenta de nuevo.",
    ]);
    expect(menuReadSummary(result)).toBe(lines.map((l) => l.text).join(" "));
  });

  it("hides zero lines, but always shows the first two, with singulars", () => {
    expect(
      menuReadSummaryLines({ dishes_read: 1, drafted: 0 }).map((l) => l.text)
    ).toEqual(["Leí 1 plato en tu menú.", "Preparé 0 borradores de receta."]);
    expect(
      menuReadSummaryLines({
        dishes_read: 1,
        drafted: 1,
        skipped_has_recipe: 1,
        skipped_no_ingredients: 1,
        not_on_menu: 1,
      }).map((l) => l.text)
    ).toEqual([
      "Leí 1 plato en tu menú.",
      "Preparé 1 borrador de receta. Las cantidades quedan pendientes: tú las escribes.",
      "1 plato ya tiene receta: no lo cambié.",
      "1 plato del menú no dice qué lleva: no pude armar el borrador. Usa «Estimar con Milton».",
      "1 plato sin receta no aparece en el menú.",
    ]);
  });

  it("says «plato», never «platillo», and never counts POS products as platos", () => {
    const text = menuReadSummary({
      dishes_read: 2,
      drafted: 1,
      skipped_has_recipe: 2,
      skipped_no_ingredients: 2,
      skipped_draft_exists: 2,
      not_on_menu: 2,
      failed: 2,
    });
    expect(text).not.toMatch(/platillo|del POS|productos/i);
    expect(text).toContain("platos");
  });
});

describe("migration 042 — menu sources", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/042_restaurant_menu_sources.sql"),
    "utf8"
  );
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("is additive: one new table, no drops or alters of existing tables", () => {
    expect(statements).toContain(
      "CREATE TABLE IF NOT EXISTS public.restaurant_menu_sources"
    );
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(
      /ALTER TABLE public\.(?!restaurant_menu_sources)/
    );
    expect(statements).not.toMatch(/\bUPDATE\s+public\./);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/);
  });

  it("is company-scoped with RLS like 038/039", () => {
    expect(statements).toContain(
      "company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE"
    );
    expect(statements).toContain("restaurant_menu_sources_company_hash_uniq");
    expect(statements).toContain("ENABLE ROW LEVEL SECURITY");
    expect(statements).toContain("is_company_member(company_id)");
  });

  it("carries the staging-only header and no production apply", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("No production apply");
  });
});
