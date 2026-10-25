import { describe, expect, it } from "vitest";
import {
  FILE_TOO_BIG_MESSAGE_CLIENT,
  MAX_UPLOAD_BYTES_CLIENT,
  fitWithin,
  summarizeUploads,
} from "@/lib/restaurant/recipe-upload-client";

describe("client-safe constants", () => {
  it("equal the server's", async () => {
    const server = await import("@/lib/restaurant/recipe-upload/process");
    expect(FILE_TOO_BIG_MESSAGE_CLIENT).toBe(server.FILE_TOO_BIG_MESSAGE);
    expect(MAX_UPLOAD_BYTES_CLIENT).toBe(server.MAX_UPLOAD_BYTES);
  });
});

describe("fitWithin", () => {
  it("caps the long side at 1600 and keeps the ratio", () => {
    expect(fitWithin(3200, 2400)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
  });
  it("never enlarges", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("summarizeUploads", () => {
  const base = {
    recipes_found: 0,
    drafts_created: 0,
    duplicates: [],
    preparations: [],
    ignored_sections: [],
    lines_without_quantity: 0,
  };
  it("a mixed result, with the exact sentences", () => {
    const lines = summarizeUploads(
      [
        {
          ...base,
          recipes_found: 7,
          drafts_created: 7,
          ignored_sections: [{ name: "Proveedores", reason: "x" }],
          duplicates: [{ dish_name: "Arroz con pollo" }],
          lines_without_quantity: 1,
        },
        {
          ...base,
          recipes_found: 5,
          drafts_created: 5,
          duplicates: [{ dish_name: "Lasaña" }],
          preparations: [{ dish_name: "Salsa roja" }, { dish_name: "Chimol" }],
        },
      ],
      5
    );
    expect(lines).toEqual([
      "Leí 12 recetas de 5 archivos: 12 borradores para revisar.",
      "1 hoja no parecía receta (Proveedores).",
      "2 ya tienen una receta aprobada con el mismo nombre: Arroz con pollo, Lasaña. No las cambié; los borradores quedan como versión nueva para revisar.",
      "2 son preparaciones (Salsa roja, Chimol).",
      "1 ingrediente sin cantidad: complétalo al revisar.",
    ]);
  });
  it("singular forms", () => {
    const lines = summarizeUploads(
      [
        {
          ...base,
          recipes_found: 1,
          drafts_created: 1,
          duplicates: [{ dish_name: "Arroz con pollo" }],
          preparations: [{ dish_name: "Chimol" }],
          lines_without_quantity: 3,
        },
      ],
      1
    );
    expect(lines[0]).toBe(
      "Leí 1 receta de 1 archivo: 1 borrador para revisar."
    );
    expect(lines[1]).toBe(
      "1 ya tiene una receta aprobada con el mismo nombre: Arroz con pollo. No la cambié; el borrador queda como versión nueva para revisar."
    );
    expect(lines[2]).toBe("1 es una preparación (Chimol).");
    expect(lines[3]).toBe(
      "3 ingredientes sin cantidad: complétalos al revisar."
    );
  });
  it("shows only the first line when everything is zero", () => {
    expect(summarizeUploads([base], 1)).toEqual([
      "Leí 0 recetas de 1 archivo: 0 borradores para revisar.",
    ]);
  });
});

describe("the duplicates sentence lists a repeated name once", () => {
  it("two drafts called «Arroz con pollo» → «2 ya tienen… : Arroz con pollo.»", async () => {
    const { summarizeUploads } =
      await import("@/lib/restaurant/recipe-upload-client");
    const result = (dish: string) => ({
      file: "a.xlsx",
      recipes_found: 1,
      drafts_created: 1,
      duplicates: [{ dish_name: dish }],
      preparations: [],
      ignored_sections: [],
      lines_without_quantity: 0,
      errors: [],
    });
    const text = JSON.stringify(
      summarizeUploads(
        [result("Arroz con pollo"), result("Arroz con pollo")] as never,
        2
      )
    );
    expect(text).toContain(
      "2 ya tienen una receta aprobada con el mismo nombre: Arroz con pollo. No las cambié"
    );
  });
});
