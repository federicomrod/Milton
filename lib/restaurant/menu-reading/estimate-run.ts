// «Estimar con Milton»: the client run loop as a PURE function (no React, no
// fetch), so every stop rule is testable. The server answers each chunk with
// `done` (a COUNT of platos estimated in that chunk, never a «finished» flag)
// and `remaining` (estimable platos still waiting after the chunk).

export interface ChunkResult {
  menu_item_id: string;
  name?: string | null;
  odoo_product_id?: number | null;
  skipped_reason?: string | null;
}

export interface ChunkResponse {
  /** Count of platos estimated in this chunk. NOT a boolean. */
  done?: number;
  /** Platos still waiting after this chunk (null/undefined = unknown). */
  remaining?: number;
  results?: ChunkResult[];
  error?: string;
}

/** A failed call. `status` 503 = the database update is missing. */
export class EstimateChunkError extends Error {
  constructor(
    public status: number,
    message?: string
  ) {
    super(message ?? "No pude estimar.");
  }
}

export interface EstimateRunOutcome {
  /** Every plato handled, in the order the server returned them. */
  results: ChunkResult[];
  estimated: number;
  skipped: number;
  /** Platos still waiting after the last chunk; null when unknown. */
  remaining: number | null;
  /** A gray note that replaces the summary (e.g. the missing migration). */
  note: string | null;
}

export async function runEstimateChunks({
  post,
  total,
  onProgress,
  missingTableNote,
}: {
  /** One call to the server for at most `limit` platos. Throws EstimateChunkError. */
  post: (limit: number) => Promise<ChunkResponse>;
  /** This run's target (already capped at the max per run). */
  total: number;
  /** Platos handled so far, after every chunk. */
  onProgress?: (processed: number) => void;
  missingTableNote?: string;
}): Promise<EstimateRunOutcome> {
  const seen = new Set<string>();
  const results: ChunkResult[] = [];
  let estimated = 0;
  let skipped = 0;
  let failedInARow = 0;
  let remaining: number | null = null;
  let note: string | null = null;

  while (seen.size < total) {
    let json: ChunkResponse;
    try {
      json = await post(total - seen.size);
    } catch (err) {
      if (err instanceof EstimateChunkError && err.status === 503) {
        note = missingTableNote ?? err.message;
        break;
      }
      failedInARow += 1;
      if (failedInARow >= 2) break;
      continue;
    }
    failedInARow = 0;
    let fresh = 0;
    for (const r of json.results ?? []) {
      if (seen.has(r.menu_item_id)) continue;
      seen.add(r.menu_item_id);
      results.push(r);
      fresh += 1;
      if (r.skipped_reason) skipped += 1;
      else estimated += 1;
    }
    remaining =
      typeof json.remaining === "number" && Number.isFinite(json.remaining)
        ? Math.max(0, json.remaining)
        : null;
    onProgress?.(seen.size);
    // Nothing new (repeated or empty): stop, never loop forever. Nothing left
    // on the server: stop. `done` is a count and is never read as a flag.
    if (fresh === 0 || remaining === 0) break;
  }
  return { results, estimated, skipped, remaining, note };
}

/** «Quedan 12 platos sin estimar…» after a run, or null when none are left. */
export function remainingNote(remaining: number | null): string | null {
  if (remaining == null || remaining <= 0) return null;
  return `${remaining === 1 ? "Queda 1 plato" : `Quedan ${remaining} platos`} sin estimar. Vuelve a pulsar para estimar ${remaining === 1 ? "el siguiente" : "los siguientes"}.`;
}
