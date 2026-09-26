import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendBriefingEmail } from "@/lib/restaurant/email/send";

// Email Briefing Extension v1 — proves the send utility handles success,
// provider errors, and network failures safely, and that the API key
// never appears in any returned result or logged output.

const ORIGINAL_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.EMAIL_FROM_ADDRESS;
const FAKE_KEY = "re_FakeResendApiKeyForTestsOnly_1234567890";

function setKey(key: string | undefined) {
  if (key === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = key;
}

beforeEach(() => {
  setKey(FAKE_KEY);
  delete process.env.EMAIL_FROM_ADDRESS;
});

afterEach(() => {
  setKey(ORIGINAL_KEY);
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM_ADDRESS;
  else process.env.EMAIL_FROM_ADDRESS = ORIGINAL_FROM;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PAYLOAD = {
  to: "owner@restaurant.com",
  subject: "Your Milton briefing",
  html: "<p>hi</p>",
  text: "hi",
};

describe("sendBriefingEmail — success", () => {
  it("returns { ok: true } on a 200 response and sends the Bearer auth header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "abc" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendBriefingEmail(PAYLOAD);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${FAKE_KEY}`,
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ to: PAYLOAD.to, subject: PAYLOAD.subject });
  });
});

describe("sendBriefingEmail — provider failure behavior", () => {
  it("returns a generic ok:false result on a non-2xx response, never throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "domain not verified" }), {
        status: 422,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendBriefingEmail(PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not send the briefing email.");
      expect(result.error).not.toContain(FAKE_KEY);
    }
  });

  it("returns a generic ok:false result on a network failure, never throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );
    await expect(sendBriefingEmail(PAYLOAD)).resolves.toEqual({
      ok: false,
      error: "Could not reach the email provider.",
    });
  });
});

describe("sendBriefingEmail — missing key handled safely", () => {
  it("returns ok:false without ever calling fetch when RESEND_API_KEY is unset", async () => {
    setKey(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendBriefingEmail(PAYLOAD);
    expect(result).toEqual({
      ok: false,
      error: "Email delivery is not configured.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendBriefingEmail — provider secret non-exposure", () => {
  it("never includes the API key in the returned result, on success or failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "1" }), { status: 200 })
        )
    );
    const success = await sendBriefingEmail(PAYLOAD);
    expect(JSON.stringify(success)).not.toContain(FAKE_KEY);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 500 }))
    );
    const failure = await sendBriefingEmail(PAYLOAD);
    expect(JSON.stringify(failure)).not.toContain(FAKE_KEY);
  });

  it("never logs the API key, even when the underlying fetch call throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new TypeError(`fetch failed with key ${FAKE_KEY}`))
    );

    await sendBriefingEmail(PAYLOAD);

    for (const call of errorSpy.mock.calls) {
      const logged = call.map((arg) => String(arg)).join(" ");
      expect(logged).not.toContain(FAKE_KEY);
    }
  });
});
