// lib/restaurant/push/dispatch.ts
//
// One notification to one manager: applies the policy (choices, quiet hours,
// daily cap), records it in push_sends FIRST (the unique dedupe_key is the real
// duplicate guard, even with two runs at once), then sends. Nothing calls this
// on a schedule yet: scheduling is a hosted step that needs approval.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushMessage } from "@/lib/restaurant/push/copy";
import {
  DEFAULT_PREFS,
  decide,
  localParts,
  type PushCategory,
  type PushPrefs,
} from "@/lib/restaurant/push/policy";
import {
  isDeadToken,
  isPushEnabled,
  sendExpoPush,
  type ExpoMessage,
} from "@/lib/restaurant/push/sender";

export interface DeviceRow {
  id: string;
  expo_token: string;
  timezone: string;
  daily_enabled: boolean;
  critical_enabled: boolean;
  daily_hour: number;
  quiet_start: number;
  quiet_end: number;
  updated_at: string;
}

export function prefsOf(d: DeviceRow | undefined): PushPrefs {
  if (!d) return DEFAULT_PREFS;
  return {
    timezone: d.timezone,
    dailyEnabled: d.daily_enabled,
    criticalEnabled: d.critical_enabled,
    dailyHour: d.daily_hour,
    quietStart: d.quiet_start,
    quietEnd: d.quiet_end,
  };
}

export type DispatchOutcome =
  | { sent: number }
  | {
      skipped:
        | "off"
        | "no_device"
        | "disabled"
        | "quiet"
        | "not_time"
        | "cap"
        | "duplicate"
        | "failed";
    };

export async function dispatchPush(args: {
  admin: SupabaseClient;
  companyId: string;
  userId: string;
  category: PushCategory;
  kind: string;
  dedupeKey: string;
  message: PushMessage;
  now?: Date;
  fetchImpl?: typeof fetch;
  enabled?: boolean;
}): Promise<DispatchOutcome> {
  const { admin, companyId, userId } = args;
  if (!(args.enabled ?? isPushEnabled())) return { skipped: "off" };
  const now = args.now ?? new Date();

  const { data: rows } = await admin
    .from("push_devices")
    .select(
      "id, expo_token, timezone, daily_enabled, critical_enabled, daily_hour, quiet_start, quiet_end, updated_at"
    )
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .is("disabled_at", null);
  const devices = ((rows ?? []) as DeviceRow[]).sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
  if (devices.length === 0) return { skipped: "no_device" };
  const prefs = prefsOf(devices[0]);

  const since = new Date(now.getTime() - 36 * 3_600_000).toISOString();
  const { data: recent } = await admin
    .from("push_sends")
    .select("created_at")
    .eq("user_id", userId)
    .in("status", ["pending", "sent"])
    .gte("created_at", since);
  const today = localParts(now, prefs.timezone).date;
  const sentToday = ((recent ?? []) as { created_at: string }[]).filter(
    (r) => localParts(new Date(r.created_at), prefs.timezone).date === today
  ).length;

  const decision = decide({
    category: args.category,
    now,
    prefs,
    sentToday,
    duplicate: false,
  });
  if (!decision.send) return { skipped: decision.why };

  // The unique key is the guard: a second run with the same key stops here.
  const { data: logged, error } = await admin
    .from("push_sends")
    .insert({
      company_id: companyId,
      user_id: userId,
      category: args.category,
      kind: args.kind,
      dedupe_key: args.dedupeKey,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !logged) {
    return { skipped: error?.code === "23505" ? "duplicate" : "failed" };
  }
  const sendId = (logged as { id: string }).id;

  const messages: ExpoMessage[] = devices.map((d) => ({
    to: d.expo_token,
    title: args.message.title,
    body: args.message.body,
    data: args.message.data,
    sound: "default",
    priority: args.category === "critical" ? "high" : "default",
  }));
  const result = await sendExpoPush(messages, { fetchImpl: args.fetchImpl });
  const delivered = result.tickets.filter((t) => t?.status === "ok").length;

  const dead = devices
    .filter((_, i) => isDeadToken(result.tickets[i]))
    .map((d) => d.id);
  if (dead.length > 0) {
    await admin
      .from("push_devices")
      .update({ disabled_at: now.toISOString() })
      .in("id", dead);
  }
  await admin
    .from("push_sends")
    .update({ status: delivered > 0 ? "sent" : "failed" })
    .eq("id", sendId);
  return delivered > 0 ? { sent: delivered } : { skipped: "failed" };
}
