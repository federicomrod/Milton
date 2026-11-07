import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  askNeedsLocation,
  chunkAnswer,
  clarifyTurn,
  sseEvent,
} from "@/lib/restaurant/mobile-manager/ask";

const h = vi.hoisted(() => ({
  auth: null as unknown,
  run: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@/lib/restaurant/mobile-manager/auth", () => ({
  authManager: vi.fn(async () => h.auth),
}));
vi.mock("@/lib/restaurant/ask-milton-run", async (orig) => ({
  ...(await orig<typeof import("@/lib/restaurant/ask-milton-run")>()),
  runAskMilton: (...a: unknown[]) => h.run(...a),
}));
vi.mock("@/lib/ai/call", () => ({
  runTranscription: (...a: unknown[]) => h.transcribe(...a),
  aiUnavailableFor: () => null,
}));

import { POST as ask } from "@/app/api/mobile/v1/ask/route";
import { POST as transcribe } from "@/app/api/mobile/v1/ask/transcribe/route";

const LOCS = [
  { id: "l1", name: "Centro" },
  { id: "l2", name: "Norte" },
];
const okAuth = (over: Record<string, unknown> = {}) => ({
  ok: true,
  supabase: {},
  companyId: "co",
  userId: "u",
  lang: "es",
  locations: LOCS,
  locationId: null,
  singleLocationId: null,
  ...over,
});
const payload = {
  source: "deterministic",
  generated_at: "x",
  answer: "Vendiste más el viernes que el jueves.",
  supporting_facts: [
    { label: "Viernes", value: "$1,200", source_area: "sales" },
  ],
  related_links: [{ label: "web", href: "/dashboard" }],
  suggested_followups: ["¿Y el sábado?"],
  confidence_notes: [],
  suggested_actions: [{ id: "web-only" }],
  ai_unavailable: null,
};
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/mobile/v1/ask", {
    method: "POST",
    body: JSON.stringify(body),
  });
const events = (text: string) =>
  text
    .trim()
    .split("\n\n")
    .map((b) => ({
      event: /^event: (.*)$/m.exec(b)![1],
      data: JSON.parse(/^data: (.*)$/m.exec(b)![1]),
    }));

beforeEach(() => {
  h.auth = okAuth();
  h.run.mockReset().mockResolvedValue(payload);
  h.transcribe.mockReset();
});

describe("clarify rule (decided in code)", () => {
  it("asks only with several restaurants, none chosen and «Todos» not picked", () => {
    expect(
      askNeedsLocation({ locationCount: 2, locationId: null, scopeAll: false })
    ).toBe(true);
    expect(
      askNeedsLocation({ locationCount: 2, locationId: "l1", scopeAll: false })
    ).toBe(false);
    expect(
      askNeedsLocation({ locationCount: 2, locationId: null, scopeAll: true })
    ).toBe(false);
    expect(
      askNeedsLocation({ locationCount: 1, locationId: null, scopeAll: false })
    ).toBe(false);
    expect(
      askNeedsLocation({ locationCount: 0, locationId: null, scopeAll: false })
    ).toBe(false);
  });
  it("offers every restaurant plus «todos»", () => {
    const t = clarifyTurn(LOCS, { question: "¿Cuál?", all: "Todos" });
    expect(t.options.map((o) => o.label)).toEqual(["Centro", "Norte", "Todos"]);
    expect(t.options[2].id).toBeNull();
  });
});

describe("streaming helpers", () => {
  it("chunks keep the exact text", () => {
    const text = "Vendiste  más el viernes que el jueves, con 40 tickets más.";
    expect(chunkAnswer(text).join("")).toBe(text);
    expect(chunkAnswer("")).toEqual([]);
  });
  it("frames one event per block", () => {
    expect(sseEvent("delta", { text: "a" })).toBe(
      'event: delta\ndata: {"text":"a"}\n\n'
    );
  });
});

