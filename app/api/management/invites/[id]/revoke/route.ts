// app/api/management/invites/[id]/revoke/route.ts
//
// Milton-admin-only: revoke a pending workspace invite (R1 item 2).
// Already accepted or revoked invites cannot be revoked (404).

import { NextRequest, NextResponse } from "next/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isUserAdminServer())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid invite id" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("workspace_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[invites] revoke failed:", error.message);
      return NextResponse.json(
        { error: "Could not revoke invite" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "No pending invite with that id" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[invites] revoke unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not revoke invite" },
      { status: 500 }
    );
  }
}
