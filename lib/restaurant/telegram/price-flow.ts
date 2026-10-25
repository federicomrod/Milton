// lib/restaurant/telegram/price-flow.ts
//
// The ONE price pipeline for the kitchen bot (typed text AND voice
// transcripts): rules -> AI fallback -> (unit missing -> ask) -> save.
//
// It works item by item, never all-or-nothing. For one message it returns:
//
//   saved           product + price + unit: saved right away as a draft
//   needUnit        a price without a unit: that item only is asked about
//   unclear         could not be read (reported by name; «150» carries a hint)
//   skippedNoPrice  «el agua tibia no tiene precio»: skipped quietly, never $0
//   overLimit       beyond PRICE_UPDATE_MAX_ITEMS: told to the cook, not dropped
//
// `none` = not a price at all: the caller goes on (recipe / acknowledgement).
//
// SECURITY: no logging of text here.

import {
  hasPriceNumber,
  isPriceAiCandidate,
  looksLikePriceIntent,
  parsePriceItems,
  PRICE_UPDATE_MAX_ITEMS,
  type ItemParse,
  type PriceUpdateItem,
  type UnitlessPrice,
} from "./price-update";
import { validateAiItems, type PriceAi } from "./price-update-ai";
import { KITCHEN_COPY, renderKitchenCopy } from "./kitchen-copy";

export type UnclearItem = { label: string | null; hint?: string };

export type PriceItemsResult = {
  saved: PriceUpdateItem[];
  needUnit: UnitlessPrice[];
  unclear: UnclearItem[];
  skippedNoPrice: string[];
  overLimit: string[];
};

export type PriceFlowResult =
  | { kind: "none"; aiCalled: boolean; aiFailed?: boolean }
  | {
      kind: "items";
      r: PriceItemsResult;
      aiCalled: boolean;
      aiFailed?: boolean;
    };

export type PriceRoute = "price" | "price_partial" | "needs_unit" | "unclear";

export function routeOf(r: PriceItemsResult): PriceRoute {
  const rest = r.needUnit.length + r.unclear.length + r.overLimit.length;
  if (r.saved.length > 0) return rest > 0 ? "price_partial" : "price";
  if (r.needUnit.length > 0) return "needs_unit";
  return "unclear";
}

export type RulesStage =
  | { done: true; result: PriceFlowResult }
  | { done: false; read: ItemParse };

const NONE: PriceFlowResult = { kind: "none", aiCalled: false };

function finalize(
  read: ItemParse,
  aiCalled: boolean,
  aiFailed = false
): PriceFlowResult {
  // The limit counts every item that would be processed (saved or asked).
  let room = PRICE_UPDATE_MAX_ITEMS;
  const overLimit: string[] = [];
  const saved: PriceUpdateItem[] = [];
  const needUnit: UnitlessPrice[] = [];
  for (const i of read.items) {
    if (room > 0) {
      saved.push(i);
      room--;
    } else overLimit.push(i.name);
  }
  for (const i of read.unitless) {
    if (room > 0) {
      needUnit.push(i);
      room--;
    } else overLimit.push(i.name);
  }
  const unclear = read.unclear.map((u) => ({ label: u.label, hint: u.hint }));
  if (
    saved.length + needUnit.length + unclear.length + overLimit.length ===
    0
  ) {
    return { kind: "none", aiCalled, aiFailed };
  }
  return {
    kind: "items",
    aiCalled,
    aiFailed,
    r: {
      saved,
      needUnit,
      unclear,
      skippedNoPrice: read.skippedNoPrice,
      overLimit,
    },
  };
}

