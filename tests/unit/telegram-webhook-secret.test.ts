import { describe, it, expect } from "vitest";
import {
  safeEqual,
  isValidWebhookSecret,
} from "@/lib/restaurant/telegram/webhook-secret";

// Telegram Daily Briefing v1 — proves the webhook rejects any request that
// doesn't carry the exact configured X-Telegram-Bot-Api-Secret-Token
// (scenario: invalid webhook secret), using a constant-time comparison.

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("same-secret-value", "same-secret-value")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(safeEqual("secret-value-aaaa", "secret-value-bbbb")).toBe(false);
  });

  it("returns false for strings of different lengths (never throws)", () => {
    expect(() => safeEqual("short", "a-much-longer-secret")).not.toThrow();
    expect(safeEqual("short", "a-much-longer-secret")).toBe(false);
  });
});

describe("isValidWebhookSecret — invalid webhook secret", () => {
  const expected = "the-real-webhook-secret";

  it("accepts a header that exactly matches the configured secret", () => {
    expect(isValidWebhookSecret(expected, expected)).toBe(true);
  });

  it("rejects a wrong header value", () => {
    expect(isValidWebhookSecret("wrong-value", expected)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isValidWebhookSecret(null, expected)).toBe(false);
  });

  it("rejects when TELEGRAM_WEBHOOK_SECRET itself is unconfigured", () => {
    expect(isValidWebhookSecret(expected, undefined)).toBe(false);
  });

  it("rejects when both are empty", () => {
    expect(isValidWebhookSecret(null, undefined)).toBe(false);
  });
});
