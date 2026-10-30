// Cocina app messages go through the SAME pipeline Telegram kitchen messages
// use (mobile #431): rules + price AI + kitchen AI, drafts that wait for a
// manager, stock alerts for Cocina. Nothing is sent to Telegram; the phone gets
// a result without amounts. Real shared code over an in-memory database; only
// the AI, the invoice writer and Storage are stand-ins.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-supabase";

const CO = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";
const STAFF = "44444444-4444-4444-8444-444444444441";
const R1 = "77777777-7777-4777-8777-777777777771";
const R2 = "77777777-7777-4777-8777-777777777772";
const R3 = "77777777-7777-4777-8777-777777777773";

const h = vi.hoisted(() => ({
  state: { db: null as any },
  interpret: vi.fn(),
  transcribe: vi.fn(),
  createDraft: vi.fn(),
  fetchSpy: vi.fn(),
  aiUnavailable: vi.fn(),
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {
    throw new Error("outside a request");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.state.db.client,
}));
vi.mock("@/lib/restaurant/telegram/kitchen-intent-ai", async (orig) => ({
  ...(await orig<
    typeof import("@/lib/restaurant/telegram/kitchen-intent-ai")
  >()),
  interpretKitchenMessage: (...a: unknown[]) => h.interpret(...a),
}));
vi.mock("@/lib/restaurant/telegram/kitchen-context", () => ({
  buildKitchenContext: async () => ({
    conversation: [],
    company_currency: "USD",
    ingredient_hints: [],
    pending_question: null,
  }),
}));
vi.mock("@/lib/ai/call", () => ({
  runTranscription: (...a: unknown[]) => h.transcribe(...a),
  aiUnavailableFor: (...a: unknown[]) => h.aiUnavailable(...a),
  runChat: vi.fn(async () => ({ ok: false, kind: "not_configured" })),
}));
vi.mock("@/lib/restaurant/telegram/price-update-ai", () => ({
  askPriceAi: vi.fn(async () => null),
}));
vi.mock("@/lib/restaurant/invoice-draft", async (orig) => ({
  ...(await orig<typeof import("@/lib/restaurant/invoice-draft")>()),
  createInvoiceDraft: (...a: unknown[]) => h.createDraft(...a),
  invoiceExistsForKitchenReport: async () => false,
}));
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));
vi.mock("@/lib/restaurant/pos-timezone", () => ({
  resolvePosTimezone: async () => "America/El_Salvador",
}));

import {
  processAppReport,
  summarizeSink,
} from "@/lib/restaurant/kitchen/pipeline/app-message";
import {
  appChatId,
  appMessageId,
  UNCLEAR_REASONS,
  recordPipelineEvent,
  runWithReplySink,
  sinkFor,
} from "@/lib/restaurant/kitchen/pipeline/reply-sink";
import { NextRequest } from "next/server";
import { applyPriceResult } from "@/lib/restaurant/kitchen/pipeline/message-pipeline";
import { withKitchenLanguage } from "@/lib/restaurant/telegram/kitchen-language";
import { hashToken } from "@/lib/restaurant/kitchen/app-identity";
import {
  assertNoMoneyFields,
  serializeAppResult,
} from "@/lib/restaurant/kitchen/kitchen-serializer";
import { GET as historyGET } from "@/app/api/mobile/v1/kitchen/history/route";
import { sendTelegramMessage } from "@/lib/restaurant/telegram/send";
import { APP_PRICE_UPDATE_NOTE_PREFIX } from "@/lib/restaurant/price-update-note";

function seed(extra: Record<string, any[]> = {}): FakeDb {
  return createFakeDb({
    companies: [{ id: CO, name: "Casa A", preferred_language: "es" }],
    restaurant_locations: [
      { id: LOC, company_id: CO, name: "Centro", status: "active" },
    ],
    kitchen_staff: [
      {
        id: STAFF,
        company_id: CO,
        location_id: LOC,
        display_name: "Luis",
        is_active: true,
      },
    ],
    supplier_invoices: [
      { id: "inv-1", company_id: CO, status: "needs_review" },
    ],
    supplier_invoice_lines: [],
    kitchen_reports: [],
    kitchen_media: [],
    ...extra,
  });
}

