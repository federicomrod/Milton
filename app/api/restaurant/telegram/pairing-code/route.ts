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
// let a second chat take over this company's slot. Disconnect/reconnect
// is explicitly deferred to a later version.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createPairingCode } from "@/lib/restaurant/telegram/pairing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { companyId } = auth;

  try {
    const result = await createPairingCode(companyId);
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            "This company already has a Telegram chat connected. Disconnecting and re-pairing isn't supported yet.",
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
