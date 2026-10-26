// lib/restaurant/telegram/price-unit-question.ts
//
// «queso 3.25» has a price but no unit. The bot asks ONCE («¿por libra, onza
// o unidad?») and keeps the question open as a row in kitchen_pending_items
// (no new table): payload `price_unit_question: { items: [{product, price,
// currency}] }`, option_staff_ids = [the restaurant], 15 min TTL, and a
// reserved NEGATIVE telegram_message_id (kitchen-routing: unitQuestionMessageId)
// derived from the asking message, so a webhook retry maps to the same row.
//
// Nothing is saved until the answer arrives. SECURITY: ids and counts only.

import { createAdminClient } from "@/lib/supabase/admin";
import type { KitchenLink } from "./kitchen-links";
import {
  createPendingItem,
  expirePendingItem,
  type PendingItem,
} from "./kitchen-pending";
import { isUnitQuestion, unitQuestionMessageId } from "./kitchen-routing";
import type { PriceUpdateItem, UnitlessPrice } from "./price-update";

export type UnitQuestionItem = {
  product: string;
  price: number;
  currency: string | null;
};

export function itemsOfQuestion(item: PendingItem): UnitQuestionItem[] | null {
  const q = item.payload.price_unit_question as { items?: unknown } | undefined;
  if (!q && item.payload.price_amount_question) {
    // An amount question: readers that only need «what is it about» (the AI
    // context) still see its product. The amount answer path reads
    // amountItemsOfQuestion() first; `price` here is NOT an answer.
    return (
      amountItemsOfQuestion(item)?.map((i) => ({
        product: i.product,
        price: i.options[1],
        currency: i.currency,
      })) ?? null
    );
  }
  if (!q || !Array.isArray(q.items)) return null;
  const out: UnitQuestionItem[] = [];
  for (const raw of q.items) {
    const r = raw as Record<string, unknown>;
    if (
      !r ||
      typeof r.product !== "string" ||
      typeof r.price !== "number" ||
      !Number.isFinite(r.price) ||
      r.price <= 0
    ) {
      return null;
    }
    out.push({
      product: r.product,
      price: r.price,
      currency: typeof r.currency === "string" ? r.currency : null,
    });
  }
  return out.length > 0 ? out : null;
}

export function applyUnit(
  items: UnitQuestionItem[],
  unit: string
): PriceUpdateItem[] {
  return items.map((i) => ({
    name: i.product,
    price: i.price,
    unit,
    currency: i.currency as PriceUpdateItem["currency"],
  }));
}

// ---------------------------------------------------------------------------
// Amount question: «aguacate a 150» may be $1.50 or $150. Same table, same
// reserved NEGATIVE id (derived from the asking message), same TTL, no
// migration. Payload `price_amount_question: { items: [{product, options,
// unit, currency}] }`; at most ONE item (one question per message).
// ---------------------------------------------------------------------------

export type AmountQuestionItem = {
  product: string;
  options: [number, number];
  unit: string | null;
  currency: string | null;
};

export function amountItemsOfQuestion(
  item: PendingItem
): AmountQuestionItem[] | null {
  const q = item.payload.price_amount_question as
    | { items?: unknown }
    | undefined;
  if (!q || !Array.isArray(q.items)) return null;
  const out: AmountQuestionItem[] = [];
  for (const raw of q.items) {
    const r = raw as Record<string, unknown>;
    const o = r?.options;
    if (
      !r ||
      typeof r.product !== "string" ||
      !Array.isArray(o) ||
      o.length !== 2 ||
      !o.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    ) {
      return null;
    }
    out.push({
      product: r.product,
      options: [o[0] as number, o[1] as number],
      unit: typeof r.unit === "string" ? r.unit : null,
      currency: typeof r.currency === "string" ? r.currency : null,
    });
  }
  return out.length > 0 ? out : null;
}

/** Product names of whatever the open question is about (either kind). */
export function productsOfQuestion(item: PendingItem): string[] {
  const amount = amountItemsOfQuestion(item);
  if (amount) return amount.map((i) => i.product);
  return (itemsOfQuestion(item) ?? []).map((i) => i.product);
}

export async function openAmountQuestion(input: {
  chatId: number;
  messageId: number;
  link: KitchenLink;
  items: AmountQuestionItem[];
}): Promise<{ ok: true; created: boolean } | { ok: false }> {
  return openQuestionRow(input.chatId, input.messageId, input.link, {
    price_amount_question: { items: input.items },
  });
}

/**
 * Opens the question for the message that asked it. `created:false` = webhook
 * retry (the question is already out). Older open questions of the chat are
 * closed first: only the newest one can be answered.
 */
export async function openUnitQuestion(input: {
  chatId: number;
  messageId: number;
  link: KitchenLink;
  items: UnitlessPrice[];
}): Promise<{ ok: true; created: boolean } | { ok: false }> {
  return openQuestionRow(input.chatId, input.messageId, input.link, {
    price_unit_question: {
      items: input.items.map((i) => ({
        product: i.name,
        price: i.price,
        currency: (i as { currency?: string | null }).currency ?? null,
      })),
    },
  });
}

async function openQuestionRow(
  chatId: number,
  messageId: number,
  link: KitchenLink,
  payload: Record<string, unknown>
): Promise<{ ok: true; created: boolean } | { ok: false }> {
  try {
    const mine = unitQuestionMessageId(messageId);
    const open = await listOpenUnitQuestions(chatId);
    for (const q of open) {
      if (q.telegramMessageId !== mine) await expirePendingItem(q.id);
    }
    const res = await createPendingItem({
      telegramUserId: link.telegramUserId,
      chatId,
      telegramMessageId: mine,
      kind: "text",
      payload,
      links: [link],
    });
    if (!res.ok) return { ok: false };
    return { ok: true, created: res.created };
  } catch {
    return { ok: false };
  }
}

async function listOpenUnitQuestions(chatId: number): Promise<PendingItem[]> {
  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from("kitchen_pending_items")
      .select(
        "id, nonce, telegram_user_id, chat_id, telegram_message_id, kind, payload, option_staff_ids, created_at, expires_at, resolved_at, chosen_staff_id"
      )
      .eq("chat_id", chatId)
      .is("resolved_at", null)
      .gte("expires_at", nowIso);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>)
      .filter((r) => isUnitQuestion(Number(r.telegram_message_id)))
      .map((r) => ({
        id: String(r.id),
        nonce: String(r.nonce),
        telegramUserId: Number(r.telegram_user_id),
        chatId: Number(r.chat_id),
        telegramMessageId: Number(r.telegram_message_id),
        kind: r.kind as PendingItem["kind"],
        payload: (r.payload as Record<string, unknown> | null) ?? {},
        optionStaffIds: Array.isArray(r.option_staff_ids)
          ? (r.option_staff_ids as string[])
          : [],
        createdAt: String(r.created_at),
        expiresAt: String(r.expires_at),
        resolvedAt: null,
        chosenStaffId: null,
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** The newest open (unresolved, not expired) unit question of this chat. */
export async function findOpenUnitQuestion(
  chatId: number
): Promise<PendingItem | null> {
  const open = await listOpenUnitQuestions(chatId);
  return open[0] ?? null;
}
