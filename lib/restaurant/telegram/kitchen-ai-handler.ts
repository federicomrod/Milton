/**
 * AI-first handler for kitchen messages (text and voice transcripts).
 *
 * Every message that is not a photo or a recipe flow, and that the rules did
 * not already save or turn into a question, comes here BEFORE any reply. The
 * AI reads it with context (recent messages of this chat and company, the open
 * question, the company currency, close ingredient names). Deterministic code
 * validates; it does not gatekeep:
 *
 *   price_update          -> draft(s) through processPriceUpdate (never applied)
 *   stock_report          -> stored as a kitchen report (Cocina › Se agota / Merma)
 *   mixed                 -> both, ONE summarising reply
 *   answer_to_pending     -> resolves the open unit / amount question
 *   clarify_question      -> opens a price_amount_question (never the AI's own words)
 *   question / greeting / complaint / unclear -> short fixed Spanish copy
 *
 * Never a bare «Recibido», never silence, never a crash. Amounts come only
 * from the validated result (literal in the text), nothing is invented, and
 * everything stays a draft for a person to approve. Company-scoped.
 *
 * SECURITY: logs fixed lines only, never the text.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  interpretKitchenMessage,
  type KitchenIntentItem,
  type KitchenIntentResult,
  type KitchenIntentContext,
} from "./kitchen-intent-ai";
import { buildKitchenContext } from "./kitchen-context";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
  destinationVars,
} from "./kitchen-copy";
import { sendTelegramMessage, type InlineKeyboardMarkup } from "./send";
import { processPriceUpdateSafe, type KitchenActor } from "./kitchen-media";
import {
  classifyKitchenReport,
  recordKitchenReport,
  type KitchenReportType,
} from "./kitchen-reports";
import type { KitchenLink } from "./kitchen-links";
import {
  deterministicReply,
  looksPriceLike,
  priceNotUnderstoodReply,
  stockSavedReply,
} from "./kitchen-fallback";
import {
  amountAskReply,
  answerFor,
  completePendingQuestion,
} from "./kitchen-pending-answer";
import { joinProducts } from "./price-flow";
import {
  amountItemsOfQuestion,
  findOpenUnitQuestion,
  openAmountQuestion,
  openUnitQuestion,
  type AmountQuestionItem,
} from "./price-unit-question";
import {
  currencyCodeFromText,
  currencySymbolFor,
  hasPriceNumber,
  hasPriceShape,
  parsePriceItems,
  parsePriceMessage,
  PRICE_UPDATE_MAX_ITEMS,
  type PriceUpdateItem,
} from "./price-update";
import { maybeCleanupPending } from "./kitchen-routing";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  inAppPipeline,
  recordPipelineEvent,
} from "@/lib/restaurant/kitchen/pipeline/reply-sink";

export type AiHandlerContext = {
  admin: SupabaseClient;
  staff: KitchenActor;
  chatId: number;
  messageId: number;
  text: string;
  markup?: InlineKeyboardMarkup;
  /** The kitchen_reports row of this message (already stored by the webhook). */
  reportId?: string | null;
  dateSec?: number | null;
  origin?: "text" | "voice";
  /** The restaurant link (needed to keep a question open). */
  link?: KitchenLink | null;
  /**
   * What to say if the AI is unavailable or has nothing better (e.g. the
   * rules' «No entendí el precio…»). Optional.
   */
  fallbackReply?: string | null;
};

const withMarkup = (ctx: AiHandlerContext) =>
  ctx.markup ? { replyMarkup: ctx.markup } : undefined;

async function say(ctx: AiHandlerContext, text: string): Promise<void> {
  await sendTelegramMessage(ctx.chatId, text, withMarkup(ctx));
}

/**
 * Handles a message through the AI. Returns true when a reply was sent (or
 * the message was fully handled); false only for a recipe, which the caller
 * continues with the recipe-draft flow.
 */
export async function handleWithAi(ctx: AiHandlerContext): Promise<boolean> {
  try {
    const context = await buildKitchenContext(
      ctx.admin,
      ctx.chatId,
      ctx.staff.company_id,
      ctx.text,
      { locationId: ctx.staff.location_id, staffId: ctx.staff.id }
    );
    const result = await interpretKitchenMessage(ctx.text, context);
    if (!result) return await unavailable(ctx);
    return await handleIntent(result, ctx, context);
  } catch (err) {
    console.error(
      "[kitchen-ai-handler] failed:",
      err instanceof Error ? err.name : "unknown"
    );
    return await unavailable(ctx);
  }
}

