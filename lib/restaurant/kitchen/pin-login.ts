// lib/restaurant/kitchen/pin-login.ts
//
// Getting back in without the original invite link: the company's kitchen code
// + the cook's name + their PIN gives a NEW device token for the same
// kitchen_staff row (history kept). The answer never says which part was wrong:
// an unknown code, an unknown name, a cook without a PIN and a wrong PIN all
// read the same, take about the same time, and count toward the same lock.

import type { SupabaseClient } from "@supabase/supabase-js";
import { issueKitchenDevice } from "./app-identity";
import { burnPinTime, normalizeKitchenCode, normalizeStaffName } from "./pin";
import { checkKitchenPin } from "./pin-store";
import {
  clearFailures,
  lockedSeconds,
  recordFailure,
  subjectOf,
} from "./pin-limit";

export type PinLoginResult =
  | {
      ok: true;
      deviceToken: string;
      staffId: string;
      staffName: string;
      companyId: string;
      locationId: string;
      locationName: string;
      mustChangePin: boolean;
    }
  | {
      ok: false;
      reason: "failed" | "locked" | "error";
      retryAfterSeconds?: number;
    };

export async function pinLogin(
  admin: SupabaseClient,
  input: {
    code: string;
    name: string;
    pin: string;
    ip: string;
    platform?: string | null;
    deviceLabel?: string | null;
  }
): Promise<PinLoginResult> {
  try {
    const code = normalizeKitchenCode(input.code);
    const nameKey = normalizeStaffName(input.name);
    const staffBucket = {
      kind: "staff" as const,
      subject: subjectOf("staff", `${code}|${nameKey}`),
    };
    const ipBucket = {
      kind: "ip" as const,
      subject: subjectOf("ip", input.ip),
    };

    const locked = await lockedSeconds(admin, [staffBucket, ipBucket]);
    if (locked > 0)
      return { ok: false, reason: "locked", retryAfterSeconds: locked };

    const fail = async (companyId: string | null): Promise<PinLoginResult> => {
      await recordFailure(admin, { ...staffBucket, companyId });
      await recordFailure(admin, { ...ipBucket, companyId: null });
      return { ok: false, reason: "failed" };
    };

    if (!code || !nameKey) {
      burnPinTime(input.pin);
      return fail(null);
    }
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id")
      .eq("kitchen_code", code)
      .maybeSingle();
    if (companyError) return { ok: false, reason: "error" };
    if (!company) {
      burnPinTime(input.pin);
      return fail(null);
    }
    const companyId = company.id as string;

    const { data: staffRows, error: staffError } = await admin
      .from("kitchen_staff")
      .select("id, location_id, display_name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .limit(500);
    if (staffError) return { ok: false, reason: "error" };
    const candidates = (staffRows ?? []).filter(
      (s) => normalizeStaffName((s.display_name as string) ?? "") === nameKey
    );
    if (candidates.length === 0) {
      burnPinTime(input.pin);
      return fail(companyId);
    }

    let matched: {
      id: string;
      locationId: string;
      name: string;
      mustChange: boolean;
    } | null = null;
    for (const c of candidates) {
      const check = await checkKitchenPin(
        admin,
        companyId,
        c.id as string,
        input.pin
      );
      if (check.match) {
        matched = {
          id: c.id as string,
          locationId: c.location_id as string,
          name: (c.display_name as string) ?? "",
          mustChange: check.mustChange,
        };
        break;
      }
    }
    if (!matched) return fail(companyId);

    const { data: location } = await admin
      .from("restaurant_locations")
      .select("name")
      .eq("id", matched.locationId)
      .eq("company_id", companyId)
      .maybeSingle();
    const issued = await issueKitchenDevice(admin, {
      companyId,
      staffId: matched.id,
      platform: input.platform,
      deviceLabel: input.deviceLabel,
    });
    if (!issued.ok) return { ok: false, reason: "error" };
    await clearFailures(admin, "staff", staffBucket.subject);
    return {
      ok: true,
      deviceToken: issued.deviceToken,
      staffId: matched.id,
      staffName: matched.name,
      companyId,
      locationId: matched.locationId,
      locationName: (location?.name as string) ?? "",
      mustChangePin: matched.mustChange,
    };
  } catch (err) {
    console.error(
      "[kitchen-pin-login] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, reason: "error" };
  }
}
