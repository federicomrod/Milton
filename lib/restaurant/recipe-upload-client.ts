// lib/restaurant/recipe-upload-client.ts
//
// Client-safe pieces of «Sube tus recetas»: the size limit and its message
// (a test keeps them equal to the server's), the summary text and the image
// size helper. No server imports.

export const MAX_UPLOAD_BYTES_CLIENT = 4 * 1024 * 1024;
export const FILE_TOO_BIG_MESSAGE_CLIENT =
  "Este archivo pesa más de 4 MB. Divídelo en partes o sube las páginas como fotos.";

export const IMAGE_MAX_SIDE = 1600;
export const IMAGE_JPEG_QUALITY = 0.82;

export const UPLOAD_ACCEPT = ".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg,.webp";

export function isImageFile(file: { name: string; type: string }): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp)$/i.test(file.name || "")
  );
}

/** Size after fitting the long side into `max`; never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  max = IMAGE_MAX_SIDE
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface UploadResultLike {
  recipes_found?: number;
  drafts_created?: number;
  duplicates?: { dish_name: string }[];
  preparations?: { dish_name: string }[];
  ignored_sections?: { name: string; reason?: string }[];
  lines_without_quantity?: number;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The summary box after all files are done: only non-zero lines show. */
export function summarizeUploads(
  results: UploadResultLike[],
  filesCount: number
): string[] {
  const sum = (pick: (r: UploadResultLike) => number) =>
    results.reduce((total, r) => total + pick(r), 0);
  const found = sum((r) => r.recipes_found ?? 0);
  const drafts = sum((r) => r.drafts_created ?? 0);
  const lines: string[] = [
    `Leí ${plural(found, "receta", "recetas")} de ${plural(filesCount, "archivo", "archivos")}: ${plural(drafts, "borrador", "borradores")} para revisar.`,
  ];

  const ignored = results.flatMap((r) => r.ignored_sections ?? []);
  if (ignored.length > 0) {
    const names = ignored.map((s) => s.name).join(", ");
    lines.push(
      ignored.length === 1
        ? `1 hoja no parecía receta (${names}).`
        : `${ignored.length} hojas no parecían receta (${names}).`
    );
  }

  const dups = results.flatMap((r) => r.duplicates ?? []);
  if (dups.length > 0) {
    // Two drafts of the same dish name list that name once.
    const names = [...new Set(dups.map((d) => d.dish_name))].join(", ");
    lines.push(
      dups.length === 1
        ? `1 ya tiene una receta aprobada con el mismo nombre: ${names}. No la cambié; el borrador queda como versión nueva para revisar.`
        : `${dups.length} ya tienen una receta aprobada con el mismo nombre: ${names}. No las cambié; los borradores quedan como versión nueva para revisar.`
    );
  }

  const preps = results.flatMap((r) => r.preparations ?? []);
  if (preps.length > 0) {
    const names = preps.map((p) => p.dish_name).join(", ");
    lines.push(
      preps.length === 1
        ? `1 es una preparación (${names}).`
        : `${preps.length} son preparaciones (${names}).`
    );
  }

  const noQty = sum((r) => r.lines_without_quantity ?? 0);
  if (noQty > 0) {
    lines.push(
      noQty === 1
        ? "1 ingrediente sin cantidad: complétalo al revisar."
        : `${noQty} ingredientes sin cantidad: complétalos al revisar.`
    );
  }
  return lines;
}

/**
 * Shrinks a photo in the browser (long side <= 1600 px, JPEG q 0.82) so it
 * stays well under the 4 MB limit. Returns the original file if the browser
 * cannot decode it.
 */
export async function shrinkImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", IMAGE_JPEG_QUALITY)
    );
    if (!blob) return file;
    const base = (file.name || "foto").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
