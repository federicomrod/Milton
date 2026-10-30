// What a message's card shows once Milton has read it (pure, so it is tested):
// chips, the question when Milton needs one more answer, and what was
// understood. Never an amount: the cook does not see prices.

import type { AppResult, ItemKind } from "../api/types";
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
  };
  if (!result || result.state !== "done") return empty;

  const chips: ChipSpec[] = [];
  if (result.asks) chips.push({ tone: "amarillo", label: s.status.asks });
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
    question: result.asks
      ? result.asks.kind === "amount"
        ? s.status.amountAsk
        : result.asks.text
      : null,
    understood:
      understood.length > 0 && (result.draft || result.noted)
        ? understood.join(", ")
        : null,
    priceNote: result.draft ? s.status.priceNote : null,
    unclear: result.unclear,
  };
}

/** The Historial's own «waiting» text: «1 envío guardado…». */
export function offlineText(count: number, s: Strings): string {
  if (count <= 0) return s.offline.banner;
  return fmt(count === 1 ? s.offline.savedOne : s.offline.savedMany, { count });
}

/** Does this item still wait for Milton's reading (so the app keeps checking)? */
export function awaitsResult(
  item: { kind: ItemKind; result: AppResult | null; createdAt: string },
  now: number
): boolean {
  if (item.kind !== "text" && item.kind !== "voice") return false;
  if (item.result) return item.result.state === "processing";
  // Just sent, the result row may not be there yet.
  return now - new Date(item.createdAt).getTime() < 90_000;
}
