"use server";

// app/dashboard/restaurant/kitchen/team-actions.ts
//
// Owner / admin / manager server actions behind the kitchen team tools in
// Configuración › Equipo: list the cooks, reset a PIN, send a new link to an
// existing cook, sign a phone out. Gate: resolveActor + "kitchen.team". The
// company always comes from the session, never the caller.
//
// SECURITY: a temporary PIN and a new link exist only in the action result
// (once). Nothing returns a pin_hash, a device token or money.

import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, resolveActor } from "@/lib/auth/permissions";
import {
  listKitchenTeam,
  newLinkForStaff,
  resetKitchenPin,
  signOutKitchenPhones,
  type TeamMember,
} from "@/lib/restaurant/kitchen/team-admin";
import { ensureKitchenCode } from "@/lib/restaurant/kitchen/pin-store";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TeamActionError = "forbidden" | "notFound" | "auth" | "error";

type Gate =
  | {
      ok: true;
      companyId: string;
      userId: string;
    }
  | { ok: false; error: TeamActionError };

async function gate(): Promise<Gate> {
  const auth = await authAndCompany();
  if (!auth.ok) return { ok: false, error: "auth" };
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  if (!can(actor, "kitchen.team")) return { ok: false, error: "forbidden" };
  return { ok: true, companyId: auth.companyId, userId: auth.userId };
}

function logFailure(scope: string, err: unknown) {
  console.error(
    `[kitchen-team] ${scope}:`,
    err instanceof Error ? err.name : "Unknown error"
  );
}

export type ListTeamResult =
  | { ok: true; kitchenCode: string | null; team: TeamMember[] }
  | { ok: false; error: TeamActionError };

export async function listKitchenTeamAction(): Promise<ListTeamResult> {
  try {
    const g = await gate();
    if (!g.ok) return g;
    const admin = createAdminClient();
    const [team, kitchenCode] = await Promise.all([
      listKitchenTeam(admin, g.companyId),
      ensureKitchenCode(admin, g.companyId),
    ]);
    if (!team) return { ok: false, error: "error" };
    return { ok: true, kitchenCode, team };
  } catch (err) {
    logFailure("list", err);
    return { ok: false, error: "error" };
  }
}

export type ResetPinActionResult =
  | { ok: true; temporaryPin: string | null }
  | { ok: false; error: TeamActionError };

export async function resetKitchenPinAction(
  staffId: string,
  mode: "temporary" | "clear"
): Promise<ResetPinActionResult> {
  try {
    const g = await gate();
    if (!g.ok) return g;
    if (typeof staffId !== "string" || !UUID_RE.test(staffId)) {
      return { ok: false, error: "notFound" };
    }
    const r = await resetKitchenPin(createAdminClient(), {
      companyId: g.companyId,
      staffId,
      actorUserId: g.userId,
      mode: mode === "clear" ? "clear" : "temporary",
    });
    if (!r.ok)
      return {
        ok: false,
        error: r.reason === "not_found" ? "notFound" : "error",
      };
    return { ok: true, temporaryPin: r.temporaryPin };
  } catch (err) {
    logFailure("reset pin", err);
    return { ok: false, error: "error" };
  }
}

export type NewLinkActionResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; error: TeamActionError };

export async function sendNewKitchenLinkAction(
  staffId: string
): Promise<NewLinkActionResult> {
  try {
    const g = await gate();
    if (!g.ok) return g;
    if (typeof staffId !== "string" || !UUID_RE.test(staffId)) {
      return { ok: false, error: "notFound" };
    }
    const r = await newLinkForStaff(createAdminClient(), {
      companyId: g.companyId,
      staffId,
      actorUserId: g.userId,
    });
    if (!r.ok)
      return {
        ok: false,
        error: r.reason === "not_found" ? "notFound" : "error",
      };
    return { ok: true, code: r.secret, expiresAt: r.expiresAt };
  } catch (err) {
    logFailure("new link", err);
    return { ok: false, error: "error" };
  }
}

export type SignOutActionResult =
  | { ok: true }
  | { ok: false; error: TeamActionError };

export async function signOutKitchenPhoneAction(
  staffId: string,
  deviceId?: string | null
): Promise<SignOutActionResult> {
  try {
    const g = await gate();
    if (!g.ok) return g;
    if (typeof staffId !== "string" || !UUID_RE.test(staffId)) {
      return { ok: false, error: "notFound" };
    }
    if (
      deviceId != null &&
      (typeof deviceId !== "string" || !UUID_RE.test(deviceId))
    ) {
      return { ok: false, error: "notFound" };
    }
    const r = await signOutKitchenPhones(createAdminClient(), {
      companyId: g.companyId,
      staffId,
      deviceId: deviceId ?? null,
    });
    return r.ok ? { ok: true } : { ok: false, error: "notFound" };
  } catch (err) {
    logFailure("sign out", err);
    return { ok: false, error: "error" };
  }
}
