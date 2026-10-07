// app/api/restaurant/kitchen/reports/route.ts
//
// GET: newest cook reports for the caller's company, optionally filtered by
// ?location_id= and ?type= (R1 #49). Read through the RLS-backed client, so
// any company member can read and nobody can read another company's rows.
// Telegram file ids are never returned; media is viewed through the
// company-checked /reports/[id]/media proxy.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { REPORT_TYPES } from "@/lib/restaurant/telegram/kitchen-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    const sp = new URL(req.url).searchParams;
    const locationId = sp.get("location_id");
    const type = sp.get("type");
    if (locationId && !UUID_RE.test(locationId)) {
      return NextResponse.json(
        { error: "Invalid location_id" },
        { status: 400 }
      );
    }
    if (type && !(REPORT_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    let query = supabase
      .from("kitchen_reports")
      .select(
        "id, location_id, staff_id, report_type, text, media_kind, media_mime, media_duration_s, created_at"
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (locationId) query = query.eq("location_id", locationId);
    if (type) query = query.eq("report_type", type);
    const { data: reports, error } = await query;
    if (error) {
      console.error("[kitchen-reports] list failed:", error.message);
      return NextResponse.json(
        { error: "Could not load reports" },
        { status: 500 }
      );
    }

    const [staffRes, locRes] = await Promise.all([
      supabase
        .from("kitchen_staff")
        .select("id, display_name")
        .eq("company_id", companyId),
      supabase
        .from("restaurant_locations")
        .select("id, name")
        .eq("company_id", companyId),
    ]);
    const staffNames = new Map(
      (staffRes.data ?? []).map((s) => [
        s.id as string,
        s.display_name as string,
      ])
    );
    const locNames = new Map(
      (locRes.data ?? []).map((l) => [l.id as string, l.name as string])
    );

    return NextResponse.json({
      reports: (reports ?? []).map((r) => ({
        ...r,
        staff_name: staffNames.get(r.staff_id as string) ?? "",
        location_name: locNames.get(r.location_id as string) ?? "",
      })),
    });
  } catch (err) {
    console.error(
      "[kitchen-reports] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not load reports" },
      { status: 500 }
    );
  }
}
