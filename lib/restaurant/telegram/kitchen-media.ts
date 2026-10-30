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
import { INVOICE_TELEGRAM_NOTE } from "@/lib/restaurant/price-update-note";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import {
  sendTelegramMessage,
  type InlineKeyboardMarkup,
} from "@/lib/restaurant/telegram/send";
import { openTelegramFile } from "@/lib/restaurant/telegram/files";
import {
  destinationVars,
  KITCHEN_COPY,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";
import { classifyKitchenReport } from "@/lib/restaurant/telegram/kitchen-reports";
import {
  findExactIngredient,
  findSynonymIngredient,
  looselySameName,
} from "@/lib/restaurant/kitchen-ingredient-match";
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
  company_name: string;
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
  /** «Cambiar restaurante» button on the success reply (default routing). */
  replyMarkup?: InlineKeyboardMarkup;
}

// The note text lives in price-update-note.ts (client-safe) so Compras can
// recognize Telegram invoices; re-exported here for callers and tests.
export { INVOICE_TELEGRAM_NOTE };

/**
 * « 1 línea quedó sin precio. 2 líneas quedaron sin cantidad.»: one phrase per
 * reason, so a line skipped for a missing quantity is never called «sin precio».
 */
export function skippedSentence(
  skipped: ReadonlyArray<{ reason: string }>
): string {
  const parts: string[] = [];
  for (const [reason, what] of [
    ["no_price", KITCHEN_COPY.FRAG_NO_PRICE],
    ["no_quantity", KITCHEN_COPY.FRAG_NO_QUANTITY],
    ["no_unit", KITCHEN_COPY.FRAG_NO_UNIT],
  ] as const) {
    const n = skipped.filter((l) => l.reason === reason).length;
    if (n > 0) {
      parts.push(
        renderKitchenCopy(
          n === 1
            ? KITCHEN_COPY.FRAG_SKIPPED_ONE
            : KITCHEN_COPY.FRAG_SKIPPED_MANY,
          { n: String(n), what }
        )
      );
    }
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

// Same as sendTelegramMessage(chatId, text) unless a button is attached.
function reply(chatId: number, text: string, markup?: InlineKeyboardMarkup) {
  return markup
    ? sendTelegramMessage(chatId, text, { replyMarkup: markup })
    : sendTelegramMessage(chatId, text);
}

function linesPhrase(n: number): string {
  return n === 1
    ? KITCHEN_COPY.FRAG_LINE_ONE
    : renderKitchenCopy(KITCHEN_COPY.FRAG_LINES, { n: String(n) });
}

/**
 * Re-reads the draft by id AND company. A reply claims success only when the
 * row really exists as a needs_review invoice.
 */
async function draftIsSaved(
  admin: Admin,
  companyId: string,
  invoiceId: string
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("supplier_invoices")
      .select("id, company_id, status")
      .eq("id", invoiceId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) return false;
    return data.status === "needs_review";
  } catch {
    return false;
  }
}

/** lines_failed leaves a header with no lines: remove it (and any events). */
async function deleteOrphanHeader(
  admin: Admin,
  companyId: string,
  invoice: Record<string, unknown> | undefined
): Promise<void> {
  const id = invoice && typeof invoice.id === "string" ? invoice.id : null;
  if (!id) return;
  try {
    await admin
      .from("invoice_events")
      .delete()
      .eq("invoice_id", id)
      .eq("company_id", companyId);
    await admin
      .from("supplier_invoice_lines")
      .delete()
      .eq("invoice_id", id)
      .eq("company_id", companyId);
    await admin
      .from("supplier_invoices")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
  } catch {
    console.error("[kitchen-media] orphan invoice cleanup failed");
  }
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
    companyId: staff.company_id,
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
  const companyCurrency = await resolveCompanyCurrency(
    admin as never,
    staff.company_id
  ).catch(() => null);

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
    console.error(
      `[kitchen-media] invoice save failed reason=${created.reason}`
    );
    if (created.reason === "lines_failed") {
      await deleteOrphanHeader(admin, staff.company_id, created.invoice);
    }
    if (created.reason === "currency_mismatch") {
      await sendTelegramMessage(chatId, KITCHEN_COPY.INVOICE_CURRENCY_MISMATCH);
    } else if (
      created.reason === "invoice_failed" ||
      created.reason === "supplier_failed" ||
      created.reason === "lines_failed"
    ) {
      await sendTelegramMessage(chatId, KITCHEN_COPY.INVOICE_SAVE_FAILED);
    } else {
      await unreadable(); // missing_date / no_lines / no_usable_lines
    }
    return;
  }
  if (!(await draftIsSaved(admin, staff.company_id, created.invoiceId))) {
    console.error("[kitchen-media] invoice save failed reason=reread_failed");
    await sendTelegramMessage(chatId, KITCHEN_COPY.INVOICE_SAVE_FAILED);
    return;
  }

  const skipped = created.linesSkipped.length;
  console.info(
    `[kitchen-media] invoice draft saved id=${created.invoiceId} company=${staff.company_id} lines=${created.linesInserted} unpriced=${skipped} ${Date.now() - started}ms`
  );
  await reply(
    chatId,
    renderKitchenCopy(KITCHEN_COPY.INVOICE_RECEIVED, {
      ...destinationVars(staff),
      de_proveedor: created.supplierName
        ? renderKitchenCopy(KITCHEN_COPY.FRAG_OF_SUPPLIER, {
            proveedor: created.supplierName,
          })
        : "",
      lineas: linesPhrase(created.linesInserted),
      sin_precio: skippedSentence(created.linesSkipped),
    }),
    input.replyMarkup
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
  /** «Cambiar restaurante» button on the success reply (default routing). */
  replyMarkup?: InlineKeyboardMarkup;
  /**
   * Extra lines of the SAME reply (a unit question, items not understood…):
   * a message with several prices gets ONE answer.
   */
  replySuffix?: string;
}

/** How a currency is named in a reply: «pesos mexicanos (MXN)». */
const CURRENCY_COPY_KEYS = {
  USD: "CURRENCY_USD",
  MXN: "CURRENCY_MXN",
  CRC: "CURRENCY_CRC",
  GTQ: "CURRENCY_GTQ",
  HNL: "CURRENCY_HNL",
  PEN: "CURRENCY_PEN",
  EUR: "CURRENCY_EUR",
  NIO: "CURRENCY_NIO",
} as const;
export function currencyName(code: string): string {
  const key =
    CURRENCY_COPY_KEYS[code.toUpperCase() as keyof typeof CURRENCY_COPY_KEYS];
  return key ? KITCHEN_COPY[key] : code;
}

/** Up to 3 close ACTIVE ingredients for a name that matched none. */
export function closeIngredientNames(
  name: string,
  ingredients: Array<{ id: string; name: string }>
): string[] {
  const out: string[] = [];
  const add = (n: string | undefined) => {
    if (n && !out.includes(n)) out.push(n);
  };
  // A name equal to the said one is not a "parecido": it would be the match.
  const equalToSaid = (n: string) =>
    findExactIngredient(name, [{ id: "x", name: n }]) !== null;
  add(findExactIngredient(name, ingredients)?.name);
  add(findSynonymIngredient(name, ingredients)?.name);
  const scored = ingredients
    .map((ing) => ({ ing, score: looselySameName(name, ing.name) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.ing.name.length - b.ing.name.length ||
        a.ing.name.localeCompare(b.ing.name, "es")
    );
  for (const x of scored) add(x.ing.name);
  return out.filter((n) => !equalToSaid(n)).slice(0, 3);
}

/**
 * One line per saved line that matched no ingredient: the draft is saved
 * anyway; the cook is told, with up to 3 close names. Best effort: any
 * failure here just means no extra lines.
 */
async function ingredientNotFoundLines(
  admin: Admin,
  staff: KitchenActor,
  invoiceId: string
): Promise<string[]> {
  try {
    const { data: lineRows } = await admin
      .from("supplier_invoice_lines")
      .select("description, match_status")
      .eq("company_id", staff.company_id)
      .eq("invoice_id", invoiceId);
    const unmatched = ((lineRows ?? []) as Array<Record<string, unknown>>)
      .filter((l) => l.match_status === "unmatched")
      .map((l) => String(l.description ?? "").trim())
      .filter(Boolean);
    if (unmatched.length === 0) return [];
    const { data: ings } = await admin
      .from("ingredients")
      .select("id, name")
      .eq("company_id", staff.company_id)
      .is("archived_at", null);
    const catalog = ((ings ?? []) as Array<Record<string, unknown>>).map(
      (i) => ({ id: String(i.id), name: String(i.name ?? "") })
    );
    return (
      [...new Set(unmatched)]
        // A said name that IS an active ingredient's name never gets a
        // «no encontré» (it would be a lie, whatever the saved status).
        .filter((name) => findExactIngredient(name, catalog) === null)
        .slice(0, 5)
        .map((name) => {
          const close = closeIngredientNames(name, catalog);
          return renderKitchenCopy(KITCHEN_COPY.PRICE_INGREDIENT_NOT_FOUND, {
            ingrediente: name,
            parecidos:
              close.length > 0
                ? renderKitchenCopy(KITCHEN_COPY.FRAG_SIMILAR, {
                    lista: close.join(", "),
                  })
                : "",
          });
        })
    );
  } catch {
    return [];
  }
}

/**
 * processPriceUpdate that never throws and never leaves the cook without an
 * answer: on an exception it logs a fixed line and sends PRICE_SAVE_FAILED
 * (with the same extra lines), the send itself protected.
 */
export async function processPriceUpdateSafe(
  input: PriceUpdateInput
): Promise<void> {
  try {
    await processPriceUpdate(input);
  } catch {
    console.error("[kitchen-media] price update failed");
    try {
      await sendTelegramMessage(
        input.chatId,
        input.replySuffix
          ? `${KITCHEN_COPY.PRICE_SAVE_FAILED}\n\n${input.replySuffix}`
          : KITCHEN_COPY.PRICE_SAVE_FAILED,
        input.replyMarkup ? { replyMarkup: input.replyMarkup } : undefined
      );
    } catch {
      // nothing more to do
    }
  }
}

/**
 * True (and the cook is told) when the currency they said is not the
 * company's: nothing is saved in that case. `said` null = none said.
 */
export async function refuseForeignCurrency(args: {
  admin: ReturnType<typeof createAdminClient>;
  staff: KitchenActor;
  chatId: number;
  said: string | null;
  suffix?: string;
  replyMarkup?: InlineKeyboardMarkup;
}): Promise<boolean> {
  if (!args.said) return false;
  const companyCurrency = await resolveCompanyCurrency(
    args.admin as never,
    args.staff.company_id
  ).catch(() => null);
  if (
    !companyCurrency ||
    args.said.toUpperCase() === companyCurrency.toUpperCase()
  )
    return false;
  console.info("[kitchen-media] price update currency mismatch");
  const text = renderKitchenCopy(KITCHEN_COPY.PRICE_CURRENCY_MISMATCH, {
    ...destinationVars(args.staff),
    moneda_dicha: currencyName(args.said),
    moneda_empresa: currencyName(companyCurrency),
  });
  await sendTelegramMessage(
    args.chatId,
    args.suffix ? `${text}\n\n${args.suffix}` : text,
    args.replyMarkup ? { replyMarkup: args.replyMarkup } : undefined
  );
  return true;
}

/** Stores the update as a needs_review draft. Never applies a price. */
export async function processPriceUpdate(
  input: PriceUpdateInput
): Promise<void> {
  const { admin, staff, chatId } = input;
  const withSuffix = (t: string) =>
    input.replySuffix ? `${t}\n\n${input.replySuffix}` : t;
  if (
    input.reportId &&
    (await invoiceExistsForKitchenReport(
      admin,
      staff.company_id,
      input.reportId
    ))
  ) {
    // A webhook retry: the first delivery already answered.
    console.info("[kitchen-media] price update duplicate report");
    return;
  }

  // The currency the cook SAID must be the company's. Never converted, never
  // saved as if it were the company's money.
  const said = input.items
    .map((i) => i.currency)
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (
    await refuseForeignCurrency({
      admin,
      staff,
      chatId,
      said: said[0] ?? null,
      suffix: input.replySuffix,
      replyMarkup: input.replyMarkup,
    })
  ) {
    return;
  }

  const companyCurrency = await resolveCompanyCurrency(
    admin as never,
    staff.company_id
  ).catch(() => null);
  const tz = await resolvePosTimezone(admin as never, staff.company_id);
  const extraction: ExtractedInvoice = {
    supplier_name: null,
    invoice_number: null,
    invoice_date: localDateKey(input.dateSec, tz),
    due_date: null,
    currency: said[0] ?? null,
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
    // The cook says «harina de trigo»: match it to the ingredient of that name.
    matchByIngredientName: true,
  });
  if (!created.ok) {
    console.error(
      `[kitchen-media] price update not stored reason=${created.reason}`
    );
    if (created.reason === "lines_failed") {
      await deleteOrphanHeader(admin, staff.company_id, created.invoice);
    }
    await sendTelegramMessage(
      chatId,
      withSuffix(KITCHEN_COPY.PRICE_SAVE_FAILED)
    );
    return;
  }
  if (!(await draftIsSaved(admin, staff.company_id, created.invoiceId))) {
    console.error(
      "[kitchen-media] price update not stored reason=reread_failed"
    );
    await sendTelegramMessage(
      chatId,
      withSuffix(KITCHEN_COPY.PRICE_SAVE_FAILED)
    );
    return;
  }
  console.info(
    `[kitchen-media] price update draft items=${input.items.length}`
  );
  const received = renderKitchenCopy(KITCHEN_COPY.PRICE_UPDATE_RECEIVED, {
    ...destinationVars(staff),
    items: formatPriceUpdateItems(
      input.items,
      currencySymbolFor(companyCurrency)
    ),
  });
  const notFound =
    created.unmatched > 0
      ? await ingredientNotFoundLines(admin, staff, created.invoiceId)
      : [];
  await reply(
    chatId,
    withSuffix([received, ...notFound].join("\n")),
    input.replyMarkup
  );
}
