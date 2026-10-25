// app/api/cron/briefing-email/route.ts
//
// GET /api/cron/briefing-email
//
// WIRED: vercel.json runs it once a day at 13:00 UTC (07:00 El Salvador),
// right after the Odoo sync cron (12:30 UTC, /api/cron/odoo-sync). The
// scheduler only sends when a company's OWN local hour is 07:00 (see
// lib/restaurant/email/scheduler.ts evaluateDue(), which reads each
// company's briefing_email_timezone, never server time), so a once-a-day
// trigger covers companies in that timezone; other timezones would need an
// hourly cron (Vercel Pro).
//
// Finds companies due for an
// automatic send RIGHT NOW (per lib/restaurant/email/scheduler.ts's
// evaluateDue(), which checks each company's OWN explicit
// briefing_email_timezone — never server time), and for each one runs the
// exact same, already-validated pipeline the manual test-send route uses:
// generateBriefing() -> renderBriefingEmail() -> sendBriefingEmail().
//
// AUTHENTICATION: this endpoint has no Milton user session — it is called
// by Vercel's cron infrastructure, not a logged-in company. It is
// authenticated via Vercel's own convention: when CRON_SECRET is set,
// Vercel calls with `Authorization: Bearer <CRON_SECRET>`. A request
// without a valid header is rejected with 401 before anything else runs —
// fails closed if CRON_SECRET is absent, exactly like the Telegram
// webhook's secret-token check. No company-specific value (company_id,
// recipient, cadence, timezone) is ever read from the request — every
// company processed here is determined entirely server-side.
//
// FAILURE ISOLATION: each company is processed inside its own try/catch.
// A thrown error, a briefing-generation failure, or a provider send
// failure for one company logs a safe diagnostic (see
// lib/restaurant/email/send.ts's own logging discipline — never a
// provider secret or raw response body) and moves on to the next company;
// nothing here can abort the batch.
//
// DUPLICATE-SEND / RACE NOTE: briefing_email_last_sent_at is written ONLY
// after Resend confirms success, so a failed send remains retry-eligible
// on the next tick — per the explicit V1 requirement. This is a
// read-then-act pattern, not a single atomic claim-and-send: two
// genuinely concurrent invocations of this endpoint could both read a
// company as "due" before either writes last_sent_at, and both would
// send. See the architecture report for why this residual risk is
// accepted for V1 (Vercel Cron does not itself invoke the same schedule
// concurrently; the realistic risk is an operator manually re-triggering
// the endpoint) rather than adding a separate atomic claim mechanism.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateBriefing } from "@/lib/restaurant/briefing-generate";
import { renderBriefingEmail } from "@/lib/restaurant/email/briefing-email-formatter";
import { autoSyncOdooCompany } from "@/lib/restaurant/odoo/auto-sync";
import { sendBriefingEmail } from "@/lib/restaurant/email/send";
import {
  normalizeEmail,
  resolveCadence,
} from "@/lib/restaurant/email/preferences";
import {
  evaluateDue,
  isAuthorizedCronRequest,
  type CompanyScheduleInput,
} from "@/lib/restaurant/email/scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sequential per-company processing (external email API calls included) —
// generous ceiling so a larger company count doesn't get cut off mid-batch.
// Verify against your Vercel plan's actual function-duration limit; lower
// (or raise, on a plan that supports it) once real company counts are known.
export const maxDuration = 300;

interface CompanyRow {
  id: string;
  briefing_email_cadence: string | null;
  briefing_email_recipient: string | null;
  briefing_email_weekday: number | null;
  briefing_email_timezone: string | null;
  briefing_email_last_sent_at: string | null;
}

function getAppUrl(req: NextRequest): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  if (
    !isAuthorizedCronRequest(
      req.headers.get("authorization"),
      process.env.CRON_SECRET
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowUtc = new Date();

  const { data: companies, error } = await admin
    .from("companies")
    .select(
      "id, briefing_email_cadence, briefing_email_recipient, briefing_email_weekday, briefing_email_timezone, briefing_email_last_sent_at"
    )
    .neq("briefing_email_cadence", "off");

  if (error) {
    console.error(
      "[briefing-email-scheduler] company lookup failed:",
      error.message
    );
    return NextResponse.json(
      { error: "Could not load companies" },
      { status: 500 }
    );
  }

  const rows = (companies ?? []) as CompanyRow[];
  const appUrl = getAppUrl(req);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const recipient = normalizeEmail(row.briefing_email_recipient);
      const input: CompanyScheduleInput = {
        cadence: resolveCadence(row.briefing_email_cadence),
        recipient,
        timezone: row.briefing_email_timezone,
        weekday: row.briefing_email_weekday ?? 1,
        lastSentAt: row.briefing_email_last_sent_at,
      };

      const decision = evaluateDue(input, nowUtc);
      if (!decision.due) {
        skipped++;
        continue;
      }

      // Never brief on stale data: sync Odoo (yesterday + today) first. The
      // helper never throws and a failed sync must NOT block the briefing,
      // which proceeds with whatever sales already exist.
      const sync = await autoSyncOdooCompany(admin, row.id, nowUtc);
      if (!sync.ok) {
        console.error(
          `[briefing-email-scheduler] pre-briefing odoo sync failed for company ${sync.company}:`,
          sync.error_kind
        );
      }

      // serverTrusted: this job runs with the service role and no user
      // session, so the member-gated sales RPCs would answer "no sales".
      // It reads pos_sales_items directly, scoped by company_id. ONLY this
      // route may pass it (tests/unit/briefing-sales-trusted.test.ts).
      const { ctx, briefing } = await generateBriefing(admin, row.id, null, {
        serverTrusted: true,
        syncStatus: {
          ok: sync.ok,
          skipped: Boolean(sync.skipped),
          error_kind: sync.ok ? undefined : sync.error_kind,
        },
      });
      const { subject, html, text } = renderBriefingEmail(
        ctx,
        briefing,
        appUrl
      );
      const sendResult = await sendBriefingEmail({
        to: recipient as string,
        subject,
        html,
        text,
      });

      if (!sendResult.ok) {
        failed++;
        console.error(
          `[briefing-email-scheduler] send failed for company ${row.id}:`,
          sendResult.error
        );
        continue; // never mark last_sent_at — stays eligible for retry
      }

      const { error: updateError } = await admin
        .from("companies")
        .update({ briefing_email_last_sent_at: nowUtc.toISOString() })
        .eq("id", row.id);
      if (updateError) {
        console.error(
          `[briefing-email-scheduler] last_sent_at update failed for company ${row.id}:`,
          updateError.message
        );
      }
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[briefing-email-scheduler] unexpected error for company ${row.id}:`,
        err instanceof Error ? err.message : "Unknown error"
      );
      // Never let one company's failure abort the batch — continue.
    }
  }

  return NextResponse.json({ processed: rows.length, sent, skipped, failed });
}
