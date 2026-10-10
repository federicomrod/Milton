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
  type AskMiltonAnswer,
  type AskMiltonIntent,
  type AskMiltonSupportingFact,
  type ResolvedEntities,
} from "@/lib/restaurant/ask-milton-prompt";

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

export function groundAskMiltonAnswer(
  aiAnswer: AskMiltonAnswer,
  ctx: AskMiltonContext,
  message: string,
  intent: AskMiltonIntent,
  resolved: ResolvedEntities
): { answer: AskMiltonAnswer; replaced: boolean } {
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
      related_links:
        aiAnswer.related_links.length > 0
          ? aiAnswer.related_links
          : grounded.related_links,
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
