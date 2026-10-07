// app/api/restaurant/kitchen/reports/[id]/media/route.ts
//
// GET: streams a cook report's photo or voice note (R1 #49). Telegram file
// ids are never exposed to the browser: the report is loaded, its
// company_id is checked against the caller's company (authAndCompany), and
// lib/restaurant/telegram/files.ts proxies the bytes from Telegram with the
// stored MIME type and Cache-Control: private, no-store.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { openTelegramFile } from "@/lib/restaurant/telegram/files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { data: report } = await createAdminClient()
      .from("kitchen_reports")
      .select("company_id, media_kind, media_mime, telegram_file_id")
      .eq("id", id)
      .maybeSingle();
    // Same 404 for "missing" and "someone else's" — no existence leak.
    if (
      !report ||
      report.company_id !== companyId ||
      !report.media_kind ||
      !report.telegram_file_id
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const file = await openTelegramFile(report.telegram_file_id as string);
    if (!file.ok) {
      return NextResponse.json({ error: file.error }, { status: 502 });
    }
    const headers: Record<string, string> = {
      "Content-Type":
        (report.media_mime as string | null) ??
        (report.media_kind === "photo" ? "image/jpeg" : "audio/ogg"),
      "Cache-Control": "private, no-store",
    };
    if (file.contentLength) headers["Content-Length"] = file.contentLength;
    return new Response(file.body, { headers });
  } catch (err) {
    console.error(
      "[kitchen-media] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not load media" },
      { status: 500 }
    );
  }
}
