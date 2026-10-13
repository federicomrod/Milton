// Speed fix 3: lists of uploads never carry the undo snapshot (each holds
// a ~150 KB copy of the file's recipes). Only the one upload dish
// preparation reads is loaded in full.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { loadRecipeSource } from "@/lib/restaurant/cost-workbook/stored-blocks";
import { emptyUndoSnapshot } from "@/lib/restaurant/cost-workbook/types";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const block = (name: string) => ({
  name,
  tabName: "PLATOS",
  kind: "recipe" as const,
  output_quantity: 1,
  output_unit: "portion",
  lines: [
    {
      tabName: "PLATOS",
      rowIndex: 3,
      ingredient_name: "Harina",
      quantity: 1,
      unit: "oz",
      raw: {},
    },
  ],
});

function batch(id: string, created_at: string, blocks: unknown[]) {
  return {
    id,
    filename: `${id}.xlsx`,
    created_at,
    undone_at: null,
    undo_snapshot: { ...emptyUndoSnapshot(), candidate_blocks: blocks },
  };
}

describe("loadRecipeSource", () => {
  it("loads only the newest live upload that kept recipes", async () => {
    const all = [
      batch("newest-no-recipes", "2026-10-03", []),
      batch("with-recipes", "2026-10-02", [block("Plato A")]),
      batch("older", "2026-10-01", [block("Plato B")]),
    ];
    const loaded: string[] = [];
    const repo = {
      listLiveBatchSummaries: async () =>
        all.map((b) => ({
          id: b.id,
          has_recipe_blocks: b.undo_snapshot.candidate_blocks.length > 0,
        })),
      getBatch: async (_c: string, id: string) => {
        loaded.push(id);
        return all.find((b) => b.id === id) ?? null;
      },
    };
    const found = await loadRecipeSource(repo as never, "co");
    expect(found?.batch.id).toBe("with-recipes");
    expect(found?.blocks.map((b) => b.name)).toEqual(["Plato A"]);
    // One full snapshot read, not one per upload.
    expect(loaded).toEqual(["with-recipes"]);
  });

  it("skips an upload whose stored blocks turn out empty, and returns null when none", async () => {
    const all = [
      batch("broken", "2026-10-02", [{ ...block("Vacío"), lines: [] }]),
      batch("good", "2026-10-01", [block("Plato B")]),
    ];
    const repo = {
      listLiveBatchSummaries: async () =>
        all.map((b) => ({ id: b.id, has_recipe_blocks: true })),
      getBatch: async (_c: string, id: string) =>
        all.find((b) => b.id === id) ?? null,
    };
    expect((await loadRecipeSource(repo as never, "co"))?.batch.id).toBe(
      "good"
    );
    const none = {
      listLiveBatchSummaries: async () => [],
      getBatch: async () => null,
    };
    expect(await loadRecipeSource(none as never, "co")).toBeNull();
  });
});

describe("the upload list query", () => {
  it("never selects the snapshot, only the first recipe's name, live uploads only", () => {
    const repo = read("lib/restaurant/cost-workbook/repo.ts");
    const fn = repo.slice(
      repo.indexOf("async listLiveBatchSummaries(companyId) {")
    );
    const query = fn.slice(0, fn.indexOf("if (error)"));
    expect(query).toContain("undo_snapshot->candidate_blocks->0->>name");
    expect(query).not.toContain('select("*")');
    expect(query).toContain('.is("undone_at", null)');
    expect(repo).not.toContain("listBatchHistory");
  });

  it("Recetas and dish preparation use the light list", () => {
    expect(read("lib/restaurant/recipe-costing/workspace-server.ts")).toContain(
      ".listLiveBatchSummaries(input.companyId)"
    );
    expect(read("lib/restaurant/recipe-suggestion-server.ts")).toContain(
      "loadRecipeSource(repo, companyId)"
    );
  });
});
