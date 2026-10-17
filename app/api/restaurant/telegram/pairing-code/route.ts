// app/api/restaurant/telegram/pairing-code/route.ts
//
// POST /api/restaurant/telegram/pairing-code
//
// Issues a short-lived (~15 min), single-use pairing code for the
// authenticated user's company, plus the Telegram deep link needed to
// complete pairing. company_id is never accepted from the client —
// resolved server-side via authAndCompany(), same pattern as every other
// restaurant route.
//
// Adjustment 2 (no silent re-pairing): refuses with 409 if this company
// already has a Telegram connection, rather than issuing a code that could
// let a second chat take over this company's slot. To change chats, an
// owner/admin disconnects first (DELETE /api/restaurant/telegram/connection).
// Only owner/admin members may issue a code (403 otherwise).

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createPairingCode } from "@/lib/restaurant/telegram/pairing";
import { telegramManagerGuard } from "@/lib/restaurant/telegram/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;

  // Only the company's owner or an admin may connect a chat.
  const denied = await telegramManagerGuard(supabase, companyId, userId);
  if (denied) return denied;

  try {
    const result = await createPairingCode(companyId);
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            "Esta empresa ya tiene un chat de Telegram conectado. Desconéctalo primero para conectar otro.",
        },
        { status: 409 }
      );
    }

    // Bot username isn't a secret (it's public in Telegram itself) — read
    // server-side only for convenience; the deep link degrades gracefully
    // to a manual "message the bot with this code" flow if unset.
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    const deepLink = botUsername
      ? `https://t.me/${botUsername}?start=${result.issued.code}`
      : null;

    return NextResponse.json({
      code: result.issued.code,
      expires_at: result.issued.expiresAt,
      deep_link: deepLink,
    });
  } catch (err) {
    console.error(
      "[telegram-pairing-code] failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not create a Telegram pairing code" },
      { status: 500 }
    );
  }
}
