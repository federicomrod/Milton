// lib/restaurant/telegram/kitchen-reports.ts
//
// Cook reports (R1 #49): what kitchen staff send the bot — items running
// out, 86'd items, waste — as text, voice note or photo.
//
// classifyKitchenReport() is a pure, deterministic Spanish keyword match
// (NO AI). extractReportFromMessage() maps a Telegram message to a report
// payload. recordKitchenReport() inserts via the service role, idempotent
// on (telegram_chat_id, telegram_message_id). Media is stored as Telegram
// file ids only — nothing is downloaded here.
//
// SECURITY: never logs message text, file ids or tokens.

import { createAdminClient } from "@/lib/supabase/admin";

export type KitchenReportType = "running_out" | "86" | "waste" | "unclassified";

export const REPORT_TYPES: readonly KitchenReportType[] = [
  "running_out",
  "86",
  "waste",
  "unclassified",
];

const MAX_TEXT = 2000;

// Patterns run on lowercase text with diacritics stripped, so "se acabó"
// and "se acabo" match alike.
const WASTE_RE =
  /merma|\btir(?:e|amos|aron|ado)|\bbot(?:e|amos)\b|se quem|quemad|caduc|venci|se paso|se dano/;
const EIGHTY_SIX_RE =
  /\b86\b|se acab(?:o|aron)|(?<!casi )no (?:hay|queda)|agotad|nos quedamos sin|^\s*sin\s+\S+/;
const RUNNING_OUT_RE =
  /queda(?:n)? poco|se esta acabando|casi no (?:hay|queda)|quedan para|ultim[oa]s?/;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Precedence: waste, then 86, then running_out, else unclassified. */
export function classifyKitchenReport(
  text: string | null | undefined
): KitchenReportType {
  if (!text || !text.trim()) return "unclassified";
  const t = normalize(text);
  if (WASTE_RE.test(t)) return "waste";
  if (EIGHTY_SIX_RE.test(t)) return "86";
  if (RUNNING_OUT_RE.test(t)) return "running_out";
  return "unclassified";
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id?: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramIncomingMessage {
  message_id?: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
}

export interface ExtractedReport {
  report_type: KitchenReportType;
  text: string | null;
  media_kind: "photo" | "voice" | null;
  telegram_file_id: string | null;
  telegram_file_unique_id: string | null;
  media_mime: string | null;
  media_duration_s: number | null;
  media_size_bytes: number | null;
  telegram_message_id: number;
}

function cap(text: string | undefined): string | null {
  const t = text?.trim();
  return t ? t.slice(0, MAX_TEXT) : null;
}

function photoArea(p: TelegramPhotoSize): number {
  return (p.width ?? 0) * (p.height ?? 0);
}

/**
 * Maps a Telegram message to a report. Photo -> largest PhotoSize, text =
 * caption. Voice -> file details, text = caption. Plain text -> text.
 * Anything else (sticker, document, video, location, empty) -> null.
 */
export function extractReportFromMessage(
  message: TelegramIncomingMessage
): ExtractedReport | null {
  const messageId = message.message_id;
  if (typeof messageId !== "number") return null;

  const base = {
    media_kind: null,
    telegram_file_id: null,
    telegram_file_unique_id: null,
    media_mime: null,
    media_duration_s: null,
    media_size_bytes: null,
    telegram_message_id: messageId,
  } as const;

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((best, p) =>
      photoArea(p) > photoArea(best) ||
      (photoArea(p) === photoArea(best) &&
        (p.file_size ?? 0) > (best.file_size ?? 0))
        ? p
        : best
    );
    const text = cap(message.caption);
    return {
      ...base,
      report_type: classifyKitchenReport(text),
      text,
      media_kind: "photo",
      telegram_file_id: largest.file_id,
      telegram_file_unique_id: largest.file_unique_id ?? null,
      media_mime: "image/jpeg", // Telegram re-encodes photos as JPEG
      media_size_bytes: largest.file_size ?? null,
    };
  }

  if (message.voice) {
    const v = message.voice;
    const text = cap(message.caption);
    return {
      ...base,
      report_type: classifyKitchenReport(text),
      text,
      media_kind: "voice",
      telegram_file_id: v.file_id,
      telegram_file_unique_id: v.file_unique_id ?? null,
      media_mime: v.mime_type ?? "audio/ogg",
      media_duration_s: v.duration ?? null,
      media_size_bytes: v.file_size ?? null,
    };
  }

  const text = cap(message.text);
  if (!text) return null;
  return { ...base, report_type: classifyKitchenReport(text), text };
}

/**
 * Inserts the report (service role). Returns true only when a NEW row was
 * stored — a Telegram retry (same chat + message id) returns false, so the
 * caller sends the acknowledgement exactly once. Throws on DB errors.
 */
export async function recordKitchenReport(input: {
  companyId: string;
  locationId: string;
  staffId: string;
  chatId: number;
  report: ExtractedReport;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { report } = input;
  const { data, error } = await admin
    .from("kitchen_reports")
    .upsert(
      {
        company_id: input.companyId,
        location_id: input.locationId,
        staff_id: input.staffId,
        report_type: report.report_type,
        text: report.text,
        media_kind: report.media_kind,
        telegram_file_id: report.telegram_file_id,
        telegram_file_unique_id: report.telegram_file_unique_id,
        media_mime: report.media_mime,
        media_duration_s: report.media_duration_s,
        media_size_bytes: report.media_size_bytes,
        telegram_chat_id: input.chatId,
        telegram_message_id: report.telegram_message_id,
      },
      {
        onConflict: "telegram_chat_id,telegram_message_id",
        ignoreDuplicates: true,
      }
    )
    .select("id");
  if (error) throw new Error("report insert failed");
  return (data?.length ?? 0) > 0;
}
