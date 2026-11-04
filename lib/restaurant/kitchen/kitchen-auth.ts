// lib/restaurant/kitchen/kitchen-auth.ts
//
// Auth for the cook-facing kitchen API (mobile P0b, #430). The app sends the
// device token it got at redeem as `Authorization: Bearer <token>`. The token
// is resolved to an active device + cook (resolveKitchenDevice), so a revoked
// device, or a cook removed on the web, gets 401 on the very next request.
//
// The returned client is the SERVICE ROLE client (cooks have no Supabase
// user): every query made with it MUST be filtered by the cook's company_id
// and location (staff.locationId / locationIds) explicitly.
//
// SECURITY: never logs the token, its hash or the Authorization header.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readBearerToken } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupKitchenDevice } from "@/lib/restaurant/kitchen/app-identity";
import { getDictionary } from "@/lib/i18n";
import {
  mobileJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";

export interface KitchenAuthOk {
  ok: true;
  admin: SupabaseClient;
  staff: {
    id: string;
    displayName: string;
    companyId: string;
    locationId: string;
    canSeeCosts: boolean;
  };
  deviceId: string;
  companyId: string;
  /** The restaurants this cook may touch (one per cook today). */
  locationIds: string[];
}

export type KitchenAuthResult =
  | KitchenAuthOk
  | { ok: false; response: NextResponse };

// A 401 carries the reason. The app signs the cook out ONLY for «revoked» or
// «unknown_device» (after one retry); anything else (a missing token, a proxy,
// a 5xx, a timeout) keeps the session.
function unauthorized(
  request: Request,
  reason: "revoked" | "unknown_device" = "unknown_device"
): {
  ok: false;
  response: NextResponse;
} {
  return {
    ok: false,
    response: mobileJson(
      {
        error: getDictionary(mobileLanguage(request)).kitchen.api.signInAgain,
        reason,
      },
      401
    ),
  };
}

export async function authKitchenDevice(
  request: Request
): Promise<KitchenAuthResult> {
  const token = readBearerToken(request);
  if (!token) return unauthorized(request);
  try {
    const admin = createAdminClient();
    const found = await lookupKitchenDevice(admin, token);
    if (!found.ok) {
      if (found.reason === "unavailable") {
        return {
          ok: false,
          response: mobileJson(
            {
              error: getDictionary(mobileLanguage(request)).kitchen.api
                .sessionCheckFailed,
              reason: "unavailable",
            },
            503
          ),
        };
      }
      return unauthorized(request, found.reason);
    }
    const resolved = found.resolved;
    return {
      ok: true,
      admin,
      staff: {
        id: resolved.staff.id,
        displayName: resolved.staff.displayName,
        companyId: resolved.staff.companyId,
        locationId: resolved.staff.locationId,
        canSeeCosts: resolved.staff.canSeeCosts,
      },
      deviceId: resolved.device.id,
      companyId: resolved.staff.companyId,
      locationIds: [resolved.staff.locationId],
    };
  } catch (err) {
    console.error(
      "[kitchen-auth] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return {
      ok: false,
      response: mobileJson(
        {
          error: getDictionary(mobileLanguage(request)).kitchen.api
            .sessionCheckFailed,
        },
        500
      ),
    };
  }
}
