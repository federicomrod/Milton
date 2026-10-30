// lib/restaurant/kitchen/kitchen-serializer.ts
//
// The «no money» wall of the kitchen API (mobile P0b, #430). Cooks must never
// see prices, costs, margins, totals or sales, whatever columns a row happens
// to carry. So every kitchen response is built by an ALLOW-LIST serializer
// (only fields listed here pass, everything else is dropped) and then checked
// again by assertNoMoneyFields() right before it leaves the server
// (mobile-response.ts -> kitchenJson).
//
// TODO(can_see_costs): kitchen_staff.can_see_costs exists but is false for
// everybody in v1 and there is no UI to turn it on. When it lands, the
// serializers below are the only place that may start returning money for a
// cook who has it; until then it changes nothing.

/**
 * Money-ish words in a key. Applied to each word of a key (snake_case,
 * camelCase, kebab-case) and to the key with separators removed, so
 * `unit_price`, `unitPrice`, `costo_total` and `margen` all match, while
 * `created_at` and `status` do not.
 */
export const MONEY_FIELD_PATTERN =
  /pric|preci(?:o|os)|cost|margin|margen|amount|monto|total|sales|ventas|revenue|importe|impuesto|profit|ganancia|utilidad|currency|moneda/i;

const MONEY_WORD_EXACT = /^(?:iva|tax|taxes|vat)$/i;

/** Keys whose value is free text typed or spoken by a person. */
const FREE_TEXT_KEYS = new Set([
  "text",
  "transcript",
  "name",
  "displayname",
  "display_name",
  "label",
  "devicelabel",
  "device_label",
  "inviteename",
  "invitee_name",
  "error",
  "message",
  // Authored recipe text (steps, notes, descriptions).
  "steps",
  "note",
  "notes",
  "description",
  // What Milton understood from a message (product names).
  "understood",
]);

// A string that IS an amount: «$12.50», «€ 3», «12,50 €», «3 USD». Anchored on
// purpose, so a random token or an id can never match by accident.
const CURRENCY_VALUE_RE =
  /^\s*(?:[-+]?[$€£]\s?\d[\d.,]*|[-+]?\d[\d.,]*\s?(?:[$€£]|usd|eur|mxn|cop|ars|clp|pen|brl))\s*$/i;

const MAX_DEPTH = 10;

export function isMoneyKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (
    words.some((w) => MONEY_WORD_EXACT.test(w) || MONEY_FIELD_PATTERN.test(w))
  ) {
    return true;
  }
  return MONEY_FIELD_PATTERN.test(words.join(""));
}

/**
 * Throws when any key looks like money, or when a non-free-text string value
 * looks like a currency amount («$12.50», «12,50 €», «3 USD»). Walks objects
 * and arrays. A cook's own free text («compré por $5») is not a money field.
 */
export function assertNoMoneyFields(value: unknown): void {
  const walk = (node: unknown, key: string | null, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error("money guard: too deep");
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, key, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (isMoneyKey(k)) throw new Error("money guard: money key");
        walk(v, k, depth + 1);
      }
      return;
    }
    if (typeof node === "string") {
      const isFreeText = key !== null && FREE_TEXT_KEYS.has(key.toLowerCase());
      if (!isFreeText && CURRENCY_VALUE_RE.test(node)) {
        throw new Error("money guard: currency value");
      }
    }
  };
  walk(value, null, 0);
}

import {
  UNCLEAR_REASONS,
  type UnclearReason,
} from "@/lib/restaurant/kitchen/pipeline/reply-sink";

type Row = Record<string, unknown>;

/** Copies only the listed fields; everything else is dropped. */
export function pickAllowed(
  row: Row | null | undefined,
  allowed: readonly string[]
): Row {
  const out: Row = {};
  if (!row) return out;
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(row, field))
      out[field] = row[field];
  }
  return out;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// Kitchen (cook) responses
// ---------------------------------------------------------------------------

export function serializeKitchenMe(input: {
  staff: Row;
  company: Row | null;
  locations: Row[];
}) {
  const staff = pickAllowed(input.staff, ["id", "display_name"]);
  return {
    staff: { id: str(staff.id), name: str(staff.display_name) },
    company: { name: str(pickAllowed(input.company, ["name"]).name) },
    locations: input.locations.map((l) => {
      const p = pickAllowed(l, ["id", "name"]);
      return { id: str(p.id), name: str(p.name) };
    }),
  };
}

export function serializeKitchenRedeem(input: {
  deviceToken: string;
  staffId: string;
  staffName: string;
  locationId: string;
  locationName: string;
}) {
  return {
    deviceToken: input.deviceToken,
    staff: { id: input.staffId, name: input.staffName },
    location: { id: input.locationId, name: input.locationName },
  };
}

export type KitchenHistoryKind = "photo" | "voice" | "document" | "text";

export function serializeKitchenHistoryItem(row: Row) {
  const p = pickAllowed(row, [
    "id",
    "media_kind",
    "media_mime",
    "text",
    "transcript",
    "processed_at",
    "app_result",
    "created_at",
  ]);
  // kitchen_reports.media_kind only allows photo | voice, so a PDF shows up as
  // a report without media_kind and an application/pdf mime.
  const kind: KitchenHistoryKind =
    p.media_kind === "photo" || p.media_kind === "voice"
      ? (p.media_kind as "photo" | "voice")
      : p.media_mime === "application/pdf"
        ? "document"
        : "text";
  return {
    id: str(p.id),
    kind,
    text: strOrNull(p.transcript) ?? strOrNull(p.text),
    status: p.processed_at ? "processed" : "received",
    result: serializeAppResult(p.app_result),
    createdAt: str(p.created_at),
  };
}

