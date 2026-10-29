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

// ---------------------------------------------------------------------------
// Direct uploads from the app (mobile P1, #431)
// ---------------------------------------------------------------------------
// The phone PUTs the file straight to Storage with a signed upload URL, so the
// bytes never go through our server (hosting caps request bodies far below
// 25 MB). The server only hands out the URL and, afterwards, registers the
// object it finds at that path.

/** Supabase signed upload URLs are valid for two hours. */
export const KITCHEN_MEDIA_SIGNED_UPLOAD_TTL_S = 2 * 60 * 60;

export type KitchenMediaKind = "photo" | "voice" | "document";

/** Does the mime type fit the kind of item the cook says they are sending? */
export function mimeMatchesKind(kind: KitchenMediaKind, mime: string): boolean {
  if (kind === "photo") return mime.startsWith("image/");
  if (kind === "voice") return mime.startsWith("audio/");
  return mime === "application/pdf";
}

const MEDIA_PATH_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/\d{4}\/\d{2}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([a-z0-9]{2,5})$/i;

/** Splits a path built by buildKitchenMediaPath, or null if it is anything else. */
export function parseKitchenMediaPath(
  path: string
): { companyId: string; locationId: string; mediaId: string } | null {
  const m = MEDIA_PATH_RE.exec(path);
  if (!m) return null;
  return { companyId: m[1], locationId: m[2], mediaId: m[3] };
}

export type SignedUploadResult =
  | { ok: true; signedUrl: string; token: string; path: string }
  | { ok: false };

/** One-shot signed upload URL for `path`. The URL and token are never logged. */
export async function createKitchenMediaSignedUploadUrl(
  admin: SupabaseClient,
  path: string
): Promise<SignedUploadResult> {
  try {
    // upsert: a retry after a dropped connection may PUT the same object again.
    const { data, error } = await admin.storage
      .from(KITCHEN_MEDIA_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.signedUrl || !data.token) return { ok: false };
    return {
      ok: true,
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path ?? path,
    };
  } catch {
    return { ok: false };
  }
}

export type MediaObjectResult =
  | { ok: true; exists: false }
  | { ok: true; exists: true; sizeBytes: number | null }
  | { ok: false };

/** Does an object exist at `path`, and how big is it? */
export async function getKitchenMediaObject(
  admin: SupabaseClient,
  path: string
): Promise<MediaObjectResult> {
  try {
    const slash = path.lastIndexOf("/");
    const folder = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data, error } = await admin.storage
      .from(KITCHEN_MEDIA_BUCKET)
      .list(folder, { limit: 5, search: name });
    if (error) return { ok: false };
    const hit = (data ?? []).find((o) => o.name === name);
    if (!hit) return { ok: true, exists: false };
    const size = (hit.metadata as { size?: unknown } | null)?.size;
    return {
      ok: true,
      exists: true,
      sizeBytes: typeof size === "number" ? size : null,
    };
  } catch {
    return { ok: false };
  }
}

/** Best-effort delete of an object that must not stay (for example too big). */
export async function removeKitchenMediaObject(
  admin: SupabaseClient,
  path: string
): Promise<void> {
  try {
    await admin.storage.from(KITCHEN_MEDIA_BUCKET).remove([path]);
  } catch {
    console.error("[kitchen-media] remove failed");
  }
}
