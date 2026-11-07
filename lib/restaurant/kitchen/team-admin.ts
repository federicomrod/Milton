// lib/restaurant/kitchen/team-admin.ts
//
// What an owner, admin or manager does with the kitchen team (web and mobile
// share this): list the cooks, reset a PIN, send a new link to an existing
// cook, sign a phone out. Service role, always company-scoped; the caller has
// already checked the capability. Nothing returned contains a pin_hash, a token
// or money.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createKitchenInvite,
  revokeKitchenDevice,
  revokeKitchenDevicesForStaff,
} from "./app-identity";
import { generateTemporaryPin } from "./pin";
import { clearKitchenPin, setKitchenPin } from "./pin-store";

export interface TeamDevice {
  id: string;
  label: string | null;
  platform: string | null;
  lastSeenAt: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  locationId: string;
  hasPin: boolean;
  pinMustChange: boolean;
  isSelf: boolean;
  devices: TeamDevice[];
}

export async function listKitchenTeam(
  admin: SupabaseClient,
  companyId: string
): Promise<TeamMember[] | null> {
  try {
    const [staff, devices, pins] = await Promise.all([
      admin
        .from("kitchen_staff")
        .select("id, display_name, location_id, user_id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("joined_at", { ascending: false })
        .limit(500),
      admin
        .from("kitchen_devices")
        .select("id, staff_id, device_label, platform, last_seen_at")
        .eq("company_id", companyId)
        .is("revoked_at", null)
        .limit(2000),
      admin
        .from("kitchen_staff_pins")
        .select("staff_id, must_change")
        .eq("company_id", companyId)
        .limit(2000),
    ]);
    if (staff.error || devices.error || pins.error) return null;
    const pinOf = new Map(
      (pins.data ?? []).map((p) => [
        p.staff_id as string,
        p.must_change === true,
      ])
    );
    return (staff.data ?? []).map((s) => ({
      id: s.id as string,
      name: (s.display_name as string) ?? "",
      locationId: s.location_id as string,
      hasPin: pinOf.has(s.id as string),
      pinMustChange: pinOf.get(s.id as string) === true,
      isSelf: s.user_id != null,
      devices: (devices.data ?? [])
        .filter((d) => d.staff_id === s.id)
        .map((d) => ({
          id: d.id as string,
          label: (d.device_label as string | null) ?? null,
          platform: (d.platform as string | null) ?? null,
          lastSeenAt: (d.last_seen_at as string | null) ?? null,
        })),
    }));
  } catch {
    return null;
  }
}

async function activeStaff(
  admin: SupabaseClient,
  companyId: string,
  staffId: string
) {
  const { data } = await admin
    .from("kitchen_staff")
    .select("id, location_id, display_name")
    .eq("id", staffId)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();
  return data as {
    id: string;
    location_id: string;
    display_name: string;
  } | null;
}

export type ResetPinResult =
  | { ok: true; temporaryPin: string | null }
  | { ok: false; reason: "not_found" | "error" };

/**
 * `temporary`: a new 6-digit PIN the cook must change at the next login (shown
 * once to the manager, stored hashed). `clear`: no PIN until the cook sets one.
 * Phones already signed in stay signed in.
 */
export async function resetKitchenPin(
  admin: SupabaseClient,
  input: {
    companyId: string;
    staffId: string;
    actorUserId: string;
    mode: "temporary" | "clear";
  }
): Promise<ResetPinResult> {
  try {
    const staff = await activeStaff(admin, input.companyId, input.staffId);
    if (!staff) return { ok: false, reason: "not_found" };
    if (input.mode === "clear") {
      const ok = await clearKitchenPin(admin, input.companyId, input.staffId);
      return ok
        ? { ok: true, temporaryPin: null }
        : { ok: false, reason: "error" };
    }
    const pin = generateTemporaryPin();
    const ok = await setKitchenPin(admin, {
      companyId: input.companyId,
      staffId: input.staffId,
      pin,
      mustChange: true,
      setBy: input.actorUserId,
    });
    return ok
      ? { ok: true, temporaryPin: pin }
      : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export type NewLinkResult =
  | { ok: true; inviteId: string; secret: string; expiresAt: string }
  | { ok: false; reason: "not_found" | "error" };

/** A single-use link for an EXISTING cook: it signs the same kitchen_staff row in on a new phone. */
export async function newLinkForStaff(
  admin: SupabaseClient,
  input: { companyId: string; staffId: string; actorUserId: string }
): Promise<NewLinkResult> {
  const staff = await activeStaff(admin, input.companyId, input.staffId);
  if (!staff) return { ok: false, reason: "not_found" };
  const created = await createKitchenInvite(admin, {
    companyId: input.companyId,
    locationId: staff.location_id,
    createdBy: input.actorUserId,
    inviteeName: staff.display_name,
    targetStaffId: staff.id,
  });
  if (!created.ok) return { ok: false, reason: "error" };
  return {
    ok: true,
    inviteId: created.inviteId,
    secret: created.secret,
    expiresAt: created.expiresAt,
  };
}

/** «Cerrar sesión en este teléfono» (one device) or on every phone of the cook. */
export async function signOutKitchenPhones(
  admin: SupabaseClient,
  input: { companyId: string; staffId: string; deviceId?: string | null }
): Promise<{ ok: boolean; revoked: boolean }> {
  const staff = await activeStaff(admin, input.companyId, input.staffId);
  if (!staff) return { ok: false, revoked: false };
  if (input.deviceId) {
    const { data: dev } = await admin
      .from("kitchen_devices")
      .select("id")
      .eq("id", input.deviceId)
      .eq("staff_id", input.staffId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (!dev) return { ok: false, revoked: false };
    const r = await revokeKitchenDevice(admin, input.deviceId, input.companyId);
    return { ok: r.ok, revoked: r.ok && r.revoked };
  }
  const r = await revokeKitchenDevicesForStaff(
    admin,
    input.staffId,
    input.companyId
  );
  return { ok: r.ok, revoked: r.ok };
}