/**
 * The AI timed out or failed. The message is already stored (the webhook
 * records every report before this), so nothing is lost; the cook still gets a
 * useful, deterministic answer: greeting, "no questions yet", the price that
 * was not understood, or the stock-report copy. «No pude procesarlo» only when
 * the message is none of those.
 */
async function unavailable(ctx: AiHandlerContext): Promise<boolean> {
  try {
    await answerWithoutAi(ctx);
  } catch {
    // At least we tried
  }
  return true;
}

/**
 * The deterministic answer used whenever no AI result is available. A stock
 * report is only claimed as saved when it really is (a voice note gets its type
 * and transcript written to the report first).
 */
export async function answerWithoutAi(ctx: AiHandlerContext): Promise<void> {
  let reply = ctx.fallbackReply ?? null;
  if (!reply) {
    const type = classifyKitchenReport(ctx.text);
    if (type !== "unclassified") {
      const stored =
        (ctx.origin ?? "text") === "text" || (await setReportType(ctx, type));
      reply = stored ? stockSavedReply(ctx.staff, type, [], ctx.text) : null;
      if (stored) {
        recordPipelineEvent({ kind: "stock", reportType: type, products: [] });
      }
      // A mixed message («se acabó el aguacate y ahora está a 3.50 la libra»)
      // with the AI down: the stock report is kept, the price is NOT, and the
      // cook is told so instead of finding out later.
      if (
        reply &&
        hasPriceNumber(ctx.text) &&
        parsePriceMessage(ctx.text) !== null
      ) {
        reply = `${reply} ${KITCHEN_COPY.PRICE_LOST_AI_DOWN}`;
      }
    } else {
      reply = deterministicReply(ctx.text, ctx.staff);
    }
  }
  await say(
    ctx,
    reply ??
      renderKitchenCopy(
        KITCHEN_COPY.PROCESSING_FAILED,
        destinationVars(ctx.staff)
      )
  );
}

async function handleIntent(
  result: KitchenIntentResult,
  ctx: AiHandlerContext,
  context: KitchenIntentContext
): Promise<boolean> {
  const dest = destinationVars(ctx.staff);

  switch (result.intent) {
    case "question":
      await say(ctx, KITCHEN_COPY.QUESTION_RESPONSE);
      return true;

    case "greeting_or_smalltalk":
      await say(ctx, renderKitchenCopy(KITCHEN_COPY.GREETING_RESPONSE, dest));
      return true;

    case "complaint_or_problem":
      await say(ctx, renderKitchenCopy(KITCHEN_COPY.COMPLAINT_RESPONSE, dest));
      return true;

    case "unclear":
    case "invoice_photo":
      await say(
        ctx,
        ctx.fallbackReply ??
          (looksPriceLike(ctx.text)
            ? priceNotUnderstoodReply(ctx.text)
            : KITCHEN_COPY.UNCLEAR_MESSAGE)
      );
      return true;

    case "recipe":
      return false;

    case "answer_to_pending":
      return await handleAnswer(result, ctx);

    case "price_update":
    case "stock_report":
      return await handleActions(result, ctx, context);

    default:
      await say(ctx, KITCHEN_COPY.UNCLEAR_MESSAGE);
      return true;
  }
}

// ---------------------------------------------------------------------------
// answer_to_pending
// ---------------------------------------------------------------------------

async function handleAnswer(
  result: KitchenIntentResult,
  ctx: AiHandlerContext
): Promise<boolean> {
  const question = await findOpenUnitQuestion(ctx.chatId);
  if (
    !question ||
    !ctx.link ||
    question.optionStaffIds[0] !== ctx.link.staffId
  ) {
    await say(ctx, ctx.fallbackReply ?? KITCHEN_COPY.UNCLEAR_MESSAGE);
    return true;
  }
  // The words themselves first; the AI's reading only as a second chance, and
  // only what the validator let through (literal in the text).
  let answer = answerFor(question, ctx.text);
  if (!answer) {
    const first = result.items[0];
    if (amountItemsOfQuestion(question)) {
      if (first && first.amount > 0) {
        answer = {
          kind: "amount",
          amount: first.amount,
          currency: currencyCodeFromText(ctx.text),
        };
      }
    } else if (first?.unit) {
      answer = { kind: "unit", unit: first.unit };
    }
  }
  if (!answer) {
    const amountItems = amountItemsOfQuestion(question);
    if (amountItems) {
      await say(
        ctx,
        amountAskReply(
          amountItems[0],
          currencySymbolFor(amountItems[0].currency)
        )
      );
    } else {
      await say(ctx, KITCHEN_COPY.UNCLEAR_MESSAGE);
    }
    return true;
  }
  const outcome = await completePendingQuestion({
    question,
    answer,
    link: ctx.link,
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    reportId: ctx.reportId ?? null,
    dateSec: ctx.dateSec ?? null,
    origin: ctx.origin ?? "text",
    markup: ctx.markup,
    run: (fn) => fn().then(() => undefined),
  });
  if (outcome === "failed") await say(ctx, KITCHEN_COPY.PRICE_SAVE_FAILED);
  return true;
}

