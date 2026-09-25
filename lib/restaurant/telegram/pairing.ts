// lib/restaurant/telegram/pairing.ts
//
// Telegram Daily Briefing v1 — pairing-code issuance and consumption.
//
// This is the ONLY mechanism that ever writes a chat_id into
// restaurant_telegram_connections (see migration 017's RLS comments: that
// table defines no INSERT/UPDATE/DELETE policy for any role). A code
// proves the party completing pairing in Telegram was shown something only
// an authenticated member of that company could obtain — issued by
// createPairingCode() (called from POST /api/restaurant/telegram/pairing-code,
// itself gated by authAndCompany()) and consumed by consumePairingCode()
// (called only from the Telegram webhook, which has no Milton user
// session and therefore must use the service-role client throughout).
//
// Adjustment 2 (approved architecture) — no silent re-pairing. One company
// = one Telegram chat, one Telegram chat = one company. Both functions
// below check this explicitly and return a clear "already connected"
// outcome instead of overwriting anything; migration 017's UNIQUE
// constraints are the last-resort backstop, not the primary enforcement.

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const CODE_BYTES = 9; // 12 base64url chars, ~72 bits of entropy
const CODE_TTL_MS = 15 * 60 * 1000; // ~15 minutes

export interface PairingCodeIssued {
  code: string;
  expiresAt: string; // ISO timestamp
}

export type CreatePairingCodeResult =
  | { ok: true; issued: PairingCodeIssued }
  | { ok: false; reason: "already_connected" };

export type ConsumePairingCodeResult =
  | { ok: true; companyId: string }
  | {
      ok: false;
      reason:
        | "invalid_or_expired"
        | "company_already_connected"
        | "chat_already_connected";
    };

function generateCode(): string {
  // base64url uses only [A-Za-z0-9_-], which is exactly the character set
  // Telegram allows in a /start deep-link payload.
  return randomBytes(CODE_BYTES).toString("base64url");
}

// ---------------------------------------------------------------------------
// Pure decision logic — no I/O, directly unit-testable. consumePairingCode()
// below is a thin I/O shell around these; every behavioral rule (expiry,
// single-use, Adjustment 2's "no silent re-pairing") lives here so it can
// be tested without a Supabase mock, matching this codebase's established
// testing philosophy.
// ---------------------------------------------------------------------------

export interface PendingCodeRow {
  expires_at: string;
  consumed_at: string | null;
}

/** A code is usable exactly once, and only before it expires. */
export function isPairingCodeUsable(
  pending: PendingCodeRow | null,
  now: Date = new Date()
): boolean {
  if (!pending) return false;
  if (pending.consumed_at) return false;
  return new Date(pending.expires_at).getTime() > now.getTime();
}

export type ConnectionConflictReason =
  | "company_already_connected"
  | "chat_already_connected";

/**
 * Adjustment 2 — no silent re-pairing. Given what (if anything) already
 * occupies the company's slot and the chat's slot, decides whether this
 * pairing must be refused. Company is checked first (matches
 * consumePairingCode()'s query order) but the result is the same either
 * way when both are already taken.
 */
export function evaluateConnectionConflict(
  existingCompanyConnection: { id: string } | null,
  existingChatConnection: { id: string } | null
): ConnectionConflictReason | null {
  if (existingCompanyConnection) return "company_already_connected";
  if (existingChatConnection) return "chat_already_connected";
  return null;
}

/**
 * Issues a new pairing code for `companyId`. Refuses (rather than
 * overwriting) if this company already has an active Telegram connection.
 * Does NOT check chat_id — the chat side of the pairing hasn't happened
 * yet; that check happens in consumePairingCode().
 */
export async function createPairingCode(
  companyId: string
): Promise<CreatePairingCodeResult> {
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("restaurant_telegram_connections")
    .select("id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(
      `Could not check existing Telegram connection: ${lookupError.message}`
    );
  }
  if (existing?.id) {
    return { ok: false, reason: "already_connected" };
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error: insertError } = await admin
    .from("restaurant_telegram_pairing_codes")
    .insert({ company_id: companyId, code, expires_at: expiresAt });
  if (insertError) {
    throw new Error(`Could not create pairing code: ${insertError.message}`);
  }

  return { ok: true, issued: { code, expiresAt } };
}

/**
 * Consumes a pairing code from the Telegram side: validates it (exists,
 * unexpired, unconsumed), then — only if neither the company nor the chat
 * is already connected (Adjustment 2) — links `chatId` to that code's
 * company and marks the code consumed.
 *
 * The caller (the webhook route) decides what to tell the Telegram user;
 * this function's return value never carries any OTHER company's identity
 * or data, by construction — only a reason code.
 */
export async function consumePairingCode(
  code: string,
  chatId: number
): Promise<ConsumePairingCodeResult> {
  const admin = createAdminClient();

  const { data: pending, error: lookupError } = await admin
    .from("restaurant_telegram_pairing_codes")
    .select("id, company_id, expires_at, consumed_at")
    .eq("code", code)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`Could not look up pairing code: ${lookupError.message}`);
  }
  if (
    !isPairingCodeUsable(
      pending
        ? {
            expires_at: pending.expires_at as string,
            consumed_at: pending.consumed_at as string | null,
          }
        : null
    )
  ) {
    return { ok: false, reason: "invalid_or_expired" };
  }
  // isPairingCodeUsable(null) is false, so this branch guarantees non-null —
  // narrowed explicitly since the check itself happens inside a helper call.
  if (!pending) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  const companyId = pending.company_id as string;

  const { data: companyConn, error: companyLookupError } = await admin
    .from("restaurant_telegram_connections")
    .select("id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (companyLookupError) {
    throw new Error(
      `Could not check company connection: ${companyLookupError.message}`
    );
  }

  // Only fetch the chat-side row when the company side is still free —
  // evaluateConnectionConflict() checks company first either way, so a
  // company conflict never needs the chat query at all.
  let chatConn: { id: string } | null = null;
  if (!companyConn?.id) {
    const { data, error: chatLookupError } = await admin
      .from("restaurant_telegram_connections")
      .select("id")
      .eq("chat_id", chatId)
      .maybeSingle();
    if (chatLookupError) {
      throw new Error(
        `Could not check chat connection: ${chatLookupError.message}`
      );
    }
    chatConn = data;
  }

  const conflict = evaluateConnectionConflict(companyConn, chatConn);
  if (conflict) {
    return { ok: false, reason: conflict };
  }

  const { error: insertError } = await admin
    .from("restaurant_telegram_connections")
    .insert({ company_id: companyId, chat_id: chatId });
  if (insertError) {
    throw new Error(
      `Could not create Telegram connection: ${insertError.message}`
    );
  }

  const { error: consumeError } = await admin
    .from("restaurant_telegram_pairing_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", pending.id as string);
  if (consumeError) {
    throw new Error(`Could not consume pairing code: ${consumeError.message}`);
  }

  return { ok: true, companyId };
}
