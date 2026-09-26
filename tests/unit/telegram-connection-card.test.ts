import { describe, it, expect } from "vitest";
import { extractBotUsername } from "@/components/restaurant/TelegramConnectionCard";

// Telegram Connection UI v1 — the one pure piece of logic in the card:
// deriving the bot's @handle from the server-issued deep link rather than
// hardcoding it, so the fallback pairing instructions never drift from
// whatever TELEGRAM_BOT_USERNAME the server actually has configured.

describe("extractBotUsername", () => {
  it("extracts the username from a valid t.me deep link", () => {
    expect(
      extractBotUsername("https://t.me/MiltonGastroBot?start=abc123")
    ).toBe("MiltonGastroBot");
  });

  it("extracts the username from a deep link with no start payload", () => {
    expect(extractBotUsername("https://t.me/MiltonGastroBot")).toBe(
      "MiltonGastroBot"
    );
  });

  it("returns null when there is no deep link (bot username not configured server-side)", () => {
    expect(extractBotUsername(null)).toBeNull();
  });

  it("returns null for a malformed URL rather than throwing", () => {
    expect(() => extractBotUsername("not a url")).not.toThrow();
    expect(extractBotUsername("not a url")).toBeNull();
  });
});
