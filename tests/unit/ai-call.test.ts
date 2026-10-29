import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
let todaysAlertRows = 0;
let adminThrows = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminThrows) throw new Error("no admin");
    const query: Record<string, unknown> = {
      select: () => query,
      in: () => query,
      gte: async () => ({ count: todaysAlertRows, error: null }),
    };
    return { from: () => ({ ...query, insert }) };
  },
}));

const sendEmail = vi.fn();
vi.mock("@/lib/restaurant/email/send", () => ({
  sendBriefingEmail: (...a: unknown[]) => sendEmail(...a),
}));

import {
  AiCallError,
  aiUnavailableFor,
  classifyAiError,
  runChat,
  runTranscription,
  unwrapAi,
} from "@/lib/ai/call";
import {
  estimateChatCostUsd,
  estimateTranscriptionCostUsd,
} from "@/lib/ai/prices";
import { shouldAlert, summarizeEvents } from "@/lib/ai/daily-cost-check";

function apiError(status: number, code: string | null, name = "APIError") {
  return Object.assign(new Error(`HTTP ${status}`), { name, status, code });
}

function fakeClient(create: ReturnType<typeof vi.fn>) {
  return {
    chat: { completions: { create } },
    audio: { transcriptions: { create } },
  } as never;
}

const PARAMS = {
  model: "gpt-4o-mini",
  messages: [{ role: "user" as const, content: "SECRET-PROMPT" }],
};

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  sendEmail.mockReset().mockResolvedValue({ ok: true });
  todaysAlertRows = 0;
  adminThrows = false;
  delete process.env.AI_ALERT_EMAIL;
});

describe("classifyAiError", () => {
  it("429 insufficient_quota is quota", () => {
    expect(classifyAiError(apiError(429, "insufficient_quota")).kind).toBe(
      "quota"
    );
  });
  it("billing codes are billing", () => {
    expect(
      classifyAiError(apiError(400, "billing_hard_limit_reached")).kind
    ).toBe("billing");
  });
  it("another 429 is rate_limit", () => {
    expect(classifyAiError(apiError(429, "rate_limit_exceeded")).kind).toBe(
      "rate_limit"
    );
    expect(classifyAiError(apiError(429, null)).kind).toBe("rate_limit");
  });
  it("aborts and timeouts are timeout", () => {
    expect(
      classifyAiError(apiError(0, null, "APIConnectionTimeoutError")).kind
    ).toBe("timeout");
    expect(classifyAiError(apiError(0, null, "APIUserAbortError")).kind).toBe(
      "timeout"
    );
    expect(
      classifyAiError(Object.assign(new Error("x"), { name: "AbortError" }))
        .kind
    ).toBe("timeout");
  });
  it("anything else is other", () => {
    expect(classifyAiError(apiError(500, null)).kind).toBe("other");
    expect(classifyAiError("weird").kind).toBe("other");
  });
});

describe("cost estimate", () => {
  it("prices cached input at the cached rate", () => {
    // (600 * 0.15 + 400 * 0.075 + 500 * 0.60) / 1e6
    expect(
      estimateChatCostUsd("gpt-4o-mini", {
        inputTokens: 1000,
        cachedInputTokens: 400,
        outputTokens: 500,
      })
    ).toBeCloseTo(0.00042, 9);
  });
  it("prices whisper per minute", () => {
    expect(estimateTranscriptionCostUsd("whisper-1", 90)).toBeCloseTo(0.009, 9);
    expect(estimateTranscriptionCostUsd("whisper-1", null)).toBeNull();
  });
  it("gives no estimate for an unknown model", () => {
    expect(
      estimateChatCostUsd("gpt-future", {
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 10,
      })
    ).toBeNull();
  });
});

