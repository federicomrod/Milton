// lib/restaurant/telegram/media-copy.ts
//
// Best-effort copy of a Telegram kitchen report's photo or voice note into
// Milton's own Storage (mobile P0a, #430). Runs after the cook already got
// their answer; any failure is swallowed so Telegram never notices. Follows
// files.ts: never logs a token, URL or raw error message.

import { openTelegramFile } from "@/lib/restaurant/telegram/files";
import type { ExtractedReport } from "@/lib/restaurant/telegram/kitchen-reports";
import { KITCHEN_MEDIA_MAX_BYTES } from "@/lib/restaurant/kitchen/media-storage";
import { ingestKitchenMedia } from "@/lib/restaurant/kitchen/pipeline/ingest";

async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Never throws. */
export async function copyTelegramReportMediaToStorage(input: {
  companyId: string;
  locationId: string;
  staffId: string | null;
  kitchenReportId: string;
  report: ExtractedReport;
}): Promise<void> {
  try {
    const { report } = input;
    const fileId = report.telegram_file_id;
    if (!report.media_kind || !fileId) return;
    const result = await ingestKitchenMedia({
      channel: "telegram",
      companyId: input.companyId,
      locationId: input.locationId,
      staffId: input.staffId,
      kitchenReportId: input.kitchenReportId,
      kind: report.media_kind,
      mime: report.media_mime,
      sizeBytes: report.media_size_bytes,
      durationS: report.media_duration_s,
      sourceRef: report.telegram_file_unique_id,
      getBytes: async () => {
        const file = await openTelegramFile(fileId);
        if (!file.ok) return null;
        return readCapped(file.body, KITCHEN_MEDIA_MAX_BYTES);
      },
    });
    if (!result.ok) console.error("[telegram-media-copy] not stored");
  } catch (err) {
    console.error(
      "[telegram-media-copy] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
  }
}
