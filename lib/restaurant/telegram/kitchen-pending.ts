// lib/restaurant/telegram/kitchen-pending.ts
//
// A cook with several restaurants sends a photo / voice note / text: we park
// it here as a pending item, ask «¿Para qué restaurante es?» with buttons,
// and replay it once they pick. Also the short-lived "next ones go to X"
// default (/restaurante).
//
// Privacy: the payload holds only what is needed to replay (file id, mime,
// caption/text up to 2000 chars, duration, message date). It is cleared to
// '{}' when the item is resolved or expires, and rows older than 24 h are
// deleted opportunistically (cleanupPendingOld; no cron).
// Nothing here logs ids, text, file ids or callback data.
//
// Service role. Every function resolves to a typed result: none throws.

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { KitchenLink } from "./kitchen-links";

export const PENDING_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_TTL_MS = 30 * 60 * 1000;
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 2000;
const MAX_OPTIONS = 8;
const NONCE_BYTES = 16;

export type PendingKind = "photo" | "voice" | "text" | "document";

export interface PendingItem {
  id: string;
  nonce: string;
  telegramUserId: number;
  chatId: number;
  telegramMessageId: number;
  kind: PendingKind;
  payload: Record<string, unknown>;
  optionStaffIds: string[];
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  chosenStaffId: string | null;
}

const COLUMNS =
  "id, nonce, telegram_user_id, chat_id, telegram_message_id, kind, payload, option_staff_ids, created_at, expires_at, resolved_at, chosen_staff_id";

type Row = Record<string, unknown>;

function toItem(row: Row): PendingItem {
  return {
    id: String(row.id),
    nonce: String(row.nonce),
    telegramUserId: Number(row.telegram_user_id),
    chatId: Number(row.chat_id),
    telegramMessageId: Number(row.telegram_message_id),
    kind: row.kind as PendingKind,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    optionStaffIds: Array.isArray(row.option_staff_ids)
      ? (row.option_staff_ids as string[])
      : [],
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    resolvedAt: (row.resolved_at as string | null) ?? null,
    chosenStaffId: (row.chosen_staff_id as string | null) ?? null,
  };
}

function cleanPayload(payload: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...payload };
  for (const key of ["text", "caption"]) {
    if (typeof out[key] === "string") {
      out[key] = (out[key] as string).slice(0, MAX_TEXT);
    }
  }
  return out;
}

export async function createPendingItem(input: {
  telegramUserId: number;
  chatId: number;
  telegramMessageId: number;
  kind: PendingKind;
  payload: Record<string, unknown>;
  links: KitchenLink[];
  defaultOnly?: boolean;
}): Promise<
  | { ok: true; item: PendingItem; created: boolean }
  | { ok: false; reason: "error" }
