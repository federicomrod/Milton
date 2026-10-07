// app/api/restaurant/kitchen/reports/[id]/route.ts
//
// PATCH { report_type }: reclassify a cook report (R1 #49). Owners and
// Milton admins only (canManageKitchenQr). The type is allowlisted and the
// update is company-checked; the write uses the service role because
// kitchen_reports has no write policies for tenant members.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageKitchenQr,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";
import { REPORT_TYPES } from "@/lib/restaurant/telegram/kitchen-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId, userId } = auth;

    const [isMiltonAdmin, membershipRole] = await Promise.all([
      isUserAdminServer(userId),
      loadMembershipRole(companyId, userId),
    ]);
    if (!canManageKitchenQr({ isMiltonAdmin, membershipRole })) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    let body: { report_type?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
    if (
      typeof body.report_type !== "string" ||
      !(REPORT_TYPES as readonly string[]).includes(body.report_type)
    ) {
      return NextResponse.json(
        { error: "Invalid report_type" },
        { status: 400 }
      );
    }

    const { data, error } = await createAdminClient()
      .from("kitchen_reports")
      .update({ report_type: body.report_type })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[kitchen-reports] reclassify failed:", error.message);
      return NextResponse.json(
        { error: "Could not update the report" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[kitchen-reports] patch unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not update the report" },
      { status: 500 }
    );
  }
}
