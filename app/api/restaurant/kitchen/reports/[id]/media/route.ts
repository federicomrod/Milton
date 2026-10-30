// app/api/restaurant/kitchen/reports/[id]/media/route.ts
//
// GET: streams a cook report's photo or voice note (R1 #49). Telegram file
// ids are never exposed to the browser: the report is loaded, its
// company_id is checked against the caller's company (authAndCompany), and
// lib/restaurant/telegram/files.ts proxies the bytes from Telegram with the
// stored MIME type and Cache-Control: private, no-store. When Milton holds a
// Storage copy (kitchen_media, P0a) the route redirects to a 5-minute signed
// URL instead. Reports sent from the app (mobile P0b) have no Telegram file id,
// only that Storage copy.

import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createKitchenMediaSignedUrl } from "@/lib/restaurant/kitchen/media-storage";
import { openTelegramFile } from "@/lib/restaurant/telegram/files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const d = await apiDictionary();
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: d.kitchen.api.idInvalid },
        { status: 400 }
      );
    }

    const { data: report } = await createAdminClient()
      .from("kitchen_reports")
      .select("company_id, media_kind, media_mime, telegram_file_id")
      .eq("id", id)
      .maybeSingle();
    // Same 404 for "missing" and "someone else's" — no existence leak.
    if (!report || report.company_id !== companyId) {
      return NextResponse.json(
        { error: d.kitchen.api.notFound },
        { status: 404 }
      );
    }

    // Prefer Milton's own copy when one exists. Any problem (table or bucket
    // not created yet, no signed URL) falls through to the Telegram proxy.
    try {
      const admin = createAdminClient();
      const { data: stored } = await admin
        .from("kitchen_media")
        .select("storage_path")
        .eq("kitchen_report_id", id)
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();
      if (stored?.storage_path) {
        const url = await createKitchenMediaSignedUrl(
          admin,
          stored.storage_path as string,
          300
        );
        if (url) return NextResponse.redirect(url, 302);
      }
    } catch {
      console.error("[kitchen-media] storage lookup failed");
    }

    if (!report.media_kind || !report.telegram_file_id) {
      return NextResponse.json(
        { error: d.kitchen.api.notFound },
        { status: 404 }
      );
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
      { error: d.kitchen.api.fileLoadFailed },
      { status: 500 }
    );
  }
}
