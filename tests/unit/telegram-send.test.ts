import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendTelegramMessage } from "@/lib/restaurant/telegram/send";

// Telegram Daily Briefing v1 — proves the send utility handles success,
// Telegram API errors, and network failures safely, and that the bot
// token never appears in any returned result or logged output.

const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FAKE_TOKEN = "123456:AAFakeTelegramBotTokenValueForTestsOnly";

function setToken(token: string | undefined) {
  if (token === undefined) {
    delete process.env.TELEGRAM_BOT_TOKEN;
  } else {
    process.env.TELEGRAM_BOT_TOKEN = token;
  }
}

beforeEach(() => {
  setToken(FAKE_TOKEN);
});

afterEach(() => {
  setToken(ORIGINAL_TOKEN);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendTelegramMessage — success", () => {
  it("returns { ok: true } on a 200 response and calls the Bot API with the right chat/text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTelegramMessage(12345, "hello");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(FAKE_TOKEN);
    expect(url).toContain("/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ chat_id: 12345, text: "hello" });
  });
});

describe("sendTelegramMessage — Telegram API error handled safely (scenario: API failure)", () => {
  it("returns a generic ok:false result on a non-2xx response, never throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, description: "chat not found" }),
        {
          status: 400,
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTelegramMessage(999, "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Telegram could not deliver the message.");
      expect(result.error).not.toContain(FAKE_TOKEN);
    }
  });

  it("returns a generic ok:false result on a network failure, never throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessage(1, "hi")).resolves.toEqual({
      ok: false,
      error: "Could not reach Telegram.",
    });
  });
});

describe("sendTelegramMessage — missing token handled safely", () => {
  it("returns ok:false without ever calling fetch when TELEGRAM_BOT_TOKEN is unset", async () => {
    setToken(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTelegramMessage(1, "hi");
    expect(result).toEqual({ ok: false, error: "Telegram is not configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendTelegramMessage — token never exposed (security)", () => {
  it("never includes the bot token in the returned result, on success or failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        )
    );
    const success = await sendTelegramMessage(1, "hi");
    expect(JSON.stringify(success)).not.toContain(FAKE_TOKEN);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 500 }))
    );
    const failure = await sendTelegramMessage(1, "hi");
    expect(JSON.stringify(failure)).not.toContain(FAKE_TOKEN);
  });

  it("never logs the bot token, even when the underlying fetch call throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new TypeError(`fetch failed for token ${FAKE_TOKEN}`)
        )
    );

    await sendTelegramMessage(1, "hi");

    for (const call of errorSpy.mock.calls) {
      const logged = call.map((arg) => String(arg)).join(" ");
      expect(logged).not.toContain(FAKE_TOKEN);
    }
  });
});