const report = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  company_id: CO,
  location_id: LOC,
  staff_id: STAFF,
  report_type: "unclassified",
  text: null,
  media_kind: null,
  transcript: null,
  processed_at: null,
  app_result: null,
  channel: "app",
  created_at: "2026-10-30T10:00:00.000Z",
  ...over,
});

const resultOf = (id: string) =>
  h.state.db.tables.kitchen_reports.find((r: any) => r.id === id);

beforeEach(() => {
  h.state.db = seed();
  h.interpret.mockReset().mockResolvedValue(null);
  h.transcribe.mockReset();
  h.aiUnavailable.mockReset().mockReturnValue(null);
  h.createDraft
    .mockReset()
    .mockResolvedValue({ ok: true, invoiceId: "inv-1", unmatched: 0 });
  h.fetchSpy
    .mockReset()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} })));
  vi.stubGlobal("fetch", h.fetchSpy);
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reply sink", () => {
  it("captures only the app cook's own chat; every other message still goes to Telegram", async () => {
    const mine = appChatId(STAFF);
    const sink = { chatId: mine, messages: [] as string[], events: [] };
    await runWithReplySink(sink, async () => {
      expect(await sendTelegramMessage(mine, "para el celular")).toEqual({
        ok: true,
      });
      await sendTelegramMessage(99887766, "para otro chat");
    });
    expect(sink.messages).toEqual(["para el celular"]);
    expect(h.fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(h.fetchSpy.mock.calls[0][0])).toContain("/sendMessage");
    expect(String(h.fetchSpy.mock.calls[0][1].body)).toContain(
      "para otro chat"
    );
  });

  it("outside a sink (every Telegram request) nothing changes", async () => {
    expect(sinkFor(123)).toBeUndefined();
    recordPipelineEvent({ kind: "question", ask: "unit", products: ["pan"] }); // no-op
    await sendTelegramMessage(123, "hola");
    expect(h.fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("pseudo ids are negative, stable, and never collide with a real Telegram chat", () => {
    const c = appChatId(STAFF);
    expect(c).toBeLessThan(-1_000_000_000_000_000);
    expect(appChatId(STAFF)).toBe(c);
    expect(appChatId("44444444-4444-4444-8444-444444444442")).not.toBe(c);
    expect(appMessageId(R1)).toBeGreaterThan(0);
    expect(appMessageId(R1)).not.toBe(appMessageId(R2));
  });
});

describe("summarizeSink", () => {
  const sink = (events: any[], messages: string[] = []) => ({
    events,
    messages,
  });
  const spanish = <T>(fn: () => T): T => withKitchenLanguage("es", fn);

  it("a price draft, a stock alert, a question, nothing, a recipe", () => {
    expect(
      summarizeSink(
        sink([{ kind: "price_draft", products: ["pan"] }]),
        "handled"
      )
    ).toMatchObject({
      state: "done",
      draft: true,
      noted: false,
      understood: ["pan"],
      asks: null,
      unclear: null,
    });
    expect(
      summarizeSink(
        sink([
          {
            kind: "stock",
            reportType: "running_out",
            products: ["queso fresco"],
          },
        ]),
        "handled"
      )
    ).toMatchObject({
      noted: true,
      draft: false,
      understood: ["queso fresco"],
    });
    expect(summarizeSink(sink([], []), "handled").unclear).toBeNull();
    expect(summarizeSink(sink([], []), "recipe")).toMatchObject({
      recipe: true,
      unclear: null,
    });
  });

  it("a unit question is REBUILT from the copy with the product names, never copied from a reply", () => {
    const leaked =
      "✅ Anoté en Casa: pan $2.00 el kilo.\n\n¿El precio de queso es por libra, onza o unidad?";
    const result = spanish(() =>
      summarizeSink(
        sink(
          [
            { kind: "price_draft", products: ["pan"] },
            { kind: "question", ask: "unit", products: ["queso"] },
          ],
          [leaked]
        ),
        "handled"
      )
    );
    expect(result.asks).toEqual({
      kind: "unit",
      text: "¿El precio de queso es por libra, onza o unidad?",
    });
    expect(JSON.stringify(result)).not.toContain("$2.00");
    expect(JSON.stringify(result)).not.toContain("Anoté");
    // Two products are joined by the copy's own helper, in the company language.
    const two = spanish(() =>
      summarizeSink(
        sink([{ kind: "question", ask: "unit", products: ["queso", "sal"] }]),
        "handled"
      )
    );
    expect(two.asks?.text).toMatch(/queso/);
    expect(two.asks?.text).toMatch(/sal/);
  });

  it("an amount question has no text at all (it would repeat prices)", () => {
    const result = spanish(() =>
      summarizeSink(
        sink([{ kind: "question", ask: "amount" }], ["¿1.50 o 150?"]),
        "handled"
      )
    );
    expect(result.asks).toEqual({ kind: "amount", text: null });
  });

  it("«could not read it» is only ever a reason code, whatever the reply says", () => {
    const replies: Array<[string, string]> = [
      [
        "No entendí el precio. Escribe producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
        "price_unclear",
      ],
      [
        "No pude guardar el precio. Vuelve a mandarlo en un momento.",
        "save_failed",
      ],
      [
        "Dijiste pesos, pero Casa trabaja en dólares. Mándame el precio en dólares.",
        "currency_mismatch",
      ],
      [
        "No pude escuchar el audio. Mándalo otra vez o escríbelo.",
        "unreadable",
      ],
      [
        "Milton no puede escuchar audios ahora mismo. Escríbelo o inténtalo más tarde.",
        "ai_unavailable",
      ],
      [
        "No pude leer los precios ahora. Escríbelos así: producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
        "ai_unavailable",
      ],
      ["Hola, ¿qué pasó en la cocina?", "other"],
    ];
    for (const [reply, code] of replies) {
      const result = spanish(() => summarizeSink(sink([], [reply]), "handled"));
      expect(result.unclear, reply).toBe(code);
      expect(JSON.stringify(result)).not.toContain("$");
    }
    // A save failure that follows a long reply with a suffix is still just a code.
    expect(
      spanish(() =>
        summarizeSink(
          sink(
            [],
            [
              "No pude guardar el precio. Vuelve a mandarlo en un momento.\n\n¿El precio de queso es por libra, onza o unidad?",
            ]
          ),
          "handled"
        )
      ).unclear
    ).toBe("save_failed");
  });

  it("a reported reason (voice) wins over any reply", () => {
    expect(
      summarizeSink(
        sink([{ kind: "unclear", reason: "unreadable" }], []),
        "handled"
      ).unclear
    ).toBe("unreadable");
  });
});

describe("a text message through the same pipeline", () => {
  it("«compramos pan a 2 dólares el kilo» becomes a draft «por App», nothing goes to Telegram", async () => {
    h.state.db.tables.kitchen_reports.push(
      report(R1, { text: "compramos pan a 2 dólares el kilo" })
    );
    await processAppReport({
      staffId: STAFF,
      reportId: R1,
      admin: h.state.db.client,
    });

    expect(h.createDraft).toHaveBeenCalledTimes(1);
    const [, draft] = h.createDraft.mock.calls[0];
    expect(draft.extraNotes).toBe(APP_PRICE_UPDATE_NOTE_PREFIX);
    expect(draft.eventMetadata).toMatchObject({
      source: "app",
      kind: "price_update",
      kitchen_report_id: R1,
      staff_id: STAFF,
    });
    expect(draft.companyId).toBe(CO);
    expect(draft.extraction.lines).toHaveLength(1);
    expect(draft.extraction.lines[0]).toMatchObject({ unit: "kg" });

    const row = resultOf(R1);
    expect(row.app_result).toMatchObject({
      state: "done",
      draft: true,
      noted: false,
    });
    expect(row.app_result.understood.join(" ").toLowerCase()).toContain("pan");
    expect(row.processed_at).toBeTruthy();
    // The cook never sees a price.
    const { understood, asks, unclear } = row.app_result;
    expect(JSON.stringify({ understood, asks, unclear })).not.toMatch(/\d/);
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("processes a report once: a second call does nothing", async () => {
    h.state.db.tables.kitchen_reports.push(
      report(R1, { text: "compramos pan a 2 dólares el kilo" })
    );
    await processAppReport({
      staffId: STAFF,
      reportId: R1,
      admin: h.state.db.client,
    });
    await processAppReport({
      staffId: STAFF,
      reportId: R1,
      admin: h.state.db.client,
    });
    expect(h.createDraft).toHaveBeenCalledTimes(1);
  });

  it("another cook's report is never processed", async () => {
    h.state.db.tables.kitchen_reports.push(
      report(R1, { text: "compramos pan a 2 dólares el kilo" })
    );
    await processAppReport({
      staffId: "44444444-4444-4444-8444-444444444449",
      reportId: R1,
      admin: h.state.db.client,
    });
    expect(h.createDraft).not.toHaveBeenCalled();
    expect(resultOf(R1).app_result).toBeNull();
  });

  it("«se nos acaba el queso fresco» is a stock alert for Cocina, stored on the report", async () => {
    h.interpret.mockResolvedValue({
      intent: "stock_report",
      items: [
        {
          product: "queso fresco",
          amount: 0,
          unit: null,
          currency: null,
          matched_ingredient_id: null,
        },
      ],
      clarify_question: null,
    });
    h.state.db.tables.kitchen_reports.push(
      report(R2, { text: "se nos acaba el queso fresco" })
    );
    await processAppReport({
      staffId: STAFF,
      reportId: R2,
      admin: h.state.db.client,
    });

    const row = resultOf(R2);
    expect(row.report_type).toBe("running_out");
    expect(row.app_result).toMatchObject({
      state: "done",
      noted: true,
      draft: false,
    });
    expect(row.app_result.understood).toContain("queso fresco");
    expect(h.createDraft).not.toHaveBeenCalled();
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("a price without a unit becomes «Milton te pregunta»; answering it later saves the draft", async () => {
    h.state.db.tables.kitchen_reports.push(
      report(R1, { text: "compramos pan a 2 dólares" })
    );
    await processAppReport({
      staffId: STAFF,
      reportId: R1,
      admin: h.state.db.client,
    });
    const asked = resultOf(R1).app_result;
    expect(asked.asks).toMatchObject({ kind: "unit" });
    expect(typeof asked.asks.text).toBe("string");
    expect(h.createDraft).not.toHaveBeenCalled();

    h.state.db.tables.kitchen_reports.push(
      report(R2, { text: "por kilo", created_at: "2026-10-30T10:01:00.000Z" })
    );
    await processAppReport({
      staffId: STAFF,
      reportId: R2,
      admin: h.state.db.client,
    });
    expect(h.createDraft).toHaveBeenCalledTimes(1);
    expect(h.createDraft.mock.calls[0][1].extraction.lines[0]).toMatchObject({
      unit: "kg",
    });
    expect(resultOf(R2).app_result).toMatchObject({
      state: "done",
      draft: true,
    });
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });
});

describe("a voice note through the same pipeline", () => {
  const voice = () => {
    h.state.db.tables.kitchen_reports.push(
      report(R3, { media_kind: "voice", media_mime: "audio/mp4" })
    );
    h.state.db.tables.kitchen_media.push({
      id: R3,
      company_id: CO,
      kitchen_report_id: R3,
      storage_path: "co/loc/2026/10/v.m4a",
      mime: "audio/mp4",
    });
  };

  it("is transcribed first, the transcript is kept, then it is read like any message", async () => {
    voice();
    h.state.db.objects.set("co/loc/2026/10/v.m4a", 2000);
    h.transcribe.mockResolvedValue({
      ok: true,
      value: { text: "compramos pan a 2 dólares el kilo" },
    });
    await processAppReport({
      staffId: STAFF,
      reportId: R3,
      admin: h.state.db.client,
    });

    expect(h.transcribe).toHaveBeenCalledTimes(1);
    expect(h.transcribe.mock.calls[0][0]).toMatchObject({
      feature: "app-voice",
      companyId: CO,
    });
    const row = resultOf(R3);
    expect(row.transcript).toBe("compramos pan a 2 dólares el kilo");
    expect(row.app_result).toMatchObject({ state: "done", draft: true });
    expect(h.createDraft.mock.calls[0][1].eventMetadata.source).toBe("app");
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("a note that cannot be heard says so with a CODE, instead of staying silent", async () => {
    voice();
    h.state.db.objects.set("co/loc/2026/10/v.m4a", 2000);
    h.transcribe.mockResolvedValue({ ok: false, kind: "timeout" });
    await processAppReport({
      staffId: STAFF,
      reportId: R3,
      admin: h.state.db.client,
    });
    const result = resultOf(R3).app_result;
    expect(result.state).toBe("done");
    expect(result.unclear).toBe("unreadable");
    expect(h.createDraft).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  it("is recorded, never thrown, and the message is not lost", async () => {
    h.state.db.tables.kitchen_reports.push(
      report(R1, { text: "compramos pan a 2 dólares el kilo" })
    );
    h.createDraft.mockRejectedValue(new Error("db exploded"));
    await expect(
      processAppReport({
        staffId: STAFF,
        reportId: R1,
        admin: h.state.db.client,
      })
    ).resolves.toBeUndefined();
    const row = resultOf(R1);
    expect(row.text).toBe("compramos pan a 2 dólares el kilo");
    expect(["done", "failed"]).toContain(row.app_result.state);
  });
});

// ---------------------------------------------------------------------------
// Cooks never see an amount (the card only carries codes, product names and
// questions rebuilt from the copy)
// ---------------------------------------------------------------------------

/** The stored result without its version number: nothing may be left that looks like an amount. */
const withoutVersion = (r: Record<string, unknown>) =>
  JSON.stringify({ ...r, v: undefined });
const NO_AMOUNT = /[\d$€£]/;

describe("a mixed message: one item with a price and unit, one without a unit", () => {
  // No price pattern for the rules to read, so the kitchen AI reads both items.
  const MIXED_AI = "llegó el pedido de pan y queso";
  const MIXED = "pan a 2 dólares el kilo y queso a 5";
  const aiItems = {
    intent: "price_update",
    items: [
      {
        product: "pan",
        amount: 2,
        unit: "kg",
        currency: "USD",
        matched_ingredient_id: null,
      },
      {
        product: "queso",
        amount: 5,
        unit: null,
        currency: null,
        matched_ingredient_id: null,
      },
    ],
    clarify_question: null,
  };

  it("through the kitchen AI: the priced item is a draft, the other asks its unit, and no price reaches the card", async () => {
    h.interpret.mockResolvedValue(aiItems);
    h.state.db.tables.kitchen_reports.push(report(R1, { text: MIXED_AI }));
    await processAppReport({
      staffId: STAFF,
      reportId: R1,
      admin: h.state.db.client,
    });

    expect(h.createDraft).toHaveBeenCalledTimes(1);
    expect(h.createDraft.mock.calls[0][1].extraction.lines).toHaveLength(1);
    expect(h.createDraft.mock.calls[0][1].extraction.lines[0]).toMatchObject({
      unit: "kg",
    });

    const result = resultOf(R1).app_result;
    expect(result).toMatchObject({ state: "done", draft: true, unclear: null });
    expect(result.asks).toEqual({
      kind: "unit",
      text: "¿El precio de queso es por libra, onza o unidad?",
    });
    expect(result.understood).toEqual(["pan"]);
    // No digit, no currency symbol, no sentence from a reply: nothing priced at all.
    expect(withoutVersion(result)).not.toMatch(NO_AMOUNT);
    expect(withoutVersion(result)).not.toMatch(/Anoté|revisa en Costos/);
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("through applyPriceResult (the rules / price AI path): same, and the captured reply DID carry the price", async () => {
    h.state.db.tables.kitchen_reports.push(report(R1, { text: MIXED }));
    const sink = {
      chatId: appChatId(STAFF),
      messages: [] as string[],
      events: [] as any[],
    };
    const link = {
      staffId: STAFF,
      companyId: CO,
      companyName: "Casa A",
      locationId: LOC,
      locationName: "Centro",
      telegramUserId: appChatId(STAFF),
      language: "es",
    } as never;
    const result = await withKitchenLanguage("es", () =>
      runWithReplySink(sink, async () => {
        const handled = await applyPriceResult(
          {
            kind: "items",
            aiCalled: true,
            r: {
              saved: [{ name: "pan", price: 2, unit: "kg", currency: "USD" }],
              needUnit: [{ name: "queso", price: 5, currency: null }],
              ambiguous: [],
              unclear: [],
              skippedNoPrice: [],
              overLimit: [],
            },
          } as never,
          {
            admin: h.state.db.client,
            staff: {
              id: STAFF,
              company_id: CO,
              company_name: "Casa A",
              location_id: LOC,
              location_name: "Centro",
            },
            link,
            chatId: appChatId(STAFF),
            messageId: appMessageId(R1),
            reportId: R1,
            dateSec: 1_700_000_000,
            origin: "text",
            len: MIXED.length,
          } as never
        );
        expect(handled).toBe(true);
        return summarizeSink(sink, "handled");
      })
    );

    // The raw captured reply is «✅ Anoté … pan $2.00 …» + the question: this is
    // what used to be copied onto the card.
    expect(sink.messages.join("\n")).toMatch(/\$2\.00/);
    expect(sink.messages.join("\n")).toMatch(/queso/);

    expect(result).toMatchObject({ draft: true, unclear: null });
    expect(result.asks).toEqual({
      kind: "unit",
      text: "¿El precio de queso es por libra, onza o unidad?",
    });
    expect(withoutVersion(result as never)).not.toMatch(NO_AMOUNT);
  });
});

describe("every «could not read it» path stores only a reason code", () => {
  const unclearCases: Array<{
    name: string;
    code: (typeof UNCLEAR_REASONS)[number];
    text?: string;
    intent?: unknown;
    draft?: unknown;
    voice?: "unreadable" | "quota";
  }> = [
    {
      name: "a voice note that cannot be heard",
      code: "unreadable",
      voice: "unreadable",
    },
    {
      name: "a voice note while the AI is out of quota",
      code: "ai_unavailable",
      voice: "quota",
    },
    {
      name: "a price the rules and AI cannot read",
      code: "price_unclear",
      text: "el queso a $",
      intent: { intent: "unclear", items: [], clarify_question: null },
    },
    {
      name: "the AI being down",
      code: "ai_unavailable",
      text: "el pan estaba carísimo hoy",
      intent: null,
    },
    {
      name: "a currency that is not the company's",
      code: "currency_mismatch",
      text: "compramos pan a 2 pesos el kilo",
      intent: null,
    },
    {
      name: "a price that could not be saved",
      code: "save_failed",
      text: "compramos pan a 2 dólares el kilo",
      draft: { ok: false, reason: "insert_failed" },
    },
    {
      name: "a greeting (nothing to do)",
      code: "other",
      text: "hola buenas",
      intent: {
        intent: "greeting_or_smalltalk",
        items: [],
        clarify_question: null,
      },
    },
  ];

  for (const c of unclearCases) {
    it(`${c.name} -> "${c.code}"`, async () => {
      if (c.voice) {
        h.state.db.tables.kitchen_reports.push(
          report(R3, { media_kind: "voice", media_mime: "audio/mp4" })
        );
        h.state.db.tables.kitchen_media.push({
          id: R3,
          company_id: CO,
          kitchen_report_id: R3,
          storage_path: "co/loc/2026/10/v.m4a",
          mime: "audio/mp4",
        });
        h.state.db.objects.set("co/loc/2026/10/v.m4a", 2000);
        h.transcribe.mockResolvedValue({
          ok: false,
          kind: c.voice === "quota" ? "quota" : "timeout",
        });
        h.aiUnavailable.mockReturnValue(c.voice === "quota" ? "quota" : null);
      } else {
        h.interpret.mockResolvedValue(c.intent ?? null);
        if (c.draft) h.createDraft.mockResolvedValue(c.draft);
        h.state.db.tables.kitchen_reports.push(report(R1, { text: c.text }));
      }
      const id = c.voice ? R3 : R1;
      await processAppReport({
        staffId: STAFF,
        reportId: id,
        admin: h.state.db.client,
      });

      const result = resultOf(id).app_result;
      expect(result.state).toBe("done");
      expect(result.unclear).toBe(c.code);
      expect(UNCLEAR_REASONS).toContain(result.unclear);
      // A code, not a sentence: no spaces, no digits, no currency.
      expect(result.unclear).toMatch(/^[a-z_]+$/);
      expect(withoutVersion(result)).not.toMatch(NO_AMOUNT);
      expect(h.fetchSpy).not.toHaveBeenCalled();
    });
  }
});

describe("the history route never returns an amount, and «unclear» is no longer free text", () => {
  const TOKEN = "device-token-for-cook-one-0000000000000000000";
  const row = (id: string, minutes: number, app_result: unknown) => ({
    id,
    company_id: CO,
    location_id: LOC,
    staff_id: STAFF,
    report_type: "unclassified",
    text: "mensaje",
    media_kind: null,
    media_mime: null,
    transcript: null,
    processed_at: "2026-10-30T10:00:00.000Z",
    created_at: new Date(Date.UTC(2026, 9, 30, 10, minutes)).toISOString(),
    app_result,
  });

  const history = async () =>
    historyGET(
      new NextRequest("http://localhost/api/mobile/v1/kitchen/history", {
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    );

  beforeEach(() => {
    h.state.db.tables.kitchen_devices = [
      {
        id: "55555555-5555-4555-8555-555555555551",
        company_id: CO,
        staff_id: STAFF,
        token_hash: hashToken(TOKEN),
        revoked_at: null,
        last_seen_at: null,
      },
    ];
  });

  it("passes the money guard with codes, and turns anything older (raw replies, quoted prices) into safe values", async () => {
    const done = {
      v: 1,
      state: "done",
      noted: false,
      draft: false,
      recipe: false,
      understood: [],
    };
    h.state.db.tables.kitchen_reports.push(
      row("77777777-7777-4777-8777-777777777771", 1, {
        ...done,
        unclear: "price_unclear",
      }),
      // Written by an older build: the raw reply, example price included.
      row("77777777-7777-4777-8777-777777777772", 2, {
        ...done,
        unclear:
          "No entendí el precio. Escribe, por ejemplo: «aguacate $1.50 la libra».",
      }),
      row("77777777-7777-4777-8777-777777777773", 3, {
        ...done,
        draft: true,
        asks: {
          kind: "unit",
          text: "✅ Anoté: pan $2.00 el kilo.\n\n¿El precio de queso es por libra, onza o unidad?",
        },
        understood: ["pan", "pan $2.00", "queso 3,50 €"],
      }),
      row("77777777-7777-4777-8777-777777777774", 4, {
        ...done,
        asks: {
          kind: "unit",
          text: "¿El precio de queso es por libra, onza o unidad?",
        },
      })
    );

    const res = await history();
    expect(res.status).toBe(200);
    const body = await res.json();
    // The route's own guard let it through, and so does the assertion itself.
    expect(() => assertNoMoneyFields(body)).not.toThrow();

    const byId = (n: number) =>
      body.items.find((i: any) => i.id.endsWith(String(n)));
    expect(byId(1).result.unclear).toBe("price_unclear");
    expect(byId(2).result.unclear).toBe("other");
    expect(byId(3).result.asks).toEqual({ kind: "unit", text: null });
    expect(byId(3).result.understood).toEqual(["pan"]);
    expect(byId(4).result.asks.text).toBe(
      "¿El precio de queso es por libra, onza o unidad?"
    );

    const raw = JSON.stringify(body.items.map((i: any) => i.result));
    expect(raw).not.toMatch(/[$€£]/);
    expect(raw).not.toMatch(/Anoté|aguacate|1\.50|2\.00|3,50/);
  });

  it("«unclear» is not free text any more: an amount under that key trips the guard", () => {
    expect(() =>
      assertNoMoneyFields({ result: { unclear: "$2.00" } })
    ).toThrow();
    expect(() =>
      assertNoMoneyFields({ result: { unclear: "3 USD" } })
    ).toThrow();
    expect(() =>
      assertNoMoneyFields({ result: { unclear: "price_unclear" } })
    ).not.toThrow();
  });

  it("serializeAppResult only lets known codes through", () => {
    for (const code of UNCLEAR_REASONS) {
      expect(
        serializeAppResult({ state: "done", unclear: code })?.unclear
      ).toBe(code);
    }
    expect(
      serializeAppResult({ state: "done", unclear: "anything else" })?.unclear
    ).toBe("other");
    expect(
      serializeAppResult({ state: "done", unclear: "" })?.unclear
    ).toBeNull();
    expect(serializeAppResult({ state: "done" })?.unclear).toBeNull();
  });
});

describe("a mixed message keeps EVERY item", () => {
  const MIXED = "pan a 2 dólares el kilo y unos tomates";
  const TOKEN = "device-token-for-cook-one-0000000000000000000";

  it("typed: the priced item is a draft, the other becomes a question with its name, and no price reaches the card", async () => {
    h.state.db.tables.kitchen_reports.push(report(R1, { text: MIXED }));
    await processAppReport({
      staffId: STAFF,
      reportId: R1,
      admin: h.state.db.client,
    });

    expect(h.createDraft).toHaveBeenCalledTimes(1);
    const [, draft] = h.createDraft.mock.calls[0];
    expect(draft.extraction.lines).toHaveLength(1);
    expect(draft.extraction.lines[0]).toMatchObject({ unit: "kg" });

    const stored = resultOf(R1).app_result;
    expect(stored).toMatchObject({
      state: "done",
      draft: true,
      extras: ["tomates"],
    });
    // Names only: no digit, no currency anywhere on the card.
    const { understood, asks, unclear, extras } = stored;
    expect(JSON.stringify({ understood, asks, unclear, extras })).not.toMatch(
      /[\d$€]/
    );
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("spoken: the transcript goes through the same path", async () => {
    h.state.db.tables.kitchen_reports.push(
      report(R2, { media_kind: "voice", media_mime: "audio/mp4" })
    );
    h.state.db.tables.kitchen_media.push({
      id: R2,
      company_id: CO,
      kitchen_report_id: R2,
      storage_path: "co/loc/2026/10/v2.m4a",
      mime: "audio/mp4",
    });
    h.state.db.objects.set("co/loc/2026/10/v2.m4a", 2000);
    h.transcribe.mockResolvedValue({ ok: true, value: { text: MIXED } });
    await processAppReport({
      staffId: STAFF,
      reportId: R2,
      admin: h.state.db.client,
    });
    expect(resultOf(R2).app_result).toMatchObject({
      state: "done",
      draft: true,
      extras: ["tomates"],
    });
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("a message with a single item has no extras, and Telegram never records them", async () => {
    h.state.db.tables.kitchen_reports.push(
      report(R3, { text: "compramos pan a 2 dólares el kilo" })
    );
    await processAppReport({
      staffId: STAFF,
      reportId: R3,
      admin: h.state.db.client,
    });
    expect(resultOf(R3).app_result.extras).toEqual([]);
    // Outside a sink (Telegram) nothing is recorded at all.
    expect(() =>
      recordPipelineEvent({ kind: "extras", products: ["tomates"] })
    ).not.toThrow();
  });

  it("serializeAppResult passes names and drops anything that looks like a price", () => {
    const r = serializeAppResult({
      v: 1,
      state: "done",
      draft: true,
      extras: ["tomates", "pan $2.00", "cebolla 1,50 usd", 7, "cilantro"],
    });
    expect(r?.extras).toEqual(["tomates", "cilantro"]);
    expect(() => assertNoMoneyFields(r)).not.toThrow();
  });

  it("the history route returns the extras and still passes the money guard", async () => {
    h.state.db.tables.kitchen_devices = [
      {
        id: "55555555-5555-4555-8555-555555555551",
        company_id: CO,
        staff_id: STAFF,
        token_hash: hashToken(TOKEN),
        revoked_at: null,
        last_seen_at: null,
      },
    ];
    h.state.db.tables.kitchen_reports.push(
      report(R1, {
        text: MIXED,
        processed_at: "2026-10-30T10:00:00.000Z",
        app_result: {
          v: 1,
          state: "done",
          noted: false,
          draft: true,
          asks: null,
          unclear: null,
          recipe: false,
          understood: ["pan"],
          extras: ["tomates"],
        },
      })
    );
    const res = await historyGET(
      new NextRequest("http://localhost/api/mobile/v1/kitchen/history", {
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].result.extras).toEqual(["tomates"]);
    expect(() => assertNoMoneyFields(body)).not.toThrow();
  });
});
