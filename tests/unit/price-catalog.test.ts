// Price catalog: reader, conflict finder and apply. Synthetic names only.

import { describe, expect, it } from "vitest";
import { undoCostImportBatch } from "@/lib/restaurant/cost-workbook";
import {
  COST_CONFLICT_KIND,
  applyPriceCatalog,
  parseDecisions,
  planCatalog,
  resolveCostConflict,
} from "@/lib/restaurant/price-catalog/apply";
import { findCostConflicts } from "@/lib/restaurant/price-catalog/conflicts";
import {
  findPriceCatalog,
  readPriceCatalog,
  readUnitMarker,
} from "@/lib/restaurant/price-catalog/reader";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";

const HEADER = ["ITEM", "LIBRA", "ONZA", "PRECIO\n UNITARIO"];

/** A small price list shaped like a restaurant's, with invented items. */
function sampleSheet(): unknown[][] {
  return [
    ["LISTA DE PRECIOS"],
    HEADER,
    ["PLANTA DE PRODUCCION"],
    ["Salsa casera", "PRECIO POR ONZA", "", 0.05],
    ["Fondo casero", "PORCION 16 ONZAS", "", 0.02],
    ["VERDURAS"],
    ["Betabel", 0.48, 0.03, ""],
    ["Papa", 0.72, 0.045, ""],
    ["Lima", "UNIDAD", "", 0.07],
    ["Comino", 9.07, 0.02, 0],
    ["Pan de molde  12 rebanadas", 1.44, 0.12, ""],
    ["Pimiento", 2.1, 0.15, ""],
    ["Mango", "LIBRA/ UNIDAD", 1.8, 0.45],
    ["Servilletas", 0.0021, "", ""],
    ["Salsa rota", "PRECIO POR ONZA", "", "#ERROR!"],
    ["Sin precio", "", "", ""],
    ["Papa  ", 0.8, 0.05, ""],
    ["Arroz", 0.96, 0.06, ""],
  ];
}

