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
  /** Channel-specific fetch. */
  getBytes: () => Promise<Uint8Array | null>;
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

    const mediaId = randomUUID();
    const storagePath = buildKitchenMediaPath({
      companyId: input.companyId,
      locationId: input.locationId,
      mediaId,
      mime,
    });

    const bytes = await input.getBytes();
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
