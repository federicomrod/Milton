// lib/restaurant/telegram/kitchen-media.ts
//
// What happens after a cook sends a photo or a price note on Telegram:
//   * routeCaption          — caption shortcuts (no AI call)
//   * parseKindFollowUp     — «factura» / «receta» reply to a PHOTO_ASK_KIND
//   * findPendingPhotoReport — which photo that reply is about
//   * downloadTelegramImage — bytes -> data URL (20 MB bot limit)
//   * processInvoicePhoto   — photo -> supplier-invoice draft (needs_review)
//   * processPriceUpdate    — «el aguacate subió a 1.50 la libra» -> draft
//   * localDateKey          — Telegram message date -> the company's local date
//
// Nothing here applies a price or writes ingredient_cost_entries: both paths
// only create a `needs_review` supplier invoice that a person approves in the
// app. A missing price is never stored as 0 (createInvoiceDraft strict mode).
//
// SECURITY: logs kinds, ids, counts and timings only. Never tokens, file URLs,
// photo content or transcripts.

import type { createAdminClient } from "@/lib/supabase/admin";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  createInvoiceDraft,
  extractInvoiceFromImage,
  invoiceExistsForKitchenReport,
  PRICE_UPDATE_NOTE_PREFIX,
} from "@/lib/restaurant/invoice-draft";
import type { ExtractedInvoice } from "@/lib/restaurant/invoice-extraction";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { sendTelegramMessage } from "@/lib/restaurant/telegram/send";
import { openTelegramFile } from "@/lib/restaurant/telegram/files";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";
import { classifyKitchenReport } from "@/lib/restaurant/telegram/kitchen-reports";
import {
  currencySymbolFor,
  formatPriceUpdateItems,
  type PriceUpdateItem,
} from "@/lib/restaurant/telegram/price-update";

type Admin = ReturnType<typeof createAdminClient>;

export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const FOLLOW_UP_WINDOW_MS = 30 * 60 * 1000;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Caption + follow-up routing
// ---------------------------------------------------------------------------

export type CaptionRoute = "recipe" | "invoice" | "report" | null;

/** Decides a photo's path from its caption alone. null = ask the classifier. */
export function routeCaption(caption: string | null | undefined): CaptionRoute {
  if (!caption || !caption.trim()) return null;
  const t = normalize(caption);
  if (/\brecetas?\b/.test(t)) return "recipe";
  if (/\b(facturas?|boletas?|recibos?|tickets?)\b|\bcompras?\b/.test(t)) {
    return "invoice";
  }
  if (classifyKitchenReport(caption) !== "unclassified") return "report";
  return null;
}

