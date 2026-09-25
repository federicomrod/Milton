// app/api/restaurant/telegram/send-briefing/route.ts
//
// POST /api/restaurant/telegram/send-briefing
//
// Manual/test send route for Telegram Daily Briefing v1 — lets an
// authenticated Milton user trigger one send of their company's current
// briefing to their connected Telegram chat, to validate a pairing works.
// No scheduling; this is the only send trigger in V1.
//
// company_id is never accepted from the client — resolved server-side via
// authAndCompany(). The connection lookup uses the normal RLS-backed
// client (restaurant_telegram_connections' own SELECT policy already
// scopes results to the caller's company), with an explicit
// company_id === companyId re-check as defense in depth — the same
// "never trust a single layer" pattern used for Odoo secrets
// (lib/restaurant/odoo/secrets.ts's secretBelongsToCompany) and restaurant
// location scoping.
//
// Reuses the EXACT same briefing pipeline as the dashboard
// (lib/restaurant/briefing-generate.ts) — only the formatting and
// transport differ.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { generateBriefing } from "@/lib/restaurant/briefing-generate";
import { formatBriefingForTelegram } from "@/lib/restaurant/telegram/briefing-formatter";
import { sendTelegramMessage } from "@/lib/restaurant/telegram/send";
import { isUsableConnection } from "@/lib/restaurant/telegram/connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const { data: connection, error: connectionError } = await supabase
    .from("restaurant_telegram_connections")
    .select("chat_id, company_id, is_active")
    .eq("company_id", companyId)
    .maybeSingle();
  if (connectionError) {
    console.error(
      "[telegram-send-briefing] connection lookup failed:",
      connectionError.message
    );
    return NextResponse.json(
      { error: "Could not look up the Telegram connection" },
      { status: 500 }
    );
  }
  if (!isUsableConnection(connection, companyId)) {
    return NextResponse.json(
      {
        error: "No Telegram chat is connected for this company",
        message:
          "Generate a pairing code via POST /api/restaurant/telegram/pairing-code and complete pairing in Telegram before sending.",
      },
      { status: 404 }
    );
  }

  let ctx;
  let briefing;
  try {
    ({ ctx, briefing } = await generateBriefing(supabase, companyId));
  } catch (err) {
    console.error(
      "[telegram-send-briefing] briefing generation failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not generate the briefing" },
      { status: 500 }
    );
  }

  const text = formatBriefingForTelegram(ctx, briefing);
  const sendResult = await sendTelegramMessage(connection.chat_id, text);
  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
