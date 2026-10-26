// lib/restaurant/telegram/kitchen-routing.ts
//
// Helpers for a cook who belongs to several restaurants: the buttons, the
// parked-message payload, the «Cambiar restaurante» anchor and the expiry
// notice. The webhook route owns the flow; nothing here writes to a company.
//
// Callback data stays opaque (kitchen-pending.ts): `kr1:<nonce>:<i>` item,
// `kd1:<nonce>:<i>` default, `kc1:<nonce>` cancel. Two reserved indexes
// (>= 90, never a real option):
//   90..98  «Ver más»: show page 0..8 of the options (8 buttons per page)
//   99      only on kd1: «Cambiar restaurante» (show the default keyboard)
//
// SECURITY: logs ids only. Never text, file ids or callback data.

import { createAdminClient } from "@/lib/supabase/admin";
import type { InlineKeyboardMarkup } from "./send";
import { sendTelegramMessage } from "./send";
import type { KitchenLink } from "./kitchen-links";
import {
  cleanupPendingOld,
  callbackData,
  createPendingItem,
  latestExpiredUnannounced,
  markExpiryAnnounced,
  type PendingKind,
} from "./kitchen-pending";
import { destinationVars, KITCHEN_COPY } from "./kitchen-copy";
import type { KitchenActor } from "./kitchen-media";
import {
  extractReportFromMessage,
  type TelegramIncomingMessage,
} from "./kitchen-reports";

export const PAGE_SIZE = 8;
export const PAGE_BASE = 90;
export const CHANGE_INDEX = 99;
/** 9 pages of 8. More links than this are simply not offered. */
export const MAX_OFFERED_LINKS = PAGE_SIZE * 9;

export function linkToActor(link: KitchenLink): KitchenActor {
  return {
    id: link.staffId,
    company_id: link.companyId,
    company_name: link.companyName,
    location_id: link.locationId,
    location_name: link.locationName,
  };
}

/** «{empresa} › {local}» */
export function linkLabel(link: {
  companyName: string;
  locationName: string;
}): string {
  const d = destinationVars({
    company_name: link.companyName,
    location_name: link.locationName,
  });
  return `${d.empresa} › ${d.local}`;
}

// ---------------------------------------------------------------------------
// Keyboards
// ---------------------------------------------------------------------------

export interface KeyboardEntry {
  /** Absolute position in the pending item's option list. */
  index: number;
  label: string;
}

/**
 * One button per row (8 per page), «Ver más» when there is another page
 * (the last page wraps to the first), then «Cancelar».
 */
export function buildRoutingKeyboard(
  nonce: string,
  kind: "item" | "default",
  entries: KeyboardEntry[],
  page = 0
): InlineKeyboardMarkup {
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const rows: InlineKeyboardMarkup["inline_keyboard"] = entries
    .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
    .map((e) => [
      { text: e.label, callback_data: callbackData(kind, nonce, e.index) },
    ]);
  if (pages > 1) {
    rows.push([
      {
        text: KITCHEN_COPY.BUTTON_MORE,
        callback_data: callbackData(
          kind,
          nonce,
          PAGE_BASE + ((current + 1) % pages)
        ),
      },
    ]);
  }
  rows.push([
    {
      text: KITCHEN_COPY.BUTTON_CANCEL,
      callback_data: callbackData("cancel", nonce),
    },
  ]);
  return { inline_keyboard: rows };
}

export function pageCount(optionCount: number): number {
  return Math.max(1, Math.ceil(optionCount / PAGE_SIZE));
}

