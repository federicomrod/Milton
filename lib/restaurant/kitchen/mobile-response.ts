// lib/restaurant/kitchen/mobile-response.ts
//
// JSON responses of /api/mobile/v1 (mobile P0b, #430): always no-store, and
// every kitchen (cook-facing) response goes through the no-money guard.

import { NextResponse } from "next/server";
import { assertNoMoneyFields } from "@/lib/restaurant/kitchen/kitchen-serializer";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mobileJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * Cook-facing JSON. If a money-looking key or value ever slips through the
 * serializers, nothing is sent: the cook gets a plain 500 and the log says
 * only that the guard tripped.
 */
export function kitchenJson(body: unknown, status = 200): NextResponse {
  try {
    assertNoMoneyFields(body);
  } catch {
    console.error("[mobile-kitchen] money guard tripped");
    return mobileJson({ error: "No pude responder ahora." }, 500);
  }
  return mobileJson(body, status);
}