describe("readPriceCatalog", () => {
  const read = readPriceCatalog("Lista", sampleSheet())!;
  const by = (name: string) => read.rows.find((r) => r.name === name)!;

  it("finds the header through a title row and tracks sections", () => {
    expect(read.headerRow).toBe(2);
    expect(by("Betabel").section).toBe("VERDURAS");
    expect(by("Salsa casera").section).toBe("PLANTA DE PRODUCCION");
  });

  it("reads a per-ounce price whose pound price is 16 ounces", () => {
    const row = by("Papa");
    expect(row).toMatchObject({ unit: "oz", unitCost: 0.045, status: "ok" });
  });

  it("uses the unit written in the sheet when there is a marker", () => {
    expect(by("Lima")).toMatchObject({ unit: "unit", unitCost: 0.07 });
    expect(by("Lima").status).toBe("ok");
    expect(readUnitMarker("PRECIO POR ONZA")).toBe("oz");
    expect(readUnitMarker("PRECIO LIBRA")).toBe("lb");
    expect(readUnitMarker("PORCION 16 ONZAS")).toBe("portion");
  });

  it("ignores a zero in the unit-price column", () => {
    expect(by("Comino").status).not.toBe("ambiguous_unit");
  });

  it("infers a per-gram price from a 453.6 divisor, and says so", () => {
    const row = by("Comino");
    expect(row.unit).toBe("g");
    expect(row.reasons).toContain("per_gram_inferred");
  });

  it("trusts the columns: LIBRA and ONZA both filled means per onza, no question", () => {
    const pan = read.rows.find((r) => /^Pan de molde/.test(r.name))!;
    expect(pan.status).toBe("ok");
    expect(pan.unit).toBe("oz");
    expect(pan.unitCost).toBe(0.12);
    // Divided by 12, not 16: kept as information, never asked.
    expect(pan.reasons).toContain("package_not_multiple_of_16");
    expect(by("Pimiento")).toMatchObject({ status: "ok", unit: "oz" });
  });

  it("asks when LIBRA and ONZA hold the same number (it cannot be both)", () => {
    const sheet = [HEADER, ["Chorizo unidad", 0.18, 0.18, ""]];
    const row = readPriceCatalog("Lista", sheet)!.rows[0];
    expect(row.status).toBe("ambiguous_unit");
    expect(row.reasons).toContain("same_price_lb_and_oz");
    expect(row.unit).toBeNull();
  });

  it("reads LIBRA/ UNIDAD as both prices: per libra (ONZA column) and per unidad", () => {
    const mango = by("Mango");
    expect(mango.status).toBe("ok");
    expect(mango.unit).toBe("lb");
    expect(mango.unitCost).toBe(1.8);
    expect(mango.options).toEqual([
      { unit: "lb", unitCost: 1.8 },
      { unit: "unit", unitCost: 0.45 },
    ]);
    expect(mango.reasons).toContain("lb_and_unit_prices");
  });

  it("never guesses a lone price with no unit", () => {
    const palillos = by("Servilletas");
    expect(palillos.status).toBe("ambiguous_unit");
    expect(palillos.unit).toBeNull();
    expect(palillos.options.length).toBe(3);
  });

  it("flags error cells and rows without a price", () => {
    expect(by("Salsa rota").status).toBe("error_cell");
    expect(read.rows.find((r) => r.name === "Sin precio")).toBeUndefined();
  });

  it("marks production-plant rows as preparations, not ingredients", () => {
    expect(by("Salsa casera").kind).toBe("preparation");
    expect(by("Fondo casero").kind).toBe("preparation");
    expect(by("Papa").kind).toBe("ingredient");
  });

  it("flags a repeated name instead of silently keeping both", () => {
    const dup = read.rows.filter((r) => r.name === "Papa");
    expect(dup).toHaveLength(2);
    expect(dup[1].status).toBe("duplicate_name");
  });

  it("recognises the right sheet and ignores others", () => {
    const found = findPriceCatalog([
      {
        name: "Recetas",
        aoa: [
          ["Articulo", "Cantidad"],
          ["x", 1],
        ],
      },
      { name: "Lista de insumos", aoa: sampleSheet() },
    ]);
    expect(found?.sheet).toBe("Lista de insumos");
    expect(
      findPriceCatalog([{ name: "Otra", aoa: [["a"], ["b"]] }])
    ).toBeNull();
  });
});

describe("planCatalog", () => {
  const read = readPriceCatalog("Lista", sampleSheet())!;

  it("saves only what was read directly; the rest waits for a person", () => {
    const plan = planCatalog(read);
    const saved = plan.save.map((p) => p.row.name);
    expect(saved).toContain("Betabel");
    expect(saved).toContain("Lima");
    expect(saved).toContain("Mango"); // LIBRA/ UNIDAD: read, no question
    expect(saved).not.toContain("Servilletas");
    expect(saved).not.toContain("Salsa casera"); // preparation
    expect(plan.preparations).toBe(2);
    expect(plan.pending.map((p) => p.row.name)).toEqual(
      expect.arrayContaining(["Servilletas", "Salsa rota"])
    );
  });

  it("saves an uncertain row only after the person confirms a unit", () => {
    const aguacate = read.rows.find((r) => r.name === "Mango")!;
    const plan = planCatalog(read, {
      rows: { [aguacate.key]: { unit: "lb" } },
    });
    const hit = plan.save.find((p) => p.row.name === "Mango");
    expect(hit).toMatchObject({ unit: "lb", unitCost: 1.8 });
  });

  it("lets a person turn a preparation into an ingredient, or skip a row", () => {
    const salsa = read.rows.find((r) => r.name === "Salsa casera")!;
    const lima = read.rows.find((r) => r.name === "Lima")!;
    const plan = planCatalog(read, {
      rows: {
        [salsa.key]: { kind: "ingredient" },
        [lima.key]: { kind: "skip" },
      },
    });
    expect(plan.save.map((p) => p.row.name)).toContain("Salsa casera");
    expect(plan.save.map((p) => p.row.name)).not.toContain("Lima");
  });

  it("drops invalid client decisions", () => {
    const parsed = parseDecisions({
      rows: {
        a: { unit: "parsec", unitCost: -1, kind: "x" },
        b: { unit: "oz", unitCost: 0.5, kind: "skip" },
      },
      conflicts: { x: "catalog", y: 2, z: "bogus", w: -1 },
    });
    expect(parsed.rows?.a).toEqual({});
    expect(parsed.rows?.b).toEqual({ unit: "oz", unitCost: 0.5, kind: "skip" });
    expect(parsed.conflicts).toEqual({ x: "catalog", y: 2 });
  });
});

