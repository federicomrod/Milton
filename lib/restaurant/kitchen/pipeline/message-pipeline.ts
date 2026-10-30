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
import { recordPipelineEvent } from "@/lib/restaurant/kitchen/pipeline/reply-sink";
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
import { currencySymbolFor } from "@/lib/restaurant/telegram/price-update";
import {
  aiStage,
  isActionable,
  joinProducts,
  overLimitLine,
  routeOf,
  rulesStage,
  unclearLine,
  type PriceFlowResult,
  type PriceItemsResult,
} from "@/lib/restaurant/telegram/price-flow";
import { askPriceAi } from "@/lib/restaurant/telegram/price-update-ai";
import {
  openAmountQuestion,
  openUnitQuestion,
} from "@/lib/restaurant/telegram/price-unit-question";
import { amountAskReply } from "@/lib/restaurant/telegram/kitchen-pending-answer";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { type KitchenLink } from "@/lib/restaurant/telegram/kitchen-links";
import { maybeCleanupPending } from "@/lib/restaurant/telegram/kitchen-routing";

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

// Acts on the pipeline's verdict. true = the message was answered.
// ONE reply per message: what was saved, the question (amount or unit, only
// ONE), what was not understood, what went over the limit.
export async function applyPriceResult(
  result: PriceFlowResult,
  ctx: PriceCtx
): Promise<boolean> {
  if (result.kind === "none") return false;
  let r = result.r;

  // A currency that is not the company's («150 pesos» for a USD restaurant):
  // nothing is saved and no question is asked; the cook is told to resend it.
  if (await replyIfCurrencyMismatch(r, ctx)) {
    logPriceRoute(ctx, "currency_mismatch", r, result.aiCalled);
    return true;
  }

  // «aguacate a 150»: 1.50 or 150? Asked once, nothing saved yet.
  let askLine: string | null = null;
  if (r.ambiguous.length > 0) {
    const first = r.ambiguous[0];
    const opened = ctx.link
      ? await openAmountQuestion({
          chatId: ctx.chatId,
          messageId: ctx.messageId,
          link: ctx.link,
          items: [
            {
              product: first.product,
              options: first.options,
              unit: first.unit,
              currency: first.currency,
            },
          ],
        })
      : ({ ok: false } as const);
    if (!opened.ok) {
      r = {
        ...r,
        ambiguous: [],
        unclear: [...r.unclear, { label: first.product }],
      };
    } else {
      maybeCleanupPending();
      recordPipelineEvent({ kind: "question", ask: "amount" });
      if (opened.created) {
        const cur =
          first.currency ??
          (await resolveCompanyCurrency(
            ctx.admin as never,
            ctx.staff.company_id
          ).catch(() => null));
        askLine = amountAskReply(first, currencySymbolFor(cur));
      }
    }
  }

  // Prices without a unit: ask once, for those items only.
  if (r.needUnit.length > 0) {
    const opened = ctx.link
      ? await openUnitQuestion({
          chatId: ctx.chatId,
          messageId: ctx.messageId,
          link: ctx.link,
          items: r.needUnit,
        })
      : ({ ok: false } as const);
    if (!opened.ok) {
      // The question could not be kept open: say they were not understood.
      r = {
        ...r,
        needUnit: [],
        unclear: [...r.unclear, ...r.needUnit.map((i) => ({ label: i.name }))],
      };
    } else {
      maybeCleanupPending();
      recordPipelineEvent({
        kind: "question",
        ask: "unit",
        products: r.needUnit.map((i) => i.name),
      });
      if (opened.created) {
        askLine = renderKitchenCopy(KITCHEN_COPY.PRICE_UNIT_ASK, {
          producto: joinProducts(r.needUnit.map((i) => i.name)),
        });
      }
    }
  }

  logPriceRoute(ctx, routeOf(r), r, result.aiCalled);
  const standalone =
    r.saved.length === 0 && r.needUnit.length === 0 && r.ambiguous.length === 0;
  let lines = [askLine, unclearLine(r, standalone), overLimitLine(r)].filter(
    (l): l is string => l !== null
  );

  // S1: When AI was called but failed (threw or timed out) and everything is unclear,
  // send PRICE_UPDATE_FAILED instead of PRICE_UPDATE_UNCLEAR
  if (
    result.aiFailed &&
    standalone &&
    lines.some((l) => l === KITCHEN_COPY.PRICE_UPDATE_UNCLEAR)
  ) {
    lines = lines.map((l) =>
      l === KITCHEN_COPY.PRICE_UPDATE_UNCLEAR
        ? KITCHEN_COPY.PRICE_UPDATE_FAILED
        : l
    );
  }

  const suffix = lines.join("\n\n");

  if (r.saved.length > 0) {
    // Never throws: a failure is logged and the cook is told (PRICE_SAVE_FAILED).
    await processPriceUpdateSafe({
      admin: ctx.admin,
      staff: ctx.staff,
      chatId: ctx.chatId,
      reportId: ctx.reportId,
      dateSec: ctx.dateSec,
      items: r.saved,
      origin: ctx.origin,
      replyMarkup: ctx.markup,
      replySuffix: suffix || undefined,
    });
    return true;
  }
  if (suffix) await sendTelegramMessage(ctx.chatId, suffix);
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
    if (isActionable(result)) {
      if (await applyPriceResult(result, ctx)) return "handled";
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
