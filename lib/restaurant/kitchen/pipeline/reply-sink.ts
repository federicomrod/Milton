// lib/restaurant/kitchen/pipeline/reply-sink.ts
//
// Lets the Cocina app run a message through the SAME pipeline Telegram uses
// (rules, price AI, kitchen AI, drafts) without sending anything to Telegram.
// Inside runWithReplySink() every sendTelegramMessage addressed to the app
// cook's own pseudo chat is captured here instead of being sent, and the
// pipeline reports what it DID (a draft saved, a stock alert stored, a
// question opened) through recordPipelineEvent(). Outside a sink (every
// Telegram request) both are no-ops, so Telegram behaves exactly as before.
//
// SECURITY / money: events carry product names and counts only, never an
// amount: the cook must not be shown prices.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Why Milton could not read a message. The app stores and shows ONLY this code
 * (mapped to its own es/en/de text), never the raw reply: replies quote example
 * prices and the prices of what was just saved.
 */
export const UNCLEAR_REASONS = [
  "unreadable",
  "ai_unavailable",
  "price_unclear",
  "currency_mismatch",
  "save_failed",
  "other",
] as const;
export type UnclearReason = (typeof UNCLEAR_REASONS)[number];

export type PipelineEvent =
  | { kind: "price_draft"; products: string[] }
  | { kind: "stock"; reportType: string; products: string[] }
  // A unit question carries the product names (so the card can rebuild the
  // question from the copy); an amount question carries nothing.
  | { kind: "question"; ask: "amount" }
  | { kind: "question"; ask: "unit"; products: string[] }
  | { kind: "unclear"; reason: UnclearReason }
  // Products named without a price beside ones that had one («pan a 2 el kilo
  // y unos tomates»): the card asks how many, so nothing said is lost.
  | { kind: "extras"; products: string[] };

export interface ReplySink {
  /** Only messages to this chat are captured; any other still goes to Telegram. */
  chatId: number;
  messages: string[];
  events: PipelineEvent[];
}

const store = new AsyncLocalStorage<ReplySink>();

export function runWithReplySink<T>(
  sink: ReplySink,
  fn: () => Promise<T>
): Promise<T> {
  return store.run(sink, fn);
}

/** The sink that wants this chat's replies, or undefined (the normal case). */
export function sinkFor(chatId: number | string): ReplySink | undefined {
  const sink = store.getStore();
  return sink && String(sink.chatId) === String(chatId) ? sink : undefined;
}

/** True while an app message is being processed. */
export function inAppPipeline(): boolean {
  return store.getStore() !== undefined;
}

export function recordPipelineEvent(event: PipelineEvent): void {
  store.getStore()?.events.push(event);
}

/** Pseudo ids for an app cook: negative and far below any real Telegram chat id. */
const APP_ID_FLOOR = 1_000_000_000_000_000;
const HASH_MOD = 2 ** 45;

/** A stable 45-bit hash of the whole id (an unsafe multiply would overflow). */
function hash45(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++)
    h = (h * 131 + id.charCodeAt(i)) % HASH_MOD;
  return h;
}

/** The cook's pseudo chat: where their open questions live. */
export function appChatId(staffId: string): number {
  return -(APP_ID_FLOOR + hash45(staffId));
}

/** A pseudo message id, unique per report. */
export function appMessageId(reportId: string): number {
  return 1 + hash45(reportId);
}
