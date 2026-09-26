// app/api/restaurant/briefing/email/send-test/route.ts
//
// POST /api/restaurant/briefing/email/send-test
//
// Sends ONE test briefing email to the authenticated company's OWN saved
// recipient (companies.briefing_email_recipient). Takes no request body —
// there is nothing for a caller to inject: company_id comes exclusively
// from authAndCompany(), and the recipient comes exclusively from that
// company's own saved preference, never from the request. This is the
// deliberate design that satisfies "do not accept arbitrary company_id or
// arbitrary recipient email in the test-send request" — there's no input
// surface for either.
//
// Reuses the exact same briefing pipeline as the dashboard and Telegram
// (lib/restaurant/briefing-generate.ts) — only the rendering and
// transport differ.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { generateBriefing } from "@/lib/restaurant/briefing-generate";
import { renderBriefingEmail } from "@/lib/restaurant/email/briefing-email-formatter";
import { sendBriefingEmail } from "@/lib/restaurant/email/send";
import { normalizeEmail } from "@/lib/restaurant/email/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("briefing_email_recipient")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) {
    console.error(
      "[briefing-email-send-test] recipient lookup failed:",
      companyError.message
    );
    return NextResponse.json(
      { error: "Could not look up the briefing recipient" },
      { status: 500 }
    );
  }

  const recipient = normalizeEmail(company?.briefing_email_recipient);
  if (!recipient) {
    return NextResponse.json(
      {
        error: "No briefing recipient email configured",
        message:
          "Save a recipient email in Briefing delivery settings before sending a test.",
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
      "[briefing-email-send-test] briefing generation failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not generate the briefing" },
      { status: 500 }
    );
  }

  const appUrl = getAppUrl(req);
  const { subject, html, text } = renderBriefingEmail(ctx, briefing, appUrl);

  const sendResult = await sendBriefingEmail({
    to: recipient,
    subject,
    html,
    text,
  });
  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
