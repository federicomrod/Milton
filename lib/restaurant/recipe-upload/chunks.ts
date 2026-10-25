// lib/restaurant/recipe-upload/chunks.ts
//
// PURE (no network, no database): turns an uploaded file into RecipeChunk[]
// the extractor reads one at a time. A chunk is a tab, a page, a part of a
// document or an image. Never logs and never returns anything but the chunks.
//
//  - xlsx/xls: one chunk per visible, non-empty tab. Line 1 is «Hoja: <tab>»,
//    then the cells as CSV with EMPTY ROWS KEPT (they separate stacked recipes).
//    Values, not formulas. A tab longer than ~12,000 chars is split only at
//    blank rows, never inside a block.
//  - csv: the same, as one tab.
//  - docx: raw text, split at page breaks / runs of blank lines, never inside
//    a paragraph.
//  - pdf: one chunk per page with text. A page with almost no text means a
//    scanned PDF: the whole PDF goes once as a `pdf_file` chunk instead.
//  - image: one `image` chunk (the browser already resized it).

import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  MAX_ROWS_PER_SHEET,
  MAX_WORKBOOK_TABS,
} from "@/lib/restaurant/cost-workbook/limits";

export type RecipeChunkKind = "text" | "image" | "pdf_file";

export interface RecipeChunk {
  label: string;
  kind: RecipeChunkKind;
  text?: string;
  dataUrl?: string;
  base64?: string;
}

export type UploadKind = "xlsx" | "csv" | "docx" | "pdf" | "image";

/** A problem with the file itself; the message is Spanish and user-facing. */
export class UploadFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadFileError";
  }
}

export const MAX_CHUNKS_PER_FILE = 30;
export const MAX_PDF_PAGES = 30;
export const CHUNK_CHAR_LIMIT = 12_000;
/** A PDF page with fewer non-space characters than this is a scan. */
export const SCANNED_PAGE_MIN_CHARS = 40;

export const PDF_TOO_LONG_MESSAGE =
  "Este PDF tiene más de 30 páginas. Divídelo en partes.";
export const CHUNK_CAP_MESSAGE =
  "Leí las primeras 30 hojas/páginas; sube el resto en otro archivo.";
export const FILE_UNREADABLE_MESSAGE =
  "No pude leer este archivo. Revisa que no esté dañado y vuelve a subirlo.";
export const NO_TEXT_MESSAGE = "No encontré texto en este archivo.";

export interface FileToChunksResult {
  chunks: RecipeChunk[];
  /** Spanish notes for the user (e.g. the 30-chunk cap). */
  notices: string[];
}

export interface FileToChunksInput {
  kind: UploadKind;
  buffer: Buffer;
  fileName: string;
  mime: string;
}

function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return last.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || "Receta";
}

function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

