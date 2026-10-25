// «Sube tus recetas»: file → chunks. Synthetic files only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  CHUNK_CAP_MESSAGE,
  PDF_TOO_LONG_MESSAGE,
  fileToChunks,
  splitAtBlankRows,
  splitDocumentText,
  UploadFileError,
} from "@/lib/restaurant/recipe-upload/chunks";
import {
  buildPdf,
  buildRecipeWorkbook,
} from "./helpers/recipe-upload-fixtures";

const mammothMock = vi.hoisted(() => ({ text: "" }));
vi.mock("mammoth", () => ({
  extractRawText: async () => ({ value: mammothMock.text }),
}));

describe("xlsx chunks", () => {
  it("gives one chunk per tab with the tab name and blank-row separators", async () => {
    const { chunks, notices } = await fileToChunks({
      kind: "xlsx",
      buffer: buildRecipeWorkbook(),
      fileName: "recetas.xlsx",
      mime: "",
    });
    expect(notices).toEqual([]);
    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.kind === "text")).toBe(true);
    const platos = chunks[0].text!;
    expect(platos.split("\n")[0]).toBe("Hoja: Platos fuertes");
    // three stacked recipes separated by blank rows
    expect(platos.split(/\n\n/).length).toBe(3);
    expect(platos).toContain("Sal,al gusto");
    expect(chunks[1].text).toContain("Hoja: Arroz con pollo");
    expect(chunks[1].text).toContain("Porciones,10");
    expect(chunks[3].text).toContain("0000-0001");
  });

  it("skips hidden and empty tabs", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Sopa"], ["Agua", 1, "litro"]]),
      "Visible"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Oculta"], ["x", 1]]),
      "Oculta"
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Vacía");
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }] };
    const buffer = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
    );
    const { chunks } = await fileToChunks({
      kind: "xlsx",
      buffer,
      fileName: "a.xlsx",
      mime: "",
    });
    expect(chunks.map((c) => c.label)).toEqual(["Visible"]);
  });

  it("splits a long tab only at blank rows, never inside a block", async () => {
    const rows: (string | number)[][] = [];
    for (let r = 0; r < 12; r++) {
      rows.push([`Receta ${r}`]);
      for (let i = 0; i < 40; i++)
        rows.push([
          `Ingrediente largo número ${r}-${i} para llenar`,
          i + 1,
          "g",
        ]);
      rows.push([]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Larga");
    const { chunks } = await fileToChunks({
      kind: "xlsx",
      buffer: Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })),
      fileName: "l.xlsx",
      mime: "",
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text!.length).toBeLessThanOrEqual(12_000);
      expect(c.text!.startsWith("Hoja: Larga")).toBe(true);
    }
    // every recipe appears whole in exactly one chunk
    for (let r = 0; r < 12; r++) {
      const holders = chunks.filter((c) => c.text!.includes(`Receta ${r},`));
      expect(holders).toHaveLength(1);
      expect(holders[0].text).toContain(
        `Ingrediente largo número ${r}-39 para llenar,40,g`
      );
    }
  });

  it("splitAtBlankRows keeps one oversized block whole", () => {
    const block = Array.from(
      { length: 50 },
      (_, i) => `linea ${i} ${"x".repeat(40)}`
    );
    const parts = splitAtBlankRows("Hoja: X", [...block, "", "otra"], 500);
    expect(parts[0]).toContain("linea 49");
    expect(parts.at(-1)).toContain("otra");
  });

  it("caps at 30 chunks and says so", async () => {
    const wb = XLSX.utils.book_new();
    for (let i = 0; i < 35; i++) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([[`Receta ${i}`], ["Sal", 1, "g"]]),
        `H${i}`
      );
    }
    const res = await fileToChunks({
      kind: "xlsx",
      buffer: Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })),
      fileName: "m.xlsx",
      mime: "",
    });
    expect(res.chunks).toHaveLength(30);
    expect(res.notices).toEqual([CHUNK_CAP_MESSAGE]);
  });
});