// ---------------------------------------------------------------------------
// price_update / stock_report / mixed
// ---------------------------------------------------------------------------

function sameProduct(a: string, b: string): boolean {
  const k = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-zñ0-9]/g, "");
  const x = k(a);
  const y = k(b);
  return (
    x === y ||
    (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x)))
  );
}

type AmbiguousSeen = {
  product: string;
  options: [number, number];
  unit: string | null;
  currency: string | null;
};

/** The parser's own reading of «150» (1.50 or 150), when the text has one. */
function ambiguousFromText(text: string): AmbiguousSeen[] {
  const p = parsePriceItems(text) as unknown as {
    ambiguous?: AmbiguousSeen[];
  } | null;
  return Array.isArray(p?.ambiguous) ? p.ambiguous : [];
}

async function setReportType(
  ctx: AiHandlerContext,
  type: KitchenReportType
): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = { report_type: type };
    if (ctx.origin === "voice") {
      patch.text = ctx.text.slice(0, 2000);
      patch.transcript = ctx.text.slice(0, 2000);
    }
    // An app report has no Telegram ids: it is found by its own id.
    const base = ctx.admin
      .from("kitchen_reports")
      .update(patch)
      .eq("company_id", ctx.staff.company_id);
    const { error } =
      inAppPipeline() && ctx.reportId
        ? await base.eq("id", ctx.reportId)
        : await base
            .eq("telegram_chat_id", ctx.chatId)
            .eq("telegram_message_id", ctx.messageId);
    if (error) {
      console.error("[kitchen-ai-handler] stock report not stored");
      return false;
    }
    return true;
  } catch {
    console.error("[kitchen-ai-handler] stock report not stored");
    return false;
  }
}

