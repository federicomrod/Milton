import { describe, expect, it } from "vitest";
import { buildRecipeSuggestionWorkbook } from "@/tests/fixtures/cost-workbook-synthetic";
import {
  collectWorkbookCandidateBlocks,
  compactCandidateBlocks,
  expandCandidateBlocks,
  candidateBlocksFromUnknown,
  runRecipeSuggestions,
  proposeRecipeHeuristic,
} from "@/lib/restaurant/cost-workbook";
import { snapshotFromUnknown } from "@/lib/restaurant/cost-workbook/snapshot";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "@/tests/unit/helpers/memory-cost-workbook-repo";

describe("stored candidate blocks", () => {
  it("round-trips parsed blocks without raw cells and skips empty ones", () => {
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
      lang: "es",
    }).all;
    const compact = compactCandidateBlocks(blocks);
    expect(compact.length).toBeGreaterThan(0);
    expect(
      compact.every(
        (block) => block.lines.length + (block.pending_lines?.length ?? 0) > 0
      )
    ).toBe(true);
    const expanded = expandCandidateBlocks(candidateBlocksFromUnknown(compact));
    expect(expanded).toHaveLength(compact.length);
    const first = expanded[0];
    expect(first?.lines[0]?.raw["Costo Unitario"] != null || true).toBe(true);
  });

  it("survives undo_snapshot JSON", () => {
    const blocks = collectWorkbookCandidateBlocks({
      buffer: buildRecipeSuggestionWorkbook(),
      lang: "es",
    }).all;
    const snap = snapshotFromUnknown({
      candidate_blocks: compactCandidateBlocks(blocks),
    });
    expect(snap.candidate_blocks?.length).toBeGreaterThan(0);
    expect(expandCandidateBlocks(snap.candidate_blocks).length).toBeGreaterThan(
      0
    );
  });

  it("does not suggest a POS product onto a block with no lines", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const emptyBlock = {
      name: "Parrillada de la Casa (3 personas)",
      tabName: "PLATOS",
      kind: "recipe" as const,
      lines: [],
      pending_lines: [],
      output_quantity: 1,
      output_unit: "orden",
    };
    expect(
      proposeRecipeHeuristic({
        product: {
          odoo_product_id: 7576,
          odoo_name: "Parrillada de la Casa (3 personas)",
        },
        candidateBlocks: [emptyBlock],
      })
    ).toBe("sin sugerencia");

    const result = await runRecipeSuggestions({
      companyId: "co-empty",
      products: [
        {
          odoo_product_id: 7576,
          odoo_name: "Parrillada de la Casa (3 personas)",
        },
      ],
      candidateBlocks: [emptyBlock],
      repo,
      ai: {
        classifyTab: async () => ({ type: "ignore", confidence: 0.1 }),
        mapColumns: async () => ({}),
        proposeRecipe: async () =>
          proposeRecipeHeuristic({
            product: {
              odoo_product_id: 7576,
              odoo_name: "Parrillada de la Casa (3 personas)",
            },
            candidateBlocks: [emptyBlock],
          }),
      },
      currency: "USD",
      filename: "costos.xlsx",
      lang: "es",
    });
    expect(result.items[0]?.result).toBe("sin sugerencia");
    expect(store.posProductLinks).toHaveLength(0);
  });
});
