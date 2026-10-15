// lib/restaurant/recipe-costing/prepare-from-upload.ts
//
// "Subir Excel de costos" → prepare the dishes from that file: a few dishes at
// a time (top sellers first), so no single request runs long and one failure
// never loses earlier work. Moved as is from the Menú workspace when the setup
// went to Costos (R1-18); the endpoint and its behaviour are unchanged.

/** Dishes per request when generating suggestions. */
export const SUGGESTION_CHUNK = 5;

export interface PrepareTotals {
  suggested: number;
  sinSugerencia: number;
  skipped: number;
}

export class PrepareError extends Error {
  constructor(
    message: string,
    readonly totals: PrepareTotals
  ) {
    super(message);
  }
}

export async function prepareDishesFromUpload(
  onProgress: (p: { done: number; total: number | null }) => void
): Promise<PrepareTotals> {
  const url = "/api/restaurant/recipes/suggestions";
  const totals: PrepareTotals = { suggested: 0, sinSugerencia: 0, skipped: 0 };
  let offset = 0;
  let total: number | null = null;
  try {
    for (let guard = 0; guard < 40; guard++) {
      onProgress({ done: offset, total });
      // The recipes come from the file just uploaded (kept with it).
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "latest_upload",
          limit: SUGGESTION_CHUNK,
          offset,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        suggested?: number;
        sin_sugerencia?: number;
        skipped?: number;
        total?: number;
        next_offset?: number | null;
      };
      if (!res.ok) {
        throw new Error(
          json.error ?? "No pude preparar tus platos desde el archivo."
        );
      }
      totals.suggested += json.suggested ?? 0;
      totals.sinSugerencia += json.sin_sugerencia ?? 0;
      totals.skipped += json.skipped ?? 0;
      total = json.total ?? total;
      if (json.next_offset == null) break;
      offset = json.next_offset;
    }
    return totals;
  } catch (err) {
    throw new PrepareError(
      err instanceof Error
        ? err.message
        : "No pude preparar tus platos desde el archivo.",
      totals
    );
  }
}

/** The message after a finished run. */
export function prepareNotice(totals: PrepareTotals): string {
  return (
    `Listo: ${totals.suggested} ${totals.suggested === 1 ? "plato preparado" : "platos preparados"} desde tu archivo` +
    `, ${totals.sinSugerencia} sin sugerencia` +
    (totals.skipped > 0
      ? `, ${totals.skipped} ya resueltos o con receta propia.`
      : ".")
  );
}

/** The message after a run that failed half way. */
export function prepareFailure(err: PrepareError): string {
  return err.totals.suggested > 0
    ? `${err.message} Lo que ya se generó (${err.totals.suggested} platos) quedó guardado.`
    : err.message;
}
