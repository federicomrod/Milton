// lib/restaurant/kitchen/pipeline/ingest.ts
//
// Channel-agnostic entry point for kitchen media (mobile P0a, #430): stores
// the bytes in Supabase Storage and records a kitchen_media row. Telegram
// calls it today; the app endpoint will call it later. This file must stay
// free of any Telegram import. Never throws; logs only static text or
// err.name.

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  KITCHEN_MEDIA_BUCKET,
  KITCHEN_MEDIA_MAX_BYTES,
  KITCHEN_MEDIA_MIMES,
  buildKitchenMediaPath,
  parseKitchenMediaPath,
  uploadKitchenMedia,
} from "@/lib/restaurant/kitchen/media-storage";

export type KitchenChannel = "telegram" | "app";

export interface KitchenMediaInput {
  channel: KitchenChannel;
  companyId: string;
  locationId: string;
  staffId: string | null;
  kitchenReportId?: string | null;
  recipeDraftId?: string | null;
  kind: "photo" | "voice" | "document";
  mime: string | null;
  sizeBytes?: number | null;
  durationS?: number | null;
  /** Telegram file_unique_id; the app's client id later. */
  sourceRef: string | null;
  /** Channel-specific fetch. Not needed when `storedAtPath` is given. */
  getBytes?: () => Promise<Uint8Array | null>;
  /**
   * The app uploads straight to Storage with a signed URL (mobile P1): the
   * object is already at this path, so it is only registered here, nothing is
   * fetched or uploaded. The path must belong to this company and location.
   */
  storedAtPath?: string | null;
}

export type KitchenMediaResult =
  | { ok: true; mediaId: string; storagePath: string; duplicate: boolean }
  | { ok: false; error: string };

export async function ingestKitchenMedia(
  input: KitchenMediaInput
): Promise<KitchenMediaResult> {
  try {
    const mime = input.mime?.toLowerCase() ?? null;
    if (!mime || !KITCHEN_MEDIA_MIMES.includes(mime)) {
      return { ok: false, error: "unsupported type" };
    }
    if (
      typeof input.sizeBytes === "number" &&
      input.sizeBytes > KITCHEN_MEDIA_MAX_BYTES
    ) {
      return { ok: false, error: "file too large" };
    }

    const admin = createAdminClient();

    if (input.sourceRef) {
      const { data: existing, error: lookupError } = await admin
        .from("kitchen_media")
        .select("id, storage_path")
        .eq("channel", input.channel)
        .eq("source_ref", input.sourceRef)
        .maybeSingle();
      if (lookupError) return { ok: false, error: "lookup failed" };
      if (existing) {
        return {
          ok: true,
          mediaId: existing.id as string,
          storagePath: existing.storage_path as string,
          duplicate: true,
        };
      }
    }

    if (input.storedAtPath)
      return await registerStoredMedia(admin, input, mime);

    const mediaId = randomUUID();
    const storagePath = buildKitchenMediaPath({
      companyId: input.companyId,
      locationId: input.locationId,
      mediaId,
      mime,
    });

    const bytes = input.getBytes ? await input.getBytes() : null;
    if (!bytes) return { ok: false, error: "no bytes" };
    if (bytes.byteLength > KITCHEN_MEDIA_MAX_BYTES) {
      return { ok: false, error: "file too large" };
    }

    const uploaded = await uploadKitchenMedia(admin, storagePath, bytes, mime);
    if (!uploaded.ok) return { ok: false, error: "upload failed" };

    const { error: insertError } = await admin.from("kitchen_media").insert({
      id: mediaId,
      company_id: input.companyId,
      location_id: input.locationId,
      staff_id: input.staffId,
      kitchen_report_id: input.kitchenReportId ?? null,
      recipe_draft_id: input.recipeDraftId ?? null,
      channel: input.channel,
      kind: input.kind,
      storage_path: storagePath,
      mime,
      size_bytes: bytes.byteLength,
      duration_s: input.durationS ?? null,
      source_ref: input.sourceRef,
    });
    if (insertError) {
      try {
        await admin.storage.from(KITCHEN_MEDIA_BUCKET).remove([storagePath]);
      } catch {
        console.error("[kitchen-ingest] cleanup failed");
      }
      return { ok: false, error: "insert failed" };
    }

    return { ok: true, mediaId, storagePath, duplicate: false };
  } catch (err) {
    console.error(
      "[kitchen-ingest] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "unexpected error" };
  }
}

/**
 * Registers an object the app already uploaded with a signed URL. The row id
 * is the uuid in the file name, so the path and the row always agree. Calling
 * it twice (or two calls racing) ends with one row and `duplicate: true`.
 */
async function registerStoredMedia(
  admin: ReturnType<typeof createAdminClient>,
  input: KitchenMediaInput,
  mime: string
): Promise<KitchenMediaResult> {
  const path = input.storedAtPath as string;
  const parsed = parseKitchenMediaPath(path);
  if (
    !parsed ||
    parsed.companyId !== input.companyId ||
    parsed.locationId !== input.locationId
  ) {
    return { ok: false, error: "wrong path" };
  }

  const { error: insertError } = await admin.from("kitchen_media").insert({
    id: parsed.mediaId,
    company_id: input.companyId,
    location_id: input.locationId,
    staff_id: input.staffId,
    kitchen_report_id: input.kitchenReportId ?? null,
    recipe_draft_id: input.recipeDraftId ?? null,
    channel: input.channel,
    kind: input.kind,
    storage_path: path,
    mime,
    size_bytes: input.sizeBytes ?? null,
    duration_s: input.durationS ?? null,
    source_ref: input.sourceRef,
  });
  if (insertError) {
    // The unique keys (storage_path, channel + source_ref) say it is already
    // registered: report that row. The object stays; the cook may retry.
    const { data: existing } = await admin
      .from("kitchen_media")
      .select("id, storage_path")
      .eq("company_id", input.companyId)
      .eq("storage_path", path)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        mediaId: existing.id as string,
        storagePath: existing.storage_path as string,
        duplicate: true,
      };
    }
    return { ok: false, error: "insert failed" };
  }
  return {
    ok: true,
    mediaId: parsed.mediaId,
    storagePath: path,
    duplicate: false,
  };
}
