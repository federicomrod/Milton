"use server";

// app/dashboard/restaurant/data/team-actions.ts
//
// Owner and admin server actions behind Configuración › Equipo y acceso: invite
// a web (Gestión) member, change a member's role, remove one, revoke or resend
// a pending invite. Gate: resolveActor + can(actor, "team.manage") on the cookie
// session; the company always comes from the session, never the caller. On top
// of that, canGrantRole / canManageMemberRole (lib/auth/capabilities.ts): only
// an owner makes or touches an owner, and nobody grants a role above their own.
//
// SECURITY: the invite token exists only in the create result (once); only its
// SHA-256 hash is stored. Nothing is logged except err.name. The privileged
// (admin) client is used only after the owner gate and every query is scoped
// to the session company.

import { headers } from "next/headers";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, resolveActor } from "@/lib/auth/permissions";
import {
  canGrantRole,
  canManageMemberRole,
  isInviteRole,
  isOwnerRole,
  normalizeRole,
  TEAM_ROLES,
  type Actor,
} from "@/lib/auth/capabilities";
import {
  generateInviteToken,
  inviteExpiry,
  normalizeInviteEmail,
  type InviteRole,
} from "@/lib/auth/invite-token";
import { sendWorkspaceInviteEmail } from "@/lib/restaurant/email/send";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type TeamActionError =
  | "forbidden"
  | "auth"
  | "email"
  | "role"
  | "role_limit"
  | "self"
  | "last_owner"
  | "error";

export type InviteMemberResult =
  | {
      ok: true;
      inviteId: string;
      link: string;
      emailSent: boolean;
      email: string;
      role: InviteRole;
      expiresAt: string;
    }
  | { ok: false; error: TeamActionError };
export type ChangeRoleResult =
  | { ok: true; role: InviteRole }
  | { ok: false; error: TeamActionError };
export type RemoveMemberResult =
  | { ok: true }
  | { ok: false; error: TeamActionError };
export type RevokeInviteResult =
  | { ok: true }
  | { ok: false; error: TeamActionError };

type OwnerContext =
  | {
      ok: true;
      auth: Extract<Awaited<ReturnType<typeof authAndCompany>>, { ok: true }>;
      actor: Actor;
    }
  | { ok: false; error: TeamActionError };

async function ownerContext(): Promise<OwnerContext> {
  const auth = await authAndCompany();
  if (!auth.ok) return { ok: false, error: "auth" };
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  if (!can(actor, "team.manage")) return { ok: false, error: "forbidden" };
  return { ok: true, auth, actor };
}

function logFailure(scope: string, err: unknown) {
  console.error(
    `[team-actions] ${scope}:`,
    err instanceof Error ? err.name : "Unknown error"
  );
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

type OwnerOk = Extract<OwnerContext, { ok: true }>;

/** Revoke the live invite for `clean`, store a fresh hashed one and email the link. */
async function createInvite(
  ctx: OwnerOk,
  clean: string,
  role: InviteRole
): Promise<InviteMemberResult> {
  const companyId = ctx.auth.companyId;
  const admin = createAdminClient();

  const { data: company } = await admin
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "error" };

  // One live invite per email: revoke the old one first.
  const { error: revokeError } = await admin
    .from("workspace_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("email", clean)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (revokeError) return { ok: false, error: "error" };

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = inviteExpiry().toISOString();
  const { data: invite, error: insertError } = await admin
    .from("workspace_invites")
    .insert({
      company_id: companyId,
      email: clean,
      role,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: ctx.auth.userId,
    })
    .select("id")
    .single();
  if (insertError || !invite) return { ok: false, error: "error" };

  const link = `${await requestOrigin()}/auth/invite?token=${token}`;
  const sent = await sendWorkspaceInviteEmail({
    to: clean,
    link,
    workspaceName: String(company.name ?? ""),
  });
  return {
    ok: true,
    inviteId: String(invite.id),
    link,
    emailSent: sent.ok,
    email: clean,
    role,
    expiresAt,
  };
}

export async function inviteMember(
  email: string,
  role: string
): Promise<InviteMemberResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    const clean = typeof email === "string" ? normalizeInviteEmail(email) : "";
    if (!EMAIL_RE.test(clean) || clean.length > 254) {
      return { ok: false, error: "email" };
    }
    if (!isInviteRole(role)) {
      return { ok: false, error: "role" };
    }
    // Nobody grants a role above their own; only an owner makes an owner.
    if (!canGrantRole(ctx.actor, role)) {
      return { ok: false, error: "role_limit" };
    }
    return await createInvite(ctx, clean, normalizeRole(role) as InviteRole);
  } catch (err) {
    logFailure("invite", err);
    return { ok: false, error: "error" };
  }
}

/**
 * The link of a pending invite cannot be shown again (only its hash is
 * stored), so «Reenviar» revokes it and creates a new one with the same email
 * and role.
 */
