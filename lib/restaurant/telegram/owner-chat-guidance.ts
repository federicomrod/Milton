// lib/restaurant/telegram/owner-chat-guidance.ts
//
// A chat that receives the briefing (restaurant_telegram_connections) is NOT a
// cook: photos, voice notes and text sent from it are never captured. When the
// sender is not an active cook but the chat is an owner-paired one, tell them
// once (at most every 10 minutes per chat) how to send invoices. No DB writes.
//
// SECURITY: logs nothing about the chat or the company.

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";
import { withKitchenLanguage } from "@/lib/restaurant/telegram/kitchen-language";
import { resolveRestaurantCockpitLanguage } from "@/lib/restaurant/language";
import { sendTelegramMessage } from "@/lib/restaurant/telegram/send";

type Admin = ReturnType<typeof createAdminClient>;

export const OWNER_GUIDANCE_WINDOW_MS = 10 * 60 * 1000;

// In-memory guard. Instances do not share it: an occasional duplicate is fine.
const lastGuidanceAt = new Map<number, number>();

export function resetOwnerChatGuidance(): void {
  lastGuidanceAt.clear();
}

/** Replies with the guidance if this chat is an active owner-paired chat. */
export async function maybeGuideOwnerChat(
  admin: Admin,
  chatId: number
): Promise<boolean> {
  const now = Date.now();
  const last = lastGuidanceAt.get(chatId);
  if (last !== undefined && now - last < OWNER_GUIDANCE_WINDOW_MS) {
    return false;
  }
  const { data: conn } = await admin
    .from("restaurant_telegram_connections")
    .select("company_id")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  if (!conn?.company_id) return false;

  lastGuidanceAt.set(chatId, now);
  const { data: company } = await admin
    .from("companies")
    .select("name, preferred_language")
    .eq("id", conn.company_id)
    .maybeSingle();
  const lang = resolveRestaurantCockpitLanguage(
    (company as { preferred_language?: unknown } | null)?.preferred_language
  );
  const text = withKitchenLanguage(lang, () =>
    renderKitchenCopy(KITCHEN_COPY.OWNER_CHAT_NOT_COOK, {
      empresa: company?.name?.trim() || KITCHEN_COPY.FRAG_YOUR_RESTAURANT,
    })
  );
  await sendTelegramMessage(chatId, text);
  return true;
}
