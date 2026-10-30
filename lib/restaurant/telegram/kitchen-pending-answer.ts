// lib/restaurant/telegram/kitchen-pending-answer.ts
//
// Answers to the bot's open price questions («¿por libra, onza o unidad?» and
// «¿$1.50 o $150?»), from typed text AND from a voice transcript. One function
// for both so the rules cannot drift:
//
//   * a unit word («por libra», «Libra.», «es por kilo») completes a unit
//     question;
//   * an amount («1.50», «150», «uno cincuenta», «ciento cincuenta», «$150»)
//     completes an amount question, then asks the unit if it is still missing;
//   * anything else closes the question (nothing is saved);
//     the caller decides whether to say so (PRICE_QUESTION_CLOSED).
//
// One winner: resolvePendingItem makes a retry or a second answer find the
// question already resolved. Company scope: the staff/company come from the
// question's own link, never from the message.
//
// SECURITY: ids and counts only. Never logs the text.

import { createAdminClient } from "@/lib/supabase/admin";
import type { InlineKeyboardMarkup } from "./send";
import { sendTelegramMessage } from "./send";
import { KITCHEN_COPY, renderKitchenCopy } from "./kitchen-copy";
import type { KitchenLink } from "./kitchen-links";
import { processPriceUpdateSafe, refuseForeignCurrency } from "./kitchen-media";
import { expirePendingItem, resolvePendingItem } from "./kitchen-pending";
import type { PendingItem } from "./kitchen-pending";
import {
  isUnitQuestion,
  linkToActor,
  maybeCleanupPending,
  unitQuestionMessageId,
} from "./kitchen-routing";
import {
  currencyCodeFromText,
  parseAmountAnswer,
  parseUnitAnswer,
} from "./price-update";
import { joinProducts } from "./price-flow";
import {
  amountItemsOfQuestion,
  applyUnit,
  findOpenUnitQuestion,
  itemsOfQuestion,
  openUnitQuestion,
  productsOfQuestion,
} from "./price-unit-question";

export type PendingAnswer =
  | { kind: "unit"; unit: string }
  /** `currency` is what the ANSWER itself names («150 pesos» → MXN), else null. */
  | { kind: "amount"; amount: number; currency: string | null };

/** What this text says to the open question, or null when it is not an answer. */
export function answerFor(
  question: PendingItem,
  text: string
): PendingAnswer | null {
  if (amountItemsOfQuestion(question)) {
    const amount = parseAmountAnswer(text);
    return amount !== null && amount > 0 && amount <= 100000
      ? { kind: "amount", amount, currency: currencyCodeFromText(text) }
      : null;
  }
  if (!itemsOfQuestion(question)) return null;
  const unit = parseUnitAnswer(text);
  return unit ? { kind: "unit", unit } : null;
}

export type CompleteOutcome =
  /** The answer was applied (saved, or the next question was asked). */
  | "done"
  /** Someone else (a retry, a second answer) already resolved it. */
  | "already_resolved"
  /** It expired between reading and resolving. */
  | "expired"
  | "failed";

export async function completePendingQuestion(args: {
  question: PendingItem;
  answer: PendingAnswer;
  link: KitchenLink;
  chatId: number;
  /** The message that carries the answer (for the chained unit question). */
  messageId: number;
  reportId: string | null;
  dateSec: number | null;
  origin: "text" | "voice";
  markup?: InlineKeyboardMarkup;
  /** Text: defer the save to after(); voice: run inline (already inside after()). */
  run: (fn: () => Promise<unknown>) => void | Promise<void>;
}): Promise<CompleteOutcome> {
  const { question, answer, link, chatId } = args;
  const staffId = question.optionStaffIds[0];
  if (!staffId || staffId !== link.staffId) return "failed";

  // Read before resolving: resolving clears the payload.
  const amountItems = amountItemsOfQuestion(question);
  const unitItems = amountItems ? null : itemsOfQuestion(question);

  const resolved = await resolvePendingItem(question.id, staffId);
  if (!resolved.ok) {
    return resolved.reason === "expired" ? "expired" : "already_resolved";
  }

  const admin = createAdminClient();
  const staff = linkToActor(link);
  const base = {
    admin,
    staff,
    chatId,
    reportId: args.reportId,
    dateSec: args.dateSec,
    origin: args.origin,
    replyMarkup: args.markup,
  };

  if (answer.kind === "unit" && unitItems) {
    const items = applyUnit(unitItems, answer.unit);
    await args.run(() => processPriceUpdateSafe({ ...base, items }));
    return "done";
  }

  if (answer.kind === "amount" && amountItems) {
    const first = amountItems[0];
    // The currency the answer names wins over the stored one, so «150 pesos»
    // reaches processPriceUpdate's mismatch check instead of saving as USD.
    const saidCurrency = answer.currency ?? first.currency;
    const currency =
      saidCurrency as import("./price-update").PriceUpdateItem["currency"];
    if (first.unit) {
      await args.run(() =>
        processPriceUpdateSafe({
          ...base,
          items: [
            {
              name: first.product,
              price: answer.amount,
              unit: first.unit as string,
              currency,
            },
          ],
        })
      );
      return "done";
    }
    // A currency that is not the company's is refused NOW, before asking the
    // unit: nothing would be saved at the end anyway.
    if (
      await refuseForeignCurrency({
        admin,
        staff,
        chatId,
        said: saidCurrency,
        replyMarkup: args.markup,
      })
    ) {
      return "done";
    }
    // Chain: the amount is settled, the unit is still missing.
    const opened = await openUnitQuestion({
      chatId,
      messageId: args.messageId,
      link,
      items: [
        {
          name: first.product,
          price: answer.amount,
          currency: saidCurrency,
        } as { name: string; price: number },
      ],
    });
    maybeCleanupPending();
    await sendTelegramMessage(
      chatId,
      opened.ok
        ? renderKitchenCopy(KITCHEN_COPY.PRICE_UNIT_ASK, {
            producto: first.product,
          })
        : KITCHEN_COPY.PRICE_SAVE_FAILED,
      args.markup ? { replyMarkup: args.markup } : undefined
    );
    return opened.ok ? "done" : "failed";
  }
  return "failed";
}