describe("POST /api/mobile/v1/ask", () => {
  it("returns the auth failure as is (kitchen token 401, wrong role 403) and never runs the engine", async () => {
    h.auth = {
      ok: false,
      response: NextResponse.json({ error: "no" }, { status: 403 }),
    };
    const res = await ask(post({ message: "hola" }));
    expect(res.status).toBe(403);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("rejects an empty or too long question", async () => {
    expect((await ask(post({ message: "  " }))).status).toBe(400);
    expect((await ask(post({ message: "x".repeat(2001) }))).status).toBe(400);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("clarifies the restaurant instead of guessing, without calling the engine", async () => {
    const res = await ask(post({ message: "¿cómo voy?" }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const [e] = events(await res.text());
    expect(e.event).toBe("clarify");
    expect(e.data.options.map((o: { label: string }) => o.label)).toEqual([
      "Centro",
      "Norte",
      "Todos los restaurantes",
    ]);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("answers for one restaurant: deltas, then one final, scoped to that restaurant", async () => {
    h.auth = okAuth({ locationId: "l1" });
    const res = await ask(post({ message: "¿cómo voy?" }));
    const ev = events(await res.text());
    expect(ev.at(-1)!.event).toBe("final");
    expect(ev.slice(0, -1).every((e) => e.event === "delta")).toBe(true);
    expect(
      ev
        .filter((e) => e.event === "delta")
        .map((e) => e.data.text)
        .join("")
    ).toBe(payload.answer);
    const fin = ev.at(-1)!.data;
    expect(fin).toMatchObject({
      answer: payload.answer,
      facts: [{ label: "Viernes", value: "$1,200" }],
      followups: ["¿Y el sábado?"],
      source: "deterministic",
    });
    // Web-only fields never reach the phone.
    expect(fin.related_links).toBeUndefined();
    expect(fin.suggested_actions).toBeUndefined();
    expect(h.run.mock.calls[0][0].selected).toEqual({
      locationId: "l1",
      brandId: null,
    });
  });

  it("«Todos» (scope all) answers company-wide without a question", async () => {
    const res = await ask(post({ message: "¿cómo voy?", scope: "all" }));
    expect(events(await res.text()).at(-1)!.event).toBe("final");
    expect(h.run.mock.calls[0][0].selected).toBeNull();
  });

  it("a single restaurant never needs the question", async () => {
    h.auth = okAuth({ locations: [LOCS[0]], singleLocationId: "l1" });
    const res = await ask(post({ message: "hola" }));
    expect(events(await res.text()).at(-1)!.event).toBe("final");
  });

  it("an engine failure is one translated error event, no details", async () => {
    h.auth = okAuth({ locationId: "l1" });
    h.run.mockRejectedValue(new Error("secret db detail"));
    const text = await (await ask(post({ message: "hola" }))).text();
    const [e] = events(text);
    expect(e.event).toBe("error");
    expect(text).not.toContain("secret db detail");
  });

  it("passes only the last turns of the conversation", async () => {
    h.auth = okAuth({ locationId: "l1" });
    const conversation = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `t${i}`,
    }));
    await (await ask(post({ message: "y?", conversation }))).text();
    expect(h.run.mock.calls[0][0].conversation).toHaveLength(6);
  });
});

describe("POST /api/mobile/v1/ask/transcribe", () => {
  const audio = (n: number) =>
    new NextRequest("http://localhost/api/mobile/v1/ask/transcribe", {
      method: "POST",
      body: new Uint8Array(n),
      headers: { "content-type": "audio/m4a" },
    });

  it("returns the text of a spoken question", async () => {
    h.transcribe.mockResolvedValue({
      ok: true,
      value: { text: " ¿Cómo voy? " },
    });
    const res = await transcribe(audio(1000));
    expect(await res.json()).toEqual({ text: "¿Cómo voy?" });
    expect(h.transcribe.mock.calls[0][0].params.language).toBe("es");
  });
  it("refuses an empty or oversized recording and a failed transcription", async () => {
    expect((await transcribe(audio(0))).status).toBe(400);
    expect((await transcribe(audio(1_500_001))).status).toBe(413);
    h.transcribe.mockResolvedValue({ ok: false, kind: "error" });
    expect((await transcribe(audio(1000))).status).toBe(502);
    h.transcribe.mockResolvedValue({ ok: true, value: { text: "  " } });
    expect((await transcribe(audio(1000))).status).toBe(422);
  });
  it("is role-gated like every Gestión route", async () => {
    h.auth = { ok: false, response: NextResponse.json({}, { status: 403 }) };
    expect((await transcribe(audio(1000))).status).toBe(403);
    expect(h.transcribe).not.toHaveBeenCalled();
  });
});
