// app/api/mobile/v1/kitchen/redeem/route.ts
//
// POST (no auth; the invite secret is the credential): a cook redeems a
// personal invite and gets a device token, returned exactly once. The cook
// becomes a kitchen_staff row without Telegram ids; never a company member,
// never a Supabase user.

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redeemKitchenInvite } from "@/lib/restaurant/kitchen/app-identity";
import { serializeKitchenRedeem } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";
import {
  clientIp,
  isRedeemRateLimited,
} from "@/lib/restaurant/kitchen/redeem-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REASON_RESPONSE = {
  invalid: { status: 404, error: "Esta invitación no es válida." },
  used: { status: 409, error: "Esta invitación ya se usó." },
  revoked: { status: 410, error: "Esta invitación ya no está activa." },
  expired: { status: 410, error: "Esta invitación venció." },
  error: { status: 500, error: "No pude abrir tu cuenta. Inténtalo otra vez." },
} as const;

export async function POST(request: NextRequest) {
  if (isRedeemRateLimited(clientIp(request))) {
    return kitchenJson(
      { error: "Demasiados intentos. Espera un minuto." },
      429
    );
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return kitchenJson({ error: "El mensaje no es válido." }, 400);
  }
  if (typeof body.secret !== "string" || !body.secret.trim()) {
    return kitchenJson({ error: "Falta la invitación." }, 400);
  }

  try {
    const result = await redeemKitchenInvite(createAdminClient(), {
      secret: body.secret,
      name: typeof body.name === "string" ? body.name : null,
      platform: typeof body.platform === "string" ? body.platform : null,
      deviceLabel:
        typeof body.deviceLabel === "string" ? body.deviceLabel : null,
    });
    if (!result.ok) {
      const r = REASON_RESPONSE[result.reason];
      return kitchenJson({ error: r.error }, r.status);
    }
    return kitchenJson(
      serializeKitchenRedeem({
        deviceToken: result.deviceToken,
        staffId: result.staffId,
        staffName: result.staffName,
        locationId: result.locationId,
        locationName: result.locationName,
      }),
      201
    );
  } catch (err) {
    console.error(
      "[mobile-redeem] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: REASON_RESPONSE.error.error }, 500);
  }
}