describe("csv chunks", () => {
  it("is one tab labelled with the file name, empty rows kept", async () => {
    const csv = "Sopa\nPorciones: 4\nAgua,2,litro\n\nSalsa\nTomate,1,lb\n";
    const { chunks } = await fileToChunks({
      kind: "csv",
      buffer: Buffer.from(csv),
      fileName: "mis recetas.csv",
      mime: "text/csv",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].label).toBe("mis recetas.csv");
    expect(chunks[0].text).toContain("Hoja: mis recetas");
    expect(chunks[0].text).toContain("Agua,2,litro\n\nSalsa");
  });
});

describe("docx chunks", () => {
  beforeEach(() => {
    mammothMock.text = "";
  });

  it("one chunk when short", async () => {
    mammothMock.text =
      "Sopa de res (Porciones: 8)\n\nIngredientes\n\n1/2 lb de carne\n\n\n\nPasteles de carne";
    const { chunks } = await fileToChunks({
      kind: "docx",
      buffer: Buffer.from("x"),
      fileName: "libro.docx",
      mime: "",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("1/2 lb de carne");
  });

  it("splits long text at breaks and never inside a paragraph", () => {
    const para = (i: number) => `Párrafo ${i} ${"palabra ".repeat(120)}`.trim();
    const text = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");
    const parts = splitDocumentText(text, 12_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(12_000);
    const all = parts.join("\n\n");
    for (let i = 0; i < 30; i++) expect(all).toContain(para(i));
  });

  it("a corrupt docx gives the typed Spanish error", async () => {
    vi.resetModules();
    vi.doMock("mammoth", () => ({
      extractRawText: async () => {
        throw new Error("zip");
      },
    }));
    const mod = await import("@/lib/restaurant/recipe-upload/chunks");
    await expect(
      mod.fileToChunks({
        kind: "docx",
        buffer: Buffer.from("x"),
        fileName: "a.docx",
        mime: "",
      })
    ).rejects.toBeInstanceOf(mod.UploadFileError);
    vi.doUnmock("mammoth");
  });
});

describe("pdf chunks", () => {
  it("a text PDF gives one text chunk per page, no pdf_file fallback", async () => {
    const buffer = buildPdf([
      [
        "Yuca frita con chicharron",
        "Porciones: 4",
        "Yuca 3 lb",
        "Chicharron 1 lb",
      ],
      ["Panes con pollo", "Rinde: 12 panes", "Pan 12 unidad", "Pollo 2 lb"],
    ]);
    const { chunks } = await fileToChunks({
      kind: "pdf",
      buffer,
      fileName: "r.pdf",
      mime: "application/pdf",
    });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.kind)).toEqual(["text", "text"]);
    expect(chunks[0].text).toContain("Yuca frita");
    expect(chunks[1].text).toContain("Rinde: 12 panes");
  });

  it("a page without text means a scan: the whole PDF goes once", async () => {
    const buffer = buildPdf([
      ["Yuca frita con chicharron", "Porciones: 4", "Yuca 3 lb"],
      [],
    ]);
    const { chunks } = await fileToChunks({
      kind: "pdf",
      buffer,
      fileName: "r.pdf",
      mime: "application/pdf",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("pdf_file");
    expect(chunks[0].base64).toBe(buffer.toString("base64"));
  });

  it("more than 30 pages is a typed error", async () => {
    const pages = Array.from({ length: 31 }, (_, i) => [
      `Receta numero ${i} con texto suficiente`,
      "Ingrediente uno 1 lb y mas texto",
    ]);
    const err = await fileToChunks({
      kind: "pdf",
      buffer: buildPdf(pages),
      fileName: "r.pdf",
      mime: "",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadFileError);
    expect((err as Error).message).toBe(PDF_TOO_LONG_MESSAGE);
  });
});

describe("image chunks", () => {
  it("one image chunk with a data URL", async () => {
    const { chunks } = await fileToChunks({
      kind: "image",
      buffer: Buffer.from([1, 2, 3]),
      fileName: "foto.PNG",
      mime: "image/png",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("image");
    expect(chunks[0].dataUrl).toBe("data:image/png;base64,AQID");
  });
});
