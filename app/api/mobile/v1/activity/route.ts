// app/api/mobile/v1/activity/route.ts
//
// PUT: record that this user opened the app (last-seen ping for adoption
// metrics). Called when the app comes to foreground, throttled client-side to
// at most once every 15 minutes. RLS: own rows only.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ActivityBody {
  surface?: unknown;
  platform?: unknown;
}

async function body(request: NextRequest): Promise<ActivityBody> {
  try {
    const b = (await request.json()) as unknown;
    return b && typeof b === "object" ? (b as ActivityBody) : {};
  } catch {
    return {};
  }
}

function validSurface(s: unknown): s is "gestion" | "cocina" {
  return s === "gestion" || s === "cocina";
}

function validPlatform(p: unknown): p is "ios" | "android" {
  return p === "ios" || p === "android";
}

export async function PUT(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const d = getDictionary(auth.lang).kitchen.api;
  const b = await body(request);

  if (!validSurface(b.surface) || !validPlatform(b.platform)) {
    return mobileJson({ error: d.managerPushInvalid }, 400);
  }

  try {
    const { error } = await auth.supabase.from("app_activity").upsert(
      {
        company_id: auth.companyId,
        user_id: auth.userId,
        surface: b.surface,
        platform: b.platform,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,company_id,surface" }
    );
    if (error) throw error;
    return mobileJson({ recorded: true });
  } catch (err) {
    // Postgres error 42P01 = table doesn't exist. Fail silently when the
    // migration hasn't been applied yet (no user-facing error, no crash).
    const pgError = err as { code?: string };
    if (pgError.code === "42P01") {
      console.warn("[mobile-activity] table not found (migration not applied)");
      return mobileJson({ recorded: false });
    }
    console.error("[mobile-activity] record failed:", err);
    // Fail silently: this is a background ping, never block the app.
    return mobileJson({ recorded: false });
  }
}