/** «Factura.» / «receta» (accents, case and trailing punctuation ignored). */
export function parseKindFollowUp(
  text: string | null | undefined
): "invoice" | "recipe" | null {
  if (!text) return null;
  const t = normalize(text)
    .trim()
    .replace(/[\s.,;:!?¡¿"'«»]+$/g, "")
    .replace(/^[\s¡¿"'«»]+/g, "");
  if (t === "factura") return "invoice";
  if (t === "receta") return "recipe";
  return null;
}

export interface PendingPhoto {
  reportId: string;
  messageId: number;
  fileId: string;
  mime: string | null;
  caption: string | null;
  /** Unix seconds the photo was received. */
  dateSec: number | null;
}

/**
 * The staff member's most recent photo report (last 30 min) that still has
 * neither a recipe draft nor an invoice. null when nothing matches.
 */
export async function findPendingPhotoReport(
  admin: Admin,
  staff: { id: string; company_id: string },
  chatId: number
): Promise<PendingPhoto | null> {
  const since = new Date(Date.now() - FOLLOW_UP_WINDOW_MS).toISOString();
  const { data } = await admin
    .from("kitchen_reports")
    .select(
      "id, telegram_message_id, telegram_file_id, media_mime, text, created_at"
    )
    .eq("company_id", staff.company_id)
    .eq("staff_id", staff.id)
    .eq("telegram_chat_id", chatId)
    .eq("media_kind", "photo")
    .eq("report_type", "unclassified")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);

  for (const row of (data ?? []) as Array<{
    id: string;
    telegram_message_id: number;
    telegram_file_id: string | null;
    media_mime: string | null;
    text: string | null;
    created_at: string | null;
  }>) {
    if (!row.telegram_file_id) continue;
    const { data: draft } = await admin
      .from("kitchen_recipe_drafts")
      .select("id")
      .eq("kitchen_report_id", row.id)
      .maybeSingle();
    if (draft) continue;
    const { data: draftByMsg } = await admin
      .from("kitchen_recipe_drafts")
      .select("id")
      .eq("telegram_chat_id", chatId)
      .eq("telegram_message_id", row.telegram_message_id)
      .maybeSingle();
    if (draftByMsg) continue;
    if (await invoiceExistsForKitchenReport(admin, staff.company_id, row.id)) {
      continue;
    }
    const ms = row.created_at ? Date.parse(row.created_at) : NaN;
    return {
      reportId: row.id,
      messageId: row.telegram_message_id,
      fileId: row.telegram_file_id,
      mime: row.media_mime,
      caption: row.text,
      dateSec: Number.isFinite(ms) ? Math.floor(ms / 1000) : null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * YYYY-MM-DD of a Unix-seconds instant in an IANA zone (the company's POS /
 * briefing zone), NOT UTC midnight. Unknown zone -> UTC. No date -> now.
 */
export function localDateKey(
  epochSeconds: number | null | undefined,
  timeZone: string
): string {
  const ms =
    typeof epochSeconds === "number" && Number.isFinite(epochSeconds)
      ? epochSeconds * 1000
      : Date.now();
  const date = new Date(ms);
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Telegram file -> data URL, or null (too big, unreachable, empty). */
export async function downloadTelegramImage(
  fileId: string,
  mime: string | null | undefined
): Promise<string | null> {
  const stream = await openTelegramFile(fileId);
  if (!stream.ok) return null;
  const declared = Number(stream.contentLength);
  if (Number.isFinite(declared) && declared > TELEGRAM_MAX_DOWNLOAD_BYTES) {
    await stream.body.cancel().catch(() => undefined);
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        total += value.byteLength;
        if (total > TELEGRAM_MAX_DOWNLOAD_BYTES) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
      if (done) break;
    }
  } catch {
    return null;
  }
  if (total === 0) return null;
  const safeMime =
    mime && /^image\/(jpeg|png|webp)$/i.test(mime)
      ? mime.toLowerCase()
      : "image/jpeg";
  return `data:${safeMime};base64,${Buffer.concat(chunks).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Invoice photo
// ---------------------------------------------------------------------------

export interface KitchenActor {
  id: string;
  company_id: string;
  location_id: string;
  location_name: string;
}

export interface InvoicePhotoInput {
  admin: Admin;
  staff: KitchenActor;
  chatId: number;
  messageId: number;
  reportId: string | null;
  fileId: string;
  mime: string | null;
  /** Unix seconds of the Telegram message. */
  dateSec: number | null;
  /** Already downloaded (the classifier did it). */
  dataUrl?: string | null;
}

export const INVOICE_TELEGRAM_NOTE =
  "Factura enviada por Telegram. Valores leídos de la foto: revisa antes de aprobar.";

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

export async function processInvoicePhoto(
  input: InvoicePhotoInput
): Promise<void> {
  const { admin, staff, chatId } = input;
  const started = Date.now();
  const unreadable = () =>
    sendTelegramMessage(chatId, KITCHEN_COPY.INVOICE_UNREADABLE);

  if (
    input.reportId &&
    (await invoiceExistsForKitchenReport(
      admin,
      staff.company_id,
      input.reportId
    ))
  ) {
    return; // already handled (duplicate delivery / double follow-up)
  }

  const dataUrl =
    input.dataUrl ?? (await downloadTelegramImage(input.fileId, input.mime));
  if (!dataUrl) {
    console.error("[kitchen-media] invoice photo download failed");
    await unreadable();
    return;
  }

  const extracted = await extractInvoiceFromImage({
    dataUrl,
    timeoutMs: 45_000,
    notesLanguage: "es",
  });
  if (!extracted.ok) {
    console.error(
      "[kitchen-media] invoice extraction failed:",
      extracted.reason
    );
    await unreadable();
    return;
  }

  const tz = await resolvePosTimezone(admin as never, staff.company_id);
  const created = await createInvoiceDraft(admin, {
    companyId: staff.company_id,
    userId: null,
    extraction: extracted.extraction,
    sourceType: "image",
    originalFileName: `telegram-${input.messageId}.jpg`,
    extraNotes: INVOICE_TELEGRAM_NOTE,
    eventMetadata: {
      source: "telegram",
      kitchen_report_id: input.reportId,
      staff_id: staff.id,
      location_id: staff.location_id,
    },
    strictPrices: true,
    fallbackInvoiceDate: localDateKey(input.dateSec, tz),
  });
  if (!created.ok) {
    console.error("[kitchen-media] invoice draft not created:", created.reason);
    await unreadable();
    return;
  }

  const skipped = created.linesSkipped.length;
  console.info(
    `[kitchen-media] invoice draft lines=${created.linesInserted} unpriced=${skipped} ${Date.now() - started}ms`
  );
  await sendTelegramMessage(
    chatId,
    renderKitchenCopy(KITCHEN_COPY.INVOICE_RECEIVED, {
      de_proveedor: created.supplierName ? ` de ${created.supplierName}` : "",
      lineas: plural(created.linesInserted, "línea", "líneas"),
      sin_precio:
        skipped > 0
          ? ` ${skipped === 1 ? "1 línea quedó sin precio." : `${skipped} líneas quedaron sin precio.`}`
          : "",
    })
  );
}

// ---------------------------------------------------------------------------
// Price update
// ---------------------------------------------------------------------------

export interface PriceUpdateInput {
  admin: Admin;
  staff: KitchenActor;
  chatId: number;
  reportId: string | null;
  dateSec: number | null;
  items: PriceUpdateItem[];
  origin: "voice" | "text";
}

/** Stores the update as a needs_review draft. Never applies a price. */
export async function processPriceUpdate(
  input: PriceUpdateInput
): Promise<void> {
  const { admin, staff, chatId } = input;
  if (
    input.reportId &&
    (await invoiceExistsForKitchenReport(
      admin,
      staff.company_id,
      input.reportId
    ))
  ) {
    return;
  }

  const tz = await resolvePosTimezone(admin as never, staff.company_id);
  const extraction: ExtractedInvoice = {
    supplier_name: null,
    invoice_number: null,
    invoice_date: localDateKey(input.dateSec, tz),
    due_date: null,
    currency: null,
    subtotal: null,
    tax_amount: null,
    total_amount: null,
    confidence_notes: [],
    lines: input.items.map((item) => ({
      description: item.name,
      supplier_item_name: item.name,
      supplier_sku: null,
      quantity: 1,
      unit: item.unit,
      unit_cost: item.price,
      line_total: item.price,
      tax_amount: null,
    })),
  };

  const created = await createInvoiceDraft(admin, {
    companyId: staff.company_id,
    userId: null,
    extraction,
    sourceType: "manual",
    originalFileName: null,
    extraNotes: PRICE_UPDATE_NOTE_PREFIX,
    eventMetadata: {
      source: "telegram",
      kind: "price_update",
      kitchen_report_id: input.reportId,
      staff_id: staff.id,
    },
    strictPrices: true,
  });
  if (!created.ok) {
    console.error("[kitchen-media] price update not stored:", created.reason);
    await sendTelegramMessage(chatId, KITCHEN_COPY.PRICE_UPDATE_FAILED);
    return;
  }
  console.info(
    `[kitchen-media] price update draft items=${input.items.length}`
  );
  await sendTelegramMessage(
    chatId,
    renderKitchenCopy(KITCHEN_COPY.PRICE_UPDATE_RECEIVED, {
      items: formatPriceUpdateItems(
        input.items,
        currencySymbolFor(
          await resolveCompanyCurrency(admin as never, staff.company_id).catch(
            () => null
          )
        )
      ),
    })
  );
}
