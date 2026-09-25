// app/api/telegram/webhook/route.ts
//
// POST /api/telegram/webhook
//
// Receives Telegram Bot API updates. This endpoint is called BY Telegram,
// not by an authenticated Milton user — there is no Milton session to
// check, so authAndCompany() does not apply here. Instead, every request
// MUST carry the X-Telegram-Bot-Api-Secret-Token header matching the
// server-only TELEGRAM_WEBHOOK_SECRET (configured via Telegram's
// setWebhook call — see the manual setup notes in the implementation
// report). Any request missing or failing that check is rejected before
// any other processing, using a constant-time comparison.
//
// V1 handles exactly one thing: a `/start <code>` message, completing the
// pairing flow started by POST /api/restaurant/telegram/pairing-code. Any
// other update (no message, non-/start text, callback queries, etc.) is
// acknowledged with 200 and otherwise ignored — there is no conversational
// Telegram in V1.
//
// SECURITY: never logs the webhook secret, never logs a raw pairing code
// value, never reveals which company (if any) a chat_id or code
// belongs/belonged to on a failed pairing attempt — every failure branch
// replies with a generic, bilingual, identity-free message.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumePairingCode } from "@/lib/restaurant/telegram/pairing";
import { sendTelegramMessage } from "@/lib/restaurant/telegram/send";
import { resolvePreferredLanguage, t } from "@/lib/restaurant/language";
import { isValidWebhookSecret } from "@/lib/restaurant/telegram/webhook-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
}

function verifyWebhookSecret(req: NextRequest): boolean {
  return isValidWebhookSecret(
    req.headers.get("x-telegram-bot-api-secret-token"),
    process.env.TELEGRAM_WEBHOOK_SECRET
  );
}

const GENERIC_INVALID_CODE_MESSAGE =
  "This code is invalid or has expired. Generate a new one from Milton.\n\n" +
  "Este código no es válido o expiró. Genera uno nuevo desde Milton.";

const GENERIC_ALREADY_CONNECTED_MESSAGE =
  "This chat or company is already connected to Milton.\n\n" +
  "Este chat o empresa ya está conectado a Milton.";

const GENERIC_USAGE_MESSAGE =
  "Please use the connection link from Milton to pair this chat.\n\n" +
  "Usa el enlace de conexión de Milton para vincular este chat.";

const GENERIC_ERROR_MESSAGE =
  "Something went wrong. Please try again from Milton.\n\n" +
  "Ocurrió un error. Inténtalo de nuevo desde Milton.";

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true }); // malformed body — nothing to do
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (!chatId || !text) {
    return NextResponse.json({ ok: true }); // not a text message — ignore
  }

  const trimmed = text.trim();
  if (!trimmed.startsWith("/start")) {
    return NextResponse.json({ ok: true }); // no conversational Telegram in V1
  }

  const code = trimmed.slice("/start".length).trim();
  if (!code) {
    await sendTelegramMessage(chatId, GENERIC_USAGE_MESSAGE);
    return NextResponse.json({ ok: true });
  }

  let result: Awaited<ReturnType<typeof consumePairingCode>>;
  try {
    result = await consumePairingCode(code, chatId);
  } catch (err) {
    console.error(
      "[telegram-webhook] pairing consumption failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    await sendTelegramMessage(chatId, GENERIC_ERROR_MESSAGE);
    return NextResponse.json({ ok: true });
  }

  if (!result.ok) {
    const message =
      result.reason === "invalid_or_expired"
        ? GENERIC_INVALID_CODE_MESSAGE
        : GENERIC_ALREADY_CONNECTED_MESSAGE;
    await sendTelegramMessage(chatId, message);
    return NextResponse.json({ ok: true });
  }

  // Success — look up the NEWLY CONNECTED company's own name/
  // preferred_language solely to phrase ITS OWN confirmation message.
  // This never touches, and never reveals, any other company's data.
  let confirmation = "✅ Connected! You'll receive Milton briefings here.";
  try {
    const admin = createAdminClient();
    const { data: company } = await admin
      .from("companies")
      .select("name, preferred_language")
      .eq("id", result.companyId)
      .maybeSingle();
    const lang = resolvePreferredLanguage(company?.preferred_language);
    const name = company?.name ?? "";
    confirmation = t(
      lang,
      `✅ Connected${name ? ` to ${name}` : ""}! You'll receive Milton briefings here.`,
      `✅ ¡Conectado${name ? ` a ${name}` : ""}! Recibirás los briefings de Milton aquí.`
    );
  } catch (err) {
    console.error(
      "[telegram-webhook] confirmation lookup failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    // Falls back to the generic English confirmation already set above.
  }

  await sendTelegramMessage(chatId, confirmation);
  return NextResponse.json({ ok: true });
}
