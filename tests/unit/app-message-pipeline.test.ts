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
}));

vi.mock("next/server", () => ({
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
  aiUnavailableFor: () => null,
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
  recordPipelineEvent,
  runWithReplySink,
  sinkFor,
} from "@/lib/restaurant/kitchen/pipeline/reply-sink";
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
    recordPipelineEvent({ kind: "question", ask: "unit" }); // no-op
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
    expect(
      summarizeSink(
        sink([{ kind: "question", ask: "unit" }], ["¿Por kilo o por libra?"]),
        "handled"
      ).asks
    ).toEqual({
      kind: "unit",
      text: "¿Por kilo o por libra?",
    });
    // An amount question is never quoted back (it repeats prices).
    expect(
      summarizeSink(
        sink([{ kind: "question", ask: "amount" }], ["¿1.50 o 150?"]),
        "handled"
      ).asks
    ).toEqual({
      kind: "amount",
      text: null,
    });
    expect(summarizeSink(sink([], ["No entendí."]), "handled")).toMatchObject({
      unclear: "No entendí.",
      noted: false,
    });
    expect(summarizeSink(sink([], []), "recipe")).toMatchObject({
      recipe: true,
      unclear: null,
    });
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

  it("a note that cannot be heard says so, instead of staying silent", async () => {
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
    expect(typeof result.unclear).toBe("string");
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
