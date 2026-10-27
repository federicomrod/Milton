// lib/restaurant/ask-milton-ground.ts
//
// Server-side grounding for Ask Milton answers that the system prompt
// alone does not reliably constrain.
//
// After PR #110 the snapshot and deterministic fallback for
// `best_sales_day` already rank by average and require day-count /
// average / uneven-count / best-date wording. The live model still
// ignored those rules (issue #108). This module checks the model
// output against the deterministic computation and replaces the
// answer (and always injects the required chips) when it is not
// compliant. Other intents pass through unchanged.

import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import {
  buildDeterministicAnswer,
  pickTopSellers,
  type AskMiltonAnswer,
  type AskMiltonIntent,
  type AskMiltonSupportingFact,
  type ResolvedEntities,
} from "@/lib/restaurant/ask-milton-prompt";
import { parseRequestedCount } from "@/lib/restaurant/ask-milton-count";
import { matchCategoryFromQuestion } from "@/lib/restaurant/ask-milton-sales";

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function factByLabel(
  facts: AskMiltonSupportingFact[],
  pattern: RegExp
): AskMiltonSupportingFact | undefined {
  return facts.find((f) => pattern.test(f.label));
}

function dayPhraseFromTotalLabel(label: string): string | null {
  const match = label.match(/total (?:de los|across)\s+(.+)/i);
  return match?.[1]?.trim() || null;
}

/**
 * True when the model prose already states the average-ranked weekday
 * total across N days, the per-day average, uneven day counts (when
 * they differ), and the best single date.
 */
export function isBestSalesDayAnswerTextCompliant(
  answer: string,
  grounded: AskMiltonAnswer
): boolean {
  const totalFact = factByLabel(
    grounded.supporting_facts,
    /total (de los|across)/i
  );
  const avgFact = factByLabel(
    grounded.supporting_facts,
    /promedio por|average per/i
  );
  if (!totalFact || !avgFact) return false;

  const dayPhrase = dayPhraseFromTotalLabel(totalFact.label);
  if (!dayPhrase) return false;

  const text = fold(answer);
  if (!text.includes(fold(dayPhrase))) return false;
  if (!/(promedio|average)/.test(text)) return false;
  if (!/total/.test(text)) return false;

  const groundedText = fold(grounded.answer);
  if (
    /(no es igual|uneven)/.test(groundedText) &&
    !/(no es igual|desigual|uneven|aparecen mas|more often|mas veces)/.test(
      text
    )
  ) {
    return false;
  }

  const bestFact = factByLabel(
    grounded.supporting_facts,
    /mejor d[ií]a individual|best single date/i
  );
  if (bestFact) {
    const dayNum = bestFact.value.match(/\b(\d{1,2})\b/);
    // Word boundary so "17" does not match inside "170".
    if (dayNum && !new RegExp(`\\b${dayNum[1]}\\b`).test(text)) return false;
    if (!/(mejor dia|best (single )?(date|day))/.test(text)) return false;
  }

  return true;
}

/** Approved platos exist, so the best list comes from Resumen's ranking. */
function hasApprovedMarginRanking(ctx: AskMiltonContext): boolean {
  const list = ctx.menu_dishes?.top_by_margin ?? [];
  return list.some(
    (d) =>
      d.cost_status === "aprobado" &&
      d.food_cost_pct !== null &&
      Number.isFinite(d.food_cost_pct)
  );
}

const CURRENCY_CODE_AMOUNT =
  /\b(USD|EUR|MXN|GTQ|HNL|NIO|CRC|COP|PEN|CLP|ARS|DOP|PAB|BZD)\s?\$?\d/;
const WEEK_WORDS = /\b(semana|week|7 dias|7 days|siete dias|seven days)\b/;
const MONTH_LIKE_SOURCES = new Set(["latest_month", "named_period"]);

/**
 * A top-selling answer keeps the model's wording only when it names the
 * snapshot's real leader, does not call a month «la última semana», and
 * gives exactly the count the owner asked for (when they asked for one).
 */
