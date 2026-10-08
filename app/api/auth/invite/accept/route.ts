// app/api/auth/invite/accept/route.ts
//
// POST /api/auth/invite/accept — activate a workspace invite (R1 item 2).
//
//   { token, password, full_name? }  new invitee: creates the auth user
//       (email_confirm: true — the link was delivered to that address),
//       joins the EXISTING workspace through accept_workspace_invite(),
//       signs the user in and returns { redirectTo }.
//   { token }                        already signed in as the invited email:
//       one-click "Join workspace" (no password involved).
//
// If an auth user with the invite's email already exists, their password is
// NEVER changed: we return account_exists so they log in (or use "Forgot
// password?") and then accept with the one-click mode.
//
// This route never creates a company and never calls the self-serve
// bootstrap RPC. Passwords, raw tokens and hashes are never logged; error
// responses are generic plus an error code.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInviteStatus, hashInviteToken } from "@/lib/auth/invite-token";
import { resolveInvitedUserLanding } from "@/lib/restaurant/post-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt / Supabase upper bound

const RPC_ERRORS: Record<string, { status: number; code: string }> = {
  invite_not_found: { status: 404, code: "invite_invalid" },
  invite_already_accepted: { status: 410, code: "invite_used" },
  invite_revoked: { status: 410, code: "invite_revoked" },
  invite_expired: { status: 410, code: "invite_expired" },
  email_mismatch: { status: 403, code: "email_mismatch" },
  already_member_of_other_company: {
    status: 409,
    code: "already_member_of_other_company",
  },
};

function fail(status: number, code: string) {
  return NextResponse.json({ error: code }, { status });
}

function rpcFailure(message: string | undefined) {
  const known = message ? RPC_ERRORS[message] : undefined;
  if (known) return fail(known.status, known.code);
  return fail(500, "accept_failed");
}

function isEmailExistsError(err: {
  code?: string;
  status?: number;
  message?: string;
}): boolean {
  return (
    err.code === "email_exists" ||
    err.code === "user_already_exists" ||
    /already.*(registered|exists)/i.test(err.message ?? "")
  );
}

export async function POST(req: NextRequest) {
  try {
    let body: { token?: unknown; password?: unknown; full_name?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, "invalid_request");
    }
    const token = typeof body.token === "string" ? body.token : "";
    if (!token || token.length > 200) return fail(400, "invalid_request");
    const tokenHash = hashInviteToken(token);

    const admin = createAdminClient();
    const { data: invite } = await admin
      .from("workspace_invites")
      .select("id, company_id, email, expires_at, accepted_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!invite) return fail(404, "invite_invalid");
    const status = getInviteStatus(invite);
    if (status === "accepted") return fail(410, "invite_used");
    if (status === "revoked") return fail(410, "invite_revoked");
    if (status === "expired") return fail(410, "invite_expired");

    const supabase = await createClient();
    let userId: string;
    let createdUserId: string | null = null;
    let signInPassword: string | null = null;

    if (body.password === undefined) {
      // One-click join: requires a session for the invited email.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return fail(401, "login_required");
      userId = user.id;
    } else {
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
        return fail(400, "invalid_password");
      }
      const fullName =
        typeof body.full_name === "string" ? body.full_name.trim() : "";
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email: invite.email as string,
          password,
          email_confirm: true,
          ...(fullName ? { user_metadata: { full_name: fullName } } : {}),
        });
      if (createError || !created?.user) {
        if (createError && isEmailExistsError(createError)) {
          return fail(409, "account_exists");
        }
        console.error(
          "[invite-accept] createUser failed:",
          createError?.code ?? "unknown"
        );
        return fail(500, "accept_failed");
      }
      userId = created.user.id;
      createdUserId = userId;
      signInPassword = password;
      if (fullName) {
        // Best effort; profiles row is created by the auth trigger.
        await admin
          .from("profiles")
          .update({ full_name: fullName })
          .eq("user_id", userId);
      }
    }

    const { data: rpcData, error: rpcError } = await admin.rpc(
      "accept_workspace_invite",
      { p_token_hash: tokenHash, p_user_id: userId }
    );
    if (rpcError) {
      console.error("[invite-accept] accept RPC failed:", rpcError.message);
      if (createdUserId) {
        // Roll back the account we just made so the invitee can retry.
        await admin.auth.admin.deleteUser(createdUserId);
      }
      return rpcFailure(rpcError.message);
    }
    const companyId =
      (rpcData as { company_id?: string } | null)?.company_id ??
      (invite.company_id as string);

    if (signInPassword) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: invite.email as string,
        password: signInPassword,
      });
      if (signInError) {
        // Joined, but no session: send them to log in normally.
        return NextResponse.json({ success: true, redirectTo: "/auth/login" });
      }
    }

    const redirectTo =
      (await resolveInvitedUserLanding(admin, companyId, {
        assumeInvited: true,
      })) ?? "/dashboard/restaurant";
    return NextResponse.json({ success: true, redirectTo });
  } catch (err) {
    console.error(
      "[invite-accept] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return fail(500, "accept_failed");
  }
}
