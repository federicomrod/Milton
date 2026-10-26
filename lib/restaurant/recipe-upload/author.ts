// lib/restaurant/recipe-upload/author.ts
//
// SENTINELS of «Sube tus recetas» (no migration, no new column).
//
// kitchen_recipe_drafts needs a staff_id (NOT NULL → kitchen_staff) and a
// (telegram_chat_id, telegram_message_id) pair that is unique together. A draft
// that came from a file has neither a cook nor a Telegram message, so:
//
//  1. AUTHOR ROW: ONE kitchen_staff row per location, display_name
//     «Archivo subido», role 'kitchen' (the only role 021 allows),
//     is_active=false and removed_at=now() (so it is never in «Equipo de
//     cocina», never counted as team, never receives Telegram and is never
//     returned by listActiveLinks / validateLink, which require is_active),
//     chat_id 0 and a NEGATIVE deterministic telegram_user_id derived from the
//     location uuid (real Telegram ids are positive). Unique key since 063 is
//     (telegram_user_id, location_id), so there is one row per location.
//  2. DRAFT KEYS: telegram_chat_id = UPLOAD_CHAT_ID (0, never a real chat) and
//     a unique NEGATIVE telegram_message_id per draft (-(Date.now()*1000+n)),
//     retried on a 23505. updateDraftPortions filters by a real chat id, so a
//     Telegram «3 porciones» reply can never touch an uploaded draft.

import type { SupabaseClient } from "@supabase/supabase-js";
import { UPLOAD_AUTHOR_NAME, UPLOAD_CHAT_ID } from "./constants";

export { UPLOAD_AUTHOR_NAME, UPLOAD_CHAT_ID };

/** Negative, deterministic bigint for a location (fits in 48 bits). */
export function uploadAuthorTelegramId(locationId: string): number {
  const n = parseInt(locationId.replace(/-/g, "").slice(0, 12), 16);
  // 0 would not be negative: map it to -1.
  return n > 0 ? -n : -1;
}

/** A unique negative telegram_message_id for one uploaded draft. */
export function uploadMessageId(index: number, attempt = 0): number {
  // A retry jumps a whole second (1,000,000), never into the next
  // millisecond's range (1,000) used by the next draft.
  return -(Date.now() * 1000 + index + attempt * 1_000_000);
}

export async function getOrCreateUploadAuthor(
  admin: SupabaseClient,
  companyId: string,
  locationId: string
): Promise<{ ok: true; staffId: string } | { ok: false; error: string }> {
  const telegramUserId = uploadAuthorTelegramId(locationId);

  const find = async (): Promise<string | null> => {
    const { data, error } = await admin
      .from("kitchen_staff")
      .select("id")
      .eq("company_id", companyId)
      .eq("location_id", locationId)
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) return null;
    return (data as { id?: string } | null)?.id ?? null;
  };

  try {
    const existing = await find();
    if (existing) return { ok: true, staffId: existing };

    const { data, error } = await admin
      .from("kitchen_staff")
      .insert({
        company_id: companyId,
        location_id: locationId,
        telegram_user_id: telegramUserId,
        chat_id: UPLOAD_CHAT_ID,
        display_name: UPLOAD_AUTHOR_NAME,
        role: "kitchen",
        is_active: false,
        removed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        const raced = await find();
        if (raced) return { ok: true, staffId: raced };
      }
      console.error("[recipe-upload] author insert failed");
      return { ok: false, error: "author" };
    }
    const id = (data as { id?: string } | null)?.id;
    return id ? { ok: true, staffId: id } : { ok: false, error: "author" };
  } catch {
    console.error("[recipe-upload] author failed");
    return { ok: false, error: "author" };
  }
}
