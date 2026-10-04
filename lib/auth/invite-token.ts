// lib/auth/invite-token.ts
//
// Pure helpers for workspace invite tokens (migration 020). The raw token
// is shown to the admin exactly once, inside the invite link; only its
// SHA-256 hash is ever stored or looked up. Server-only (node:crypto).

import { createHash, randomBytes } from "node:crypto";

export const INVITE_TTL_DAYS = 7;
export type InviteRole = "owner" | "member";
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

/** 32 random bytes, base64url. Returns the raw token and its hash. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

/** Deterministic SHA-256 hex of the raw token. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getInviteStatus(
  invite: {
    accepted_at?: string | null;
    revoked_at?: string | null;
    expires_at: string;
  },
  now: Date = new Date()
): InviteStatus {
  if (invite.accepted_at) return "accepted";
  if (invite.revoked_at) return "revoked";
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return "expired";
  return "pending";
}

/**
 * The pilot client's first user becomes the workspace owner; later invites
 * default to member.
 */
export function defaultInviteRole(companyHasOwner: boolean): InviteRole {
  return companyHasOwner ? "member" : "owner";
}
