import { describe, expect, it, vi } from "vitest";
import { AiCallError } from "@/lib/ai/call";
import { extractRecipesFromChunks } from "@/lib/restaurant/recipe-upload/extract";
import {
  AI_UNAVAILABLE_UPLOAD_MESSAGE,
  processRecipeFile,
  skippedChunksMessage,
} from "@/lib/restaurant/recipe-upload/process";
import type { RecipeChunk } from "@/lib/restaurant/recipe-upload/chunks";

const chunks = (n: number): RecipeChunk[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: "text",
    label: `Hoja ${i + 1}`,
    text: `Receta ${i + 1}`,
  })) as RecipeChunk[];

describe("recipe upload: skipped chunks are counted", () => {
  it("counts the chunks whose AI call failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ai = vi.fn(async (c: RecipeChunk) => {
      if (c.label === "Hoja 2" || c.label === "Hoja 4") {
        throw new AiCallError("timeout");
      }
      return { recipes: [], ignored: [] };
    });
    const r = await extractRecipesFromChunks(chunks(5), ai);
    expect(r.failed_chunks).toBe(2);
    expect(r.ai_unavailable).toBeNull();
  });

  it("flags quota when a chunk failed for quota", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await extractRecipesFromChunks(chunks(2), async () => {
      throw new AiCallError("quota");
    });
    expect(r.failed_chunks).toBe(2);
    expect(r.ai_unavailable).toBe("quota");
  });

  it("the message says how many parts were skipped", () => {
    expect(skippedChunksMessage(1)).toContain("1 parte");
    expect(skippedChunksMessage(3)).toContain("3 partes");
  });

  it("a quota failure with no recipes gets the AI-unavailable message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await processRecipeFile({
      admin: {} as never,
      companyId: "co-1",
      locationId: "loc-1",
      fileName: "recetas.csv",
      mime: "text/csv",
      buffer: Buffer.from("Receta,Ingrediente,Cantidad\nSopa,Sal,1\n"),
      ai: async () => {
        throw new AiCallError("quota");
      },
    });
    expect(result.errors).toContain(AI_UNAVAILABLE_UPLOAD_MESSAGE);
  });
});
