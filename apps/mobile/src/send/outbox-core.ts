// The send flow and retry rules, with no React Native imports (so they are
// unit-tested). One item = one clientRef, made before the first attempt and
// reused by every retry: the server stores an item once however many times we
// ask. Files never touch our server; they go to Storage with a signed URL.

import { ApiError, type ApiClient } from "../api/client";

export type OutboxKind = "photo" | "voice" | "text";
export type OutboxState = "pending" | "sending" | "sent" | "failed";

export interface OutboxItem {
  /** The clientRef. */
  id: string;
  kind: OutboxKind;
  text: string | null;
  fileUri: string | null;
  mime: string | null;
  sizeBytes: number | null;
  durationS: number | null;
  createdAt: string;
  state: OutboxState;
  attempts: number;
  /** Epoch ms; the next automatic retry. */
  nextAttemptAt: number;
  /** Retrying can never work (for example a type the server refuses). */
  permanent: boolean;
  /** The last failure was «no connection». */
  offline: boolean;
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; permanent: boolean; offline: boolean };

export type Uploader = (input: {
  url: string;
  fileUri: string;
  mime: string;
}) => Promise<{ status: number }>;

export interface SendDeps {
  api: Pick<ApiClient, "text" | "uploadTicket" | "uploadComplete">;
  upload: Uploader;
}

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/** 2 s, 4 s, 8 s … capped at 5 min. */
export function backoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (n - 1));
}

export function isDue(item: OutboxItem, now: number): boolean {
  return (
    (item.state === "pending" || item.state === "failed") &&
    !item.permanent &&
    now >= item.nextAttemptAt
  );
}

/** These statuses mean «try again» even though they are 4xx. */
const RETRY_STATUSES = new Set([408, 409, 425, 429]);

function isPermanent(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.retryable) return false;
    if (err.kind === "unauthorized") return false; // the session ends; items wait
    return !(err.status !== undefined && RETRY_STATUSES.has(err.status));
  }
  return false;
}

export async function sendItem(
  item: OutboxItem,
  deps: SendDeps
): Promise<SendOutcome> {
  try {
    if (item.kind === "text") {
      await deps.api.text({ text: item.text ?? "", clientRef: item.id });
      return { ok: true };
    }
    if (!item.fileUri || !item.mime || !item.sizeBytes) {
      return { ok: false, permanent: true, offline: false };
    }
    // A fresh ticket every attempt: cheap, idempotent by clientRef, and a
    // retry never depends on an upload URL that may have expired.
    const ticket = await deps.api.uploadTicket({
      kind: item.kind,
      mime: item.mime,
      sizeBytes: item.sizeBytes,
      clientRef: item.id,
      text: item.text,
      durationS: item.durationS,
    });
    if (ticket.uploadUrl) {
      const put = await deps.upload({
        url: ticket.uploadUrl,
        fileUri: item.fileUri,
        mime: item.mime,
      });
      if (put.status < 200 || put.status >= 300) {
        // Too big / refused type will never work; anything else may.
        const never = put.status === 413 || put.status === 415;
        return { ok: false, permanent: never, offline: false };
      }
    }
    await deps.api.uploadComplete({
      reportId: ticket.reportId,
      clientRef: item.id,
      path: ticket.path,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      permanent: isPermanent(err),
      offline: err instanceof ApiError ? err.offline : false,
    };
  }
}

/** The item after one more failed attempt. */
export function afterFailure(
  item: OutboxItem,
  outcome: { permanent: boolean; offline: boolean },
  now: number
): OutboxItem {
  const attempts = item.attempts + 1;
  return {
    ...item,
    state: "failed",
    attempts,
    permanent: outcome.permanent,
    offline: outcome.offline,
    nextAttemptAt: now + backoffMs(attempts),
  };
}

export function newItem(
  input: Pick<OutboxItem, "id" | "kind"> &
    Partial<
      Pick<OutboxItem, "text" | "fileUri" | "mime" | "sizeBytes" | "durationS">
    >,
  now: Date = new Date()
): OutboxItem {
  return {
    id: input.id,
    kind: input.kind,
    text: input.text ?? null,
    fileUri: input.fileUri ?? null,
    mime: input.mime ?? null,
    sizeBytes: input.sizeBytes ?? null,
    durationS: input.durationS ?? null,
    createdAt: now.toISOString(),
    state: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    permanent: false,
    offline: false,
  };
}
