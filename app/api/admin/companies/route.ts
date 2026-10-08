// app/api/admin/companies/route.ts
//
// Admin-only: list all companies (workspaces).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserAdminServer } from "@/lib/profile-service-server";

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

  return NextResponse.json(data);
}