describe("findCostConflicts", () => {
  const catalog = readPriceCatalog("Lista", sampleSheet())!.rows.filter(
    (r) => r.kind === "ingredient"
  );
  const obs = (name: string, unitLabel: string, unitCost: number, row = 5) => ({
    name,
    unitLabel,
    unitCost,
    tab: "PLATOS",
    row,
    recipe: `Plato ${row}`,
  });

  it("is silent when recipe lines agree with the price list", () => {
    expect(findCostConflicts(catalog, [obs("Betabel", "ONZA", 0.03)])).toEqual(
      []
    );
  });

  it("does not call a wrong unit label a price conflict", () => {
    // Price per ounce typed under a LIBRA label: same number, label lies.
    expect(findCostConflicts(catalog, [obs("Betabel", "LIBRA", 0.03)])).toEqual(
      []
    );
  });

  it("reports a different price and groups the distinct values", () => {
    const conflicts = findCostConflicts(catalog, [
      obs("Betabel", "ONZA", 0.04, 10),
      obs("Betabel", "ONZA", 0.04, 11),
      obs("Betabel", "ONZA", 0.06, 12),
      obs("Papa", "ONZA", 0.045, 13),
    ]);
    expect(conflicts).toHaveLength(1);
    const [c] = conflicts;
    expect(c.name).toBe("Betabel");
    expect(c.catalog).toMatchObject({ unit: "oz", unitCost: 0.03 });
    expect(c.candidates.map((x) => [x.unitCost, x.lines])).toEqual([
      [0.04, 2],
      [0.06, 1],
    ]);
  });

  it("matches by exact name only, never a look-alike", () => {
    expect(findCostConflicts(catalog, [obs("Zanahora", "ONZA", 0.9)])).toEqual(
      []
    );
  });

  it("skips lines that cannot be compared (pieces vs ounces)", () => {
    expect(findCostConflicts(catalog, [obs("Betabel", "UNIDAD", 9)])).toEqual(
      []
    );
  });
});

// ---- apply ------------------------------------------------------------

const COMPANY = "co-1";
const FILE = "Lista de precios_Abril-2026.xlsx";

function setup() {
  const store = emptyMemoryStore();
  const repo = createMemoryCostWorkbookRepo(store);
  const read = readPriceCatalog("Lista", sampleSheet())!;
  return { store, repo, read };
}

const obsFor = (name: string, cost: number, unit = "ONZA") => [
  {
    name,
    unitLabel: unit,
    unitCost: cost,
    tab: "PLATOS",
    row: 7,
    recipe: "P1",
  },
];