export async function resendInvite(
  inviteId: string
): Promise<InviteMemberResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (typeof inviteId !== "string" || !UUID_RE.test(inviteId)) {
      return { ok: false, error: "error" };
    }
    const { data: invite } = await createAdminClient()
      .from("workspace_invites")
      .select("id, email, role")
      .eq("id", inviteId)
      .eq("company_id", ctx.auth.companyId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .maybeSingle();
    if (!invite || !isInviteRole(invite.role)) {
      return { ok: false, error: "error" };
    }
    if (!canGrantRole(ctx.actor, invite.role)) {
      return { ok: false, error: "role_limit" };
    }
    return await createInvite(
      ctx,
      normalizeInviteEmail(String(invite.email)),
      normalizeRole(invite.role) as InviteRole
    );
  } catch (err) {
    logFailure("resend", err);
    return { ok: false, error: "error" };
  }
}

export async function changeMemberRole(
  membershipId: string,
  role: string
): Promise<ChangeRoleResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (typeof membershipId !== "string" || !UUID_RE.test(membershipId)) {
      return { ok: false, error: "error" };
    }
    const next = normalizeRole(role);
    if (!next || !(TEAM_ROLES as readonly string[]).includes(next)) {
      return { ok: false, error: "role" };
    }
    const companyId = ctx.auth.companyId;
    const admin = createAdminClient();
    const { data: target } = await admin
      .from("company_memberships")
      .select("id, user_id, role")
      .eq("id", membershipId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!target) return { ok: false, error: "error" };
    if (target.user_id === ctx.auth.userId) {
      return { ok: false, error: "self" };
    }
    // Not above the actor on either side: not their current role, not the new one.
    if (
      !canManageMemberRole(ctx.actor, target.role) ||
      !canGrantRole(ctx.actor, next)
    ) {
      return { ok: false, error: "role_limit" };
    }
    if (isOwnerRole(target.role) && next !== "owner") {
      const { data: owners } = await admin
        .from("company_memberships")
        .select("id")
        .eq("company_id", companyId)
        .eq("role", "owner");
      if ((owners ?? []).length <= 1) {
        return { ok: false, error: "last_owner" };
      }
    }
    const { error } = await admin
      .from("company_memberships")
      .update({ role: next })
      .eq("id", membershipId)
      .eq("company_id", companyId);
    if (error) return { ok: false, error: "error" };
    return { ok: true, role: next as InviteRole };
  } catch (err) {
    logFailure("change-role", err);
    return { ok: false, error: "error" };
  }
}

export async function removeMember(
  membershipId: string
): Promise<RemoveMemberResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (typeof membershipId !== "string" || !UUID_RE.test(membershipId)) {
      return { ok: false, error: "error" };
    }
    const companyId = ctx.auth.companyId;
    const admin = createAdminClient();
    const { data: target } = await admin
      .from("company_memberships")
      .select("id, user_id, role")
      .eq("id", membershipId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!target) return { ok: false, error: "error" };
    if (target.user_id === ctx.auth.userId) {
      return { ok: false, error: "self" };
    }
    // An admin cannot remove an owner.
    if (!canManageMemberRole(ctx.actor, target.role)) {
      return { ok: false, error: "role_limit" };
    }
    if (isOwnerRole(target.role)) {
      const { data: owners } = await admin
        .from("company_memberships")
        .select("id")
        .eq("company_id", companyId)
        .eq("role", "owner");
      if ((owners ?? []).length <= 1) {
        return { ok: false, error: "last_owner" };
      }
    }
    const { error } = await admin
      .from("company_memberships")
      .delete()
      .eq("id", membershipId)
      .eq("company_id", companyId);
    if (error) return { ok: false, error: "error" };
    // If that person had this company active (support), clear it so the app
    // never keeps showing a company they no longer belong to.
    for (const column of ["id", "user_id"] as const) {
      await admin
        .from("profiles")
        .update({ company_id: null })
        .eq(column, String(target.user_id))
        .eq("company_id", companyId);
    }
    return { ok: true };
  } catch (err) {
    logFailure("remove", err);
    return { ok: false, error: "error" };
  }
}

export async function revokeInvite(
  inviteId: string
): Promise<RevokeInviteResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (typeof inviteId !== "string" || !UUID_RE.test(inviteId)) {
      return { ok: false, error: "error" };
    }
    const admin = createAdminClient();
    // An admin cannot revoke an owner's invite.
    const { data: pending } = await admin
      .from("workspace_invites")
      .select("role")
      .eq("id", inviteId)
      .eq("company_id", ctx.auth.companyId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .maybeSingle();
    if (pending && !canManageMemberRole(ctx.actor, pending.role)) {
      return { ok: false, error: "role_limit" };
    }
    const { data, error } = await admin
      .from("workspace_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
      .eq("company_id", ctx.auth.companyId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id");
    if (error || !data || data.length === 0) {
      return { ok: false, error: "error" };
    }
    return { ok: true };
  } catch (err) {
    logFailure("revoke", err);
    return { ok: false, error: "error" };
  }
}