export function changeMarkup(nonce: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: KITCHEN_COPY.BUTTON_CHANGE,
          callback_data: callbackData("default", nonce, CHANGE_INDEX),
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Parked message <-> payload
// ---------------------------------------------------------------------------

export function payloadFromMessage(
  message: TelegramIncomingMessage
): { kind: PendingKind; payload: Record<string, unknown> } | null {
  const report = extractReportFromMessage(message);
  if (!report) return null;
  const kind: PendingKind =
    report.media_kind === "voice"
      ? "voice"
      : report.media_kind === "photo"
        ? message.photo?.length
          ? "photo"
          : "document"
        : "text";
  const payload: Record<string, unknown> = {};
  if (report.telegram_file_id) payload.file_id = report.telegram_file_id;
  if (report.media_mime) payload.mime = report.media_mime;
  if (report.text) payload.text = report.text;
  if (report.media_duration_s != null) {
    payload.duration = report.media_duration_s;
  }
  if (typeof message.date === "number") payload.date = message.date;
  return { kind, payload };
}

/** Rebuilds the Telegram message a parked item came from. */
export function messageFromPayload(
  kind: PendingKind,
  payload: Record<string, unknown>,
  messageId: number
): TelegramIncomingMessage {
  const str = (k: string) =>
    typeof payload[k] === "string" ? (payload[k] as string) : undefined;
  const fileId = str("file_id");
  const text = str("text");
  const base: TelegramIncomingMessage = {
    message_id: messageId,
    ...(typeof payload.date === "number" ? { date: payload.date } : {}),
  };
  if (kind === "photo" && fileId) {
    return {
      ...base,
      photo: [{ file_id: fileId, width: 1, height: 1 }],
      caption: text,
    };
  }
  if (kind === "document" && fileId) {
    return {
      ...base,
      document: { file_id: fileId, mime_type: str("mime") },
      caption: text,
    };
  }
  if (kind === "voice" && fileId) {
    return {
      ...base,
      voice: {
        file_id: fileId,
        mime_type: str("mime"),
        duration:
          typeof payload.duration === "number" ? payload.duration : undefined,
      },
      caption: text,
    };
  }
  return { ...base, text };
}

// ---------------------------------------------------------------------------
// Pending rows with more than 8 options
// ---------------------------------------------------------------------------

/**
 * createPendingItem keeps 8 options; with more links the full list (up to
 * 72) is written back so «Ver más» pages can reach them. Best effort.
 */
async function extendOptions(itemId: string, links: KitchenLink[]) {
  if (links.length <= PAGE_SIZE) return;
  try {
    await createAdminClient()
      .from("kitchen_pending_items")
      .update({ option_staff_ids: links.map((l) => l.staffId) })
      .eq("id", itemId)
      .is("resolved_at", null);
  } catch {
    // the first 8 options still work
  }
}

/**
 * Parks an item (or a default-only anchor) and returns its nonce and the
 * ordered links the option indexes refer to. `created:false` = webhook retry.
 */
export async function parkItem(input: {
  telegramUserId: number;
  chatId: number;
  telegramMessageId: number;
  kind: PendingKind;
  payload: Record<string, unknown>;
  links: KitchenLink[];
  defaultOnly?: boolean;
}): Promise<
  | {
      ok: true;
      created: boolean;
      id: string;
      nonce: string;
      ordered: KitchenLink[];
    }
  | { ok: false }
> {
  const ordered = input.links.slice(0, MAX_OFFERED_LINKS);
  const res = await createPendingItem({ ...input, links: ordered });
  if (!res.ok) return { ok: false };
  if (res.created) await extendOptions(res.item.id, ordered);
  return {
    ok: true,
    created: res.created,
    id: res.item.id,
    nonce: res.item.nonce,
    ordered,
  };
}

/** The keyboard entries for a pending item's options, by staff id. */
export function entriesFor(
  optionStaffIds: string[],
  links: KitchenLink[]
): KeyboardEntry[] {
  const byId = new Map(links.map((l) => [l.staffId, l]));
  const out: KeyboardEntry[] = [];
  optionStaffIds.forEach((id, index) => {
    const link = byId.get(id);
    if (link) out.push({ index, label: linkLabel(link) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// «Cambiar restaurante» anchor and /restaurante rows
// ---------------------------------------------------------------------------

/** Anchors use the NEGATIVE message id, so they never collide with an item. */
export function anchorMessageId(messageId: number): number {
  return -Math.abs(messageId || 1);
}

/**
 * Open «¿por libra, onza o unidad?» questions (price-unit-question.ts) are
 * rows too. Their telegram_message_id is -(10_000_000_000 + message id):
 * below every anchor (-1 .. about -2.2e9) and every real id, so the
 * UNIQUE (chat_id, telegram_message_id) never collides and a webhook retry
 * of the same message maps to the same row.
 */
export const UNIT_QUESTION_BASE = 10_000_000_000;

export function unitQuestionMessageId(messageId: number): number {
  return -(UNIT_QUESTION_BASE + Math.abs(messageId || 1));
}

export function isUnitQuestion(telegramMessageId: number): boolean {
  return telegramMessageId <= -UNIT_QUESTION_BASE;
}

/** Default-only «Cambiar restaurante» rows. Unit questions are NOT anchors. */
export function isAnchor(telegramMessageId: number): boolean {
  return telegramMessageId < 0 && !isUnitQuestion(telegramMessageId);
}

/** Creates the anchor behind a «Cambiar restaurante» button; null if it fails. */
export async function createChangeAnchor(input: {
  telegramUserId: number;
  chatId: number;
  messageId: number;
  links: KitchenLink[];
}): Promise<InlineKeyboardMarkup | null> {
  const parked = await parkItem({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    telegramMessageId: anchorMessageId(input.messageId),
    kind: "text",
    payload: {},
    links: input.links,
    defaultOnly: true,
  });
  return parked.ok ? changeMarkup(parked.nonce) : null;
}

// ---------------------------------------------------------------------------
// Expiry notice and opportunistic cleanup
// ---------------------------------------------------------------------------

/**
 * Tells the cook ONCE that an unanswered question expired, and closes every
 * other expired one silently. Anchors (default-only rows) and unit questions never get a notice.
 * With `send:false` it only closes them (the caller already told the cook).
 * Returns whether a notice was sent.
 */
export async function announceExpiredOnce(
  telegramUserId: number,
  chatId: number,
  opts: { send?: boolean } = {}
): Promise<boolean> {
  let announced = opts.send === false;
  for (let i = 0; i < 10; i++) {
    const item = await latestExpiredUnannounced(telegramUserId, chatId);
    if (!item) break;
    await markExpiryAnnounced(item.id);
    // Anchors and unit questions are closed silently: nothing was lost.
    if (
      isAnchor(item.telegramMessageId) ||
      isUnitQuestion(item.telegramMessageId) ||
      announced
    ) {
      continue;
    }
    announced = true;
    console.info(`[telegram-webhook] pending expired id=${item.id}`);
    await sendTelegramMessage(chatId, KITCHEN_COPY.ROUTING_EXPIRED);
  }
  return announced;
}

const CLEANUP_EVERY_MS = 10 * 60 * 1000;
let lastCleanupAt = 0;

export function resetRoutingState(): void {
  lastCleanupAt = 0;
}

/** At most once per instance per 10 minutes; never awaits the delete. */
export function maybeCleanupPending(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_EVERY_MS) return;
  lastCleanupAt = now;
  void cleanupPendingOld();
}