export function topSellingAnswerIsGrounded(
  answer: string,
  ctx: AskMiltonContext,
  message: string
): boolean {
  const sales = ctx.sales;
  if (!sales.available) return true;
  const text = fold(answer);
  if (MONTH_LIKE_SOURCES.has(sales.period.source) && WEEK_WORDS.test(text)) {
    return false;
  }
  // Money reads like Ventas («$501»), never with a currency code.
  if (CURRENCY_CODE_AMOUNT.test(answer)) return false;
  const category = matchCategoryFromQuestion(
    message,
    sales.by_category.map((c) => c.key).filter(Boolean)
  );
  const picked = pickTopSellers(sales, message, category);
  // «Plato» questions must lead with the top dish, not a drink.
  if (picked.dishesOnly && !picked.category) {
    const topDish = picked.items[0];
    if (topDish && !text.includes(fold(topDish.name))) return false;
  }
  const leader = picked.dishesOnly ? picked.items[0] : sales.top_items_by_units[0];
  if (leader && !text.includes(fold(leader.name))) {
    // Category questions lead with the category's own top item.
    const inCategory = sales.top_items_by_category.some(
      (c) => c.items[0] && text.includes(fold(c.items[0].name))
    );
    if (!inCategory) return false;
  }
  const requested = parseRequestedCount(message);
  if (requested !== null && requested > 1) {
    const listed = answer
      .split("\n")
      .filter((line) => /^\s*\d+[.)]\s/.test(line)).length;
    if (listed !== 0 && listed !== Math.min(requested, picked.items.length)) {
      return false;
    }
  }
  return true;
}

export function groundAskMiltonAnswer(
  aiAnswer: AskMiltonAnswer,
  ctx: AskMiltonContext,
  message: string,
  intent: AskMiltonIntent,
  resolved: ResolvedEntities
): { answer: AskMiltonAnswer; replaced: boolean } {
  if (
    intent === "dish_food_cost" ||
    intent === "least_profitable_dishes" ||
    (intent === "most_profitable_dish" && hasApprovedMarginRanking(ctx))
  ) {
    return {
      answer: buildDeterministicAnswer(ctx, message, intent, resolved),
      replaced: true,
    };
  }
  if (intent === "expensive_ingredients") {
    // R1-16c: when real prices exist the answer must be built on them. A
    // model answer that names none of the top ingredients (e.g. "no tengo
    // datos") is replaced by the deterministic ranking.
    const top = ctx.ingredient_prices.top_by_unit_cost.slice(0, 3);
    if (top.length === 0) return { answer: aiAnswer, replaced: false };
    const text = fold(aiAnswer.answer);
    const names = top.some((i) => text.includes(fold(i.name)));
    if (names) return { answer: aiAnswer, replaced: false };
    return {
      answer: buildDeterministicAnswer(ctx, message, intent, resolved),
      replaced: true,
    };
  }
  if (intent === "top_selling_items") {
    if (topSellingAnswerIsGrounded(aiAnswer.answer, ctx, message)) {
      // The model's words stay; the chips and follow-ups are the rule
      // path's (Ventas and Platos), never a generic Panel principal.
      const grounded = buildDeterministicAnswer(ctx, message, intent, resolved);
      return {
        answer: {
          ...aiAnswer,
          related_links: grounded.related_links,
          suggested_followups: grounded.suggested_followups,
        },
        replaced: false,
      };
    }
    return {
      answer: buildDeterministicAnswer(ctx, message, intent, resolved),
      replaced: true,
    };
  }
  if (intent !== "best_sales_day") {
    return { answer: aiAnswer, replaced: false };
  }

  const grounded = buildDeterministicAnswer(ctx, message, intent, resolved);
  const hasRequiredFacts = grounded.supporting_facts.some((f) =>
    /total (de los|across)/i.test(f.label)
  );
  if (!hasRequiredFacts) {
    return { answer: grounded, replaced: true };
  }

  const textOk = isBestSalesDayAnswerTextCompliant(aiAnswer.answer, grounded);
  return {
    answer: {
      answer: textOk ? aiAnswer.answer : grounded.answer,
      supporting_facts: grounded.supporting_facts,
      related_links: grounded.related_links,
      suggested_followups:
        aiAnswer.suggested_followups.length > 0
          ? aiAnswer.suggested_followups
          : grounded.suggested_followups,
      confidence_notes: (aiAnswer.confidence_notes.length > 0
        ? aiAnswer.confidence_notes
        : grounded.confidence_notes
      ).slice(0, 3),
    },
    replaced: !textOk,
  };
}

export function resolveAskMiltonAnswer(
  aiAnswer: AskMiltonAnswer | null,
  ctx: AskMiltonContext,
  message: string,
  intent: AskMiltonIntent,
  resolved: ResolvedEntities
): { answer: AskMiltonAnswer; source: "openai" | "deterministic" } {
  if (!aiAnswer) {
    return {
      answer: buildDeterministicAnswer(ctx, message, intent, resolved),
      source: "deterministic",
    };
  }
  const { answer, replaced } = groundAskMiltonAnswer(
    aiAnswer,
    ctx,
    message,
    intent,
    resolved
  );
  return {
    answer,
    source: replaced ? "deterministic" : "openai",
  };
}
