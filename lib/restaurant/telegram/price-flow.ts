// lib/restaurant/telegram/price-flow.ts
//
// The ONE price pipeline for the kitchen bot (typed text AND voice
// transcripts): rules -> AI fallback -> (unit missing -> ask) -> save.
//
//   update      every item has a unit: save it as a draft
//   needs_unit  a price without a unit: ask once, save nothing yet
//   unclear     a price was meant but could not be read: «No entendí el precio»
//   none        not a price at all: the caller goes on (recipe / acknowledgement)
//
// SECURITY: no logging of text here.

import {
  isPriceAiCandidate,
  looksLikePriceIntent,
  parsePriceMessage,
  priceNumberCount,
  type PriceUpdateItem,
  type UnitlessPrice,
} from "./price-update";
import { validateAiItems, type PriceAi } from "./price-update-ai";

export type PriceFlowResult =
  | { kind: "update"; items: PriceUpdateItem[] }
  | { kind: "needs_unit"; items: UnitlessPrice[] }
  | { kind: "unclear" }
  | { kind: "none" };

export type RulesStage =
  | { done: true; result: PriceFlowResult }
  | { done: false; rules: "none" | "unclear" };

/** Synchronous part: lets the caller reply right away when no AI is needed. */
export function rulesStage(text: string): RulesStage {
  const r = parsePriceMessage(text);
  if (r?.kind === "price_update") {
    return { done: true, result: { kind: "update", items: r.items } };
  }
  if (r?.kind === "needs_unit") {
    return { done: true, result: { kind: "needs_unit", items: r.items } };
  }
  const rules = r?.kind === "price_intent_unclear" ? "unclear" : "none";
  // The AI only looks at messages that already read like a price: a plain
  // report with a number («1 hamburguesa») is acknowledged right away.
  if (
    isPriceAiCandidate(text) &&
    (rules === "unclear" || looksLikePriceIntent(text))
  ) {
    return { done: false, rules };
  }
  return { done: true, result: finalFallback(text, rules) };
}

function finalFallback(
  text: string,
  rules: "none" | "unclear"
): PriceFlowResult {
  if (rules === "unclear") return { kind: "unclear" };
  return looksLikePriceIntent(text) ? { kind: "unclear" } : { kind: "none" };
}

/** The AI part. Any failure or doubt falls back to «not parsed». */
export async function aiStage(
  text: string,
  rules: "none" | "unclear",
  ai: PriceAi
): Promise<PriceFlowResult> {
  let raw: unknown = null;
  try {
    raw = await ai(text);
  } catch {
    raw = null;
  }
  const items = raw == null ? [] : validateAiItems(raw, text);
  // The rules saw something they could not read: the AI must account for
  // every price in the text, or we do not trust a partial answer.
  const covers = rules === "none" || items.length >= priceNumberCount(text);
  if (items.length > 0 && covers) {
    if (items.every((i) => i.unit !== null)) {
      return {
        kind: "update",
        items: items.map((i) => ({
          name: i.name,
          price: i.price,
          unit: i.unit as string,
        })),
      };
    }
    if (items.every((i) => i.unit === null)) {
      return {
        kind: "needs_unit",
        items: items.map((i) => ({ name: i.name, price: i.price })),
      };
    }
    return { kind: "unclear" }; // mixed: never guess
  }
  return finalFallback(text, rules);
}

export async function resolvePriceText(
  text: string,
  ai: PriceAi
): Promise<PriceFlowResult> {
  const stage = rulesStage(text);
  if (stage.done) return stage.result;
  return aiStage(text, stage.rules, ai);
}
