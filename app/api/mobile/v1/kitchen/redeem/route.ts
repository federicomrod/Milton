// app/api/mobile/v1/kitchen/redeem/route.ts
//
// POST (no auth; the invite secret is the credential): a cook redeems a
// personal invite and gets a device token, returned exactly once. The cook
// becomes a kitchen_staff row without Telegram ids; never a company member,
// never a Supabase user.

import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
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

const REASON_STATUS = {
  invalid: 404,
  used: 409,
  revoked: 410,
  expired: 410,
  error: 500,
} as const;

const REASON_KEY = {
  invalid: "redeemInvalid",
  used: "redeemUsed",
  revoked: "redeemRevoked",
  expired: "redeemExpired",
  error: "redeemFailed",
} as const;

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  if (isRedeemRateLimited(clientIp(request))) {
    return kitchenJson({ error: d.kitchen.api.tooManyAttempts }, 429);
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return kitchenJson({ error: d.kitchen.api.messageInvalid }, 400);
  }
  if (typeof body.secret !== "string" || !body.secret.trim()) {
    return kitchenJson({ error: d.kitchen.api.inviteMissing }, 400);
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
      return kitchenJson(
        {
          error: d.kitchen.api[REASON_KEY[result.reason]],
          reason: result.reason,
        },
        REASON_STATUS[result.reason]
      );
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
    return kitchenJson({ error: d.kitchen.api.redeemFailed }, 500);
  }
}
