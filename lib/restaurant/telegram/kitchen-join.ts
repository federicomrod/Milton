// lib/restaurant/telegram/kitchen-join.ts
//
// Kitchen QR join (R1 #55): wall QR per location -> Telegram deep link
// https://t.me/<bot>?start=kq1_<secret>. Pure functions first, I/O shell
// after (mirrors pairing.ts).
//
// The payload is an opaque 24-random-byte secret (never a company or
// location id). Only the SHA-256 hex of the secret is stored, so a QR can
// never be shown again — a lost sheet means rotating. All table access
// here uses the service-role client: kitchen_join_tokens has no RLS
// policies at all, and kitchen_staff is written only from the webhook /
// owner-admin routes.
//
// SECURITY: never logs raw tokens, token hashes, or message text.

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const KITCHEN_PAYLOAD_PREFIX = "kq1_";
export const RATE_LIMIT_PER_HOUR = 20;
const SECRET_BYTES = 24; // 32 base64url chars
const KITCHEN_PAYLOAD_RE = /^kq1_[A-Za-z0-9_-]{32}$/;
const MAX_DISPLAY_NAME = 128;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** secret = 32 base64url chars; payload = "kq1_" + secret (36 chars). */
export function generateKitchenToken(): { secret: string; payload: string } {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { secret, payload: `${KITCHEN_PAYLOAD_PREFIX}${secret}` };
}

/** SHA-256 hex of the secret (the part after kq1_). */
export function hashKitchenToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** True only for kq1_ + 32 base64url chars; 12-char pairing codes never match. */
export function isKitchenPayload(payload: string): boolean {
  return KITCHEN_PAYLOAD_RE.test(payload);
}

export function secretFromPayload(payload: string): string {
  return payload.slice(KITCHEN_PAYLOAD_PREFIX.length);
}

/** Telegram first_name + optional last_name, capped. No phone / username. */
export function buildDisplayName(from: {
  first_name?: string;
  last_name?: string;
}): string {
  const name = [from.first_name, from.last_name]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .map((p) => p.trim())
    .join(" ");
  return (name || "Cocina").slice(0, MAX_DISPLAY_NAME);
}

/** Owners and Milton admins manage QRs; members don't. */
export function canManageKitchenQr(input: {
  isMiltonAdmin: boolean;
  membershipRole: string | null | undefined;
}): boolean {
  return input.isMiltonAdmin || input.membershipRole === "owner";
}

export interface ExistingStaff {
  location_id: string;
  is_active: boolean;
}

export type JoinDecision =
  | { kind: "invalid" }
  | { kind: "rate_limited" }
  | { kind: "already_joined" }
  | { kind: "moved"; previousLocationId: string }
  | { kind: "joined" };

/**
 * Join rules: unknown/revoked token -> invalid. Same active cook at the
 * same location -> already_joined (no write, not counted toward the rate
 * limit). 20+ joins on this QR in the last hour -> rate_limited. An active
 * cook elsewhere is moved; a new or removed cook (re)joins.
 */
export function decideJoin(input: {
  token: { revoked_at: string | null } | null;
  existingStaff: ExistingStaff | null;
  targetLocationId: string;
  recentJoinsCount: number;
}): JoinDecision {
  const { token, existingStaff, targetLocationId, recentJoinsCount } = input;
  if (!token || token.revoked_at) return { kind: "invalid" };
  if (
    existingStaff?.is_active &&
    existingStaff.location_id === targetLocationId
  ) {
    return { kind: "already_joined" };
  }
  if (recentJoinsCount >= RATE_LIMIT_PER_HOUR) return { kind: "rate_limited" };
  if (existingStaff?.is_active) {
    return { kind: "moved", previousLocationId: existingStaff.location_id };
  }
  return { kind: "joined" };
}

// ---------------------------------------------------------------------------
// I/O shell (service role)
// ---------------------------------------------------------------------------

export function buildKitchenDeepLink(payload: string): string {
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  if (!bot) throw new Error("TELEGRAM_BOT_USERNAME is not set.");
  return `https://t.me/${bot}?start=${payload}`;
}

/**
 * Revokes the location's live token (if any) and inserts a new one. The
 * raw payload/deep link is returned ONCE; only the hash is stored.
 */