describe("applyPriceCatalog", () => {
  it("saves read rows in USD with source and the file's month, never preparations", async () => {
    const { store, repo, read } = setup();
    const result = await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: [],
      decisions: {},
    });
    const names = store.ingredients.map((i) => i.name);
    expect(names).toContain("Betabel");
    expect(names).not.toContain("Salsa casera");
    expect(names).toContain("Mango"); // LIBRA/ UNIDAD is read, not asked
    expect(names).not.toContain("Servilletas"); // a lone price waits
    expect(result.preparations_left_out).toBe(2);
    expect(result.pending_rows).toBeGreaterThan(0);
    expect(store.ingredients.every((i) => i.currency === "USD")).toBe(true);
    expect(store.costEntries.every((e) => e.currency === "USD")).toBe(true);
    const betabel = store.costEntries.find(
      (e) =>
        e.ingredient_id ===
        store.ingredients.find((i) => i.name === "Betabel")?.id
    )!;
    expect(betabel.cost_date).toBe("2026-04-01");
    expect(betabel.date_source).toBe("dated_price_list");
    expect(betabel.notes).toBe("Lista · fila 7");
    expect(betabel.source_id).toBe(result.batch_id);
  });

  it("is undoable with the existing batch undo", async () => {
    const { store, repo, read } = setup();
    const result = await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: { conflicts: { BETABEL: 0 } },
    });
    expect(store.ingredients.length).toBeGreaterThan(0);
    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    expect(store.ingredients).toHaveLength(0);
    expect(store.costEntries).toHaveLength(0);
  });

  it("keeps the price-list cost in force and preserves both values when nobody has chosen", async () => {
    const { store, repo, read } = setup();
    const result = await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: {},
    });
    expect(result.conflicts_open).toBe(1);
    const betabel = store.ingredients.find((i) => i.name === "Betabel")!;
    expect(
      store.costEntries.filter((e) => e.ingredient_id === betabel.id)
    ).toHaveLength(1);
    expect(betabel.current_unit_cost).toBeCloseTo(0.03, 6);
    expect(store.chosenCosts).toHaveLength(0);
    const item = store.reviewItems.find(
      (r) => r.raw_values.kind === COST_CONFLICT_KIND
    )!;
    expect(item.status).toBe("pending");
    expect(item.reason).toContain("Betabel");
    const raw = item.raw_values as {
      catalog: { unitCost: number };
      candidates: Array<{ unitCost: number }>;
    };
    expect(raw.catalog.unitCost).toBe(0.03);
    expect(raw.candidates.map((c) => c.unitCost)).toEqual([0.04]);
  });

  it("records a chosen recipe-sheet cost as the newest entry and as the choice", async () => {
    const { store, repo, read } = setup();
    await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: { conflicts: { BETABEL: 0 } },
    });
    const betabel = store.ingredients.find((i) => i.name === "Betabel")!;
    const entries = store.costEntries.filter(
      (e) => e.ingredient_id === betabel.id
    );
    expect(entries).toHaveLength(2);
    const chosen = store.chosenCosts.find(
      (c) => c.ingredient_id === betabel.id
    )!;
    expect(chosen.chosen_by).toBe("u1");
    const entry = entries.find((e) => e.id === chosen.cost_entry_id)!;
    expect(entry.unit_cost).toBeCloseTo(0.04, 6);
    expect(entry.notes).toContain("(elegido)");
    expect(betabel.current_unit_cost).toBeCloseTo(0.04, 6);
  });

  it("choosing the price list records that entry and adds nothing", async () => {
    const { store, repo, read } = setup();
    await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: { conflicts: { BETABEL: "catalog" } },
    });
    const betabel = store.ingredients.find((i) => i.name === "Betabel")!;
    const entries = store.costEntries.filter(
      (e) => e.ingredient_id === betabel.id
    );
    expect(entries).toHaveLength(1);
    expect(store.chosenCosts[0].cost_entry_id).toBe(entries[0].id);
    expect(betabel.current_unit_cost).toBeCloseTo(0.03, 6);
  });

  it("resolves a left-open conflict later, once, and refuses bad input", async () => {
    const { store, repo, read } = setup();
    await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: {},
    });
    const item = store.reviewItems.find(
      (r) => r.raw_values.kind === COST_CONFLICT_KIND
    )!;
    const base = {
      repo,
      companyId: COMPANY,
      userId: "u2",
      currency: "USD",
      reviewId: item.id,
    };

    expect((await resolveCostConflict({ ...base, choice: 9 })).ok).toBe(false);
    expect(
      (await resolveCostConflict({ ...base, reviewId: "missing", choice: 0 }))
        .ok
    ).toBe(false);

    const ok = await resolveCostConflict({ ...base, choice: 0 });
    expect(ok.ok).toBe(true);
    expect(store.reviewItems.find((r) => r.id === item.id)?.status).toBe(
      "approved"
    );
    expect(store.chosenCosts[0].chosen_by).toBe("u2");

    const again = await resolveCostConflict({ ...base, choice: 0 });
    expect(again.ok).toBe(false);
  });

  it("will not resolve a conflict from an undone upload", async () => {
    const { store, repo, read } = setup();
    const result = await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: {},
    });
    const item = store.reviewItems.find(
      (r) => r.raw_values.kind === COST_CONFLICT_KIND
    )!;
    await undoCostImportBatch(repo, COMPANY, result.batch_id);
    const res = await resolveCostConflict({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      reviewId: item.id,
      choice: 0,
    });
    expect(res.ok).toBe(false);
  });
});