/**
 * What Milton did with a message sent from the app, for the card's chips. Only
 * these fields pass: what happened and product names, never an amount.
 */
export function serializeAppResult(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Row;
  const state =
    r.state === "processing" || r.state === "done" || r.state === "failed"
      ? r.state
      : null;
  if (!state) return null;
  const asks =
    r.asks && typeof r.asks === "object"
      ? {
          kind: (r.asks as Row).kind === "amount" ? "amount" : "unit",
          // Defence in depth: a question that carries any digit or currency is
          // dropped (the app words it itself), whatever an older row stored.
          text: noAmount(strOrNull((r.asks as Row).text)),
        }
      : null;
  return {
    state,
    noted: r.noted === true,
    draft: r.draft === true,
    asks,
    // Only a known reason code passes. Anything else (for example the raw reply
    // an older version stored) becomes "other"; its text is never returned.
    unclear: unclearCode(r.unclear),
    recipe: r.recipe === true,
    understood: Array.isArray(r.understood)
      ? r.understood
          .filter(
            (x): x is string => typeof x === "string" && !looksLikePrice(x)
          )
          .slice(0, 10)
      : [],
  };
}

/** A product name that is really a price («pan $2.00», «2,50 €»). */
function looksLikePrice(value: string): boolean {
  return /[$€£]|\d[\d.,]*\s?(?:usd|eur|mxn|cop|ars|clp|pen|brl)\b|\d+[.,]\d{2}\b/i.test(
    value
  );
}

/** The text, or null when it carries a digit or a currency symbol. */
function noAmount(value: string | null): string | null {
  return value !== null && !/[\d$€£]/.test(value) ? value : null;
}

function unclearCode(value: unknown): UnclearReason | null {
  if (typeof value !== "string" || value === "") return null;
  return (UNCLEAR_REASONS as readonly string[]).includes(value)
    ? (value as UnclearReason)
    : "other";
}

export function serializeKitchenUpload(input: {
  reportId: string;
  mediaId?: string | null;
  duplicate: boolean;
}) {
  return {
    reportId: input.reportId,
    mediaId: input.mediaId ?? null,
    duplicate: input.duplicate,
  };
}

// ---------------------------------------------------------------------------
// Manager responses under kitchen/ (invites and devices). Never a secret,
// token, hash or Telegram id.
// ---------------------------------------------------------------------------

export function serializeKitchenInvite(row: Row, now: Date = new Date()) {
  const p = pickAllowed(row, [
    "id",
    "location_id",
    "invitee_name",
    "expires_at",
    "used_at",
    "revoked_at",
    "created_at",
  ]);
  const status = p.used_at
    ? "used"
    : p.revoked_at
      ? "revoked"
      : new Date(str(p.expires_at)).getTime() <= now.getTime()
        ? "expired"
        : "pending";
  return {
    id: str(p.id),
    locationId: str(p.location_id),
    inviteeName: strOrNull(p.invitee_name),
    expiresAt: str(p.expires_at),
    usedAt: strOrNull(p.used_at),
    revokedAt: strOrNull(p.revoked_at),
    createdAt: str(p.created_at),
    status,
  };
}

export function serializeKitchenDevice(row: Row, staffName: string | null) {
  const p = pickAllowed(row, [
    "id",
    "staff_id",
    "platform",
    "device_label",
    "last_seen_at",
    "revoked_at",
    "created_at",
  ]);
  return {
    id: str(p.id),
    staffId: str(p.staff_id),
    staffName,
    platform: strOrNull(p.platform),
    deviceLabel: strOrNull(p.device_label),
    lastSeenAt: strOrNull(p.last_seen_at),
    revokedAt: strOrNull(p.revoked_at),
    createdAt: str(p.created_at),
  };
}

// ---------------------------------------------------------------------------
// Direct uploads and recipes (mobile P1, #431)
// ---------------------------------------------------------------------------

export function serializeKitchenUploadTicket(input: {
  reportId: string;
  uploadUrl: string | null;
  uploadToken: string | null;
  path: string;
  expiresInS: number;
  duplicate: boolean;
}) {
  return {
    reportId: input.reportId,
    uploadUrl: input.uploadUrl,
    uploadToken: input.uploadToken,
    path: input.path,
    expiresInS: input.expiresInS,
    duplicate: input.duplicate,
  };
}

/**
 * A recipe as the cook sees it: name, category, yield, ingredients (name,
 * quantity, unit) and steps. Whatever else the source rows carry (selling
 * price, unit cost, cost source…) is dropped here.
 */
export function serializeKitchenRecipe(input: {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  yield: { quantity: number; unit: string } | null;
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    note: string | null;
  }>;
  steps: string[];
}) {
  return {
    id: str(input.id),
    name: str(input.name),
    category: strOrNull(input.category),
    description: strOrNull(input.description),
    yield: input.yield
      ? { quantity: Number(input.yield.quantity), unit: str(input.yield.unit) }
      : null,
    ingredients: input.ingredients.map((i) => ({
      name: str(i.name),
      quantity: Number(i.quantity),
      unit: str(i.unit),
      note: strOrNull(i.note),
    })),
    steps: input.steps.map((s) => str(s)),
  };
}
