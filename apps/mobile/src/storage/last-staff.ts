// Who used this phone last (not secret). Two jobs: after a confirmed revoke the
// outbox is kept for the SAME cook (staff id), and the PIN screen starts with
// the kitchen code and name filled in.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "milton.lastStaff.v1";

export interface LastStaff {
  /** Cleared by «Cerrar sesión»; kept across a revoke. */
  staffId: string | null;
  name: string;
  kitchenCode: string | null;
}

export async function getLastStaff(): Promise<LastStaff | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastStaff>;
    return {
      staffId: typeof p.staffId === "string" ? p.staffId : null,
      name: typeof p.name === "string" ? p.name : "",
      kitchenCode: typeof p.kitchenCode === "string" ? p.kitchenCode : null,
    };
  } catch {
    return null;
  }
}

export async function setLastStaff(value: LastStaff): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Prefill is a convenience only.
  }
}

/** Explicit sign-out: forget the cook's id (the outbox goes too), keep the prefill. */
export async function forgetStaffId(): Promise<void> {
  const last = await getLastStaff();
  if (last) await setLastStaff({ ...last, staffId: null });
}