describe("runChat", () => {
  it("returns the completion and logs tokens, cost and latency, never content", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "SECRET-ANSWER" } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    });
    const r = await runChat({
      feature: "test-feature",
      companyId: "co-1",
      client: fakeClient(create),
      params: PARAMS,
    });
    expect(r.ok).toBe(true);
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      company_id: "co-1",
      feature: "test-feature",
      model: "gpt-4o-mini",
      input_tokens: 1000,
      cached_input_tokens: 400,
      output_tokens: 500,
      status: "ok",
      error_kind: null,
    });
    expect(row.est_cost_usd).toBeCloseTo(0.00042, 9);
    expect(JSON.stringify(row)).not.toMatch(/SECRET/);
  });

  it("never retries: one attempt, maxRetries 0 and a timeout on the request", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(apiError(429, "insufficient_quota"));
    const r = await runChat({
      feature: "f",
      client: fakeClient(create),
      params: PARAMS,
    });
    expect(r).toMatchObject({ ok: false, kind: "quota" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
    expect(create.mock.calls[0][1].timeout).toBeGreaterThan(0);
  });

  it("a logging failure does not break the call", async () => {
    adminThrows = true;
    const create = vi.fn().mockResolvedValue({ choices: [] });
    const r = await runChat({
      feature: "f",
      client: fakeClient(create),
      params: PARAMS,
    });
    expect(r.ok).toBe(true);
    insert.mockRejectedValue(new Error("db down"));
    adminThrows = false;
    const r2 = await runChat({
      feature: "f",
      client: fakeClient(create),
      params: PARAMS,
    });
    expect(r2.ok).toBe(true);
  });

  it("the first quota error of the day sends one alert; later ones do not", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(apiError(429, "insufficient_quota"));
    process.env.AI_ALERT_EMAIL = "admin@example.com";
    await runChat({ feature: "f", client: fakeClient(create), params: PARAMS });
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(sendEmail.mock.calls[0][0].to).toBe("admin@example.com");
    expect(JSON.stringify(sendEmail.mock.calls[0][0])).not.toMatch(/SECRET/);

    sendEmail.mockClear();
    insert.mockClear();
    todaysAlertRows = 1;
    await runChat({ feature: "f", client: fakeClient(create), params: PARAMS });
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("with no admin address it only logs one [ai-alert] line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const create = vi
      .fn()
      .mockRejectedValue(apiError(429, "insufficient_quota"));
    await runChat({ feature: "f", client: fakeClient(create), params: PARAMS });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.calls[0][0])).toContain("[ai-alert]");
    expect(sendEmail).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("runTranscription", () => {
  it("classifies a quota error and logs the audio seconds", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(apiError(429, "insufficient_quota"));
    const r = await runTranscription({
      feature: "voice",
      client: fakeClient(create),
      audioSeconds: 12,
      params: {
        file: new File([new Uint8Array(1)], "v.ogg"),
        model: "whisper-1",
      },
    });
    expect(r).toMatchObject({ ok: false, kind: "quota" });
    expect(aiUnavailableFor(r)).toBe("quota");
    await vi.waitFor(() => expect(insert).toHaveBeenCalled());
    expect(insert.mock.calls[0][0]).toMatchObject({
      feature: "voice",
      audio_seconds: 12,
      status: "error",
      error_kind: "quota",
    });
  });
});

describe("unwrapAi", () => {
  it("throws an AiCallError carrying the kind", () => {
    try {
      unwrapAi({ ok: false, kind: "quota" });
      throw new Error("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AiCallError);
      expect((err as AiCallError).kind).toBe("quota");
    }
  });
});

describe("daily cost check", () => {
  it("alerts over the threshold or on any quota/billing error", () => {
    const quiet = summarizeEvents([
      { est_cost_usd: "0.4", status: "ok", error_kind: null },
      { est_cost_usd: null, status: "error", error_kind: "timeout" },
    ]);
    expect(quiet).toMatchObject({ totalUsd: 0.4, otherErrors: 1 });
    expect(shouldAlert(quiet)).toBe(false);
    expect(
      shouldAlert(
        summarizeEvents([{ est_cost_usd: 1.5, status: "ok", error_kind: null }])
      )
    ).toBe(true);
    expect(
      shouldAlert(
        summarizeEvents([
          { est_cost_usd: null, status: "error", error_kind: "billing" },
        ])
      )
    ).toBe(true);
  });
});