> {
  try {
    const admin = createAdminClient();
    const find = async () => {
      const { data, error } = await admin
        .from("kitchen_pending_items")
        .select(COLUMNS)
        .eq("chat_id", input.chatId)
        .eq("telegram_message_id", input.telegramMessageId)
        .maybeSingle();
      if (error) throw new Error("pending lookup failed");
      return data as Row | null;
    };

    const existing = await find();
    if (existing) return { ok: true, item: toItem(existing), created: false };

    const payload = cleanPayload(input.payload);
    if (input.defaultOnly) payload.default_only = true;
    const now = Date.now();
    const { data, error } = await admin
      .from("kitchen_pending_items")
      .insert({
        nonce: randomBytes(NONCE_BYTES).toString("base64url"),
        telegram_user_id: input.telegramUserId,
        chat_id: input.chatId,
        telegram_message_id: input.telegramMessageId,
        kind: input.kind,
        payload,
        option_staff_ids: input.links
          .slice(0, MAX_OPTIONS)
          .map((l) => l.staffId),
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + PENDING_TTL_MS).toISOString(),
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      // A concurrent retry may have inserted first (unique violation).
      const raced = await find();
      if (raced) return { ok: true, item: toItem(raced), created: false };
      return { ok: false, reason: "error" };
    }
    return { ok: true, item: toItem(data as Row), created: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function loadPendingByNonce(
  nonce: string
): Promise<PendingItem | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("kitchen_pending_items")
      .select(COLUMNS)
      .eq("nonce", nonce)
      .maybeSingle();
    if (error || !data) return null;
    return toItem(data as Row);
  } catch {
    return null;
  }
}

/**
 * Atomic: only one caller wins. The payload is returned as it was and
 * cleared right after the winner read it. A double tap resolves once.
 */
export async function resolvePendingItem(
  id: string,
  chosenStaffId: string
): Promise<
  | { ok: true; item: PendingItem }
  | {
      ok: false;
      reason: "already_resolved" | "expired" | "not_found" | "error";
    }
> {
  try {
    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("kitchen_pending_items")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, reason: "error" };
    if (!row) return { ok: false, reason: "not_found" };
    const before = toItem(row as Row);
    if (!before.optionStaffIds.includes(chosenStaffId)) {
      return { ok: false, reason: "not_found" };
    }
    if (before.resolvedAt) return { ok: false, reason: "already_resolved" };

    const nowIso = new Date().toISOString();
    if (before.expiresAt <= nowIso) {
      await clearPayload(id);
      return { ok: false, reason: "expired" };
    }

    const { data: won, error: updError } = await admin
      .from("kitchen_pending_items")
      .update({ resolved_at: nowIso, chosen_staff_id: chosenStaffId })
      .eq("id", id)
      .is("resolved_at", null)
      .gte("expires_at", nowIso)
      .select("id");
    if (updError) return { ok: false, reason: "error" };
    if (!won || won.length === 0) {
      const { data: again } = await admin
        .from("kitchen_pending_items")
        .select("resolved_at")
        .eq("id", id)
        .maybeSingle();
      return {
        ok: false,
        reason: again && again.resolved_at ? "already_resolved" : "expired",
      };
    }

    await clearPayload(id);
    return {
      ok: true,
      item: { ...before, resolvedAt: nowIso, chosenStaffId },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

async function clearPayload(id: string): Promise<void> {
  try {
    await createAdminClient()
      .from("kitchen_pending_items")
      .update({ payload: {} })
      .eq("id", id);
  } catch {
    // best effort; the 24 h cleanup removes the row anyway
  }
}

/** Clears the payload and closes the item without a choice (cancel / expiry). */
export async function expirePendingItem(id: string): Promise<void> {
  try {
    await createAdminClient()
      .from("kitchen_pending_items")
      .update({ payload: {}, resolved_at: new Date().toISOString() })
      .eq("id", id)
      .is("resolved_at", null);
  } catch {
    // swallow
  }
}

/** The newest expired, never-resolved item for this chat (not yet announced). */
export async function latestExpiredUnannounced(
  telegramUserId: number,
  chatId: number
): Promise<PendingItem | null> {
  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();
    // Privacy: expired items lose their payload as soon as we see them.
    await admin
      .from("kitchen_pending_items")
      .update({ payload: {} })
      .eq("telegram_user_id", telegramUserId)
      .eq("chat_id", chatId)
      .is("resolved_at", null)
      .lt("expires_at", nowIso);
    const { data, error } = await admin
      .from("kitchen_pending_items")
      .select(COLUMNS)
      .eq("telegram_user_id", telegramUserId)
      .eq("chat_id", chatId)
      .is("resolved_at", null)
      .lt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return toItem(data[0] as Row);
  } catch {
    return null;
  }
}

/** Marks the expiry as told, so the cook hears it only once. */
export async function markExpiryAnnounced(id: string): Promise<void> {
  await expirePendingItem(id);
}

export async function getRoutingDefault(
  telegramUserId: number
): Promise<{ staffId: string; chosenAt: string } | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("kitchen_routing_defaults")
      .select("staff_id, chosen_at")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error || !data) return null;
    const chosenAt = String(data.chosen_at);
    if (Date.now() - new Date(chosenAt).getTime() >= DEFAULT_TTL_MS) {
      return null;
    }
    return { staffId: String(data.staff_id), chosenAt };
  } catch {
    return null;
  }
}

export async function setRoutingDefault(
  telegramUserId: number,
  staffId: string
): Promise<void> {
  try {
    await createAdminClient().from("kitchen_routing_defaults").upsert(
      {
        telegram_user_id: telegramUserId,
        staff_id: staffId,
        chosen_at: new Date().toISOString(),
      },
      { onConflict: "telegram_user_id" }
    );
  } catch {
    // swallow
  }
}

/** Opportunistic: deletes pending rows older than 24 h. Swallows errors. */
export async function cleanupPendingOld(): Promise<void> {
  try {
    await createAdminClient()
      .from("kitchen_pending_items")
      .delete()
      .lt("created_at", new Date(Date.now() - CLEANUP_AFTER_MS).toISOString());
  } catch {
    // swallow
  }
}

// ---------------------------------------------------------------------------
// Callback data: opaque, never ids or names, <= 64 bytes
// ---------------------------------------------------------------------------

export type CallbackKind = "item" | "default" | "cancel";
const CALLBACK_RE = /^(kr1|kd1|kc1):([A-Za-z0-9_-]{16,40})(?::(\d{1,2}))?$/;

export function callbackData(
  kind: CallbackKind,
  nonce: string,
  index?: number
): string {
  if (kind === "cancel") return `kc1:${nonce}`;
  return `${kind === "item" ? "kr1" : "kd1"}:${nonce}:${index ?? 0}`;
}

export function parseCallbackData(
  data: string
): { kind: CallbackKind; nonce: string; index: number | null } | null {
  if (typeof data !== "string" || data.length > 64) return null;
  const m = CALLBACK_RE.exec(data);
  if (!m) return null;
  const [, prefix, nonce, idx] = m;
  if (prefix === "kc1") {
    return idx === undefined ? { kind: "cancel", nonce, index: null } : null;
  }
  if (idx === undefined) return null;
  return {
    kind: prefix === "kr1" ? "item" : "default",
    nonce,
    index: Number(idx),
  };
}
