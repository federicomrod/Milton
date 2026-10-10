// app/api/admin/companies/route.ts
//
// Admin-only: list all companies (workspaces). Each row includes is_own
// for the signed-in workspace (same resolveCompanyIdForUser path as
// authAndCompany / Sync now) so /management/odoo can label the sync target.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("companies")
    .select("id, name")
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: "Failed to load companies" },
      { status: 500 }
    );
  }

  const ownCompanyId = await resolveCompanyIdForUser(supabase, user.id);

  return NextResponse.json(
    (data ?? []).map((company) => ({
      id: company.id,
      name: company.name,
      is_own: ownCompanyId != null && company.id === ownCompanyId,
    }))
  );
}
