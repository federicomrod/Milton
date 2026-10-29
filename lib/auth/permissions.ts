// lib/auth/permissions.ts
//
// ONE place that answers "may this person do this?" for the restaurant app.
//
//   const actor = await resolveActor(supabase, userId, { companyId });
//   const denied = requireCapability(actor, "recipes.edit");
//   if (denied) return denied;
//
// Rules, in one table (CAPABILITIES in capabilities.ts). The role is read
// with the ADMIN client by (company_id, user_id), so RLS cannot hide the row,
// and it is compared trimmed + lowercased ("Owner" and " owner " are owner).
// Milton staff (is_milton_admin) pass every capability except the ones
// marked in STAFF_EXCLUDED. The "staff must record how the client confirmed"
// rule is NOT here: it stays in recipe-costing/approval.ts.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  CAPABILITY_MESSAGES,
  DEFAULT_FORBIDDEN_MESSAGE,
  can,
  denialReason,
  normalizeRole,
  type Actor,
  type Capability,
} from "./capabilities";

export * from "./capabilities";

/**
 * The person + the company + their role in THAT company.
 *
 * - With `opts.companyId` (a resource's company: a draft, a dish, an
 *   ingredient) the role is the membership in exactly that company; no
 *   membership means role null (Milton staff still pass).
 * - Without it the company is the user's own (`resolveCompanyIdForUser`,
 *   which needs the user's client).
 */
export async function resolveActor(
  supabase: SupabaseClient | null,
  userId: string,
  opts?: { companyId?: string | null; isMiltonStaff?: boolean }
): Promise<Actor> {
  const companyId =
    opts?.companyId ??
    (supabase ? await resolveCompanyIdForUser(supabase, userId) : null);
  const [isMiltonStaff, role] = await Promise.all([
    opts?.isMiltonStaff ?? isUserAdminServer(userId),
    companyId ? loadCompanyRole(companyId, userId) : Promise.resolve(null),
  ]);
  return { userId, companyId, role, isMiltonStaff };
}

/** The membership role (normalized) in ONE company, read with the admin client. */
export async function loadCompanyRole(
  companyId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("company_memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeRole(data?.role);
}

export function forbiddenResponse(
  message: string = DEFAULT_FORBIDDEN_MESSAGE,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status: 403 });
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Inicia sesión de nuevo." },
    { status: 401 }
  );
}

/**
 * null when allowed; otherwise the Spanish 403. `message` overrides the
 * capability's default (an endpoint that already says something more
 * specific keeps saying it).
 */
export function requireCapability(
  actor: Actor,
  capability: Capability,
  opts?: { message?: string; extra?: Record<string, unknown> }
): NextResponse | null {
  if (can(actor, capability)) return null;
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[permissions] ${capability} denied: ${denialReason(actor)}`);
  }
  return forbiddenResponse(
    opts?.message ?? CAPABILITY_MESSAGES[capability],
    opts?.extra
  );
}

/**
 * Milton-staff-only endpoints (app/api/admin/*, management/*). null when the
 * signed-in user is Milton staff; otherwise the Spanish 403.
 */
export async function requireMiltonStaff(
  userId?: string
): Promise<NextResponse | null> {
  if (await isUserAdminServer(userId)) return null;
  if (process.env.NODE_ENV !== "production") {
    console.warn("[permissions] milton staff only: denied");
  }
  return forbiddenResponse(DEFAULT_FORBIDDEN_MESSAGE);
}
