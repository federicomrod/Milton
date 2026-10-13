import { describe, expect, it } from "vitest";
import { buildRecipeSuggestionWorkbook } from "@/tests/fixtures/cost-workbook-los-ranchos";
import {
  SIN_SUGERENCIA,
  bindProposalToParsedBlock,
  collectWorkbookCandidateBlocks,
  parseRecipeProposal,
  proposeRecipeHeuristic,
  runRecipeSuggestions,
} from "@/lib/restaurant/cost-workbook";
import { workbookCostsMatch } from "@/lib/restaurant/cost-workbook/variance";
import { undoCostImportBatch } from "@/lib/restaurant/cost-workbook/undo";
import {
  confirmPosProductLink,
  unlinkedPosProduct,
} from "@/lib/restaurant/pos-product-links";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "@/tests/unit/helpers/memory-cost-workbook-repo";

const COMPANY = "co-suggest";
const OTHER = "co-other";

function heuristicAi(): WorkbookAi {
  return {
    classifyTab: async () => ({ type: "ignore", confidence: 0.2 }),
    mapColumns: async () => ({}),
    proposeRecipe: async (product, blocks) =>
      proposeRecipeHeuristic({ product, candidateBlocks: blocks }),
  };
}

function products() {
  return [
    { odoo_product_id: 1, odoo_name: "BISTEC TIPICO", net_sales: 400 },
    { odoo_product_id: 2, odoo_name: "SALSA DEMIGLASS PLATO", net_sales: 200 },
    { odoo_product_id: 3, odoo_name: "ROLL VEGETALES", net_sales: 150 },
    { odoo_product_id: 4, odoo_name: "CHURRASCO QUESILLO", net_sales: 80 },
  ];
}

describe("proposeRecipe schema", () => {
  it("returns sin sugerencia when the AI JSON fails the schema", () => {
    expect(parseRecipeProposal({ tab: "x" })).toBe(SIN_SUGERENCIA);
    expect(parseRecipeProposal("not json")).toBe(SIN_SUGERENCIA);
    expect(parseRecipeProposal(null)).toBe(SIN_SUGERENCIA);
  });

  it("returns sin sugerencia from a suggestion run when AI output is invalid", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
    }).all;
    const ai: WorkbookAi = {
      classifyTab: async () => ({ type: "ignore", confidence: 0.1 }),
      mapColumns: async () => ({}),
      proposeRecipe: async () =>
        ({
          tab: "nope",
        }) as never,
    };
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products: products().slice(0, 1),
      candidateBlocks: blocks,
      repo,
      ai,
      currency: "USD",
      filename: "sugerencias.xlsx",
      lang: "es",
    });
    expect(result.items[0]?.result).toBe(SIN_SUGERENCIA);
    expect(store.posProductLinks).toHaveLength(0);
    expect(store.recipeVersions).toHaveLength(0);
  });

  it("rejects a proposal that invents a block or line", () => {
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
    }).all;
    expect(
      bindProposalToParsedBlock(
        {
          tab: "Inventada",
          block_name: "Fantasma",
          confidence: 0.9,
          evidence: "guess",
          lines: [
            {
              source_row: 99,
              raw_name: "SAL",
              ingredient_match: null,
              sub_recipe_match: null,
              qty: 1,
              unit: "g",
              unit_cost: 0.1,
              flags: [],
            },
          ],
          yield: { value: 1, unit: "unit", source: "excel" },
          excel_total: 1,
        },
        blocks
      )
    ).toBe(SIN_SUGERENCIA);
  });
});

