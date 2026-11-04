// app/api/mobile/v1/kitchen/pin/route.ts
//
// POST (device token): the cook sets or changes their PIN.
//   - no PIN yet (joined before PINs, or a manager cleared it) -> `pin` is enough
//   - a temporary PIN a manager set (must change)             -> `pin` is enough
//   - otherwise `currentPin` must match (counts toward the same lock)
// The PIN is stored hashed; nothing here returns it or its hash.

import { NextRequest } from "next/server";
import { getDictionary } from "@/lib/i18n";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import {
  kitchenJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";
import { isValidPin, isWeakPin } from "@/lib/restaurant/kitchen/pin";
import {
  checkKitchenPin,
  getKitchenPinStatus,
  setKitchenPin,
} from "@/lib/restaurant/kitchen/pin-store";
import {
  clearFailures,
  lockedSeconds,
  recordFailure,
  subjectOf,
} from "@/lib/restaurant/kitchen/pin-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const { admin, staff, companyId } = auth;
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return kitchenJson({ error: d.kitchen.api.messageInvalid }, 400);
  }
  if (!isValidPin(body.pin)) {
    return kitchenJson({ error: d.kitchen.api.pinInvalid }, 400);
  }
  if (isWeakPin(body.pin)) {
    return kitchenJson({ error: d.kitchen.api.pinWeak }, 400);
  }
  try {
    const status = await getKitchenPinStatus(admin, companyId, staff.id);
    if (status.set && !status.mustChange) {
      const bucket = {
        kind: "staff" as const,
        subject: subjectOf("staff", `change|${staff.id}`),
      };
      const locked = await lockedSeconds(admin, [bucket]);
      if (locked > 0) {
        return kitchenJson(
          { error: d.kitchen.api.pinLocked, reason: "locked" },
          429
        );
      }
      const current = isValidPin(body.currentPin) ? body.currentPin : "";
      const check = current
        ? await checkKitchenPin(admin, companyId, staff.id, current)
        : { match: false, mustChange: false };
      if (!check.match) {
        await recordFailure(admin, { ...bucket, companyId });
        return kitchenJson(
          { error: d.kitchen.api.pinWrong, reason: "wrong_pin" },
          400
        );
      }
      await clearFailures(admin, "staff", bucket.subject);
    }
    const ok = await setKitchenPin(admin, {
      companyId,
      staffId: staff.id,
      pin: body.pin,
      mustChange: false,
      setBy: null,
    });
    if (!ok) return kitchenJson({ error: d.kitchen.api.pinSaveFailed }, 500);
    return kitchenJson({ pin: { set: true, mustChange: false } });
  } catch (err) {
    console.error(
      "[mobile-kitchen-pin] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: d.kitchen.api.pinSaveFailed }, 500);
  }
}
