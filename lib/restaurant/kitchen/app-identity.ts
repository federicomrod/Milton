// lib/restaurant/kitchen/app-identity.ts
//
// Cook identity for the kitchen app (mobile P0b, #430). Server-only; every
// function takes the service-role client and is company-scoped by the caller's
// arguments.
//
//   owner creates a personal invite (7 days, single use)
//     -> the cook redeems it on their phone with their name
//     -> a kitchen_staff row (no Telegram ids) + a kitchen_devices row appear
//     -> the app sends the device token as a bearer on every kitchen request.
//
// Cooks are NEVER company members and never get a Supabase auth user: nothing
// in this file touches company_memberships.
//
// SECURITY: invite secrets and device tokens are stored only as SHA-256 hashes
// (hashKitchenToken, same as kitchen_join_tokens) and the raw value is
// returned exactly once. Nothing here logs a token, a hash or a raw error
// message (static text or err.name only), and nothing throws: callers get
// typed results.

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashKitchenToken } from "@/lib/restaurant/telegram/kitchen-join";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LAST_SEEN_THROTTLE_MS = 60_000;
const TOKEN_BYTES = 32;
const MAX_NAME = 128;
const MAX_DEVICE_LABEL = 80;
const MAX_RAW_TOKEN = 200;
const DEFAULT_STAFF_NAME = "Cocina";

/** 32 random bytes, base64url. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex of a raw token (the same helper kitchen_join_tokens uses). */
export function hashToken(raw: string): string {
  return hashKitchenToken(raw);
}

export type DevicePlatform = "ios" | "android";

function cleanName(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, max);
  return v || null;
}

function platformOf(value: unknown): DevicePlatform | null {
  return value === "ios" || value === "android" ? value : null;
}

