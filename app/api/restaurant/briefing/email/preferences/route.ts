// app/api/restaurant/briefing/email/preferences/route.ts
//
// GET  /api/restaurant/briefing/email/preferences  — load the authenticated
//      company's current email delivery preferences.
// POST /api/restaurant/briefing/email/preferences  — save them.
//
// Email Briefing Extension v1. company_id is never accepted from the
// client — resolved server-side via authAndCompany(), same pattern as
// every other restaurant route. Writes go through the normal RLS-backed
// client (companies already has an UPDATE policy for company members —
// the same one lib/profile-service.ts's updateCompany() and
// onboarding/complete/route.ts already rely on); briefing_email_recipient
// is not a secret, so no service-role client is needed here.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  normalizeCadence,
  normalizeEmail,
  resolveCadence,
  resolveTimezone,
  resolveTimezoneForCadence,
  resolveWeekday,
} from "@/lib/restaurant/email/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CompanyEmailPrefsRow {
  briefing_email_cadence: string | null;
  briefing_email_recipient: string | null;
  briefing_email_weekday: number | null;
  briefing_email_timezone: string | null;
}

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const { data, error } = await supabase
    .from("companies")
    .select(
      "briefing_email_cadence, briefing_email_recipient, briefing_email_weekday, briefing_email_timezone"
    )
    .eq("id", companyId)
    .maybeSingle();
  if (error) {
    console.error("[briefing-email-preferences] lookup failed:", error.message);
    return NextResponse.json(
      { error: "Could not load email briefing preferences" },
      { status: 500 }
    );
  }

  const row = data as CompanyEmailPrefsRow | null;
  return NextResponse.json({
    cadence: resolveCadence(row?.briefing_email_cadence),
    recipient: row?.briefing_email_recipient ?? null,
    weekday: resolveWeekday(row?.briefing_email_weekday),
    timezone: resolveTimezone(row?.briefing_email_timezone),
  });
}

interface RequestBody {
  cadence?: unknown;
  recipient?: unknown;
  weekday?: unknown;
  timezone?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const cadence = normalizeCadence(body.cadence);
  if (!cadence) {
    return NextResponse.json(
      { error: "cadence must be one of: off, daily, weekly" },
      { status: 400 }
    );
  }

  const recipient = normalizeEmail(body.recipient);
  if (cadence !== "off" && !recipient) {
    return NextResponse.json(
      {
        error:
          "A valid recipient email is required when delivery is Daily or Weekly.",
      },
      { status: 400 }
    );
  }

  const weekday = resolveWeekday(body.weekday);

  const timezoneResult = resolveTimezoneForCadence(cadence, body.timezone);
  if (!timezoneResult.ok) {
    return NextResponse.json(
      {
        error:
          "A valid delivery timezone is required when delivery is Daily or Weekly.",
      },
      { status: 400 }
    );
  }
  const timezone = timezoneResult.timezone;

  const { error } = await supabase
    .from("companies")
    .update({
      briefing_email_cadence: cadence,
      briefing_email_recipient: recipient,
      briefing_email_weekday: weekday,
      briefing_email_timezone: timezone,
    })
    .eq("id", companyId);
  if (error) {
    console.error("[briefing-email-preferences] save failed:", error.message);
    return NextResponse.json(
      { error: "Could not save email briefing preferences" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    cadence,
    recipient,
    weekday,
    timezone,
  });
}
