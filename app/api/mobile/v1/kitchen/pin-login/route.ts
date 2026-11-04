// app/api/mobile/v1/kitchen/pin-login/route.ts
//
// POST (no auth; the kitchen code + name + PIN are the credential): a cook who
// lost the session gets a NEW device token for the same kitchen_staff row.
// Locked after 5 wrong tries per cook (20 per IP) for 15 minutes. The answer
// never says which part was wrong. The token is returned exactly once.

import { NextRequest } from "next/server";
import { getDictionary } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  kitchenJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";
import { serializeKitchenRedeem } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { clientIp } from "@/lib/restaurant/kitchen/redeem-limit";
import { isValidPin } from "@/lib/restaurant/kitchen/pin";
import { pinLogin } from "@/lib/restaurant/kitchen/pin-login";
import { ensureKitchenCode } from "@/lib/restaurant/kitchen/pin-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return kitchenJson({ error: d.kitchen.api.messageInvalid }, 400);
  }
  // A malformed request is the same plain failure as a wrong PIN.
  const code = typeof body.code === "string" ? body.code.slice(0, 64) : "";
  const name = typeof body.name === "string" ? body.name.slice(0, 128) : "";
  if (!code.trim() || !name.trim() || !isValidPin(body.pin)) {
    return kitchenJson(
      { error: d.kitchen.api.pinLoginFailed, reason: "failed" },
      401
    );
  }

  try {
    const admin = createAdminClient();
    const result = await pinLogin(admin, {
      code,
      name,
      pin: body.pin,
      ip: clientIp(request),
      platform: typeof body.platform === "string" ? body.platform : null,
      deviceLabel:
        typeof body.deviceLabel === "string" ? body.deviceLabel : null,
    });
    if (!result.ok) {
      if (result.reason === "locked") {
        const res = kitchenJson(
          {
            error: d.kitchen.api.pinLocked,
            reason: "locked",
            retryAfterSeconds: result.retryAfterSeconds ?? 900,
          },
          429
        );
        res.headers.set("Retry-After", String(result.retryAfterSeconds ?? 900));
        return res;
      }
      if (result.reason === "error") {
        return kitchenJson({ error: d.kitchen.api.redeemFailed }, 500);
      }
      return kitchenJson(
        { error: d.kitchen.api.pinLoginFailed, reason: "failed" },
        401
      );
    }
    let language: unknown = null;
    try {
      const company = await admin
        .from("companies")
        .select("preferred_language")
        .eq("id", result.companyId)
        .maybeSingle();
      language = (company.data as { preferred_language?: unknown } | null)
        ?.preferred_language;
    } catch {
      language = null;
    }
    const kitchenCode = await ensureKitchenCode(admin, result.companyId);
    return kitchenJson(
      serializeKitchenRedeem({
        pin: { set: true, mustChange: result.mustChangePin },
        kitchenCode,
        language,
        deviceToken: result.deviceToken,
        staffId: result.staffId,
        staffName: result.staffName,
        locationId: result.locationId,
        locationName: result.locationName,
      }),
      200
    );
  } catch (err) {
    console.error(
      "[mobile-pin-login] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: d.kitchen.api.redeemFailed }, 500);
  }
}
