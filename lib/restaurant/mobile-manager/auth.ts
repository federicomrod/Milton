// lib/restaurant/mobile-manager/auth.ts
//
// Auth for the manager side of the Cocina/Milton app (mobile P1, #432). The
// phone sends the manager's Supabase access token as a bearer; the client it
// builds carries that token, so RLS applies exactly as on the web.
//
// A KITCHEN DEVICE TOKEN is not a Supabase JWT: getUser() rejects it, so every
// route here answers 401 to a cook's phone. On top of that every money route is
// role-gated on the server with the same capability the web page uses, and the
// company and restaurant come from the verified membership, never from the
// request body.
//
// SECURITY: never logs the token, the password or the Authorization header.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authAndCompanyFromBearer } from "@/lib/restaurant/api-auth";
import {
  can,
  resolveActor,
  type Actor,
  type Capability,
} from "@/lib/auth/permissions";
import { getDictionary } from "@/lib/i18n";
import {
  mobileJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  resolveRestaurantContext,
  type RestaurantLocationOption,
} from "@/lib/restaurant/restaurant-context-server";

/**
 * What «Gestión» needs: the money screens are for the roles that may see
 * Costos fijos (owner, admin, manager). Writes ask for their own capability.
 */
export const MANAGER_READ_CAPABILITY: Capability = "costs.fixed";

export interface ManagerAuth {
  ok: true;
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  email: string | null;
  actor: Actor;
  lang: PreferredLanguage;
  /** Every restaurant of the company. */
  locations: RestaurantLocationOption[];
  /** The restaurant asked for (`?location=`), only if it is the company's. */
  locationId: string | null;
  /** The restaurant to use when one is needed: the asked one, else the only one. */
  singleLocationId: string | null;
}

export type ManagerAuthResult =
  | ManagerAuth
  | { ok: false; response: NextResponse };

export async function authManager(
  request: Request,
  capability: Capability = MANAGER_READ_CAPABILITY
): Promise<ManagerAuthResult> {
  const lang = mobileLanguage(request);
  const d = getDictionary(lang).kitchen.api;
  const auth = await authAndCompanyFromBearer(request);
  if (!auth.ok) return auth;
  const { supabase, companyId, userId, email } = auth;
  try {
    const actor = await resolveActor(supabase, userId, { companyId });
    if (!can(actor, capability)) {
      return {
        ok: false,
        response: mobileJson({ error: d.managerNoAccess }, 403),
      };
    }
    const requested = new URL(request.url).searchParams.get("location");
    const context = await resolveRestaurantContext(
      supabase,
      companyId,
      requested
    );
    const locationId = context.selected?.locationId ?? null;
    return {
      ok: true,
      supabase,
      companyId,
      userId,
      email,
      actor,
      lang,
      locations: context.locations,
      locationId,
      singleLocationId:
        locationId ??
        (context.locations.length === 1 ? context.locations[0].id : null),
    };
  } catch (err) {
    console.error(
      "[mobile-manager] auth failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return {
      ok: false,
      response: mobileJson({ error: d.managerLoadFailed }, 500),
    };
  }
}

export function managerError(
  request: Request,
  key: keyof ReturnType<typeof apiMessages>,
  status: number
): NextResponse {
  return mobileJson({ error: apiMessages(request)[key] }, status);
}

function apiMessages(request: Request) {
  return getDictionary(mobileLanguage(request)).kitchen.api;
}
