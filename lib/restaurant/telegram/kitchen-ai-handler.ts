/**
 * AI-first handler for kitchen messages. Production-safe fallback approach:
 * - Keeps existing flows (invoice, recipe, stock reports, unit questions) working
 * - AI interprets ambiguous cases that would get generic "Recibido"
 * - Never crashes, never silent, always replies
 * 
 * TODAY'S PRODUCTION REQUIREMENTS:
 * - Whatever kitchen sends → captured as draft OR smart Spanish reply
 * - Never bare "Recibido", never silence, never crash
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  interpretKitchenMessage,
  type KitchenIntentResult,
} from "./kitchen-intent-ai";
import { buildKitchenContext } from "./kitchen-context";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
  destinationVars,
} from "./kitchen-copy";
import { sendTelegramMessage, type InlineKeyboardMarkup } from "./send";
import type { KitchenActor } from "./kitchen-media";
import { recordKitchenReport } from "./kitchen-reports";

export type AiHandlerContext = {
  admin: SupabaseClient;
  staff: KitchenActor;
  chatId: number;
  messageId: number;
  text: string;
  markup?: InlineKeyboardMarkup;
};

/**
 * Handles messages based on AI intent classification.
 * Returns true if handled, false if should fall through to existing logic.
 */
export async function handleWithAi(
  ctx: AiHandlerContext
): Promise<boolean> {
  try {
    // Build context from existing data
    const context = await buildKitchenContext(
      ctx.admin,
      ctx.chatId,
      ctx.staff.company_id,
      ctx.text
    );

    // Call AI interpreter
    const result = await interpretKitchenMessage(ctx.text, context);

    // AI timeout or failure: let existing logic handle it
    if (!result) return false;

    // Handle each intent
    return await handleIntent(result, ctx);
  } catch (err) {
    console.error("[kitchen-ai-handler] failed:", err instanceof Error ? err.message : "unknown");
    // On hard failure, send fallback reply
    try {
      await sendTelegramMessage(
        ctx.chatId,
        renderKitchenCopy(KITCHEN_COPY.PROCESSING_FAILED, destinationVars(ctx.staff)),
        ctx.markup ? { replyMarkup: ctx.markup } : undefined
      );
    } catch {
      // Even send failed - at least we tried
    }
    return true; // Handled (even if poorly)
  }
}

async function handleIntent(
  result: KitchenIntentResult,
  ctx: AiHandlerContext
): Promise<boolean> {
  const dest = destinationVars(ctx.staff);

  switch (result.intent) {
    case "question":
      await sendTelegramMessage(
        ctx.chatId,
        KITCHEN_COPY.QUESTION_RESPONSE,
        ctx.markup ? { replyMarkup: ctx.markup } : undefined
      );
      return true;

    case "greeting_or_smalltalk":
      await sendTelegramMessage(
        ctx.chatId,
        renderKitchenCopy(KITCHEN_COPY.GREETING_RESPONSE, dest),
        ctx.markup ? { replyMarkup: ctx.markup } : undefined
      );
      return true;

    case "complaint_or_problem":
      await sendTelegramMessage(
        ctx.chatId,
        renderKitchenCopy(KITCHEN_COPY.COMPLAINT_RESPONSE, dest),
        ctx.markup ? { replyMarkup: ctx.markup } : undefined
      );
      return true;

    case "unclear":
      await sendTelegramMessage(
        ctx.chatId,
        KITCHEN_COPY.UNCLEAR_MESSAGE,
        ctx.markup ? { replyMarkup: ctx.markup } : undefined
      );
      return true;

    case "price_update":
    case "answer_to_pending":
    case "stock_report":
    case "recipe":
    case "invoice_photo":
      // Let existing specialized handlers deal with these
      return false;

    default:
      return false;
  }
}

/**
 * Handles unsupported media types (stickers, videos, non-PDF documents, locations).
 */
export async function handleUnsupportedMedia(
  chatId: number,
  staff: KitchenActor,
  markup?: InlineKeyboardMarkup
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    KITCHEN_COPY.UNSUPPORTED_MEDIA,
    markup ? { replyMarkup: markup } : undefined
  );
}

/**
 * Handles photos that are neither invoices nor recipes.
 */
export async function handleUnrecognizedPhoto(
  chatId: number,
  staff: KitchenActor,
  markup?: InlineKeyboardMarkup
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    KITCHEN_COPY.PHOTO_NOT_RECOGNIZED,
    markup ? { replyMarkup: markup } : undefined
  );
}

/**
 * Stores message as kitchen report even when processing fails (no data loss).
 */
export async function storeAsReport(
  admin: SupabaseClient,
  staff: KitchenActor,
  chatId: number,
  report: {
    telegram_message_id: number;
    text?: string | null;
    transcript?: string | null;
    media_kind?: "photo" | "voice" | null;
    telegram_file_id?: string | null;
  }
): Promise<string | null> {
  try {
    const inserted = await recordKitchenReport({
      companyId: staff.company_id,
      locationId: staff.location_id,
      staffId: staff.id,
      chatId,
      report: {
        telegram_message_id: report.telegram_message_id,
        report_type: "unclassified",
        text: report.text || null,
        transcript: report.transcript || null,
        media_kind: report.media_kind || null,
        telegram_file_id: report.telegram_file_id || null,
        telegram_file_unique_id: null,
        media_mime: null,
        media_duration_s: null,
        media_size_bytes: null,
      },
    });

    if (inserted) {
      const { data } = await admin
        .from("kitchen_reports")
        .select("id")
        .eq("telegram_chat_id", chatId)
        .eq("telegram_message_id", report.telegram_message_id)
        .maybeSingle();

      return data?.id || null;
    }
  } catch (err) {
    console.error("[kitchen-ai-handler] store failed:", err instanceof Error ? err.message : "unknown");
  }
  return null;
}
