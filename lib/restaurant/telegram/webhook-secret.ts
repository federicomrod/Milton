// lib/restaurant/telegram/webhook-secret.ts
//
// Constant-time verification of Telegram's X-Telegram-Bot-Api-Secret-Token
// header against the server-only TELEGRAM_WEBHOOK_SECRET. Pure — no I/O,
// directly unit-testable — kept out of app/api/telegram/webhook/route.ts
// so tests don't need to load "next/server" just to exercise this logic.

import { timingSafeEqual } from "crypto";

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isValidWebhookSecret(
  received: string | null,
  expected: string | undefined
): boolean {
  if (!expected || !received) return false;
  return safeEqual(received, expected);
}
