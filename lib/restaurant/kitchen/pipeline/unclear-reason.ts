// lib/restaurant/kitchen/pipeline/unclear-reason.ts
//
// What went wrong with an app message, as a CODE. The pipeline reports it in
// Telegram's words («No entendí el precio… por ejemplo «aguacate $1.50 la
// libra»»), and those texts can carry an example price or the price just saved.
// So the raw reply is only ever LOOKED AT here, to pick a code; it is never
// stored or shown. Must run in the company's kitchen language, the language the
// reply was captured in (processAppReport does).

import { KITCHEN_COPY } from "@/lib/restaurant/telegram/kitchen-copy";
import type { UnclearReason } from "@/lib/restaurant/kitchen/pipeline/reply-sink";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A copy template as a pattern: every {placeholder} matches anything. */
function pattern(template: string): RegExp | null {
  const parts = template.split(/\{[^}]+\}/g);
  const literal = parts.join("").trim();
  if (literal.length < 8) return null; // only placeholders: too loose to match
  return new RegExp(parts.map(escape).join("[\\s\\S]*"));
}

type CopyKey = keyof typeof KITCHEN_COPY;

// In priority order: the first reason that matches any captured reply wins.
const BY_REASON: ReadonlyArray<[UnclearReason, readonly CopyKey[]]> = [
  ["save_failed", ["PRICE_SAVE_FAILED"]],
  ["currency_mismatch", ["PRICE_CURRENCY_MISMATCH"]],
  ["unreadable", ["VOICE_UNREADABLE"]],
  [
    "ai_unavailable",
    [
      "VOICE_AI_UNAVAILABLE",
      "PRICE_UPDATE_FAILED",
      "PRICE_LOST_AI_DOWN",
      "PROCESSING_FAILED",
    ],
  ],
  ["price_unclear", ["PRICE_NOT_UNDERSTOOD", "PRICE_UPDATE_UNCLEAR"]],
];

export function unclearReasonOf(messages: readonly string[]): UnclearReason {
  for (const [reason, keys] of BY_REASON) {
    const patterns = keys
      .map((k) => pattern(KITCHEN_COPY[k] as string))
      .filter((p): p is RegExp => p !== null);
    if (messages.some((m) => patterns.some((p) => p.test(m)))) return reason;
  }
  return "other";
}
