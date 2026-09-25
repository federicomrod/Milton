// lib/restaurant/telegram/send.ts
//
// Telegram Daily Briefing v1 — the ONLY place TELEGRAM_BOT_TOKEN is read.
// Server-only (Node's global `fetch`); must never be imported from a
// "use client" component.
//
// SECURITY: the bot token is embedded in the request URL Telegram's Bot
// API requires (`/bot<token>/sendMessage`). Because of that, this file
// deliberately NEVER logs a raw caught error's `.message` (which could, in
// principle, echo a URL/request detail depending on the underlying fetch
// implementation) — only a static description or `err.name`. It never
// logs the URL itself, never returns the token in any result, and every
// failure mode resolves to a generic TelegramSendResult rather than
// throwing, so a Telegram outage or misconfiguration can never propagate
// into (and break) the dashboard briefing route, which does not import
// this module at all.

const TELEGRAM_API_BASE = "https://api.telegram.org";

export class TelegramConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramConfigError";
  }
}

export type TelegramSendResult = { ok: true } | { ok: false; error: string };

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TelegramConfigError("TELEGRAM_BOT_TOKEN is not set.");
  }
  return token;
}

/**
 * Sends a plain-text message to a Telegram chat. Never throws — every
 * failure mode (missing token, network error, Telegram API error response)
 * resolves to { ok: false, error } with a generic, credential-free message.
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string
): Promise<TelegramSendResult> {
  let token: string;
  try {
    token = getBotToken();
  } catch (err) {
    console.error(
      "[telegram-send] config error:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "Telegram is not configured." };
  }

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!res.ok) {
      // Telegram's JSON error body carries a `description` (e.g. "chat not
      // found", "bot was blocked by the user") — never the bot token or
      // the request URL, so it's safe to log directly.
      let description = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { description?: string };
        if (body?.description) description = body.description;
      } catch {
        // Non-JSON error body — keep the generic HTTP status description.
      }
      console.error("[telegram-send] Telegram API error:", description);
      return { ok: false, error: "Telegram could not deliver the message." };
    }

    return { ok: true };
  } catch (err) {
    // Deliberately logs only the error's name, never `.message` — see the
    // file-level security note above.
    console.error(
      "[telegram-send] request failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "Could not reach Telegram." };
  }
}