describe("AI recipe suggestions", () => {
  it("keeps APIO and QUESILLO pending and never writes a cost", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
      lang: "es",
    });
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products: products(),
      candidateBlocks: blocks.all,
      repo,
      ai: heuristicAi(),
      currency: "USD",
      filename: "sugerencias.xlsx",
      lang: "es",
    });

    const roll = result.items.find((row) => row.odoo_name === "ROLL VEGETALES");
    expect(roll?.result).toBe("sugerido");
    expect(roll?.status).toBe("borrador");
    expect(roll?.pending).toBe(true);
    expect(roll?.reasons.some((reason) => /APIO/.test(reason))).toBe(true);
    expect(roll?.link_state).toBe("sugerido");
    const apio = (
      roll?.evidence.lines as Array<{
        raw_name: string;
        unit_cost: number | null;
        pending: boolean;
        flags: string[];
      }>
    )?.find((line) => line.raw_name === "APIO");
    expect(apio?.pending).toBe(true);
    expect(apio?.flags).toEqual(expect.arrayContaining(["pendiente_unidad"]));

    const quesillo = result.items.find(
      (row) => row.odoo_name === "CHURRASCO QUESILLO"
    );
    expect(quesillo?.status).toBe("borrador");
    expect(quesillo?.pending).toBe(true);
    expect(quesillo?.reasons.some((reason) => /QUESILLO/.test(reason))).toBe(
      true
    );
    // Prices are never taken from the Excel: an unknown ingredient stays
    // pending with no cost at all (never $0).
    expect(quesillo?.milton_cost).toBeNull();
    const qLine = (
      quesillo?.evidence.lines as Array<{
        raw_name: string;
        unit_cost: number | null;
      }>
    )?.find((line) => line.raw_name === "QUESILLO");
    expect(qLine?.unit_cost).toBeNull();

    const version = store.recipeVersions.find(
      (row) => row.id === roll?.recipe_version_id
    );
    expect(version?.status).toBe("in_review");
    expect(version?.notes).toBe("Borrador");
  });

  it("points DEMIGLASS at a preparation (a new draft or an existing one), never at the Excel block's own price", async () => {
    const run = async (store: ReturnType<typeof emptyMemoryStore>) => {
      const blocks = collectWorkbookCandidateBlocks({
        buffer: buildRecipeSuggestionWorkbook(),
        lang: "es",
      });
      const result = await runRecipeSuggestions({
        companyId: COMPANY,
        products: products().filter(
          (row) => row.odoo_name === "SALSA DEMIGLASS PLATO"
        ),
        candidateBlocks: blocks.all,
        repo: createMemoryCostWorkbookRepo(store),
        ai: heuristicAi(),
        currency: "USD",
        filename: "sugerencias.xlsx",
        lang: "es",
        odooProductId: 2,
      });
      return (
        result.items[0]?.evidence.lines as Array<{
          raw_name: string;
          sub_recipe_match: string | null;
          unit_cost: number | null;
          pending: boolean;
        }>
      )?.find((line) => line.raw_name === "DEMIGLASS");
    };

    // Only an Excel block exists: the run creates a preparation draft from
    // it (in review, counts nowhere) and the line points at the draft. The
    // block's own Excel price is never used as a cost.
    const fresh = emptyMemoryStore();
    const fromBlock = await run(fresh);
    expect(fromBlock?.sub_recipe_match).toBe("DEMIGLASS");
    expect(fromBlock?.unit_cost).toBeNull();
    const draft = fresh.components.find((row) => row.name === "DEMIGLASS");
    expect(draft).toBeTruthy();
    expect(
      fresh.componentRecipeVersions
        .filter((row) => row.component_id === draft?.id)
        .every((row) => row.status === "in_review")
    ).toBe(true);

    // A real preparation exists: the line points at it (cost comes from it).
    const store = emptyMemoryStore();
    store.components.push({
      id: "comp-demi",
      name: "DEMIGLASS",
      output_unit: "oz",
    } as (typeof store.components)[number]);
    const withPrep = await run(store);
    expect(withPrep?.sub_recipe_match).toBe("DEMIGLASS");
    expect(withPrep?.unit_cost).toBeNull();
    const version = store.recipeVersions.at(-1);
    expect(
      version?.inputs.some(
        (row) =>
          row.input_type === "component" && row.component_id === "comp-demi"
      )
    ).toBe(true);
  });

  it("matches Excel totals on the documented tolerance edges", () => {
    expect(workbookCostsMatch(1, 1.05)).toBe(true);
    expect(workbookCostsMatch(1, 1.06)).toBe(false);
    expect(workbookCostsMatch(10, 10.2)).toBe(true);
    expect(workbookCostsMatch(10, 10.3)).toBe(false);
  });

  it("never overwrites a handmade or approved recipe", async () => {
    const store = emptyMemoryStore();
    store.menuItems.push({
      id: "menu-hand",
      name: "BISTEC TIPICO",
      source_type: "manual",
      source_id: null,
    });
    store.recipes.push({
      id: "rec-hand",
      menu_item_id: "menu-hand",
      name: "BISTEC TIPICO",
      source_type: "manual",
      source_id: null,
    });
    store.companyByEntityId["menu-hand"] = COMPANY;
    store.companyByEntityId["rec-hand"] = COMPANY;
    store.menuItems.push({
      id: "menu-ok",
      name: "ROLL VEGETALES",
      source_type: "import",
      source_id: "old",
    });
    store.recipes.push({
      id: "rec-ok",
      menu_item_id: "menu-ok",
      name: "ROLL VEGETALES",
      source_type: "import",
      source_id: "old",
    });
    store.recipeVersions.push({
      id: "ver-ok",
      recipe_id: "rec-ok",
      menu_item_id: "menu-ok",
      version_number: 1,
      status: "approved",
      effective_date: null,
      source_type: "import",
      inputs: [],
    });
    const repo = createMemoryCostWorkbookRepo(store);
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
    }).all;
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products: products(),
      candidateBlocks: blocks,
      repo,
      ai: heuristicAi(),
      currency: "USD",
      filename: "sugerencias.xlsx",
      lang: "es",
    });
    expect(
      result.items.find((row) => row.odoo_name === "BISTEC TIPICO")?.result
    ).toBe("omitido");
    expect(
      result.items.find((row) => row.odoo_name === "ROLL VEGETALES")?.result
    ).toBe("omitido");
    expect(
      store.recipes.find((row) => row.id === "rec-hand")?.source_type
    ).toBe("manual");
    expect(
      store.recipeVersions.filter((row) => row.recipe_id === "rec-ok")
    ).toHaveLength(1);
  });

  it("never auto-confirms a POS link", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
    }).all;
    await runRecipeSuggestions({
      companyId: COMPANY,
      products: products().slice(0, 1),
      candidateBlocks: blocks,
      repo,
      ai: heuristicAi(),
      currency: "USD",
      filename: "sugerencias.xlsx",
      lang: "es",
    });
    expect(store.posProductLinks).toHaveLength(1);
    expect(store.posProductLinks[0]?.link_state).toBe("sugerido");
    expect(store.posProductLinks[0]?.confirmed_by).toBeNull();
    expect(store.posProductLinks[0]?.confirmed_at).toBeNull();
    expect(store.posProductLinks[0]?.confirmed_how).toBeNull();
    expect(
      store.recipeVersions.every((row) => row.status === "in_review")
    ).toBe(true);

    const confirmed = confirmPosProductLink(
      unlinkedPosProduct({
        company_id: COMPANY,
        odoo_product_id: 99,
        odoo_name: "Ya confirmado",
      }),
      {
        confirmed_by: "user-1",
        confirmed_at: "2026-10-12T12:00:00.000Z",
        confirmed_how: "manual",
      }
    );
    store.posProductLinks.push({
      ...confirmed,
      id: "link-conf",
      odoo_product_id: 4,
      odoo_name: "CHURRASCO QUESILLO",
    });
    const again = await runRecipeSuggestions({
      companyId: COMPANY,
      products: products().filter((row) => row.odoo_product_id === 4),
      candidateBlocks: blocks,
      repo,
      ai: heuristicAi(),
      currency: "USD",
      filename: "sugerencias.xlsx",
      lang: "es",
      odooProductId: 4,
    });
    expect(again.items[0]?.result).toBe("omitido");
    expect(
      store.posProductLinks.find((row) => row.id === "link-conf")?.link_state
    ).toBe("confirmado");
  });

  it("undoes a suggestion batch without touching another company", async () => {
    const store = emptyMemoryStore();
    store.posProductLinks.push({
      ...unlinkedPosProduct({
        company_id: OTHER,
        odoo_product_id: 1,
        odoo_name: "BISTEC TIPICO",
      }),
      id: "other-link",
    });
    const repo = createMemoryCostWorkbookRepo(store);
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
    }).all;
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products: products().slice(0, 1),
      candidateBlocks: blocks,
      repo,
      ai: heuristicAi(),
      currency: "USD",
      filename: "sugerencias.xlsx",
      lang: "es",
    });
    expect(result.suggested).toBe(1);
    expect(store.menuItems.some((row) => row.name === "BISTEC TIPICO")).toBe(
      true
    );
    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    expect(store.menuItems.some((row) => row.name === "BISTEC TIPICO")).toBe(
      false
    );
    expect(
      store.posProductLinks.some((row) => row.company_id === COMPANY)
    ).toBe(false);
    expect(
      store.posProductLinks.find((row) => row.id === "other-link")?.company_id
    ).toBe(OTHER);
  });

  it("does not block other dishes when one stays Por revisar", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
    }).all;
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products: products(),
      candidateBlocks: blocks,
      repo,
      ai: heuristicAi(),
      currency: "USD",
      filename: "sugerencias.xlsx",
      lang: "es",
    });
    const pending = result.items.filter((row) => row.pending);
    const suggested = result.items.filter((row) => row.result === "sugerido");
    expect(pending.length).toBeGreaterThan(0);
    expect(suggested.length).toBeGreaterThan(1);
  });
});
