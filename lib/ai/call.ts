// lib/ai/call.ts
//
// The ONE place that calls OpenAI (chat completions and transcriptions).
// Every feature goes through runChat / runTranscription so that:
//   * the client never retries (maxRetries: 0) and always has a timeout, so a
//     quota or billing error is never retried;
//   * errors are classified (quota, billing, rate_limit, timeout, other);
//   * one row per call lands in ai_usage_events (tokens, latency, estimated
//     cost, status), fire-and-forget: a logging failure never breaks a feature;
//   * the first quota/billing error of the UTC day alerts the admin.
//
// SECURITY: never logs or stores prompts, answers, images, audio or keys.
// A test fails if any other file calls the OpenAI create methods directly.

import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import type { Transcription } from "openai/resources/audio/transcriptions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAiAlert } from "./alert";
import { estimateChatCostUsd, estimateTranscriptionCostUsd } from "./prices";

export type AiErrorKind =
  | "quota"
  | "billing"
  | "rate_limit"
  | "timeout"
  | "bad_output"
  | "other";

/** `not_configured`: no OPENAI_API_KEY / SDK; nothing was called or logged. */
export type AiFailureKind = AiErrorKind | "not_configured";

export type AiResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: AiFailureKind; message?: string };

export const DEFAULT_CHAT_TIMEOUT_MS = 30_000;
export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 20_000;

export { AI_UNAVAILABLE_COPY } from "./unavailable-copy";

export type AiUnavailable = "quota" | null;

/** quota and billing both mean «the account cannot pay for calls now». */
export function aiUnavailableFor(
  result: AiResult<unknown> | AiFailureKind | null | undefined
): AiUnavailable {
  const kind =
    result && typeof result === "object"
      ? result.ok
        ? null
        : result.kind
      : (result ?? null);
  return kind === "quota" || kind === "billing" ? "quota" : null;
}

/** Thrown by adapters that must keep a throwing contract (see unwrapAi). */
export class AiCallError extends Error {
  readonly kind: AiFailureKind;
  constructor(kind: AiFailureKind, message?: string) {
    super(message ?? `AI call failed: ${kind}`);
    this.name = "AiCallError";
    this.kind = kind;
  }
}

export function unwrapAi<T>(result: AiResult<T>): T {
  if (result.ok) return result.value;
  throw new AiCallError(result.kind, result.message);
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  type?: unknown;
  error?: { code?: unknown; type?: unknown } | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function classifyAiError(err: unknown): {
  kind: Exclude<AiErrorKind, "bad_output">;
  code: string | null;
  status: number | null;
} {
  const e = (err && typeof err === "object" ? err : {}) as ErrorLike;
  const status = typeof e.status === "number" ? e.status : null;
  const code =
    asString(e.code) ??
    asString(e.error?.code) ??
    asString(e.type) ??
    asString(e.error?.type);
  const name = asString(e.name) ?? "";
  const message = asString(e.message) ?? "";

  if (code === "insufficient_quota") return { kind: "quota", code, status };
  if (code && (/^billing/.test(code) || code === "account_deactivated")) {
    return { kind: "billing", code, status };
  }
  if (status === 429) return { kind: "rate_limit", code, status };
  if (
    name === "APIConnectionTimeoutError" ||
    name === "APIUserAbortError" ||
    name === "AbortError" ||
    name === "TimeoutError" ||
    /timed out|timeout/i.test(message)
  ) {
    return { kind: "timeout", code: code ?? "timeout", status };
  }
  return {
    kind: "other",
    code: code ?? (status ? `http_${status}` : null),
    status,
  };
}

// ---------------------------------------------------------------------------
// Logging (fire-and-forget)
// ---------------------------------------------------------------------------

export interface AiUsageEvent {
  company_id: string | null;
  feature: string;
  model: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  audio_seconds: number | null;
  est_cost_usd: number | null;
  latency_ms: number | null;
  status: "ok" | "error" | "fallback";
  error_kind: AiErrorKind | null;
  error_code: string | null;
}

function utcDayStartIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
}

async function writeEvent(event: AiUsageEvent): Promise<void> {
  try {
    const admin = createAdminClient();
    const needsAlert =
      event.error_kind === "quota" || event.error_kind === "billing";
    let firstToday = false;
    if (needsAlert) {
      // Dedupe through the table itself: the first quota/billing row of the
      // UTC day sends the alert.
      const { count } = await admin
        .from("ai_usage_events")
        .select("id", { count: "exact", head: true })
        .in("error_kind", ["quota", "billing"])
        .gte("created_at", utcDayStartIso());
      firstToday = (count ?? 0) === 0;
    }
    const { error } = await admin.from("ai_usage_events").insert(event);
    if (error) console.error("[ai-usage] log insert failed");
    if (needsAlert && firstToday) {
      await sendAiAlert(`Milton: la IA falló por ${event.error_kind}`, [
        `Función: ${event.feature}`,
        `Tipo de error: ${event.error_kind}`,
        `Código: ${event.error_code ?? "sin código"}`,
        "Revisa el saldo y el límite de gasto de la cuenta de OpenAI.",
      ]);
    }
  } catch {
    console.error("[ai-usage] log failed");
  }
}

