"use server";

// app/dashboard/restaurant/kitchen/app-invite-actions.ts
//
// Owner-only server actions behind «App Milton Cocina»: create, list and
// revoke kitchen app invites from the web (cookie session, no bearer token).
// Same gate as the wall-QR route: resolveActor + requireCapability
// "kitchen.qr". The company always comes from the session, never the caller.
//
// SECURITY: the secret exists only in the create result (once). The list is
// read through RLS and serialized without a secret or hash. Nothing is logged
// except err.name.

import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, resolveActor } from "@/lib/auth/permissions";
import {
  createKitchenInvite,
  revokeKitchenInvite,
} from "@/lib/restaurant/kitchen/app-identity";
import { serializeKitchenInvite } from "@/lib/restaurant/kitchen/kitchen-serializer";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_LIMIT = 50;

export type InviteActionError = "forbidden" | "location" | "auth" | "error";

export interface AppInviteRow {
  id: string;
  locationId: string;
  inviteeName: string | null;
  expiresAt: string;
  status: "pending" | "used" | "revoked" | "expired";
}

export type CreateAppInviteResult =
  | { ok: true; inviteId: string; code: string; expiresAt: string }
  | { ok: false; error: InviteActionError };
export type ListAppInvitesResult =
  | { ok: true; invites: AppInviteRow[] }
  | { ok: false; error: InviteActionError };
export type RevokeAppInviteResult =
  | { ok: true }
  | { ok: false; error: InviteActionError };

type OwnerContext =
  | {
      ok: true;
      auth: Extract<Awaited<ReturnType<typeof authAndCompany>>, { ok: true }>;
    }
  | { ok: false; error: InviteActionError };

async function ownerContext(): Promise<OwnerContext> {
  const auth = await authAndCompany();
  if (!auth.ok) return { ok: false, error: "auth" };
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  if (!can(actor, "kitchen.qr")) return { ok: false, error: "forbidden" };
  return { ok: true, auth };
}

function logFailure(scope: string, err: unknown) {
  console.error(
    `[kitchen-app-invite] ${scope}:`,
    err instanceof Error ? err.name : "Unknown error"
  );
}

export async function createAppInvite(
  locationId: string,
  inviteeName?: string
): Promise<CreateAppInviteResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
      return { ok: false, error: "location" };
    }
    const created = await createKitchenInvite(createAdminClient(), {
      companyId: ctx.auth.companyId,
      locationId,
      createdBy: ctx.auth.userId,
      inviteeName: typeof inviteeName === "string" ? inviteeName : null,
    });
    if (!created.ok) {
      return {
        ok: false,
        error: created.reason === "location" ? "location" : "error",
      };
    }
    return {
      ok: true,
      inviteId: created.inviteId,
      code: created.secret,
      expiresAt: created.expiresAt,
    };
  } catch (err) {
    logFailure("create", err);
    return { ok: false, error: "error" };
  }
}

export async function listAppInvites(): Promise<ListAppInvitesResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.auth.supabase
      .from("kitchen_invites")
      .select(
        "id, location_id, invitee_name, expires_at, used_at, revoked_at, created_at"
      )
      .eq("company_id", ctx.auth.companyId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (error) return { ok: false, error: "error" };
    const now = new Date();
    const invites = (data ?? []).map((row) => {
      const s = serializeKitchenInvite(row as Record<string, unknown>, now);
      return {
        id: s.id,
        locationId: s.locationId,
        inviteeName: s.inviteeName,
        expiresAt: s.expiresAt,
        status: s.status as AppInviteRow["status"],
      };
    });
    return { ok: true, invites };
  } catch (err) {
    logFailure("list", err);
    return { ok: false, error: "error" };
  }
}

export async function revokeAppInvite(
  inviteId: string
): Promise<RevokeAppInviteResult> {
  try {
    const ctx = await ownerContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (typeof inviteId !== "string" || !UUID_RE.test(inviteId)) {
      return { ok: false, error: "error" };
    }
    const result = await revokeKitchenInvite(
      createAdminClient(),
      inviteId,
      ctx.auth.companyId
    );
    if (!result.ok) return { ok: false, error: "error" };
    return result.revoked ? { ok: true } : { ok: false, error: "error" };
  } catch (err) {
    logFailure("revoke", err);
    return { ok: false, error: "error" };
  }
}