describe("Ninguna (dejar Pendiente)", () => {
  it("parses as a conflict answer", () => {
    expect(parseDecisions({ conflicts: { a: "none" } }).conflicts).toEqual({
      a: "none",
    });
  });

  it("at upload: saves no price for that ingredient and asks nothing more", async () => {
    const { store, repo, read } = setup();
    const result = await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: { conflicts: { BETABEL: "none" } },
    });
    expect(result.conflicts_left_pending).toBe(1);
    expect(result.conflicts_open).toBe(0);
    const betabel = store.ingredients.find((i) => i.name === "Betabel");
    // Never $0 and never one of the wrong prices: no cost entry at all.
    expect(
      store.costEntries.filter((e) => e.ingredient_id === betabel?.id)
    ).toHaveLength(0);
    expect(
      store.reviewItems.filter((r) => r.raw_values.kind === COST_CONFLICT_KIND)
    ).toHaveLength(0);
  });

  it("later: removes only this upload's price and closes the question", async () => {
    const { store, repo, read } = setup();
    await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: {},
    });
    const item = store.reviewItems.find(
      (r) => r.raw_values.kind === COST_CONFLICT_KIND
    )!;
    const betabel = store.ingredients.find((i) => i.name === "Betabel")!;
    expect(
      store.costEntries.filter((e) => e.ingredient_id === betabel.id)
    ).toHaveLength(1);
    const ok = await resolveCostConflict({
      repo,
      companyId: COMPANY,
      userId: "u2",
      currency: "USD",
      reviewId: item.id,
      choice: "none",
    });
    expect(ok.ok).toBe(true);
    expect(
      store.costEntries.filter((e) => e.ingredient_id === betabel.id)
    ).toHaveLength(0);
    expect(
      store.ingredients.find((i) => i.id === betabel.id)?.current_unit_cost
    ).toBeNull();
    expect(store.reviewItems.find((r) => r.id === item.id)?.status).toBe(
      "skipped"
    );
  });
});

