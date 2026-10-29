// lib/restaurant/recipe-upload/process.ts
//
// «Sube tus recetas»: one uploaded file → recipe drafts. This is the contract
// with the API route; it never throws (failures become Spanish `errors` with
// drafts_created 0) and never returns extracted text.
//
// Everything this creates is a draft in kitchen_recipe_drafts. It never writes
// recipes, recipe_versions, menu_items, menu_recipe_inputs or
// ingredient_cost_entries. Company and location come from the caller.
//
// SECURITY: logs ids, counts, reasons and timings only; never file contents,
// extracted text, client file names, URLs or keys.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fileToChunks,
  UploadFileError,
  FILE_UNREADABLE_MESSAGE,
  NO_TEXT_MESSAGE,
  type UploadKind,
} from "./chunks";
import {
  createOpenAiUploadReader,
  extractRecipesFromChunks,
  type UploadAi,
} from "./extract";
import { persistRecipes } from "./persist";

export type { UploadKind } from "./chunks";
export type { UploadAi } from "./extract";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const FILE_TOO_BIG_MESSAGE =
  "Este archivo pesa más de 4 MB. Divídelo en partes o sube las páginas como fotos.";
export const UNKNOWN_TYPE_MESSAGE =
  "Este tipo de archivo no lo leo todavía. Usa Excel, Word, PDF, CSV o una foto.";
export const OLD_DOC_MESSAGE =
  "Guarda el archivo como .docx y vuelve a subirlo.";
export const NO_RECIPES_MESSAGE = "No encontré recetas en este archivo.";
export const READ_FAILED_MESSAGE =
  "No pude leer las recetas de este archivo. Vuelve a intentarlo.";
export const AI_UNAVAILABLE_UPLOAD_MESSAGE =
  "Milton no puede leer archivos con IA ahora mismo. Inténtalo más tarde.";

/** Some parts of a file were skipped: say how many, never drop them silently. */
export function skippedChunksMessage(count: number): string {
  return count === 1
    ? "No pude leer 1 parte del archivo; sus recetas no se cargaron. Vuelve a subirlo."
    : `No pude leer ${count} partes del archivo; sus recetas no se cargaron. Vuelve a subirlo.`;
}

const EXTENSION_KIND: Record<string, UploadKind> = {
  xlsx: "xlsx",
  xls: "xlsx",
  csv: "csv",
  docx: "docx",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
};

const MIME_KIND: Record<string, UploadKind> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/webp": "image",
};

export function detectUploadKind(
  fileName: string,
  mime: string
): { ok: true; kind: UploadKind } | { ok: false; error: string } {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const type = (mime || "").toLowerCase().split(";")[0].trim();
  if (ext === "doc" || type === "application/msword") {
    return { ok: false, error: OLD_DOC_MESSAGE };
  }
  const byExt = fileName.includes(".") ? EXTENSION_KIND[ext] : undefined;
  if (byExt) return { ok: true, kind: byExt };
  // No usable extension: trust the MIME type.
  const byMime = MIME_KIND[type];
  if (byMime && !fileName.includes(".")) return { ok: true, kind: byMime };
  return { ok: false, error: UNKNOWN_TYPE_MESSAGE };
}

export interface UploadResult {
  file: string;
  recipes_found: number;
  drafts_created: number;
  duplicates: Array<{ dish_name: string }>;
  preparations: Array<{ dish_name: string }>;
  ignored_sections: Array<{ name: string; reason: string }>;
  lines_without_quantity: number;
  errors: string[];
}

function failure(file: string, ...errors: string[]): UploadResult {
  return {
    file,
    recipes_found: 0,
    drafts_created: 0,
    duplicates: [],
    preparations: [],
    ignored_sections: [],
    lines_without_quantity: 0,
    errors,
  };
}

export async function processRecipeFile(input: {
  admin: SupabaseClient;
  companyId: string;
  locationId: string;
  fileName: string;
  mime: string;
  buffer: Buffer;
  ai?: UploadAi;
}): Promise<UploadResult> {
  const file = input.fileName;
  const started = Date.now();
  try {
    const detected = detectUploadKind(input.fileName, input.mime);
    if (!detected.ok) return failure(file, detected.error);
    if (input.buffer.length > MAX_UPLOAD_BYTES) {
      return failure(file, FILE_TOO_BIG_MESSAGE);
    }

    let chunked;
    try {
      chunked = await fileToChunks({
        kind: detected.kind,
        buffer: input.buffer,
        fileName: input.fileName,
        mime: input.mime,
      });
    } catch (err) {
      return failure(
        file,
        err instanceof UploadFileError ? err.message : FILE_UNREADABLE_MESSAGE
      );
    }
    if (chunked.chunks.length === 0) return failure(file, NO_TEXT_MESSAGE);

    const ai = input.ai ?? createOpenAiUploadReader(input.companyId);
    const extraction = await extractRecipesFromChunks(chunked.chunks, ai);

    const errors = [...chunked.notices];
    if (extraction.recipes.length === 0) {
      errors.push(
        extraction.ai_unavailable === "quota"
          ? AI_UNAVAILABLE_UPLOAD_MESSAGE
          : extraction.failed_chunks > 0
            ? READ_FAILED_MESSAGE
            : NO_RECIPES_MESSAGE
      );
      return {
        ...failure(file, ...errors),
        ignored_sections: extraction.ignored,
      };
    }
    if (extraction.failed_chunks > 0) {
      errors.push(skippedChunksMessage(extraction.failed_chunks));
    }

    const saved = await persistRecipes({
      admin: input.admin,
      companyId: input.companyId,
      locationId: input.locationId,
      recipes: extraction.recipes,
    });

    console.log(
      `[recipe-upload] company=${input.companyId} location=${input.locationId} kind=${detected.kind} chunks=${chunked.chunks.length} recipes=${extraction.recipes.length} drafts=${saved.drafts_created} ms=${Date.now() - started}`
    );

    return {
      file,
      recipes_found: extraction.recipes.length,
      drafts_created: saved.drafts_created,
      duplicates: saved.duplicates,
      preparations: saved.preparations,
      ignored_sections: extraction.ignored,
      lines_without_quantity: saved.lines_without_quantity,
      errors: [...errors, ...saved.errors],
    };
  } catch {
    console.error("[recipe-upload] processing failed");
    return failure(file, FILE_UNREADABLE_MESSAGE);
  }
}
