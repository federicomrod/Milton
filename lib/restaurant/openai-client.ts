// lib/restaurant/openai-client.ts
//
// One place that builds the OpenAI client the kitchen features use (Telegram
// recipe drafts and the recipe file upload). Never logs keys or content.

import type OpenAINs from "openai";

export type OpenAIClient = InstanceType<typeof OpenAINs>;

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function openAiModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
}

export async function createOpenAIClient(
  timeoutMs: number
): Promise<{ ok: true; client: OpenAIClient } | { ok: false; error: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OpenAI not configured" };
  }

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch {
    console.error("[openai-client] openai sdk import failed");
    return { ok: false, error: "OpenAI SDK unavailable" };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK unavailable" };
  }

  return {
    ok: true,
    client: new OpenAIctor({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: timeoutMs,
      maxRetries: 0,
    }),
  };
}
