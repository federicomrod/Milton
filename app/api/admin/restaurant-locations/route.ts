// app/api/admin/restaurant-locations/route.ts
//
// Admin-only: list restaurant locations for a company.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireMiltonStaff,
  unauthorizedResponse,
} from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorizedResponse();

  const notStaff = await requireMiltonStaff(user.id);
  if (notStaff) return notStaff;

  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json(
      { error: "company_id query parameter is required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("restaurant_locations")
    .select("id, name")
    .eq("company_id", companyId)
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: "Failed to load locations" },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}
