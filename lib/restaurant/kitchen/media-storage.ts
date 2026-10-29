// lib/restaurant/kitchen/media-storage.ts
//
// Supabase Storage helpers for kitchen media (mobile P0a, #430). Server-only.
// Files live in the private `kitchen-media` bucket under
//   <company_id>/<location_id>/<yyyy>/<mm>/<kitchen_media.id>.<ext>
// Like files.ts, nothing here logs a URL, a signed URL or a raw error message,
// and nothing throws.

import type { SupabaseClient } from "@supabase/supabase-js";

export const KITCHEN_MEDIA_BUCKET = "kitchen-media";
export const KITCHEN_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "application/pdf": "pdf",
};

export const KITCHEN_MEDIA_MIMES = Object.keys(EXT_BY_MIME);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function kitchenMediaExt(mime: string | null | undefined): string {
  return EXT_BY_MIME[(mime ?? "").toLowerCase()] ?? "bin";
}

/** Pure. Throws only on an invalid id (callers pass server-generated ids). */
export function buildKitchenMediaPath(input: {
  companyId: string;
  locationId: string;
  mediaId: string;
  mime: string | null | undefined;
  now?: Date;
}): string {
  for (const id of [input.companyId, input.locationId, input.mediaId]) {
    if (!UUID_RE.test(id)) throw new Error("invalid id");
  }
  const now = input.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${input.companyId}/${input.locationId}/${yyyy}/${mm}/${input.mediaId}.${kitchenMediaExt(input.mime)}`;
}

export async function uploadKitchenMedia(
  admin: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  mime: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await admin.storage
      .from(KITCHEN_MEDIA_BUCKET)
      .upload(path, bytes, {
        upsert: false,
        ...(mime ? { contentType: mime } : {}),
      });
    if (error) return { ok: false, error: "upload failed" };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.name : "Unknown error",
    };
  }
}

/** Short-lived signed read URL, or null. The URL is never logged. */
export async function createKitchenMediaSignedUrl(
  admin: SupabaseClient,
  path: string,
  seconds = 300
): Promise<string | null> {
  try {
    const { data, error } = await admin.storage
      .from(KITCHEN_MEDIA_BUCKET)
      .createSignedUrl(path, seconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
