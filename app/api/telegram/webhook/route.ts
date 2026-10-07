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
// Handles: (1) a manager `/start <code>` message, completing the pairing
// flow started by POST /api/restaurant/telegram/pairing-code; (2) kitchen
// QR joins, `/start kq1_<secret>` from a PRIVATE chat (R1 #55); and (3)
// cook reports — text, voice notes or photos from an active kitchen_staff
// member (R1 #49), answered with one minimal Spanish acknowledgement.
// Everything else is acknowledged with 200 and ignored. Dispatch order:
// kitchen payload first, then the unchanged manager pairing path.
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
import {
  buildDisplayName,
  consumeKitchenJoin,
  isKitchenPayload,
} from "@/lib/restaurant/telegram/kitchen-join";
import {
  KITCHEN_COPY,
  renderKitchenCopy,
} from "@/lib/restaurant/telegram/kitchen-copy";
import {
  extractReportFromMessage,
  findActiveKitchenStaff,
  recordKitchenReport,
  type TelegramIncomingMessage,
} from "@/lib/restaurant/telegram/kitchen-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TelegramUpdate {
  message?: TelegramIncomingMessage & {
    from?: { id?: number; first_name?: string; last_name?: string };
    chat?: { id?: number; type?: string };
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

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

// Kitchen QR join (private chats only; groups are ignored silently). Cook
// copy is Sofia's Spanish only; on an internal error nothing is sent.
async function handleKitchenJoin(
  message: TelegramMessage,
  chatId: number,
  payload: string
): Promise<void> {
  const fromId = message.from?.id;
  if (message.chat?.type !== "private" || !fromId) return;
  try {
    const result = await consumeKitchenJoin({
      payload,
      telegramUserId: fromId,
      chatId,
      displayName: buildDisplayName(message.from ?? {}),
    });
    let reply: string;
    switch (result.kind) {
      case "invalid":
        reply = KITCHEN_COPY.QR_INVALID;
        break;
      case "rate_limited":
        reply = KITCHEN_COPY.RATE_LIMITED;
        break;
      case "already_joined":
        reply = renderKitchenCopy(KITCHEN_COPY.ALREADY_JOINED, {
          local: result.locationName,
        });
        break;
      case "moved":
        reply = renderKitchenCopy(KITCHEN_COPY.MOVED, {
          "local nuevo": result.locationName,
          "local anterior": result.previousLocationName,
        });
        break;
      default:
        reply = renderKitchenCopy(KITCHEN_COPY.JOINED, {
          local: result.locationName,
        });
    }
    await sendTelegramMessage(chatId, reply);
  } catch (err) {
    console.error(
      "[telegram-webhook] kitchen join failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
  }
}

// Cook report: private chat, active kitchen_staff only. Unknown, removed
// and group senders are ignored (no row, no reply). The acknowledgement is
// always the generic R5 and is sent only when a NEW row was stored, so a
// Telegram retry never double-acknowledges.
async function handleKitchenReport(
  message: TelegramMessage,
  chatId: number
): Promise<void> {
  const fromId = message.from?.id;
  if (message.chat?.type !== "private" || !fromId) return;
  try {
    const staff = await findActiveKitchenStaff(fromId);
    if (!staff) return;
    const report = extractReportFromMessage(message);
    if (!report) return;
    const inserted = await recordKitchenReport({
      companyId: staff.company_id,
      locationId: staff.location_id,
      staffId: staff.id,
      chatId,
      report,
    });
    if (inserted) {
      await sendTelegramMessage(
        chatId,
        renderKitchenCopy(KITCHEN_COPY.REPORT_ACK, {
          nombre_local: staff.location_name,
        })
      );
    }
  } catch (err) {
    console.error(
      "[telegram-webhook] kitchen report failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
  }
}

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

  const message = update.message;
  const chatId = message?.chat?.id;
  if (!message || !chatId) {
    return NextResponse.json({ ok: true }); // no message — ignore
  }

  const trimmed = (message.text ?? "").trim();
  if (!trimmed.startsWith("/start")) {
    // Not a pairing/join command. Any other command is ignored; a
    // non-command message may be a cook report (text, voice or photo).
    if (!trimmed.startsWith("/")) {
      await handleKitchenReport(message, chatId);
    }
    return NextResponse.json({ ok: true });
  }

  const code = trimmed.slice("/start".length).trim();
  if (!code) {
    await sendTelegramMessage(chatId, GENERIC_USAGE_MESSAGE);
    return NextResponse.json({ ok: true });
  }

  // Kitchen QR payloads (kq1_...) never collide with 12-char pairing codes.
  if (isKitchenPayload(code)) {
    await handleKitchenJoin(message, chatId, code);
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
