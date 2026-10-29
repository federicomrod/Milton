// lib/restaurant/kitchen/app-reports.ts
//
// kitchen_reports rows created by the app (mobile P0b, #430): channel 'app',
// no Telegram ids, and a client_ref chosen by the phone so a retried upload is
// the same report. AI processing of app items is a later PR; the row just
// shows up in Milton › Cocina like a Telegram one. Service-role client:
// every query is filtered by the cook's company and staff id.
//
// SECURITY: never logs text, client refs or raw error messages.

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyKitchenReport } from "@/lib/restaurant/telegram/kitchen-reports";

export const MAX_REPORT_TEXT = 2000;
export const CLIENT_REF_RE = /^[A-Za-z0-9._:-]{8,100}$/;

export interface AppReportStaff {
  id: string;
  companyId: string;
  locationId: string;
}

export interface AppReportInput {
  clientRef: string;
  text: string | null;
  /** kitchen_reports.media_kind only allows photo | voice; a PDF stores null. */
  mediaKind: "photo" | "voice" | null;
  mime: string | null;
  durationS: number | null;
  sizeBytes: number | null;
}

export type FindOrCreateReportResult =
  | { ok: true; reportId: string; duplicate: boolean }
  | { ok: false };

export function cleanReportText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().slice(0, MAX_REPORT_TEXT);
  return t || null;
}

async function findByClientRef(
  admin: SupabaseClient,
  staff: AppReportStaff,
  clientRef: string
): Promise<string | null> {
  const { data } = await admin
    .from("kitchen_reports")
    .select("id")
    .eq("company_id", staff.companyId)
    .eq("staff_id", staff.id)
    .eq("client_ref", clientRef)
    .maybeSingle();
  return data ? (data.id as string) : null;
}

/** The cook's report for this client_ref, creating it the first time. */
export async function findOrCreateAppReport(
  admin: SupabaseClient,
  staff: AppReportStaff,
  input: AppReportInput
): Promise<FindOrCreateReportResult> {
  try {
    const existing = await findByClientRef(admin, staff, input.clientRef);
    if (existing) return { ok: true, reportId: existing, duplicate: true };

    const { data, error } = await admin
      .from("kitchen_reports")
      .insert({
        company_id: staff.companyId,
        location_id: staff.locationId,
        staff_id: staff.id,
        report_type: classifyKitchenReport(input.text),
        text: input.text,
        media_kind: input.mediaKind,
        media_mime: input.mime,
        media_duration_s: input.durationS,
        media_size_bytes: input.sizeBytes,
        telegram_chat_id: null,
        telegram_message_id: null,
        channel: "app",
        client_ref: input.clientRef,
      })
      .select("id")
      .single();
    if (error || !data) {
      // Two retries racing on the unique (staff_id, client_ref) index.
      if (error?.code === "23505") {
        const raced = await findByClientRef(admin, staff, input.clientRef);
        if (raced) return { ok: true, reportId: raced, duplicate: true };
      }
      return { ok: false };
    }
    return { ok: true, reportId: data.id as string, duplicate: false };
  } catch (err) {
    console.error(
      "[kitchen-app-reports] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false };
  }
}

/** Removes a report whose media could not be stored, so the retry starts clean. */
export async function deleteAppReport(
  admin: SupabaseClient,
  staff: AppReportStaff,
  reportId: string
): Promise<void> {
  try {
    await admin
      .from("kitchen_reports")
      .delete()
      .eq("id", reportId)
      .eq("company_id", staff.companyId)
      .eq("staff_id", staff.id);
  } catch {
    console.error("[kitchen-app-reports] cleanup failed");
  }
}
