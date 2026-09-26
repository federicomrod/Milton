// app/api/restaurant/telegram/connection/route.ts
//
// GET /api/restaurant/telegram/connection
//
// Telegram Connection UI v1 — the read-only status check the dashboard
// card needs to show "Not connected" vs "Connected". None of the existing
// Telegram routes exposed this, and querying restaurant_telegram_connections
// directly from the browser would depend on the browser Supabase client's
// own company resolution (lib/profile-service.ts's getUserCompany(), which
// resolves by `created_by` — a different, narrower path than
// authAndCompany()'s, and not guaranteed to match for every company
// member). This route sidesteps that by resolving company_id the same way
// every other restaurant route does.
//
// No new table, no new write — reuses restaurant_telegram_connections and
// the same isUsableConnection() guard the send-briefing route already
// uses, so "connected" here means exactly what "usable" means there.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isUsableConnection } from "@/lib/restaurant/telegram/connections";
import { resolvePreferredLanguage } from "@/lib/restaurant/language";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const [{ data: connection, error: connectionError }, { data: company }] =
    await Promise.all([
      supabase
        .from("restaurant_telegram_connections")
        .select("company_id, chat_id, is_active, connected_at")
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("companies")
        .select("preferred_language")
        .eq("id", companyId)
        .maybeSingle(),
    ]);

  if (connectionError) {
    console.error(
      "[telegram-connection] lookup failed:",
      connectionError.message
    );
    return NextResponse.json(
      { error: "Could not look up the Telegram connection" },
      { status: 500 }
    );
  }

  const connected = isUsableConnection(connection, companyId);
  return NextResponse.json({
    connected,
    connected_at: connected ? (connection?.connected_at ?? null) : null,
    preferred_language: resolvePreferredLanguage(company?.preferred_language),
  });
}
