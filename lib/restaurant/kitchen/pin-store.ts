// lib/restaurant/kitchen/pin-store.ts
//
// PIN storage, company-scoped, service role only. The hash lives in
// kitchen_staff_pins (RLS on, no policy): nothing here, and no API, ever
// returns pin_hash. Nothing throws; callers get typed results. Logs err.name
// only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateKitchenCode, hashPin, verifyPin } from "./pin";

export interface PinStatus {
  set: boolean;
  mustChange: boolean;
}

export async function setKitchenPin(
  admin: SupabaseClient,
  input: {
    companyId: string;
    staffId: string;
    pin: string;
    mustChange: boolean;
    setBy: string | null;
  }
): Promise<boolean> {
  try {
    const { data: staff } = await admin
      .from("kitchen_staff")
      .select("id")
      .eq("id", input.staffId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (!staff) return false;
    const row = {
      company_id: input.companyId,
      pin_hash: hashPin(input.pin),
      pin_set_at: new Date().toISOString(),
      must_change: input.mustChange,
      set_by: input.setBy,
    };
    // Update first, insert when there is none (and update again if another
    // request inserted in between).
    const updated = await admin
      .from("kitchen_staff_pins")
      .update(row)
      .eq("staff_id", input.staffId)
      .eq("company_id", input.companyId)
      .select("staff_id")
      .maybeSingle();
    if (updated.error) return false;
    if (updated.data) return true;
    const inserted = await admin
      .from("kitchen_staff_pins")
      .insert({ staff_id: input.staffId, ...row });
    if (!inserted.error) return true;
    const again = await admin
      .from("kitchen_staff_pins")
      .update(row)
      .eq("staff_id", input.staffId)
      .eq("company_id", input.companyId)
      .select("staff_id")
      .maybeSingle();
    return !again.error && !!again.data;
  } catch (err) {
    console.error(
      "[kitchen-pin] set:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return false;
  }
}

/** Removes the PIN: the cook sets a new one (needs a signed-in phone or a new link). */
export async function clearKitchenPin(
  admin: SupabaseClient,
  companyId: string,
  staffId: string
): Promise<boolean> {
  try {
    const { error } = await admin
      .from("kitchen_staff_pins")
      .delete()
      .eq("staff_id", staffId)
      .eq("company_id", companyId);
    return !error;
  } catch {
    return false;
  }
}

export async function getKitchenPinStatus(
  admin: SupabaseClient,
  companyId: string,
  staffId: string
): Promise<PinStatus> {
  try {
    const { data } = await admin
      .from("kitchen_staff_pins")
      .select("must_change")
      .eq("staff_id", staffId)
      .eq("company_id", companyId)
      .maybeSingle();
    return data
      ? { set: true, mustChange: data.must_change === true }
      : { set: false, mustChange: false };
  } catch {
    return { set: false, mustChange: false };
  }
}

/** The hash is read here and compared here; it leaves this function only as a boolean. */
export async function checkKitchenPin(
  admin: SupabaseClient,
  companyId: string,
  staffId: string,
  pin: string
): Promise<{ match: boolean; mustChange: boolean }> {
  try {
    const { data } = await admin
      .from("kitchen_staff_pins")
      .select("pin_hash, must_change")
      .eq("staff_id", staffId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) return { match: false, mustChange: false };
    return {
      match: verifyPin(pin, data.pin_hash as string),
      mustChange: data.must_change === true,
    };
  } catch {
    return { match: false, mustChange: false };
  }
}

/** The company's short kitchen code, made on first use. */
export async function ensureKitchenCode(
  admin: SupabaseClient,
  companyId: string
): Promise<string | null> {
  try {
    const { data } = await admin
      .from("companies")
      .select("kitchen_code")
      .eq("id", companyId)
      .maybeSingle();
    if (!data) return null;
    if (typeof data.kitchen_code === "string" && data.kitchen_code)
      return data.kitchen_code;
    for (let i = 0; i < 5; i++) {
      const code = generateKitchenCode();
      const { data: saved, error } = await admin
        .from("companies")
        .update({ kitchen_code: code })
        .eq("id", companyId)
        .is("kitchen_code", null)
        .select("kitchen_code")
        .maybeSingle();
      if (!error && saved?.kitchen_code) return saved.kitchen_code as string;
      // Lost a race or the code was taken: read again, else try another code.
      const again = await admin
        .from("companies")
        .select("kitchen_code")
        .eq("id", companyId)
        .maybeSingle();
      if (again.data?.kitchen_code) return again.data.kitchen_code as string;
    }
    return null;
  } catch {
    return null;
  }
}