export type PendingResult =
  | { kind: "none" }
  | { kind: "handled" }
  | { kind: "closed"; products: string[] };

/**
 * The shared entry for text and voice. Looks for the chat's open question:
 *   none                      -> { none }  (go on as usual)
 *   it is the very message that asked it (webhook retry) -> { none }
 *   the text answers it       -> applied, { handled }
 *   anything else             -> the question is closed (nothing saved), { closed }
 */
export async function tryPendingAnswer(args: {
  text: string;
  chatId: number;
  messageId: number;
  dateSec: number | null;
  links: KitchenLink[];
  origin: "text" | "voice";
  /** Text: stores the answer message as a report (null = already stored/duplicate). Voice: already stored. */
  prepareReport: (
    link: KitchenLink
  ) => Promise<{ reportId: string | null } | null>;
  getMarkup: () => Promise<InlineKeyboardMarkup | undefined>;
  run: (fn: () => Promise<unknown>) => void | Promise<void>;
}): Promise<PendingResult> {
  const question = await findOpenUnitQuestion(args.chatId);
  if (!question || !isUnitQuestion(question.telegramMessageId)) {
    return { kind: "none" };
  }
  // A retry of the very message that asked: leave the question alone.
  if (question.telegramMessageId === unitQuestionMessageId(args.messageId)) {
    return { kind: "none" };
  }
  const staffId = question.optionStaffIds[0];
  const link = args.links.find((l) => l.staffId === staffId);
  const answer = answerFor(question, args.text);
  if (!answer || !link) {
    await expirePendingItem(question.id);
    return { kind: "closed", products: productsOfQuestion(question) };
  }

  const prepared = await args.prepareReport(link);
  if (!prepared) {
    // A duplicate delivery of the answer: nothing more to do.
    return { kind: "handled" };
  }
  const markup = await args.getMarkup();
  const outcome = await completePendingQuestion({
    question,
    answer,
    link,
    chatId: args.chatId,
    messageId: args.messageId,
    reportId: prepared.reportId,
    dateSec: args.dateSec,
    origin: args.origin,
    markup,
    run: args.run,
  });
  if (outcome === "expired") {
    return { kind: "closed", products: productsOfQuestion(question) };
  }
  if (outcome === "failed") {
    console.error("[kitchen-pending-answer] answer not applied");
    try {
      await sendTelegramMessage(
        args.chatId,
        KITCHEN_COPY.PRICE_SAVE_FAILED,
        markup ? { replyMarkup: markup } : undefined
      );
    } catch {
      // nothing more to do
    }
  }
  return { kind: "handled" };
}

/** «Dejé sin guardar el precio de queso…» for the products of a closed question. */
export function questionClosedReply(products: string[]): string {
  return renderKitchenCopy(KITCHEN_COPY.PRICE_QUESTION_CLOSED, {
    producto: joinProducts(products) || KITCHEN_COPY.FRAG_YOUR_PRODUCT,
  });
}

function fmtAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** «¿El aguacate está a $1.50 o a $150? Responde 1.50 o 150.» */
export function amountAskReply(
  item: { product: string; options: [number, number] },
  symbol: string
): string {
  return renderKitchenCopy(KITCHEN_COPY.PRICE_AMOUNT_ASK, {
    producto: item.product,
    moneda: symbol,
    opcion1: fmtAmount(item.options[0]),
    opcion2: fmtAmount(item.options[1]),
  });
}
