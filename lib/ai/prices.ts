// lib/ai/prices.ts
//
// OpenAI list prices used to ESTIMATE the cost of each call (USD).
// Source: https://platform.openai.com/docs/pricing, as of 2026-10-29.
// Update here when the prices change; an unknown model gets no estimate
// (null), never a guessed one.

export const PRICES_SOURCE_URL = "https://platform.openai.com/docs/pricing";
export const PRICES_AS_OF = "2026-10-29";

export interface TokenPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M cached input tokens. */
  cachedInput: number;
  /** USD per 1M output tokens. */
  output: number;
}

export const CHAT_PRICES: Record<string, TokenPrice> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
};

/** USD per audio minute. */
export const TRANSCRIPTION_PRICES: Record<string, number> = {
  "whisper-1": 0.006,
};

export function estimateChatCostUsd(
  model: string,
  usage: {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
  }
): number | null {
  const price = CHAT_PRICES[model];
  if (!price) return null;
  const input = usage.inputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, input);
  const output = usage.outputTokens ?? 0;
  const usd =
    ((input - cached) * price.input +
      cached * price.cachedInput +
      output * price.output) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

export function estimateTranscriptionCostUsd(
  model: string,
  audioSeconds: number | null
): number | null {
  const perMinute = TRANSCRIPTION_PRICES[model];
  if (perMinute === undefined || audioSeconds === null) return null;
  return Math.round((audioSeconds / 60) * perMinute * 1e6) / 1e6;
}
