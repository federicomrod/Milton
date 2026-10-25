import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerCallbackQuery,
  editMessageText,
  sendTelegramMessage,
} from "@/lib/restaurant/telegram/send";

const TOKEN = "123456:AAFakeTelegramBotTokenValueForTestsOnly";
const original = process.env.TELEGRAM_BOT_TOKEN;
beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});
afterEach(() => {
  if (original === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = original;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (result: unknown = {}) =>
  new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sent = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), body: JSON.parse(init.body as string) };
};

describe("telegram client helpers", () => {
  it("sendTelegramMessage sends the keyboard and returns the message id", async () => {
    const f = vi.fn().mockResolvedValue(ok({ message_id: 77 }));
    vi.stubGlobal("fetch", f);
    const replyMarkup = {
      inline_keyboard: [[{ text: "Cancelar", callback_data: "kc1:x" }]],
    };
    const r = await sendTelegramMessage(5, "hola", { replyMarkup });
    expect(r).toEqual({ ok: true, messageId: 77 });
    const { url, body } = sent(f);
    expect(url.endsWith("/sendMessage")).toBe(true);
    expect(body).toEqual({
      chat_id: 5,
      text: "hola",
      reply_markup: replyMarkup,
    });
  });

  it("without options the body is unchanged and no id is invented", async () => {
    const f = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", f);
    expect(await sendTelegramMessage(5, "hola")).toEqual({ ok: true });
    expect(sent(f).body).toEqual({ chat_id: 5, text: "hola" });
  });

  it("answerCallbackQuery posts the id and optional text", async () => {
    const f = vi.fn().mockResolvedValue(ok(true));
    vi.stubGlobal("fetch", f);
    expect(await answerCallbackQuery("cb1", "Listo")).toEqual({ ok: true });
    const { url, body } = sent(f);
    expect(url.endsWith("/answerCallbackQuery")).toBe(true);
    expect(body).toEqual({ callback_query_id: "cb1", text: "Listo" });
  });

  it("editMessageText removes the keyboard when none is given", async () => {
    const f = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", f);
    await editMessageText(5, 77, "Para Demo Resto › Local Centro ✓");
    const { url, body } = sent(f);
    expect(url.endsWith("/editMessageText")).toBe(true);
    expect(body).toEqual({
      chat_id: 5,
      message_id: 77,
      text: "Para Demo Resto › Local Centro ✓",
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("failures never throw and never log the token", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`boom ${TOKEN}`))
    );
    expect(await answerCallbackQuery("cb1")).toEqual({
      ok: false,
      error: "Could not reach Telegram.",
    });
    expect(await editMessageText(5, 1, "x")).toEqual({
      ok: false,
      error: "Could not reach Telegram.",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ description: "message is not modified" }),
            { status: 400 }
          )
        )
    );
    expect(
      (
        await sendTelegramMessage(5, "x", {
          replyMarkup: { inline_keyboard: [] },
        })
      ).ok
    ).toBe(false);
    expect(JSON.stringify(err.mock.calls)).not.toContain(TOKEN);
  });
});