async function handleActions(
  result: KitchenIntentResult,
  ctx: AiHandlerContext,
  context: KitchenIntentContext
): Promise<boolean> {
  const text = ctx.text;
  const origin = ctx.origin ?? "text";
  const reportWords = classifyKitchenReport(text);
  const isStock =
    result.intent === "stock_report" || reportWords !== "unclassified";
  const priceShaped = hasPriceShape(text);

  // Which items are PRICES: all with an amount for a price_update; for a
  // stock report only those the text says as a price («a 3.50 la libra»).
  let priced: KitchenIntentItem[] = result.items.filter(
    (i) => i.amount > 0 && (result.intent === "price_update" || priceShaped)
  );
  // A voice note about stock can mention quantities («2 bandejas»): those are
  // not prices unless the text has the shape of one.
  if (result.intent === "price_update" && !priceShaped && isStock) priced = [];

  // 150 without a currency or decimals: the AI does not get to decide that
  // alone. The parser's reading (1.50 or 150) turns it into a question.
  const ambiguous = ambiguousFromText(text);
  let ask: AmbiguousSeen | null =
    ambiguous[0] ??
    (result.clarify
      ? {
          product: result.clarify.product,
          options: result.clarify.options,
          unit: result.clarify.unit,
          currency: null,
        }
      : null);
  if (ask) {
    const a = ask;
    priced = priced.filter(
      (i) =>
        !(
          sameProduct(i.product, a.product) &&
          a.options.some((o) => Math.abs(o - i.amount) < 0.001)
        )
    );
  } else if (result.clarify_question && priced.length > 0) {
    // The AI is unsure about an amount: only a plain three-digit number can be
    // turned into «1.50 o 150»; anything else is reported as not understood.
    const cand = priced.find(
      (i) => Number.isInteger(i.amount) && i.amount >= 100 && i.amount < 1000
    );
    if (cand) {
      ask = {
        product: cand.product,
        options: [Math.round(cand.amount) / 100, cand.amount],
        unit: cand.unit,
        currency: cand.currency,
      };
      priced = priced.filter((i) => i !== cand);
    }
  }

  const hints = context.ingredient_hints;
  const nameOf = (i: KitchenIntentItem) =>
    (i.matched_ingredient_id
      ? hints.find((h) => h.id === i.matched_ingredient_id)?.name
      : undefined) ?? i.product;

  const saved: PriceUpdateItem[] = [];
  const needUnit: Array<{
    name: string;
    price: number;
    currency: string | null;
  }> = [];
  const unreadable: string[] = [];
  for (const i of priced) {
    if (saved.length + needUnit.length >= PRICE_UPDATE_MAX_ITEMS) {
      unreadable.push(i.product);
    } else if (i.unit) {
      saved.push({
        name: nameOf(i),
        price: i.amount,
        unit: i.unit,
        currency: i.currency,
      });
    } else {
      needUnit.push({ name: nameOf(i), price: i.amount, currency: i.currency });
    }
  }

  const lines: string[] = [];

  // --- one question per message: the amount first, else the unit -------------
  let asked = false;
  if (ask && ctx.link) {
    const q: AmountQuestionItem = {
      product: ask.product,
      options: ask.options,
      unit: ask.unit,
      currency: ask.currency,
    };
    const opened = await openAmountQuestion({
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      link: ctx.link,
      items: [q],
    });
    if (opened.ok) {
      maybeCleanupPending();
      recordPipelineEvent({ kind: "question", ask: "amount" });
      asked = true;
      if (opened.created) {
        const cur =
          q.currency ??
          (await resolveCompanyCurrency(
            ctx.admin as never,
            ctx.staff.company_id
          ).catch(() => null));
        lines.push(amountAskReply(q, currencySymbolFor(cur)));
      }
    } else {
      unreadable.push(ask.product);
    }
  } else if (ask) {
    unreadable.push(ask.product);
  }
  if (needUnit.length > 0) {
    if (asked || !ctx.link) {
      unreadable.push(...needUnit.map((i) => i.name));
    } else {
      const opened = await openUnitQuestion({
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        link: ctx.link,
        items: needUnit,
      });
      if (opened.ok) {
        maybeCleanupPending();
        recordPipelineEvent({
          kind: "question",
          ask: "unit",
          products: needUnit.map((i) => i.name),
        });
        asked = true;
        if (opened.created) {
          lines.push(
            renderKitchenCopy(KITCHEN_COPY.PRICE_UNIT_ASK, {
              producto: joinProducts(needUnit.map((i) => i.name)),
            })
          );
        }
      } else {
        unreadable.push(...needUnit.map((i) => i.name));
      }
    }
  }

  // --- the stock part ---------------------------------------------------------
  let stockLine: string | null = null;
  if (isStock) {
    const kind: KitchenReportType =
      reportWords === "unclassified" ? "running_out" : reportWords;
    const stored =
      reportWords === kind && origin === "text"
        ? true // already stored with this very type by the webhook
        : await setReportType(ctx, kind);
    if (stored) {
      const names = [
        ...new Set(result.items.map((i) => nameOf(i)).filter(Boolean)),
      ];
      stockLine = stockSavedReply(ctx.staff, kind, names, text);
      recordPipelineEvent({ kind: "stock", reportType: kind, products: names });
    }
  }

  if (unreadable.length > 0) {
    lines.push(
      renderKitchenCopy(KITCHEN_COPY.PRICE_NOT_UNDERSTOOD, {
        productos: joinProducts([...new Set(unreadable)]),
      })
    );
  }

  const nothingToSay =
    saved.length === 0 && !asked && !stockLine && unreadable.length === 0;
  if (nothingToSay) {
    // The AI called it a price/stock message but gave nothing usable.
    await say(
      ctx,
      ctx.fallbackReply ??
        deterministicReply(text, ctx.staff) ??
        (looksPriceLike(text)
          ? priceNotUnderstoodReply(text)
          : KITCHEN_COPY.UNCLEAR_MESSAGE)
    );
    return true;
  }

  const rest = [stockLine, ...lines].filter((l): l is string => !!l);
  if (saved.length > 0) {
    await processPriceUpdateSafe({
      admin: ctx.admin as never,
      staff: ctx.staff,
      chatId: ctx.chatId,
      reportId: ctx.reportId ?? null,
      dateSec: ctx.dateSec ?? null,
      items: saved,
      origin,
      replyMarkup: ctx.markup,
      replySuffix: rest.length > 0 ? rest.join("\n\n") : undefined,
    });
  } else {
    await say(ctx, rest.join("\n\n"));
  }
  return true;
}

/**
 * Handles unsupported media types (stickers, videos, non-PDF documents,
 * locations, audio files, polls, dice).
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
 * A photo the classifier is SURE is neither an invoice nor a recipe.
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
    console.error(
      "[kitchen-ai-handler] store failed:",
      err instanceof Error ? err.message : "unknown"
    );
  }
  return null;
}
