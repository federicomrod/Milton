// app/api/management/invites/route.ts
//
// Milton-admin-only workspace invites (R1 item 2, issue #45).
//
// POST { company_id, email, role? } creates an invite and returns the raw
//   link ONCE (/auth/invite?token=...). Only the SHA-256 hash is stored.
//   Re-inviting an email that already has a live invite revokes the old one.
// GET ?company_id= lists invites (never tokens or hashes), plus the company
//   list for the picker and recent "Connect your data" requests.
//
// Every handler is gated by isUserAdminServer() (profiles.role = 'admin');
// everyone else gets 403. The admin client is used only after that gate,
// for the privileged invite reads/writes.

import { NextRequest, NextResponse } from "next/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  defaultInviteRole,
  generateInviteToken,
  getInviteStatus,
  inviteExpiry,
  normalizeInviteEmail,
  type InviteRole,
} from "@/lib/auth/invite-token";
import { sendWorkspaceInviteEmail } from "@/lib/restaurant/email/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const forbidden = () =>
  NextResponse.json({ error: "Forbidden" }, { status: 403 });

export async function POST(req: NextRequest) {
  try {
    if (!(await isUserAdminServer())) return forbidden();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return forbidden();

    let body: { company_id?: unknown; email?: unknown; role?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const companyId =
      typeof body.company_id === "string" ? body.company_id : "";
    const email =
      typeof body.email === "string" ? normalizeInviteEmail(body.email) : "";
    if (!UUID_RE.test(companyId)) {
      return NextResponse.json(
        { error: "Invalid company_id" },
        { status: 400 }
      );
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (
      body.role !== undefined &&
      body.role !== "owner" &&
      body.role !== "member"
    ) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: company } = await admin
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    let role = body.role as InviteRole | undefined;
    if (!role) {
      const { count } = await admin
        .from("company_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("role", "owner");
      role = defaultInviteRole((count ?? 0) > 0);
    }

    // Revoke any live invite for the same email in this workspace.
    const { error: revokeError } = await admin
      .from("workspace_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null);
    if (revokeError) {
      console.error("[invites] revoke-old failed:", revokeError.message);
      return NextResponse.json(
        { error: "Could not create invite" },
        { status: 500 }
      );
    }

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = inviteExpiry();
    const { data: invite, error: insertError } = await admin
      .from("workspace_invites")
      .insert({
        company_id: companyId,
        email,
        role,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        created_by: user.id,
      })
      .select("id, company_id, email, role, expires_at, created_at")
      .single();
    if (insertError || !invite) {
      console.error("[invites] insert failed:", insertError?.message);
      return NextResponse.json(
        { error: "Could not create invite" },
        { status: 500 }
      );
    }

    const link = `${new URL(req.url).origin}/auth/invite?token=${token}`;
    const emailResult = await sendWorkspaceInviteEmail({
      to: email,
      link,
      workspaceName: company.name as string,
    });

    return NextResponse.json({
      invite: { ...invite, status: "pending" },
      link,
      email_sent: emailResult.ok,
      email_note: emailResult.ok
        ? "Invite email sent."
        : "Email not sent — share the link manually.",
    });
  } catch (err) {
    console.error(
      "[invites] POST failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not create invite" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isUserAdminServer())) return forbidden();
    const companyId = new URL(req.url).searchParams.get("company_id");
    if (companyId && !UUID_RE.test(companyId)) {
      return NextResponse.json(
        { error: "Invalid company_id" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: companies } = await admin
      .from("companies")
      .select("id, name")
      .order("name", { ascending: true });

    let invitesQuery = admin
      .from("workspace_invites")
      // Explicit column list: token_hash is never selected.
      .select(
        "id, company_id, email, role, expires_at, created_at, accepted_at, revoked_at"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (companyId) invitesQuery = invitesQuery.eq("company_id", companyId);
    const { data: invites, error } = await invitesQuery;
    if (error) {
      console.error("[invites] list failed:", error.message);
      return NextResponse.json(
        { error: "Could not list invites" },
        { status: 500 }
      );
    }

    let requestsQuery = admin
      .from("data_source_requests")
      .select("id, company_id, source, details, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (companyId) requestsQuery = requestsQuery.eq("company_id", companyId);
    const { data: requests } = await requestsQuery;

    const now = new Date();
    return NextResponse.json({
      companies: companies ?? [],
      invites: (invites ?? []).map((i) => ({
        ...i,
        status: getInviteStatus(i, now),
      })),
      recent_requests: requests ?? [],
    });
  } catch (err) {
    console.error(
      "[invites] GET failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not list invites" },
      { status: 500 }
    );
  }
}