function logUnexpected(scope: string, err: unknown): void {
  console.error(
    `[kitchen-app-identity] ${scope}:`,
    err instanceof Error ? err.name : "Unknown error"
  );
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export type CreateInviteResult =
  | { ok: true; inviteId: string; secret: string; expiresAt: string }
  | { ok: false; reason: "location" | "error" };

export async function createKitchenInvite(
  admin: SupabaseClient,
  input: {
    companyId: string;
    locationId: string;
    createdBy: string;
    inviteeName?: string | null;
  }
): Promise<CreateInviteResult> {
  try {
    const { data: location, error: locError } = await admin
      .from("restaurant_locations")
      .select("id, status")
      .eq("id", input.locationId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (locError) return { ok: false, reason: "error" };
    if (
      !location ||
      (location.status != null && location.status !== "active")
    ) {
      return { ok: false, reason: "location" };
    }

    const secret = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { data, error } = await admin
      .from("kitchen_invites")
      .insert({
        company_id: input.companyId,
        location_id: input.locationId,
        created_by: input.createdBy,
        invitee_name: cleanName(input.inviteeName, MAX_NAME),
        secret_hash: hashToken(secret),
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, reason: "error" };
    return { ok: true, inviteId: data.id as string, secret, expiresAt };
  } catch (err) {
    logUnexpected("create invite", err);
    return { ok: false, reason: "error" };
  }
}

export type RedeemInviteResult =
  | {
      ok: true;
      deviceToken: string;
      staffId: string;
      staffName: string;
      companyId: string;
      locationId: string;
      locationName: string;
    }
  | {
      ok: false;
      reason: "invalid" | "used" | "revoked" | "expired" | "error";
    };

interface InviteRow {
  id: string;
  company_id: string;
  location_id: string;
  invitee_name: string | null;
  expires_at: string;
  used_at: string | null;
  used_by_staff_id: string | null;
  revoked_at: string | null;
}

/**
 * Redeems an invite exactly once. The single-use guarantee is a conditional
 * UPDATE (… where used_at is null returning id): of two concurrent redeems
 * only one gets a row back, the other sees «used».
 */
export async function redeemKitchenInvite(
  admin: SupabaseClient,
  input: {
    secret: string;
    name?: string | null;
    platform?: string | null;
    deviceLabel?: string | null;
  }
): Promise<RedeemInviteResult> {
  try {
    const secret = typeof input.secret === "string" ? input.secret.trim() : "";
    if (!secret || secret.length > MAX_RAW_TOKEN) {
      return { ok: false, reason: "invalid" };
    }

    const { data: found, error: findError } = await admin
      .from("kitchen_invites")
      .select(
        "id, company_id, location_id, invitee_name, expires_at, used_at, used_by_staff_id, revoked_at"
      )
      .eq("secret_hash", hashToken(secret))
      .maybeSingle();
    if (findError) return { ok: false, reason: "error" };
    const invite = found as InviteRow | null;
    if (!invite) return { ok: false, reason: "invalid" };

    const now = new Date();
    const nowIso = now.toISOString();
    if (invite.used_at) return { ok: false, reason: "used" };
    if (invite.revoked_at) return { ok: false, reason: "revoked" };
    if (new Date(invite.expires_at).getTime() <= now.getTime()) {
      return { ok: false, reason: "expired" };
    }

    // The location must still be there (and active) before the invite is spent.
    const { data: location, error: locError } = await admin
      .from("restaurant_locations")
      .select("id, name, status")
      .eq("id", invite.location_id)
      .eq("company_id", invite.company_id)
      .maybeSingle();
    if (locError) return { ok: false, reason: "error" };
    if (
      !location ||
      (location.status != null && location.status !== "active")
    ) {
      return { ok: false, reason: "invalid" };
    }

    // Claim. Only one concurrent caller gets a row back.
    const { data: claimed, error: claimError } = await admin
      .from("kitchen_invites")
      .update({ used_at: nowIso })
      .eq("id", invite.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .select("id")
      .maybeSingle();
    if (claimError) return { ok: false, reason: "error" };
    if (!claimed) return { ok: false, reason: "used" };

    const staffName =
      cleanName(input.name, MAX_NAME) ??
      cleanName(invite.invitee_name, MAX_NAME) ??
      DEFAULT_STAFF_NAME;

    const rollback = async (createdStaffId: string | null) => {
      try {
        if (createdStaffId) {
          await admin
            .from("kitchen_staff")
            .delete()
            .eq("id", createdStaffId)
            .eq("company_id", invite.company_id);
        }
        await admin
          .from("kitchen_invites")
          .update({ used_at: null })
          .eq("id", invite.id)
          .eq("company_id", invite.company_id);
      } catch (err) {
        logUnexpected("redeem rollback", err);
      }
    };

    // Reuse the staff row a previous, half-finished redeem of THIS invite made.
    let staffId: string | null = null;
    let createdStaffId: string | null = null;
    if (invite.used_by_staff_id) {
      const { data: prior } = await admin
        .from("kitchen_staff")
        .select("id")
        .eq("id", invite.used_by_staff_id)
        .eq("company_id", invite.company_id)
        .eq("location_id", invite.location_id)
        .maybeSingle();
      if (prior) staffId = prior.id as string;
    }
    if (!staffId) {
      const { data: staff, error: staffError } = await admin
        .from("kitchen_staff")
        .insert({
          company_id: invite.company_id,
          location_id: invite.location_id,
          telegram_user_id: null,
          chat_id: null,
          display_name: staffName,
          is_active: true,
        })
        .select("id")
        .single();
      if (staffError || !staff) {
        await rollback(null);
        return { ok: false, reason: "error" };
      }
      staffId = staff.id as string;
      createdStaffId = staffId;
    }

    const deviceToken = generateToken();
    const { error: deviceError } = await admin.from("kitchen_devices").insert({
      company_id: invite.company_id,
      staff_id: staffId,
      invite_id: invite.id,
      token_hash: hashToken(deviceToken),
      platform: platformOf(input.platform),
      device_label: cleanName(input.deviceLabel, MAX_DEVICE_LABEL),
    });
    if (deviceError) {
      await rollback(createdStaffId);
      return { ok: false, reason: "error" };
    }

    // Audit link; the redeem already succeeded, so a failure here is not fatal.
    const { error: linkError } = await admin
      .from("kitchen_invites")
      .update({ used_by_staff_id: staffId })
      .eq("id", invite.id)
      .eq("company_id", invite.company_id);
    if (linkError) console.error("[kitchen-app-identity] link failed");

    return {
      ok: true,
      deviceToken,
      staffId,
      staffName,
      companyId: invite.company_id,
      locationId: invite.location_id,
      locationName: (location.name as string) ?? "",
    };
  } catch (err) {
    logUnexpected("redeem", err);
    return { ok: false, reason: "error" };
  }
}

export async function revokeKitchenInvite(
  admin: SupabaseClient,
  inviteId: string,
  companyId?: string
): Promise<{ ok: true; revoked: boolean } | { ok: false }> {
  try {
    let query = admin
      .from("kitchen_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId)
      .is("used_at", null)
      .is("revoked_at", null);
    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) return { ok: false };
    return { ok: true, revoked: !!data };
  } catch (err) {
    logUnexpected("revoke invite", err);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface ResolvedKitchenDevice {
  device: { id: string; companyId: string; staffId: string };
  staff: {
    id: string;
    companyId: string;
    locationId: string;
    displayName: string;
    // Read but unused in v1: stays false and nothing returns money either way.
    canSeeCosts: boolean;
  };
}

/**
 * The active device + cook behind a raw device token, or null (unknown,
 * revoked, or the cook was removed). Touches last_seen_at at most once a
 * minute.
 */
export async function resolveKitchenDevice(
  admin: SupabaseClient,
  rawToken: string
): Promise<ResolvedKitchenDevice | null> {
  try {
    if (
      typeof rawToken !== "string" ||
      rawToken.length < 16 ||
      rawToken.length > MAX_RAW_TOKEN
    ) {
      return null;
    }
    const { data: device, error } = await admin
      .from("kitchen_devices")
      .select("id, company_id, staff_id, last_seen_at")
      .eq("token_hash", hashToken(rawToken))
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !device) return null;

    const { data: staff, error: staffError } = await admin
      .from("kitchen_staff")
      .select(
        "id, company_id, location_id, display_name, is_active, can_see_costs"
      )
      .eq("id", device.staff_id as string)
      .eq("company_id", device.company_id as string)
      .eq("is_active", true)
      .maybeSingle();
    if (staffError || !staff) return null;

    const lastSeen = device.last_seen_at
      ? new Date(device.last_seen_at as string).getTime()
      : 0;
    if (Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
      await admin
        .from("kitchen_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", device.id as string)
        .eq("company_id", device.company_id as string);
    }

    return {
      device: {
        id: device.id as string,
        companyId: device.company_id as string,
        staffId: device.staff_id as string,
      },
      staff: {
        id: staff.id as string,
        companyId: staff.company_id as string,
        locationId: staff.location_id as string,
        displayName: (staff.display_name as string) ?? "",
        canSeeCosts: staff.can_see_costs === true,
      },
    };
  } catch (err) {
    logUnexpected("resolve device", err);
    return null;
  }
}

/** Revokes every live device of one cook (used when the cook is removed). */
export async function revokeKitchenDevicesForStaff(
  admin: SupabaseClient,
  staffId: string,
  companyId?: string
): Promise<{ ok: true } | { ok: false }> {
  try {
    let query = admin
      .from("kitchen_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("staff_id", staffId)
      .is("revoked_at", null);
    if (companyId) query = query.eq("company_id", companyId);
    const { error } = await query;
    return error ? { ok: false } : { ok: true };
  } catch (err) {
    logUnexpected("revoke devices", err);
    return { ok: false };
  }
}

/** Revokes one device. `revoked` is false when it was missing or already revoked. */
export async function revokeKitchenDevice(
  admin: SupabaseClient,
  deviceId: string,
  companyId: string
): Promise<{ ok: true; revoked: boolean } | { ok: false }> {
  try {
    const { data, error } = await admin
      .from("kitchen_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", deviceId)
      .eq("company_id", companyId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false };
    return { ok: true, revoked: !!data };
  } catch (err) {
    logUnexpected("revoke device", err);
    return { ok: false };
  }
}