/** Never throws and never blocks the caller. */
export function logAiEvent(event: AiUsageEvent): void {
  let pending: Promise<void>;
  try {
    pending = writeEvent(event);
  } catch {
    return;
  }
  void pending.catch(() => undefined);
  // Keep the write alive after the response on serverless; plain promise
  // elsewhere (tests, scripts).
  void import("next/server")
    .then((mod) => {
      try {
        mod.after(() => pending);
      } catch {
        // outside a request scope
      }
    })
    .catch(() => undefined);
}

/**
 * A call succeeded but its answer was unusable and the feature fell back to
 * its deterministic version. Only the kind is recorded, never the answer.
 */
export function logAiFallback(input: {
  feature: string;
  companyId?: string | null;
  model?: string;
  kind: AiErrorKind;
  code?: string | null;
}): void {
  logAiEvent({
    company_id: input.companyId ?? null,
    feature: input.feature,
    model: input.model ?? "unknown",
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    audio_seconds: null,
    est_cost_usd: null,
    latency_ms: null,
    status: "fallback",
    error_kind: input.kind,
    error_code: input.code ?? null,
  });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let ctorPromise: Promise<typeof OpenAI | null> | null = null;

function loadCtor(): Promise<typeof OpenAI | null> {
  return (ctorPromise ??= import("openai")
    .then(
      (mod) =>
        mod.OpenAI ?? (mod as unknown as { default: typeof OpenAI }).default
    )
    .catch(() => null));
}

async function makeClient(timeoutMs: number): Promise<OpenAI | null> {
  const Ctor = await loadCtor();
  if (!Ctor) return null;
  try {
    // The SDK itself refuses to build a client without a key.
    return new Ctor({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: timeoutMs,
      maxRetries: 0,
    });
  } catch {
    console.error("[ai-call] openai client unavailable");
    return null;
  }
}

function failEvent(
  base: Pick<AiUsageEvent, "company_id" | "feature" | "model">,
  err: unknown,
  latencyMs: number,
  audioSeconds: number | null
): { kind: AiErrorKind; message?: string } {
  const c = classifyAiError(err);
  logAiEvent({
    ...base,
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    audio_seconds: audioSeconds,
    est_cost_usd: null,
    latency_ms: latencyMs,
    status: "error",
    error_kind: c.kind,
    error_code: c.code ? c.code.slice(0, 80) : null,
  });
  const message =
    err instanceof Error && c.kind === "other" ? err.message : undefined;
  return { kind: c.kind, message };
}

// ---------------------------------------------------------------------------
// runChat / runTranscription
// ---------------------------------------------------------------------------

export interface RunChatOptions {
  /** Stable name of the feature, e.g. "ask-milton". */
  feature: string;
  companyId?: string | null;
  params: ChatCompletionCreateParamsNonStreaming;
  /** Existing client (tests, shared proxy). Default: a fresh one. */
  client?: OpenAI;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function runChat(
  opts: RunChatOptions
): Promise<AiResult<ChatCompletion>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
  const client = opts.client ?? (await makeClient(timeoutMs));
  if (!client) return { ok: false, kind: "not_configured" };

  const base = {
    company_id: opts.companyId ?? null,
    feature: opts.feature,
    model: String(opts.params.model),
  };
  const started = Date.now();
  try {
    const completion = await client.chat.completions.create(opts.params, {
      timeout: timeoutMs,
      maxRetries: 0,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const usage = completion?.usage;
    const inputTokens = usage?.prompt_tokens ?? null;
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? null;
    const outputTokens = usage?.completion_tokens ?? null;
    logAiEvent({
      ...base,
      input_tokens: inputTokens,
      cached_input_tokens: cached,
      output_tokens: outputTokens,
      audio_seconds: null,
      est_cost_usd: usage
        ? estimateChatCostUsd(base.model, {
            inputTokens,
            cachedInputTokens: cached,
            outputTokens,
          })
        : null,
      latency_ms: Date.now() - started,
      status: "ok",
      error_kind: null,
      error_code: null,
    });
    return { ok: true, value: completion };
  } catch (err) {
    const { kind, message } = failEvent(base, err, Date.now() - started, null);
    return { ok: false, kind, message };
  }
}

export interface RunTranscriptionOptions {
  feature: string;
  companyId?: string | null;
  params: { file: File; model: string; language?: string };
  /** Length of the audio when the caller knows it (cost estimate). */
  audioSeconds?: number | null;
  client?: OpenAI;
  timeoutMs?: number;
}

export async function runTranscription(
  opts: RunTranscriptionOptions
): Promise<AiResult<Transcription>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
  const client = opts.client ?? (await makeClient(timeoutMs));
  if (!client) return { ok: false, kind: "not_configured" };

  const base = {
    company_id: opts.companyId ?? null,
    feature: opts.feature,
    model: opts.params.model,
  };
  const audioSeconds = opts.audioSeconds ?? null;
  const started = Date.now();
  try {
    const transcription = await client.audio.transcriptions.create(
      opts.params as never,
      { timeout: timeoutMs, maxRetries: 0 }
    );
    logAiEvent({
      ...base,
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      audio_seconds: audioSeconds,
      est_cost_usd: estimateTranscriptionCostUsd(base.model, audioSeconds),
      latency_ms: Date.now() - started,
      status: "ok",
      error_kind: null,
      error_code: null,
    });
    return { ok: true, value: transcription as Transcription };
  } catch (err) {
    const { kind, message } = failEvent(
      base,
      err,
      Date.now() - started,
      audioSeconds
    );
    return { ok: false, kind, message };
  }
}
