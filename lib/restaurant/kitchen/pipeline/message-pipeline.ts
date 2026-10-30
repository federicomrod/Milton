// lib/restaurant/kitchen/pipeline/message-pipeline.ts
//
// The text / transcript pipeline of a kitchen message, shared by every channel
// (moved verbatim out of the Telegram webhook route, mobile app messages #431):
//   1. rules (+ the price AI for the parts the rules could not read)
//      -> saved / asked: answered (applyPriceResult)
//   2. a recipe -> the caller continues with the recipe draft
//   3. the AI interpreter (handleWithAi) with context, BEFORE any reply
//   4. its timeout/failure -> a deterministic reply (never a bare «Recibido»)
// Replies go through sendTelegramMessage; the app runs this inside a reply
// sink (reply-sink.ts) that captures them instead of sending them.
//
// SECURITY: logs fixed lines only, never the text.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendTelegramMessage,
  type InlineKeyboardMarkup,
} from "@/lib/restaurant/telegram/send";
import {
  destinationVars,
  KITCHEN_COPY,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";
import { classifyKitchenReport } from "@/lib/restaurant/telegram/kitchen-reports";
import {
  type KitchenActor,
  currencyName,
  processPriceUpdateSafe,
} from "@/lib/restaurant/telegram/kitchen-media";
import {
  purchaseMentions,
  type DraftLine,
  type PriceUpdateItem,
} from "@/lib/restaurant/telegram/price-update";
import {
  aiStage,
  isActionable,
  overLimitLine,
  routeOf,
  rulesStage,
  unclearLine,
  type PriceFlowResult,
  type PriceItemsResult,
} from "@/lib/restaurant/telegram/price-flow";
import { askPriceAi } from "@/lib/restaurant/telegram/price-update-ai";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { type KitchenLink } from "@/lib/restaurant/telegram/kitchen-links";

export interface PriceCtx {
  admin: ReturnType<typeof createAdminClient>;
  staff: KitchenActor;
  /** The restaurant link the unit question belongs to. */
  link: KitchenLink | null;
  chatId: number;
  messageId: number;
  reportId: string | null;
  dateSec: number | null;
  origin: "text" | "voice";
  /** Length of the text / transcript (the only thing ever logged about it). */
  len: number;
  markup?: InlineKeyboardMarkup;
}

// One line per message: ids and counts only, NEVER the text.
export function logPriceRoute(
  ctx: Pick<PriceCtx, "origin" | "len">,
  route: string,
  r: PriceItemsResult | undefined,
  aiCalled: boolean
) {
  const lenKey = ctx.origin === "voice" ? "transcript_len" : "text_len";
  console.info(
    `[telegram-webhook] price_flow ${lenKey}=${ctx.len} route=${route}` +
      ` items_saved=${r?.saved.length ?? 0}` +
      ` items_unit_asked=${r?.needUnit.length ?? 0}` +
      ` items_amount_asked=${r?.ambiguous.length ?? 0}` +
      ` items_unclear=${r?.unclear.length ?? 0}` +
      ` items_skipped_no_price=${r?.skippedNoPrice.length ?? 0}` +
      ` ai_called=${aiCalled}`
  );
}

// What to say when nothing could be saved or asked but the message read like a
// price (the rules' «No entendí…» / «No pude leer los precios ahora»).
function unclearReply(result: PriceFlowResult): string | null {
  if (result.kind !== "items") return null;
  const line = unclearLine(result.r, true);
  if (!line) return null;
  return result.aiFailed && line === KITCHEN_COPY.PRICE_UPDATE_UNCLEAR
    ? KITCHEN_COPY.PRICE_UPDATE_FAILED
    : line;
}

// The first currency the cook SAID that differs from the company's, if any.
async function replyIfCurrencyMismatch(
  r: PriceItemsResult,
  ctx: PriceCtx
): Promise<boolean> {
  const said = [
    ...r.saved.map((i) => i.currency),
    ...r.needUnit.map((i) => (i as { currency?: string | null }).currency),
    ...r.ambiguous.map((i) => i.currency),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  if (said.length === 0) return false;
  const company = await resolveCompanyCurrency(
    ctx.admin as never,
    ctx.staff.company_id
  ).catch(() => null);
  if (!company) return false;
  const wrong = said.find((c) => c.toUpperCase() !== company.toUpperCase());
  if (!wrong) return false;
  await sendTelegramMessage(
    ctx.chatId,
    renderKitchenCopy(KITCHEN_COPY.PRICE_CURRENCY_MISMATCH, {
      ...destinationVars(ctx.staff),
      moneda_dicha: currencyName(wrong),
      moneda_empresa: currencyName(company),
    }),
    ctx.markup ? { replyMarkup: ctx.markup } : undefined
  );
  return true;
}

/**
 * Every product the price flow met, as a Compras line. NOTHING is dropped and
 * the cook is never asked a follow-up: what was not said (price, quantity,
 * unit) stays empty and the manager completes it in Revisar.
 */
export function draftLinesOf(
  r: PriceItemsResult,
  mentions: DraftLine[] = []
): DraftLine[] {
  const lines: DraftLine[] = [
    ...r.saved.map((i) => ({
      name: i.name,
      price: i.price,
      unit: i.unit,
      currency: i.currency,
    })),
    // A price without a unit: kept, the unit shows «Falta».
    ...r.needUnit.map((i) => ({
      name: i.name,
      price: i.price,
      unit: null,
      currency: (i as { currency?: PriceUpdateItem["currency"] }).currency,
    })),
    // «aguacate a 150»: 1.50 or 150? Never guessed, never asked: no price.
    ...r.ambiguous.map((a) => ({
      name: a.product,
      price: null,
      unit: a.unit,
    })),
    ...r.unclear
      .filter((u): u is { label: string; hint?: string } => !!u.label)
      .map((u) => ({ name: u.label, price: null, unit: null })),
    ...r.skippedNoPrice
      .filter(Boolean)
      .map((name) => ({ name, price: null, unit: null })),
    ...mentions,
  ];
  const seen = new Set<string>();
  return lines.filter((l) => {
    const k = l.name.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Acts on the pipeline's verdict. true = the message was answered.
// ONE draft per message with a line for every product; what could not be read
// at all is reported once; what went over the limit is told, not dropped.
export async function applyPriceResult(
  result: PriceFlowResult,
  ctx: PriceCtx,
  mentions: DraftLine[] = []
): Promise<boolean> {
  if (result.kind === "none" && mentions.length === 0) return false;
  const r: PriceItemsResult =
    result.kind === "items"
      ? result.r
      : {
          saved: [],
          needUnit: [],
          ambiguous: [],
          unclear: [],
          skippedNoPrice: [],
          overLimit: [],
        };

  // A currency that is not the company's («150 pesos» for a USD restaurant):
  // nothing is saved; the cook is told to resend it.
  if (await replyIfCurrencyMismatch(r, ctx)) {
    logPriceRoute(ctx, "currency_mismatch", r, result.aiCalled);
    return true;
  }

  const lines = draftLinesOf(r, mentions);
  logPriceRoute(ctx, routeOf(r), r, result.aiCalled);

  let extra = [overLimitLine(r)].filter((l): l is string => l !== null);
  if (lines.length === 0) {
    // Nothing named at all («aguacate 1.50 por favor»): say so once.
    let unclear = unclearLine(r, true);
    if (result.aiFailed && unclear === KITCHEN_COPY.PRICE_UPDATE_UNCLEAR) {
      unclear = KITCHEN_COPY.PRICE_UPDATE_FAILED;
    }
    extra = [unclear, ...extra].filter((l): l is string => l !== null);
    const suffix = extra.join("\n\n");
    if (suffix) await sendTelegramMessage(ctx.chatId, suffix);
    return true;
  }

  const suffix = extra.join("\n\n");
  // Never throws: a failure is logged and the cook is told (PRICE_SAVE_FAILED).
  await processPriceUpdateSafe({
    admin: ctx.admin,
    staff: ctx.staff,
    chatId: ctx.chatId,
    reportId: ctx.reportId,
    dateSec: ctx.dateSec,
    items: lines,
    origin: ctx.origin,
    replyMarkup: ctx.markup,
    replySuffix: suffix || undefined,
  });
  return true;
}

// The whole text / transcript pipeline, in one place (typed text and voice):
//   1. rules (+ the price AI for the parts the rules could not read)
//      -> saved / asked: answered (applyPriceResult)
//   2. a recipe -> the caller continues with the recipe draft
//   3. the AI interpreter (handleWithAi) with context, BEFORE any reply
//   4. its timeout/failure -> a deterministic reply (never a bare «Recibido»)
// "handled" = a reply was sent; "recipe" = continue with the recipe flow.
export async function runMessagePipeline(
  text: string,
  ctx: PriceCtx
): Promise<"handled" | "recipe"> {
  const logCtx = { origin: ctx.origin, len: ctx.len };
  try {
    const stage = rulesStage(text);
    const result: PriceFlowResult = stage.done
      ? stage.result
      : await aiStage(text, stage.read, askPriceAi);
    // Every product becomes a line; the stock talk of the same message
    // («se acabó el queso») still goes to the stock path afterwards.
    const mentions = purchaseMentions(text);
    const hasLines =
      isActionable(result) ||
      (result.kind === "items" &&
        draftLinesOf(result.r, mentions.lines).length > 0) ||
      mentions.lines.length > 0;
    if (hasLines) {
      if (await applyPriceResult(result, ctx, mentions.lines)) {
        if (mentions.stockText) {
          const { handleWithAi } =
            await import("@/lib/restaurant/telegram/kitchen-ai-handler");
          await handleWithAi({
            admin: ctx.admin,
            staff: ctx.staff,
            chatId: ctx.chatId,
            messageId: ctx.messageId,
            text: mentions.stockText,
            markup: ctx.markup,
            reportId: ctx.reportId,
            dateSec: ctx.dateSec,
            origin: ctx.origin,
            link: ctx.link,
            fallbackReply: null,
          });
        }
        return "handled";
      }
    }

    const { detectRecipeIntent } =
      await import("@/lib/restaurant/telegram/kitchen-recipe-drafts");
    if (detectRecipeIntent(text).isRecipe) {
      logPriceRoute(logCtx, "recipe", undefined, result.aiCalled);
      return "recipe";
    }

    // The rules' own reading of a price that could not be understood. Not
    // for stock talk: that gets the stock copy.
    const hasStockWords = classifyKitchenReport(text) !== "unclassified";
    const unclear = hasStockWords ? null : unclearReply(result);

    const { handleWithAi } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");
    const handled = await handleWithAi({
      admin: ctx.admin,
      staff: ctx.staff,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      text,
      markup: ctx.markup,
      reportId: ctx.reportId,
      dateSec: ctx.dateSec,
      origin: ctx.origin,
      link: ctx.link,
      // If this AI fails too: the rules' own «no entendí» (or «no pude leer los
      // precios ahora» when the price AI was down), never stock talk's.
      fallbackReply:
        unclear ??
        (result.aiFailed && !hasStockWords
          ? KITCHEN_COPY.PRICE_UPDATE_FAILED
          : null),
    });
    if (handled) {
      logPriceRoute(logCtx, "ai_handled", undefined, result.aiCalled);
      return "handled";
    }
    logPriceRoute(logCtx, "recipe", undefined, result.aiCalled);
    return "recipe";
  } catch {
    console.error("[telegram-webhook] message pipeline failed");
    try {
      await sendTelegramMessage(
        ctx.chatId,
        KITCHEN_COPY.PRICE_UPDATE_FAILED,
        ctx.markup ? { replyMarkup: ctx.markup } : undefined
      );
    } catch {
      // Guard the send itself so it can't throw
    }
    return "handled";
  }
}