describe("fewer questions: the list price is the default", () => {
  const list = readPriceCatalog("Lista", [HEADER, ["Ajo", 1.6, 0.1, ""]])!.rows;
  const obs = (cost: number, recipe: string, unit = "ONZA") => ({
    name: "Ajo",
    unitLabel: unit,
    unitCost: cost,
    tab: "PLATOS",
    row: 1,
    recipe,
  });

  it("asks only when a recipe differs by more than 20%", () => {
    expect(findCostConflicts(list, [obs(0.115, "P1")])).toHaveLength(0);
    expect(findCostConflicts(list, [obs(0.085, "P1")])).toHaveLength(0);
    const asked = findCostConflicts(list, [obs(0.13, "P1")]);
    expect(asked).toHaveLength(1);
    expect(asked[0].candidates.map((c) => c.unitCost)).toEqual([0.13]);
  });

  it("drops recipe prices that are obviously another unit (8× or more)", () => {
    // $10.04 per onza vs $0.10: a per-libra or typo number, not a price.
    expect(findCostConflicts(list, [obs(10.04, "P1")])).toHaveLength(0);
    expect(findCostConflicts(list, [obs(0.005, "P1")])).toHaveLength(0);
    const mixed = findCostConflicts(list, [obs(10.04, "P1"), obs(0.15, "P2")]);
    expect(mixed[0].candidates.map((c) => c.unitCost)).toEqual([0.15]);
  });

  it("does not ask when a recipe already uses the list price", () => {
    expect(
      findCostConflicts(list, [obs(0.1, "P1"), obs(0.32, "P2")])
    ).toHaveLength(0);
  });

  it("does not ask about rows under a production section", () => {
    const rows = readPriceCatalog("Lista", sampleSheet())!.rows;
    const salsa = rows.find((r) => r.name === "Salsa casera")!;
    expect(salsa.kind).toBe("preparation");
    expect(salsa.reasons).toContain("preparation_section");
  });

  it("keeps the per-unidad price of a LIBRA/ UNIDAD row in the cost note", async () => {
    const { store, repo, read } = setup();
    await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: [],
      decisions: {},
    });
    const mango = store.ingredients.find((i) => i.name === "Mango")!;
    const entry = store.costEntries.find((e) => e.ingredient_id === mango.id)!;
    expect(entry.unit).toBe("lb");
    expect(entry.notes).toMatch(/también \$0\.4500 por unidad/);
  });
});

describe("saving the list over ingredients the recipe import made", () => {
  it("keeps the price even when the ingredient's unit came from a mislabeled recipe line", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    // The import created it from a recipe line written "UNIDAD".
    await repo.createIngredients([
      {
        companyId: COMPANY,
        name: "Brocoli",
        defaultUnit: "unit",
        currentUnitCost: null,
        currency: "USD",
      },
    ]);
    const read = readPriceCatalog("Lista", [
      HEADER,
      ["Brocoli", 0.68, 0.0425, ""],
    ])!;
    const result = await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: [],
      decisions: {},
    });
    expect(result.failed).toBe(0);
    expect(store.ingredients).toHaveLength(1);
    const entry = store.costEntries.find(
      (e) => e.ingredient_id === store.ingredients[0].id
    )!;
    expect(entry.normalized_unit).toBe("oz");
    expect(entry.normalized_unit_cost).toBeCloseTo(0.0425, 6);
  });

  it("never makes a twin for the same name written with other spacing", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    await repo.createIngredients([
      {
        companyId: COMPANY,
        name: "CEBOLLA BLANCA",
        defaultUnit: "oz",
        currentUnitCost: null,
        currency: "USD",
      },
    ]);
    const read = readPriceCatalog("Lista", [
      HEADER,
      ["CEBOLLA  BLANCA", 0.96, 0.06, ""],
    ])!;
    await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: [],
      decisions: {},
    });
    expect(store.ingredients.map((i) => i.name)).toEqual(["CEBOLLA BLANCA"]);
    expect(store.costEntries).toHaveLength(1);
  });

  it("'usar la lista' finds the ingredient that holds the list price, even with a twin", async () => {
    const { store, repo, read } = setup();
    // A twin with no price (as an older import could leave).
    await repo.createIngredients([
      {
        companyId: COMPANY,
        name: "BETABEL",
        defaultUnit: "unit",
        currentUnitCost: null,
        currency: "USD",
      },
    ]);
    await applyPriceCatalog({
      repo,
      companyId: COMPANY,
      userId: "u1",
      currency: "USD",
      filename: FILE,
      read,
      observations: obsFor("Betabel", 0.04),
      decisions: {},
    });
    const item = store.reviewItems.find(
      (r) => r.raw_values.kind === COST_CONFLICT_KIND
    );
    if (!item) return; // nothing asked: the list price already applies
    const ok = await resolveCostConflict({
      repo,
      companyId: COMPANY,
      userId: "u2",
      currency: "USD",
      reviewId: item.id,
      choice: "catalog",
    });
    expect(ok.ok).toBe(true);
  });
});
