// What a message's card shows once Milton has read it (pure, so it is tested):
// chips, the question when Milton needs one more answer, and what was
// understood. Never an amount: the cook does not see prices.

import type { AppResult, ItemKind, UnclearReason } from "../api/types";
import { fmt, type Strings } from "../i18n/strings";

export type ChipTone = "mint" | "amarillo" | "grey" | "lavender";

export interface ChipSpec {
  tone: ChipTone;
  label: string;
}

export interface ResultView {
  chips: ChipSpec[];
  /** Milton's question (a unit question), or the app's own words for an amount one. */
  question: string | null;
  /** «pan, queso fresco» next to the lavender «Esto entendí» chip. */
  understood: string | null;
  /** «Los precios los ve tu encargado.» whenever a price went to the manager. */
  priceNote: string | null;
  /** Milton could not read it. */
  unclear: string | null;
  /** Products named without a price: the card offers quantity quick replies. */
  extras: string[];
  /** «¿Qué cantidad de tomates?» (names only, never an amount). */
  extrasQuestion: string | null;
}

/** The app's own words for a reason code (an unknown code reads as «other»). */
export function unclearText(code: UnclearReason | string, s: Strings): string {
  const u = s.status.unclear;
  switch (code) {
    case "unreadable":
      return u.unreadable;
    case "ai_unavailable":
      return u.aiUnavailable;
    case "price_unclear":
      return u.priceUnclear;
    case "currency_mismatch":
      return u.currencyMismatch;
    case "save_failed":
      return u.saveFailed;
    default:
      return u.other;
  }
}

export function describeResult(
  result: AppResult | null | undefined,
  s: Strings
): ResultView {
  const sent: ChipSpec = { tone: "mint", label: s.status.sent };
  const empty: ResultView = {
    chips: [sent],
    question: null,
    understood: null,
    priceNote: null,
    unclear: null,
    extras: [],
    extrasQuestion: null,
  };
  if (!result || result.state !== "done") return empty;

  const chips: ChipSpec[] = [];
  const extras = (result.extras ?? []).filter(Boolean);
  if (result.asks || extras.length > 0) {
    chips.push({ tone: "amarillo", label: s.status.asks });
  }
  if (result.draft) chips.push({ tone: "grey", label: s.status.awaiting });
  if (result.noted) chips.push({ tone: "mint", label: s.status.noted });
  const understood = result.understood.filter(Boolean);
  if (understood.length > 0 && (result.draft || result.noted)) {
    chips.push({ tone: "lavender", label: s.status.understood });
  }
  if (result.recipe) chips.push({ tone: "grey", label: s.status.recipeSeen });
  if (result.unclear)
    chips.push({ tone: "grey", label: s.status.couldNotRead });
  if (chips.length === 0) chips.push(sent);

  return {
    chips,
    // A unit question comes from the server's copy (product names, no amounts);
    // when it has none, and for an amount question, the app uses its own words.
    question: result.asks
      ? result.asks.kind === "amount"
        ? s.status.amountAsk
        : (result.asks.text ?? s.status.unitAsk)
      : null,
    understood:
      understood.length > 0 && (result.draft || result.noted)
        ? understood.join(", ")
        : null,
    priceNote: result.draft ? s.status.priceNote : null,
    unclear: result.unclear ? unclearText(result.unclear, s) : null,
    extras,
    extrasQuestion:
      extras.length > 0
        ? fmt(s.status.extrasAsk, { products: extras.join(", ") })
        : null,
  };
}

/** Quantities offered as quick replies on a «¿Qué cantidad…?» card. */
export const QUICK_QUANTITIES = [1, 2, 5, 10] as const;

/** The message a quick reply sends: «tomates: 5» (no price words, no money). */
export function quickReplyText(product: string, quantity: number): string {
  return `${product}: ${quantity}`;
}

/** The Historial's own «waiting» text: «1 envío guardado…». */
export function offlineText(count: number, s: Strings): string {
  if (count <= 0) return s.offline.banner;
  return fmt(count === 1 ? s.offline.savedOne : s.offline.savedMany, { count });
}

/** After this long a card still «processing» stops being polled. */
export const STUCK_AFTER_MS = 120_000;

type Waiting = {
  kind: ItemKind;
  result: AppResult | null;
  createdAt: string;
  status?: "received" | "processed";
};

/** The moment the wait counts from: the send, or the last «Reintentar». */
function waitStart(item: Waiting, since?: number): number {
  return Math.max(new Date(item.createdAt).getTime(), since ?? 0);
}

/**
 * Does this item still wait for Milton's reading (so the app keeps checking)?
 * Not forever: after two minutes it counts as stuck (isStuck) and polling stops
 * until the cook taps «Reintentar» (`since`).
 */
export function awaitsResult(
  item: Waiting,
  now: number,
  since?: number
): boolean {
  if (item.kind !== "text" && item.kind !== "voice") return false;
  const age = now - waitStart(item, since);
  if (item.result) {
    return item.result.state === "processing" && age < STUCK_AFTER_MS;
  }
  // Just sent, the result row may not be there yet.
  return age < 90_000;
}

/**
 * A text / voice card that stayed on «processing» (or never got a result) for
 * two minutes: shown as «Por enviar» with «Reintentar». Old history rows that
 * never had a result (before this feature) are not stuck, only left alone.
 */
export function isStuck(item: Waiting, now: number, since?: number): boolean {
  if (item.kind !== "text" && item.kind !== "voice") return false;
  const age = now - waitStart(item, since);
  if (age < STUCK_AFTER_MS) return false;
  if (item.result) return item.result.state === "processing";
  return item.status !== "processed" && age < 60 * 60_000;
}