export async function rotateLocationToken(
  companyId: string,
  locationId: string,
  userId: string
): Promise<{ deepLink: string; rawToken: string }> {
  const admin = createAdminClient();

  const { error: revokeError } = await admin
    .from("kitchen_join_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("location_id", locationId)
    .is("revoked_at", null);
  if (revokeError) throw new Error("Could not revoke the previous QR.");

  const { secret, payload } = generateKitchenToken();
  const { error: insertError } = await admin
    .from("kitchen_join_tokens")
    .insert({
      company_id: companyId,
      location_id: locationId,
      token_hash: hashKitchenToken(secret),
      created_by: userId,
    });
  if (insertError) throw new Error("Could not create the QR.");

  return { deepLink: buildKitchenDeepLink(payload), rawToken: payload };
}

export type ConsumeKitchenJoinResult =
  | { kind: "invalid" }
  | { kind: "rate_limited" }
  | { kind: "already_joined"; locationName: string }
  | { kind: "joined"; locationName: string }
  | { kind: "moved"; locationName: string; previousLocationName: string };

/** Handles a /start kq1_... join from a private chat. Throws on DB errors. */
export async function consumeKitchenJoin(input: {
  payload: string;
  telegramUserId: number;
  chatId: number;
  displayName: string;
}): Promise<ConsumeKitchenJoinResult> {
  if (!isKitchenPayload(input.payload)) return { kind: "invalid" };
  const admin = createAdminClient();

  const { data: token, error: tokenError } = await admin
    .from("kitchen_join_tokens")
    .select("id, company_id, location_id, revoked_at")
    .eq("token_hash", hashKitchenToken(secretFromPayload(input.payload)))
    .is("revoked_at", null)
    .maybeSingle();
  if (tokenError) throw new Error("token lookup failed");
  if (!token) return { kind: "invalid" };

  const { data: location, error: locError } = await admin
    .from("restaurant_locations")
    .select("id, name")
    .eq("id", token.location_id)
    .eq("company_id", token.company_id)
    .maybeSingle();
  if (locError) throw new Error("location lookup failed");
  if (!location) return { kind: "invalid" };

  const { data: existing, error: staffError } = await admin
    .from("kitchen_staff")
    .select("id, location_id, is_active")
    .eq("telegram_user_id", input.telegramUserId)
    .maybeSingle();
  if (staffError) throw new Error("staff lookup failed");

  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: countError } = await admin
    .from("kitchen_staff")
    .select("id", { count: "exact", head: true })
    .eq("joined_via_token_id", token.id)
    .gt("joined_at", oneHourAgo);
  if (countError) throw new Error("rate-limit lookup failed");

  const decision = decideJoin({
    token,
    existingStaff: existing
      ? { location_id: existing.location_id, is_active: existing.is_active }
      : null,
    targetLocationId: token.location_id,
    recentJoinsCount: count ?? 0,
  });

  if (decision.kind === "invalid") return { kind: "invalid" };
  if (decision.kind === "rate_limited") return { kind: "rate_limited" };
  if (decision.kind === "already_joined") {
    return { kind: "already_joined", locationName: location.name };
  }

  let previousLocationName = "";
  if (decision.kind === "moved") {
    const { data: prev } = await admin
      .from("restaurant_locations")
      .select("name")
      .eq("id", decision.previousLocationId)
      .maybeSingle();
    previousLocationName = prev?.name ?? "";
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await admin.from("kitchen_staff").upsert(
    {
      company_id: token.company_id,
      location_id: token.location_id,
      telegram_user_id: input.telegramUserId,
      chat_id: input.chatId,
      display_name: input.displayName,
      is_active: true,
      joined_via_token_id: token.id,
      joined_at: now,
      removed_at: null,
      removed_by: null,
      updated_at: now,
    },
    { onConflict: "telegram_user_id" }
  );
  if (upsertError) throw new Error("staff upsert failed");

  return decision.kind === "moved"
    ? {
        kind: "moved",
        locationName: location.name,
        previousLocationName,
      }
    : { kind: "joined", locationName: location.name };
}

// ---------------------------------------------------------------------------
// Dashboard-side helpers (service role): permission input + QR status
// ---------------------------------------------------------------------------

/** The user's company_memberships.role for this company (admin client). */
export async function loadMembershipRole(
  companyId: string,
  userId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

export interface KitchenQrLocationStatus {
  location_id: string;
  name: string;
  has_active_qr: boolean;
  qr_created_at: string | null;
  active_staff_count: number;
}

/** Per-location QR status for a company. Never returns a token or hash. */
export async function loadKitchenQrStatus(
  companyId: string
): Promise<KitchenQrLocationStatus[]> {
  const admin = createAdminClient();
  const [locs, tokens, staff] = await Promise.all([
    admin
      .from("restaurant_locations")
      .select("id, name, is_active")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    admin
      .from("kitchen_join_tokens")
      .select("location_id, created_at")
      .eq("company_id", companyId)
      .is("revoked_at", null),
    admin
      .from("kitchen_staff")
      .select("location_id")
      .eq("company_id", companyId)
      .eq("is_active", true),
  ]);
  if (locs.error || tokens.error || staff.error) {
    throw new Error("Could not load kitchen QR status.");
  }
  const tokenByLocation = new Map(
    (tokens.data ?? []).map((t) => [
      t.location_id as string,
      t.created_at as string,
    ])
  );
  const staffCount = new Map<string, number>();
  for (const row of staff.data ?? []) {
    const id = row.location_id as string;
    staffCount.set(id, (staffCount.get(id) ?? 0) + 1);
  }
  return (locs.data ?? [])
    .filter((l) => l.is_active !== false)
    .map((l) => ({
      location_id: l.id as string,
      name: l.name as string,
      has_active_qr: tokenByLocation.has(l.id as string),
      qr_created_at: tokenByLocation.get(l.id as string) ?? null,
      active_staff_count: staffCount.get(l.id as string) ?? 0,
    }));
}
