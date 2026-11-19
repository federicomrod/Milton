// app/api/mobile/v1/push/register/route.ts
//
// PUT {token, platform, timezone, ...choices}: this phone's Expo push token for
// the signed-in manager. DELETE {token}: stop notifications on this phone (sign
// out, or the person turned them off). Own rows only (RLS); the one use of the
// service role is to take a token away from a previous user of the same phone.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePrefsPatch, parseToken } from "@/lib/restaurant/push/prefs-input";
import { validTimezone } from "@/lib/restaurant/push/policy";
import { isPushEnabled } from "@/lib/restaurant/push/sender";
import { isTableMissing } from "@/lib/restaurant/push/table-missing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = (await request.json()) as unknown;
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const d = getDictionary(auth.lang).kitchen.api;
  const b = await body(request);
  const token = parseToken(b);
  const patch = parsePrefsPatch(b);
  const platform =
    b.platform === "android" ? "android" : b.platform === "ios" ? "ios" : null;
  if (!token || !patch || !platform || !validTimezone(b.timezone)) {
    return mobileJson({ error: d.managerPushInvalid }, 400);
  }
  // Push is OFF or the table doesn't exist yet: acknowledge without error.
  // Already-shipped builds with EXPO_PUBLIC_PUSH_ENABLED=1 will call this,
  // but we don't show an error when the backend feature is not enabled yet.
  if (!isPushEnabled()) {
    return mobileJson({ registered: false });
  }
  try {
    // The same phone, a different person signed in before: that token is now ours.
    await createAdminClient()
      .from("push_devices")
      .delete()
      .eq("expo_token", token)
      .neq("user_id", auth.userId);
    const { error } = await auth.supabase.from("push_devices").upsert(
      {
        company_id: auth.companyId,
        user_id: auth.userId,
        expo_token: token,
        platform,
        language: auth.lang,
        ...patch,
        disabled_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "expo_token" }
    );
    if (error) throw error;
    return mobileJson({ registered: true });
  } catch (err) {
    // PostgREST PGRST205 or Postgres 42P01 = table doesn't exist. Don't show
    // an error to the user when the migration hasn't been applied yet.
    if (isTableMissing(err)) {
      console.warn(
        "[mobile-push] register: table not found (migration not applied)"
      );
      return mobileJson({ registered: false });
    }
    console.error("[mobile-push] register failed:", err);
    return mobileJson({ error: d.managerLoadFailed }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const d = getDictionary(auth.lang).kitchen.api;
  const token = parseToken(await body(request));
  if (!token) return mobileJson({ error: d.managerPushInvalid }, 400);
  // Push OFF or table missing: acknowledge without error.
  if (!isPushEnabled()) {
    return mobileJson({ registered: false });
  }
  try {
    const { error } = await auth.supabase
      .from("push_devices")
      .delete()
      .eq("expo_token", token)
      .eq("user_id", auth.userId);
    if (error) throw error;
    return mobileJson({ registered: false });
  } catch (err) {
    if (isTableMissing(err)) {
      console.warn(
        "[mobile-push] unregister: table not found (migration not applied)"
      );
      return mobileJson({ registered: false });
    }
    console.error("[mobile-push] unregister failed:", err);
    return mobileJson({ error: d.managerLoadFailed }, 500);
  }
}
