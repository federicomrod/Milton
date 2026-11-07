// app/api/mobile/v1/push/preferences/route.ts
//
// GET ?token=: this phone's notification choices (the defaults if it is not
// registered yet). PUT {token, ...choices}: change them. Own rows only.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";
import { parsePrefsPatch, parseToken } from "@/lib/restaurant/push/prefs-input";
import { DEFAULT_PREFS, validExpoToken } from "@/lib/restaurant/push/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLUMNS =
  "timezone, daily_enabled, critical_enabled, daily_hour, quiet_start, quiet_end";

interface Row {
  timezone: string;
  daily_enabled: boolean;
  critical_enabled: boolean;
  daily_hour: number;
  quiet_start: number;
  quiet_end: number;
}

const shape = (r: Row | null) =>
  r
    ? {
        registered: true,
        timezone: r.timezone,
        dailyEnabled: r.daily_enabled,
        criticalEnabled: r.critical_enabled,
        dailyHour: r.daily_hour,
        quietStart: r.quiet_start,
        quietEnd: r.quiet_end,
      }
    : { registered: false, ...DEFAULT_PREFS };

export async function GET(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const d = getDictionary(auth.lang).kitchen.api;
  const token = new URL(request.url).searchParams.get("token");
  if (!validExpoToken(token)) return mobileJson(shape(null));
  const { data, error } = await auth.supabase
    .from("push_devices")
    .select(COLUMNS)
    .eq("expo_token", token)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) return mobileJson({ error: d.managerLoadFailed }, 500);
  return mobileJson(shape((data as Row | null) ?? null));
}

export async function PUT(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const d = getDictionary(auth.lang).kitchen.api;
  let b: Record<string, unknown> = {};
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    // Falls through to the invalid answer.
  }
  const token = parseToken(b ?? {});
  const patch = parsePrefsPatch(b ?? {});
  if (!token || !patch || Object.keys(patch).length === 0) {
    return mobileJson({ error: d.managerPushInvalid }, 400);
  }
  const { data, error } = await auth.supabase
    .from("push_devices")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("expo_token", token)
    .eq("user_id", auth.userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return mobileJson({ error: d.managerLoadFailed }, 500);
  if (!data) return mobileJson({ error: d.managerPushInvalid }, 404);
  return mobileJson(shape(data as Row));
}