/** Synchronous part: lets the caller reply right away when no AI is needed. */
export function rulesStage(text: string): RulesStage {
  const p = parsePriceItems(text);
  if (!p) return { done: true, result: NONE };
  const read = p.items.length + p.unitless.length;
  let unclear = p.unclear;
  // Rules saw nothing, yet it reads like a price («aguacate 1.50 por favor»).
  if (
    read === 0 &&
    unclear.length === 0 &&
    p.skippedNoPrice.length === 0 &&
    looksLikePriceIntent(text)
  ) {
    unclear = [{ label: null, segment: "" }];
  }
  const parse: ItemParse = { ...p, unclear };
  // The AI looks at what the rules could not read (a number must be there). A
  // plain report with a number («1 hamburguesa») never gets here.
  const wantsAi =
    unclear.some((u) => !u.hint) &&
    hasPriceNumber(text) &&
    (read > 0 || isPriceAiCandidate(text));
  if (wantsAi) return { done: false, read: parse };
  return { done: true, result: finalize(parse, false) };
}

function key(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(es|s)$/, "");
}

/** The AI part. Any failure or doubt leaves the unread items as «not understood». */
export async function aiStage(
  text: string,
  read: ItemParse,
  ai: PriceAi
): Promise<PriceFlowResult> {
  let raw: unknown = null;
  try {
    raw = await ai(text);
  } catch {
    raw = null;
  }
  const candidates = raw == null ? [] : validateAiItems(raw, text);
  const readCount = read.items.length + read.unitless.length;
  const known = new Set(
    [...read.items, ...read.unitless].map((i) => key(i.name))
  );
  const items = [...read.items];
  const unitless = [...read.unitless];
  const resolved = new Set<number>();
  const seen = new Set<string>();
  let accepted = 0;
  for (const c of candidates) {
    if (known.has(key(c.name))) continue; // the rules already read it
    const at = read.unclear.findIndex(
      (u) => u.segment !== "" && u.segment.includes(c.said)
    );
    // Beside what the rules read, the AI may only fix the unreadable parts.
    if (readCount > 0 && at < 0) continue;
    const dup = `${key(c.name)}|${c.price}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    if (at >= 0) resolved.add(at);
    accepted++;
    if (c.unit !== null) {
      items.push({ name: c.name, price: c.price, unit: c.unit });
    } else unitless.push({ name: c.name, price: c.price });
  }
  let unclear = read.unclear.filter((_, i) => !resolved.has(i));
  if (accepted > 0 && readCount === 0) {
    unclear = unclear.filter((u) => u.hint);
  }
  // When AI returned null (threw or timed out), mark it as failed
  const aiFailed = raw === null;
  return finalize({ ...read, items, unitless, unclear }, true, aiFailed);
}

export async function resolvePriceText(
  text: string,
  ai: PriceAi
): Promise<PriceFlowResult> {
  const stage = rulesStage(text);
  if (stage.done) return stage.result;
  return aiStage(text, stage.read, ai);
}

// ---------------------------------------------------------------------------
// Reply pieces (the caller joins them into ONE message)
// ---------------------------------------------------------------------------

export function joinProducts(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function uniq(names: string[]): string[] {
  return [...new Set(names)];
}

/** «No entendí …» for what could not be read. `standalone` = nothing else was read. */
export function unclearLine(
  r: PriceItemsResult,
  standalone: boolean
): string | null {
  if (r.unclear.length === 0) return null;
  if (standalone && r.unclear.every((u) => !u.hint)) {
    return KITCHEN_COPY.PRICE_UPDATE_UNCLEAR;
  }
  const labels = r.unclear.map((u) => {
    if (!u.label) return null;
    if (!u.hint) return u.label;
    return `${u.label} (¿$${u.hint[0]}.${u.hint.slice(1)} o $${u.hint}?)`;
  });
  const named = uniq(labels.filter((l): l is string => l !== null));
  const unnamed = labels.length - labels.filter((l) => l !== null).length;
  if (unnamed > 0) named.push(unnamed === 1 ? "un precio" : "unos precios");
  return renderKitchenCopy(KITCHEN_COPY.PRICE_NOT_UNDERSTOOD, {
    productos: joinProducts(named),
  });
}

export function overLimitLine(r: PriceItemsResult): string | null {
  if (r.overLimit.length === 0) return null;
  return renderKitchenCopy(KITCHEN_COPY.PRICE_OVER_LIMIT, {
    n: String(PRICE_UPDATE_MAX_ITEMS),
    productos: joinProducts(uniq(r.overLimit)),
  });
}
