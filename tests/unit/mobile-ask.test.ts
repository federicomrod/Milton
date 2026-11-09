import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  askNeedsLocation,
  chunkAnswer,
  clarifyTurn,
  MAX_AUDIO_BYTES,
  sseEvent,
} from "@/lib/restaurant/mobile-manager/ask";
import { filterMenuItemsForSelection } from "@/lib/restaurant/profitability-server";
import { resolveSelectedLocation } from "@/lib/restaurant/restaurant-context-server";

const h = vi.hoisted(() => ({
  auth: null as unknown,
  /** Run the REAL authManager (over a faked bearer login) instead of h.auth. */
  useReal: false,
  run: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@/lib/restaurant/mobile-manager/auth", async (orig) => {
  const real =
    await orig<typeof import("@/lib/restaurant/mobile-manager/auth")>();
  return {
    ...real,
    authManager: vi.fn(async (...a: Parameters<typeof real.authManager>) =>
      h.useReal ? real.authManager(...a) : h.auth
    ),
  };
});
// The real authManager needs a bearer login, a role and the restaurant list.
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompanyFromBearer: vi.fn(async () => ({
    ok: true,
    supabase: {},
    companyId: "co",
    userId: "u",
    email: null,
  })),
  authAndCompany: vi.fn(async () => ({
    ok: true,
    supabase: {},
    companyId: "co",
    userId: "u",
  })),
}));
vi.mock("@/lib/auth/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/permissions")>()),
  resolveActor: vi.fn(async () => ({ role: "owner" })),
  can: vi.fn(() => true),
}));
vi.mock("@/lib/restaurant/restaurant-context-server", async (orig) => {
  const real =
    await orig<typeof import("@/lib/restaurant/restaurant-context-server")>();
  return {
    ...real,
    // Same selection logic as production over a company with two brands.
    resolveRestaurantContext: vi.fn(
      async (_s: unknown, _c: unknown, requested: string | null) => ({
        locations: BRAND_LOCATIONS,
        selected: real.resolveSelectedLocation(BRAND_LOCATIONS, requested),
      })
    ),
  };
});
vi.mock("@/lib/restaurant/ask-milton-run", async (orig) => ({
  ...(await orig<typeof import("@/lib/restaurant/ask-milton-run")>()),
  runAskMilton: (...a: unknown[]) => h.run(...a),
}));
vi.mock("@/lib/ai/call", () => ({
  runTranscription: (...a: unknown[]) => h.transcribe(...a),
  aiUnavailableFor: () => null,
}));

import { POST as ask } from "@/app/api/mobile/v1/ask/route";
import { POST as webAsk } from "@/app/api/restaurant/ask-milton/route";
import { POST as transcribe } from "@/app/api/mobile/v1/ask/transcribe/route";

// Two restaurants of different brands.
const BRAND_LOCATIONS = [
  { id: "l1", name: "Centro", brand_id: "brand-a" },
  { id: "l2", name: "Norte", brand_id: "brand-b" },
];
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
  selected: over.locationId
    ? { locationId: over.locationId as string, brandId: "brand-a" }
    : null,
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
  h.useReal = false;
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
      brandId: "brand-a",
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
    expect((await transcribe(audio(MAX_AUDIO_BYTES + 1))).status).toBe(413);
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

describe("the restaurant's brand reaches the assistant (phone = web)", () => {
  const MENU = [
    { name: "Bowl A", brand_id: "brand-a", location_id: null },
    { name: "Taco B", brand_id: "brand-b", location_id: null },
    { name: "Café (shared)", brand_id: null, location_id: null },
    { name: "Special at Centro", brand_id: "brand-a", location_id: "l1" },
    { name: "Special at Norte", brand_id: "brand-b", location_id: "l2" },
  ];
  const names = (sel: { locationId: string; brandId: string | null } | null) =>
    filterMenuItemsForSelection(MENU, sel)
      .map((m) => m.name)
      .sort();

  async function phoneSelection(location: string) {
    h.useReal = true;
    h.run.mockClear();
    await (
      await ask(
        new NextRequest(
          `http://localhost/api/mobile/v1/ask?location=${location}`,
          {
            method: "POST",
            body: JSON.stringify({ message: "¿qué platos dejan más margen?" }),
          }
        )
      )
    ).text();
    return h.run.mock.calls[0][0].selected;
  }
  async function webSelection(location: string) {
    h.run.mockClear();
    await webAsk(
      new NextRequest(
        `http://localhost/api/restaurant/ask-milton?location=${location}`,
        {
          method: "POST",
          body: JSON.stringify({ message: "¿qué platos dejan más margen?" }),
        }
      )
    );
    return h.run.mock.calls[0][0].selected;
  }

  it("with ?location= set the phone passes that restaurant's own brandId", async () => {
    expect(await phoneSelection("l1")).toEqual({
      locationId: "l1",
      brandId: "brand-a",
    });
    expect(await phoneSelection("l2")).toEqual({
      locationId: "l2",
      brandId: "brand-b",
    });
  });

  it("phone and web build the same selection for the same restaurant", async () => {
    for (const id of ["l1", "l2"]) {
      expect(await phoneSelection(id)).toEqual(await webSelection(id));
      expect(await phoneSelection(id)).toEqual(
        resolveSelectedLocation(BRAND_LOCATIONS, id)
      );
    }
  });

  it("their dishes stay scoped: each restaurant sees its own brand + shared items, never the other brand's", async () => {
    const a = await phoneSelection("l1");
    const b = await phoneSelection("l2");
    expect(names(a)).toEqual(["Bowl A", "Café (shared)", "Special at Centro"]);
    expect(names(b)).toEqual(["Café (shared)", "Special at Norte", "Taco B"]);
    expect(names(a)).not.toContain("Taco B");
    expect(names(b)).not.toContain("Bowl A");
    // Phone and web scope identically.
    expect(names(a)).toEqual(names(await webSelection("l1")));
    expect(names(b)).toEqual(names(await webSelection("l2")));
  });

  it("the old phone selection (brandId null) would have scoped wrongly", () => {
    expect(names({ locationId: "l1", brandId: null })).not.toEqual(
      names({ locationId: "l1", brandId: "brand-a" })
    );
  });

  it("no location (company-wide) or an unknown one gives no selection, like the web", async () => {
    h.useReal = true;
    h.run.mockClear();
    await (
      await ask(
        new NextRequest("http://localhost/api/mobile/v1/ask?location=nope", {
          method: "POST",
          body: JSON.stringify({ message: "hola", scope: "all" }),
        })
      )
    ).text();
    expect(h.run.mock.calls[0][0].selected).toBeNull();
  });
});
