// app/api/restaurant/data-source-requests/route.ts
//
// POST /api/restaurant/data-source-requests { source, details? }
//
// Records a "please support this data source" request from the Connect
// your data screen (R1 item 2). The Milton company comes from
// authAndCompany() and is never read from the body. The source is checked
// against an allowlist, details are trimmed and capped, and the row is
// inserted through the RLS-backed client. Sends nothing externally — no
// Slack, no email; Milton admins see requests on /management/invites.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  DATA_SOURCE_REQUEST_SOURCES,
  MAX_REQUEST_DETAILS,
  type DataSourceRequestSource,
} from "@/lib/restaurant/connect-data-copy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId, userId } = auth;

    let body: { source?: unknown; details?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }

    if (
      typeof body.source !== "string" ||
      !DATA_SOURCE_REQUEST_SOURCES.includes(
        body.source as DataSourceRequestSource
      )
    ) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }
    if (body.details !== undefined && typeof body.details !== "string") {
      return NextResponse.json({ error: "Invalid details" }, { status: 400 });
    }
    const details = (body.details as string | undefined)
      ?.trim()
      .slice(0, MAX_REQUEST_DETAILS);

    const { error } = await supabase.from("data_source_requests").insert({
      company_id: companyId,
      user_id: userId,
      source: body.source,
      details: details || null,
    });
    if (error) {
      console.error("[data-source-requests] insert failed:", error.message);
      return NextResponse.json(
        { error: "Could not save your request" },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[data-source-requests] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not save your request" },
      { status: 500 }
    );
  }
}