/** Blank-separated blocks of lines (runs of blank lines count as one gap). */
function toBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (isBlankLine(line)) {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/**
 * Splits `lines` at blank-row boundaries only so every part is <= limit chars
 * (a single block longer than the limit stays whole). Each part starts with
 * the header line.
 */
export function splitAtBlankRows(
  header: string,
  lines: string[],
  limit = CHUNK_CHAR_LIMIT
): string[] {
  const whole = [header, ...lines].join("\n").replace(/\s+$/, "");
  if (whole.length <= limit) return [whole];

  const blocks = toBlocks(lines).map((b) => b.join("\n"));
  const parts: string[] = [];
  let current = "";
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (current && header.length + 1 + candidate.length > limit) {
      parts.push(`${header}\n${current}`);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(`${header}\n${current}`);
  return parts;
}

function pushTabChunks(
  out: RecipeChunk[],
  name: string,
  csvLines: string[]
): void {
  // Rows with only separators are empty rows: keep them, as empty lines.
  const lines = csvLines.map((l) => (/^[,;\s"]*$/.test(l) ? "" : l));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  if (lines.length === 0) return;
  const header = `Hoja: ${name}`;
  const parts = splitAtBlankRows(header, lines);
  parts.forEach((text, i) => {
    out.push({
      label: parts.length > 1 ? `${name} (parte ${i + 1})` : name,
      kind: "text",
      text,
    });
  });
}

function xlsxToChunks(buffer: Buffer): RecipeChunk[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new UploadFileError(FILE_UNREADABLE_MESSAGE);
  }
  const sheetsMeta = wb.Workbook?.Sheets ?? [];
  const visible = wb.SheetNames.filter((_, i) => !sheetsMeta[i]?.Hidden);
  if (visible.length > MAX_WORKBOOK_TABS) {
    throw new UploadFileError(
      `Este archivo tiene más de ${MAX_WORKBOOK_TABS} hojas. Divídelo en partes.`
    );
  }
  const out: RecipeChunk[] = [];
  for (const name of visible) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    if (range.e.r - range.s.r + 1 > MAX_ROWS_PER_SHEET) {
      throw new UploadFileError(
        `Una hoja tiene más de ${MAX_ROWS_PER_SHEET.toLocaleString("es")} filas. Divídela en partes.`
      );
    }
    const csv = XLSX.utils.sheet_to_csv(ws, {
      blankrows: true,
      dateNF: "yyyy-mm-dd",
    });
    pushTabChunks(out, name, csv.split(/\r?\n/));
  }
  return out;
}

function decodeText(buffer: Buffer): string {
  let text = buffer.toString("utf8");
  if (text.includes("�")) text = buffer.toString("latin1");
  return text.replace(/^\uFEFF/, "");
}

function csvToChunks(buffer: Buffer, fileName: string): RecipeChunk[] {
  const parsed = Papa.parse<string[]>(decodeText(buffer), {
    skipEmptyLines: false,
  });
  const rows = parsed.data as string[][];
  if (rows.length > MAX_ROWS_PER_SHEET + 1) {
    throw new UploadFileError(
      `El archivo tiene más de ${MAX_ROWS_PER_SHEET.toLocaleString("es")} filas. Divídelo en partes.`
    );
  }
  const lines = rows.map((row) =>
    row.every((c) => String(c ?? "").trim() === "")
      ? ""
      : Papa.unparse([row.map((c) => String(c ?? ""))])
  );
  const out: RecipeChunk[] = [];
  const name = baseName(fileName);
  pushTabChunks(out, name, lines);
  // The label of a csv is the file name.
  out.forEach((c) => {
    c.label = fileName;
  });
  return out;
}

/** Packs paragraphs of one oversized segment into parts <= limit chars. */
function packParagraphs(paragraphs: string[], limit: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (current && candidate.length > limit) {
      parts.push(current);
      current = p;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Splits document text into parts <= limit chars, never inside a paragraph. */
export function splitDocumentText(
  text: string,
  limit = CHUNK_CHAR_LIMIT
): string[] {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  // Strongest breaks first: page breaks and runs of blank lines.
  const segments = clean
    .split(/\f|\n{3,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current) parts.push(current);
    current = "";
  };
  for (const seg of segments) {
    if (seg.length > limit) {
      flush();
      parts.push(...packParagraphs(seg.split(/\n{2}/), limit));
      continue;
    }
    const candidate = current ? `${current}\n\n\n${seg}` : seg;
    if (current && candidate.length > limit) {
      flush();
      current = seg;
    } else {
      current = candidate;
    }
  }
  flush();
  return parts;
}

async function docxToChunks(
  buffer: Buffer,
  fileName: string
): Promise<RecipeChunk[]> {
  let value = "";
  try {
    const mod = (await import("mammoth")) as unknown as {
      extractRawText?: (i: { buffer: Buffer }) => Promise<{ value: string }>;
      default?: {
        extractRawText: (i: { buffer: Buffer }) => Promise<{ value: string }>;
      };
    };
    const extract = mod.extractRawText ?? mod.default?.extractRawText;
    if (!extract) throw new Error("mammoth unavailable");
    value = (await extract({ buffer })).value ?? "";
  } catch {
    throw new UploadFileError(FILE_UNREADABLE_MESSAGE);
  }
  const parts = splitDocumentText(value);
  const name = baseName(fileName);
  return parts.map((text, i) => ({
    label: parts.length > 1 ? `${name} (parte ${i + 1})` : name,
    kind: "text" as const,
    text,
  }));
}

async function pdfToChunks(buffer: Buffer): Promise<RecipeChunk[]> {
  let pages: string[];
  try {
    const { extractText } = await import("unpdf");
    // unpdf may take ownership of the bytes: give it a copy.
    const res = await extractText(new Uint8Array(buffer), {
      mergePages: false,
    });
    pages = Array.isArray(res.text) ? res.text : [String(res.text ?? "")];
  } catch {
    throw new UploadFileError(FILE_UNREADABLE_MESSAGE);
  }
  if (pages.length > MAX_PDF_PAGES) {
    throw new UploadFileError(PDF_TOO_LONG_MESSAGE);
  }
  const scanned = pages.some(
    (p) => p.replace(/\s/g, "").length < SCANNED_PAGE_MIN_CHARS
  );
  if (pages.length === 0 || scanned) {
    const base64 = buffer.toString("base64");
    return [
      {
        label: "PDF",
        kind: "pdf_file",
        base64,
        dataUrl: `data:application/pdf;base64,${base64}`,
      },
    ];
  }
  const out: RecipeChunk[] = [];
  pages.forEach((p, i) => {
    const label = `Página ${i + 1}`;
    const body = p.replace(/\r\n?/g, "\n").trim();
    if (body.length <= CHUNK_CHAR_LIMIT) {
      out.push({ label, kind: "text", text: `${label}\n${body}` });
      return;
    }
    splitDocumentText(body).forEach((part, j) => {
      out.push({
        label: `${label} (parte ${j + 1})`,
        kind: "text",
        text: `${label}\n${part}`,
      });
    });
  });
  return out;
}

function imageMime(fileName: string, mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m === "image/png" || m === "image/jpeg" || m === "image/webp") return m;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function imageToChunks(
  buffer: Buffer,
  fileName: string,
  mime: string
): RecipeChunk[] {
  const base64 = buffer.toString("base64");
  return [
    {
      label: "Imagen",
      kind: "image",
      base64,
      dataUrl: `data:${imageMime(fileName, mime)};base64,${base64}`,
    },
  ];
}

export async function fileToChunks(
  input: FileToChunksInput
): Promise<FileToChunksResult> {
  let chunks: RecipeChunk[];
  switch (input.kind) {
    case "xlsx":
      chunks = xlsxToChunks(input.buffer);
      break;
    case "csv":
      chunks = csvToChunks(input.buffer, input.fileName);
      break;
    case "docx":
      chunks = await docxToChunks(input.buffer, input.fileName);
      break;
    case "pdf":
      chunks = await pdfToChunks(input.buffer);
      break;
    case "image":
      chunks = imageToChunks(input.buffer, input.fileName, input.mime);
      break;
    default:
      throw new UploadFileError(FILE_UNREADABLE_MESSAGE);
  }
  const notices: string[] = [];
  if (chunks.length > MAX_CHUNKS_PER_FILE) {
    chunks = chunks.slice(0, MAX_CHUNKS_PER_FILE);
    notices.push(CHUNK_CAP_MESSAGE);
  }
  return { chunks, notices };
}
