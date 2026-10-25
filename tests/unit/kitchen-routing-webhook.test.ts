// Telegram webhook with a cook who belongs to two restaurants: the question,
// the buttons, the default, expiry, forged taps, follow-ups and replays.
// Synthetic data only.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type Row } from "./helpers/fake-db";

const {
  store,
  afterJobs,
  sent,
  answers,
  edits,
  extractInvoice,
  extractRecipe,
  classify,
} = vi.hoisted(() => ({
  store: {} as Record<string, Row[]>,
  afterJobs: [] as Promise<unknown>[],
  sent: [] as Array<{
    chatId: number;
    text: string;
    markup?: {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  }>,
  answers: [] as Array<{ id: string; text?: string }>,
  edits: [] as Array<{
    messageId: number;
    text: string;
    markup?: {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  }>,
  extractInvoice: vi.fn(),
  extractRecipe: vi.fn(),
  classify: vi.fn(),
}));
let transcript = "";
let questionId = 1000;

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterJobs.push(Promise.resolve().then(() => fn()));
    },
  };
});
vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: async (
    chatId: number,
    text: string,
    options?: { replyMarkup?: (typeof sent)[number]["markup"] }
  ) => {
    sent.push({ chatId, text, markup: options?.replyMarkup });
    return { ok: true, messageId: ++questionId };
  },
  answerCallbackQuery: async (id: string, text?: string) => {
    answers.push({ id, text });
    return { ok: true };
  },
  editMessageText: async (
    _chatId: number,
    messageId: number,
    text: string,
    options?: { replyMarkup?: (typeof sent)[number]["markup"] }
  ) => {
    edits.push({ messageId, text, markup: options?.replyMarkup });
    return { ok: true };
  },
  TelegramConfigError: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => {
  const db = makeFakeDb(store);
  return { createAdminClient: () => db };
});
vi.mock("@/lib/restaurant/telegram/files", () => ({
  openTelegramFile: async () => ({
    ok: true,
    contentLength: "4",
    body: new Response(new Uint8Array([1, 2, 3, 4])).body,
  }),
}));
vi.mock("@/lib/restaurant/telegram/photo-classify", () => ({
  classifyKitchenPhoto: (...a: unknown[]) => classify(...a),
}));
vi.mock("@/lib/restaurant/invoice-draft", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/restaurant/invoice-draft")>();
  return {
    ...actual,
    extractInvoiceFromImage: (...a: unknown[]) => extractInvoice(...a),
  };
});
vi.mock("@/lib/restaurant/telegram/kitchen-recipe-drafts", async (orig) => {
  const actual =
    await orig<
      typeof import("@/lib/restaurant/telegram/kitchen-recipe-drafts")
    >();
  return {
    ...actual,
    extractAndCreateRecipeDraft: (...a: unknown[]) => extractRecipe(...a),
  };
});
vi.mock("openai", () => {
  class FakeOpenAI {
    audio = { transcriptions: { create: async () => ({ text: transcript }) } };
  }
  return { default: FakeOpenAI, OpenAI: FakeOpenAI };
});
vi.mock("@/lib/restaurant/telegram/kitchen-reports", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-reports")
    >();
  return {
    ...actual,
    // Same contract as the real one: false on a duplicate delivery.
    recordKitchenReport: async (input: {
      companyId: string;
      locationId: string;
      staffId: string;
      chatId: number;
      report: Record<string, unknown>;
    }) => {
      const rows = (store.kitchen_reports ??= []);
      if (
        rows.some(
          (r) =>
            r.telegram_chat_id === input.chatId &&
            r.telegram_message_id === input.report.telegram_message_id
        )
      ) {
        return false;
      }
      rows.push({
        id: `kr-${rows.length + 1}`,
        company_id: input.companyId,
        location_id: input.locationId,
        staff_id: input.staffId,
        telegram_chat_id: input.chatId,
        created_at: new Date().toISOString(),
        ...input.report,
      });
      return true;
    },
  };
});

import { POST } from "@/app/api/telegram/webhook/route";
import { resetOwnerChatGuidance } from "@/lib/restaurant/telegram/owner-chat-guidance";
import { resetRoutingState } from "@/lib/restaurant/telegram/kitchen-routing";
import {
  generateKitchenToken,
  hashKitchenToken,
} from "@/lib/restaurant/telegram/kitchen-join";
import { KITCHEN_COPY } from "@/lib/restaurant/telegram/kitchen-copy";

const CHAT = 4242;
const COOK = 9;
const MIN = 60 * 1000;
const qrNorte = generateKitchenToken();

let nextId = 100;
const consoleCalls: string[] = [];

function seed() {
  for (const k of Object.keys(store)) delete store[k];
  store.companies = [
    { id: "co-demo", name: "Demo Resto" },
    { id: "co-stage", name: "Stage Test 1" },
  ];
  store.restaurant_locations = [
    {
      id: "loc-centro",
      company_id: "co-demo",
      name: "Local Centro",
      status: "active",
      archived_at: null,
    },
    {
      id: "loc-norte",
      company_id: "co-stage",
      name: "Local Norte",
      status: "active",
      archived_at: null,
    },
  ];
  store.kitchen_staff = [
    {
      id: "st-demo",
      company_id: "co-demo",
      location_id: "loc-centro",
      telegram_user_id: COOK,
      is_active: true,
    },
    {
      id: "st-stage",
      company_id: "co-stage",
      location_id: "loc-norte",
      telegram_user_id: COOK,
      is_active: true,
    },
  ];
  store.kitchen_join_tokens = [
    {
      id: "t2",
      company_id: "co-stage",
      location_id: "loc-norte",
      token_hash: hashKitchenToken(qrNorte.secret),
      revoked_at: null,
    },
  ];
  store.kitchen_pending_items = [];
  store.kitchen_routing_defaults = [];
}

async function post(body: unknown, secret = "s3cret") {
  const res = await POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(body),
    })
  );
  await Promise.all(afterJobs.splice(0));
  return res;
}

function msg(extra: Record<string, unknown>, id = ++nextId, from = COOK) {
  return post({
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      from: { id: from, first_name: "Ana" },
      chat: { id: CHAT, type: "private" },
      ...extra,
    },
  });
}

let cbn = 0;
function tap(
  data: string,
  o: { from?: number; chat?: number; qid?: number } = {}
) {
  return post({
    callback_query: {
      id: `cb-${++cbn}`,
      from: { id: o.from ?? COOK },
      message: {
        message_id: o.qid ?? 77,
        chat: { id: o.chat ?? CHAT, type: "private" },
      },
      data,
    },
  });
}

const photo = (fileId = "FILE-SECRET-1", caption = "factura") => ({
  photo: [{ file_id: fileId, width: 100, height: 100 }],
  caption,
});
const lastSent = () => sent[sent.length - 1];
const buttons = (m = lastSent()) =>
  (m.markup?.inline_keyboard ?? []).map((row) => row[0]);
const optionData = (i: number, m = lastSent()) => buttons(m)[i].callback_data;
const invoices = () => store.supplier_invoices ?? [];
const pendingRows = () => store.kitchen_pending_items ?? [];
const logged = () => consoleCalls.join("\n");

function goodExtraction() {
  return {
    ok: true,
    extraction: {
      supplier_name: "Proveedor Demo",
      invoice_number: "A-1",
      invoice_date: "2026-03-01",
      due_date: null,
      currency: null,
      subtotal: null,
      tax_amount: null,
      total_amount: null,
      confidence_notes: [],
      lines: [
        {
          description: "Aguacate",
          supplier_item_name: null,
          supplier_sku: null,
          quantity: 10,
          unit: "lb",
          unit_cost: 1.5,
          line_total: 15,
          tax_amount: null,
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now());
  seed();
  afterJobs.length = 0;
  sent.length = 0;
  answers.length = 0;
  edits.length = 0;
  consoleCalls.length = 0;
  transcript = "";
  resetOwnerChatGuidance();
  resetRoutingState();
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  process.env.OPENAI_API_KEY = "test-key";
  extractInvoice.mockReset().mockResolvedValue(goodExtraction());
  classify.mockReset().mockResolvedValue({
    ok: true,
    kind: "other",
    confidence: "high",
  });
  extractRecipe.mockReset().mockResolvedValue({ ok: true, draftId: "d-1" });
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("two restaurants: ask first, save after the tap", () => {
  it("a photo writes nothing and asks with one button per restaurant plus Cancelar", async () => {
    await msg(photo());
    expect(store.kitchen_reports ?? []).toHaveLength(0);
    expect(invoices()).toHaveLength(0);
    expect(store.kitchen_recipe_drafts ?? []).toHaveLength(0);
    expect(extractInvoice).not.toHaveBeenCalled();
    expect(pendingRows()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(lastSent().text).toBe(KITCHEN_COPY.ROUTING_ASK);
    expect(buttons().map((b) => b.text)).toEqual([
      "Demo Resto › Local Centro",
      "Stage Test 1 › Local Norte",
      "Cancelar",
    ]);
    for (const b of buttons()) {
      expect(b.callback_data).toMatch(/^k[rc]1:/);
      expect(b.callback_data).not.toMatch(/co-|loc-|st-|Demo|Stage/);
    }
  });

  it("tapping Demo Resto saves the invoice only there and remembers the choice", async () => {
    await msg(photo(), 501);
    const data = optionData(0);
    await tap(data, { qid: 321 });

    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-demo");
    expect(invoices().some((i) => i.company_id === "co-stage")).toBe(false);
    expect(store.kitchen_reports).toHaveLength(1);
    expect(store.kitchen_reports[0]).toMatchObject({
      company_id: "co-demo",
      location_id: "loc-centro",
      staff_id: "st-demo",
      telegram_chat_id: CHAT,
      telegram_message_id: 501,
    });
    expect(
      (store.invoice_events as Row[]).every(
        (e) => (e.metadata as Row).staff_id === "st-demo"
      )
    ).toBe(true);
    expect(store.kitchen_routing_defaults).toHaveLength(1);
    expect(store.kitchen_routing_defaults[0].staff_id).toBe("st-demo");
    expect(edits).toEqual([
      expect.objectContaining({
        messageId: 321,
        text: "Para Demo Resto › Local Centro ✓",
      }),
    ]);
    expect(edits[0].markup).toBeUndefined();
    expect(answers).toHaveLength(1);
    expect(lastSent().text).toContain("en Demo Resto › Local Centro");
    expect(pendingRows()[0].payload).toEqual({});
    expect(pendingRows()[0].chosen_staff_id).toBe("st-demo");
    expect(logged()).toMatch(
      /\[telegram-webhook\] restaurant chosen pending=\S+ staff=st-demo/
    );
  });

  it("the other restaurant gets its own invoice when it is chosen", async () => {
    await msg(photo());
    await tap(optionData(1));
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-stage");
    expect(lastSent().text).toContain("Stage Test 1 › Local Norte");
  });

  it("Cancelar saves nothing and edits the question", async () => {
    await msg(photo());
    await tap(optionData(2), { qid: 55 });
    expect(invoices()).toHaveLength(0);
    expect(store.kitchen_reports ?? []).toHaveLength(0);
    expect(edits[0]).toMatchObject({
      messageId: 55,
      text: KITCHEN_COPY.ROUTING_CANCELLED,
    });
    expect(pendingRows()[0].payload).toEqual({});
    expect(store.kitchen_routing_defaults).toHaveLength(0);
  });

  it("a webhook retry of the same message parks one item and asks once", async () => {
    await msg(photo(), 600);
    await msg(photo(), 600);
    expect(pendingRows()).toHaveLength(1);
    expect(
      sent.filter((s) => s.text === KITCHEN_COPY.ROUTING_ASK)
    ).toHaveLength(1);
  });

  it("a second item while one waits gets its own question and resolves separately", async () => {
    await msg(photo("F1"), 700);
    const first = optionData(0);
    await msg(photo("F2"), 701);
    const second = optionData(1);
    expect(pendingRows()).toHaveLength(2);
    expect(sent).toHaveLength(2);

    await tap(second);
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-stage");
    await tap(first);
    expect(invoices()).toHaveLength(2);
    expect(invoices().map((i) => i.company_id)).toEqual([
      "co-stage",
      "co-demo",
    ]);
  });
});

describe("the 30-minute default", () => {
  async function chooseDemo() {
    await msg(photo(), 800);
    await tap(optionData(0));
    sent.length = 0;
  }

  it("the next photo goes to Demo Resto without asking, with «Cambiar restaurante»", async () => {
    await chooseDemo();
    vi.setSystemTime(Date.now() + 10 * MIN);
    await msg(photo("F2"), 801);
    expect(invoices()).toHaveLength(2);
    expect(invoices().every((i) => i.company_id === "co-demo")).toBe(true);
    expect(sent.some((s) => s.text === KITCHEN_COPY.ROUTING_ASK)).toBe(false);
    const confirmation = lastSent();
    expect(confirmation.text).toContain("en Demo Resto › Local Centro");
    expect(buttons(confirmation).map((b) => b.text)).toEqual([
      "Cambiar restaurante",
    ]);
  });

  it("after 31 minutes it asks again", async () => {
    await chooseDemo();
    vi.setSystemTime(Date.now() + 31 * MIN);
    await msg(photo("F2"), 802);
    expect(invoices()).toHaveLength(1);
    expect(lastSent().text).toBe(KITCHEN_COPY.ROUTING_ASK);
  });

  it("a default whose link was removed is ignored", async () => {
    await chooseDemo();
    store.kitchen_staff.find((r) => r.id === "st-demo")!.is_active = false;
    await msg(photo("F2"), 803);
    // only Stage is left: one link, saved straight there
    expect(invoices()).toHaveLength(2);
    expect(invoices()[1].company_id).toBe("co-stage");
  });

  it("«Cambiar restaurante» shows the keyboard for the future; nothing saved moves", async () => {
    await chooseDemo();
    await msg(photo("F2"), 804);
    const change = optionData(0);
    expect(change).toMatch(/^kd1:/);
    const savedBefore = JSON.stringify(invoices());
    await tap(change);
    expect(lastSent().text).toContain(KITCHEN_COPY.CHANGE_NOTE);
    expect(lastSent().text).toContain(KITCHEN_COPY.CHANGE_HINT);
    expect(buttons().map((b) => b.text)).toEqual([
      "Demo Resto › Local Centro",
      "Stage Test 1 › Local Norte",
      "Cancelar",
    ]);
    await tap(optionData(1));
    expect(JSON.stringify(invoices())).toBe(savedBefore);
    expect(lastSent().text).toBe(
      "Listo: lo próximo va a Stage Test 1 › Local Norte (por 30 minutos)."
    );
    expect(store.kitchen_routing_defaults[0].staff_id).toBe("st-stage");

    sent.length = 0;
    await msg(photo("F3"), 805);
    expect(invoices()[invoices().length - 1].company_id).toBe("co-stage");
  });
});

describe("/restaurante and /restaurantes", () => {
  it("/restaurante shows a keyboard; choosing sets the default and saves nothing", async () => {
    await msg({ text: "/restaurante" });
    expect(lastSent().text).toBe(KITCHEN_COPY.DEFAULT_ASK);
    expect(optionData(0)).toMatch(/^kd1:/);
    await tap(optionData(1), { qid: 90 });
    expect(lastSent().text).toBe(
      "Listo: lo próximo va a Stage Test 1 › Local Norte (por 30 minutos)."
    );
    expect(edits[0].text).toBe("Para Stage Test 1 › Local Norte ✓");
    expect(store.kitchen_routing_defaults[0].staff_id).toBe("st-stage");
    expect(store.kitchen_reports ?? []).toHaveLength(0);
    expect(invoices()).toHaveLength(0);

    await msg(photo(), 810);
    expect(invoices()[0].company_id).toBe("co-stage");
  });

  it("/restaurantes lists the restaurants", async () => {
    await msg({ text: "/restaurantes" });
    expect(lastSent().text).toBe(
      "Tus restaurantes:\n• Demo Resto › Local Centro\n• Stage Test 1 › Local Norte"
    );
  });

  it("works with the bot name suffix", async () => {
    await msg({ text: "/restaurantes@MiltonBot" });
    expect(lastSent().text).toContain("Tus restaurantes:");
  });

  it("a cook with one restaurant hears «Solo estás en…»", async () => {
    store.kitchen_staff.find((r) => r.id === "st-stage")!.is_active = false;
    await msg({ text: "/restaurante" });
    await msg({ text: "/restaurantes" });
    expect(sent.map((s) => s.text)).toEqual([
      "Solo estás en Demo Resto › Local Centro.",
      "Solo estás en Demo Resto › Local Centro.",
    ]);
    expect(pendingRows()).toHaveLength(0);
  });

  it("a stranger gets nothing and /start is not broken", async () => {
    await msg({ text: "/restaurante" }, ++nextId, 12345);
    expect(sent).toHaveLength(0);
    await msg({ text: "/start" });
    expect(lastSent().text).toContain("Usa el enlace de conexión");
  });

  it("a retried /restaurante asks once", async () => {
    await msg({ text: "/restaurante" }, 900);
    await msg({ text: "/restaurante" }, 900);
    expect(sent).toHaveLength(1);
  });
});

describe("expiry", () => {
  it("a tap after 16 minutes saves nothing, tells the cook once and clears the payload", async () => {
    await msg(photo(), 1100);
    const data = optionData(0);
    vi.setSystemTime(Date.now() + 16 * MIN);
    await tap(data, { qid: 41 });
    expect(invoices()).toHaveLength(0);
    expect(store.kitchen_reports ?? []).toHaveLength(0);
    expect(
      sent.filter((s) => s.text === KITCHEN_COPY.ROUTING_EXPIRED)
    ).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      messageId: 41,
      text: KITCHEN_COPY.ROUTING_EXPIRED_EDIT,
    });
    expect(pendingRows()[0].payload).toEqual({});
    expect(logged()).toMatch(/\[telegram-webhook\] pending expired id=\S+/);
    // tapping again, or sending something, does not repeat the notice
    await tap(data);
    expect(
      sent.filter((s) => s.text === KITCHEN_COPY.ROUTING_EXPIRED)
    ).toHaveLength(1);
  });

  it("sending anything after expiry announces it once, then asks the new question", async () => {
    await msg(photo(), 1200);
    vi.setSystemTime(Date.now() + 16 * MIN);
    await msg(photo("F2"), 1201);
    expect(sent.map((s) => s.text)).toEqual([
      KITCHEN_COPY.ROUTING_ASK,
      KITCHEN_COPY.ROUTING_EXPIRED,
      KITCHEN_COPY.ROUTING_ASK,
    ]);
    expect(invoices()).toHaveLength(0);
    await msg(photo("F3"), 1202);
    expect(
      sent.filter((s) => s.text === KITCHEN_COPY.ROUTING_EXPIRED)
    ).toHaveLength(1);
  });

  it("an unused /restaurante keyboard expiring is never announced", async () => {
    await msg({ text: "/restaurante" });
    vi.setSystemTime(Date.now() + 16 * MIN);
    await msg(photo(), 1300);
    expect(sent.some((s) => s.text === KITCHEN_COPY.ROUTING_EXPIRED)).toBe(
      false
    );
  });
});

describe("forged or stale taps change nothing", () => {
  let nonce = "";
  beforeEach(async () => {
    await msg(photo("FILE-SECRET-2", "factura SECRET-CAPTION"), 1400);
    nonce = String(pendingRows()[0].nonce);
    answers.length = 0;
    consoleCalls.length = 0;
  });

  async function expectRejected(reason: string) {
    expect(invoices()).toHaveLength(0);
    expect(store.kitchen_reports ?? []).toHaveLength(0);
    expect(store.kitchen_routing_defaults).toHaveLength(0);
    expect(answers).toHaveLength(1);
    expect(answers[0].text).toBe(KITCHEN_COPY.CALLBACK_INVALID);
    expect(edits).toHaveLength(0);
    expect(logged()).toContain(
      `[telegram-webhook] callback rejected reason=${reason}`
    );
    for (const needle of [nonce, "FILE-SECRET", "SECRET-CAPTION", "kr1:"]) {
      expect(logged()).not.toContain(needle);
    }
  }

  it("another Telegram account", async () => {
    await tap(`kr1:${nonce}:0`, { from: 555 });
    await expectRejected("wrong_user");
    expect(pendingRows()[0].resolved_at ?? null).toBeNull();
  });

  it("another chat", async () => {
    await tap(`kr1:${nonce}:0`, { chat: 999 });
    await expectRejected("wrong_chat");
  });

  it("an unknown nonce", async () => {
    await tap("kr1:AbCdEfGhIjKlMnOpQrStUv:0");
    await expectRejected("no_nonce");
  });

  it("garbage data", async () => {
    await tap("hello");
    await expectRejected("bad_data");
  });

  it("an index that was not offered", async () => {
    await tap(`kr1:${nonce}:5`);
    await expectRejected("bad_index");
  });

  it("an item nonce used as a default", async () => {
    await tap(`kd1:${nonce}:0`);
    await expectRejected("bad_data");
  });

  it("a second tap (double tap) processes once", async () => {
    await tap(`kr1:${nonce}:0`);
    expect(invoices()).toHaveLength(1);
    answers.length = 0;
    consoleCalls.length = 0;
    await tap(`kr1:${nonce}:1`);
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-demo");
    expect(answers[0].text).toBe(KITCHEN_COPY.CALLBACK_INVALID);
    expect(logged()).toContain("callback rejected reason=resolved");
  });

  it("a restaurant removed between the question and the tap", async () => {
    store.kitchen_staff.find((r) => r.id === "st-stage")!.is_active = false;
    await tap(`kr1:${nonce}:1`);
    await expectRejected("link_gone");
    expect(pendingRows()[0].resolved_at ?? null).toBeNull();
    // the other restaurant is still a valid answer
    await tap(`kr1:${nonce}:0`);
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-demo");
  });

  it("a wrong webhook secret is refused before anything runs", async () => {
    const res = await post(
      { callback_query: { id: "x", from: { id: COOK }, data: "kc1:abc" } },
      "nope"
    );
    expect(res.status).toBe(401);
  });
});

describe("a restaurant removed from the cook", () => {
  it("the next photo is saved straight to the one left, no buttons", async () => {
    store.kitchen_staff.find((r) => r.id === "st-stage")!.is_active = false;
    await msg(photo(), 1500);
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-demo");
    expect(pendingRows()).toHaveLength(0);
    expect(sent.every((s) => !s.markup)).toBe(true);
  });
});

describe("follow-ups go to the restaurant that owns the pending item", () => {
  it("«factura» belongs to the most recent undecided photo, without asking", async () => {
    store.kitchen_reports = [
      {
        id: "kr-old",
        company_id: "co-demo",
        staff_id: "st-demo",
        telegram_chat_id: CHAT,
        telegram_message_id: 31,
        telegram_file_id: "OLD",
        media_kind: "photo",
        media_mime: "image/jpeg",
        report_type: "unclassified",
        text: null,
        created_at: new Date(Date.now() - 10 * MIN).toISOString(),
      },
      {
        id: "kr-new",
        company_id: "co-stage",
        staff_id: "st-stage",
        telegram_chat_id: CHAT,
        telegram_message_id: 32,
        telegram_file_id: "NEW",
        media_kind: "photo",
        media_mime: "image/jpeg",
        report_type: "unclassified",
        text: null,
        created_at: new Date(Date.now() - 1 * MIN).toISOString(),
      },
    ];
    await msg({ text: "factura" });
    expect(sent.some((s) => s.markup)).toBe(false);
    expect(pendingRows()).toHaveLength(0);
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-stage");
  });

  it("a portions answer («3x») goes to the draft's restaurant, without asking", async () => {
    store.kitchen_recipe_drafts = [
      {
        id: "d-1",
        company_id: "co-stage",
        staff_id: "st-stage",
        telegram_chat_id: CHAT,
        telegram_message_id: 1,
        status: "awaiting_portions",
        portions: null,
        total_cost: 9,
        dish_name: "Plato Demo",
        created_at: new Date(Date.now() - MIN).toISOString(),
      },
    ];
    await msg({ text: "3x" });
    expect(pendingRows()).toHaveLength(0);
    expect(store.kitchen_recipe_drafts[0]).toMatchObject({
      status: "draft",
      portions: 3,
    });
    expect(lastSent().text).toContain("Stage Test 1 › Local Norte");
    expect(lastSent().markup).toBeUndefined();
  });
});

describe("voice and text use the same question", () => {
  it("a price note: asked, then a draft only in the chosen company", async () => {
    await msg({ text: "el aguacate subió a 1.50 la libra" });
    expect(invoices()).toHaveLength(0);
    expect(lastSent().text).toBe(KITCHEN_COPY.ROUTING_ASK);
    await tap(optionData(1));
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({
      company_id: "co-stage",
      status: "needs_review",
    });
    expect(lastSent().text).toContain("Anoté en Stage Test 1");
    expect(store.ingredient_cost_entries ?? []).toHaveLength(0);
  });

  it("a recipe text: asked, then the draft is made for the chosen link", async () => {
    await msg({ text: "receta de pollo con arroz para 2 porciones" });
    expect(extractRecipe).not.toHaveBeenCalled();
    await tap(optionData(1));
    expect(extractRecipe).toHaveBeenCalledTimes(1);
    expect(extractRecipe.mock.calls[0][0]).toMatchObject({
      companyId: "co-stage",
      locationId: "loc-norte",
      staffId: "st-stage",
    });
  });

  it("a voice note: parked, transcribed only after the tap", async () => {
    transcript = "el tomate subió a 0.80 el kilo";
    await msg({ voice: { file_id: "VOICE-SECRET", duration: 3 } });
    expect(invoices()).toHaveLength(0);
    expect(store.kitchen_reports ?? []).toHaveLength(0);
    expect(pendingRows()[0].kind).toBe("voice");
    await tap(optionData(0));
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0].company_id).toBe("co-demo");
    expect(logged()).not.toContain("VOICE-SECRET");
    expect(logged()).not.toContain("tomate");
  });

  it("a plain report word gets the ACK for the chosen local", async () => {
    await msg({ text: "se acabó el aguacate" });
    await tap(optionData(1));
    expect(lastSent().text).toContain("Local Norte");
    expect(store.kitchen_reports[0]).toMatchObject({
      company_id: "co-stage",
      staff_id: "st-stage",
    });
  });

  it("an image document is parked and replayed from its stored file id", async () => {
    await msg({
      document: { file_id: "DOC-1", mime_type: "image/png" },
      caption: "factura",
    });
    expect(pendingRows()[0].kind).toBe("document");
    await tap(optionData(0));
    expect(store.kitchen_reports[0]).toMatchObject({
      telegram_file_id: "DOC-1",
      media_mime: "image/png",
    });
    expect(invoices()).toHaveLength(1);
  });

  it("a PDF or sticker is not parked", async () => {
    await msg({ document: { file_id: "P", mime_type: "application/pdf" } });
    expect(pendingRows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});

describe("more than 8 restaurants: «Ver más»", () => {
  beforeEach(() => {
    for (let i = 0; i < 10; i++) {
      store.restaurant_locations.push({
        id: `loc-x${i}`,
        company_id: "co-demo",
        name: `Local ${String(i).padStart(2, "0")}`,
        status: "active",
        archived_at: null,
      });
      store.kitchen_staff.push({
        id: `st-x${i}`,
        company_id: "co-demo",
        location_id: `loc-x${i}`,
        telegram_user_id: COOK,
        is_active: true,
      });
    }
  });

  it("shows 8, a second page by editing the keyboard, and saves to a link on page 2", async () => {
    await msg(photo(), 1700);
    const first = buttons();
    expect(first).toHaveLength(8 + 2);
    expect(first[8].text).toBe("Ver más");
    expect(first[9].text).toBe("Cancelar");
    expect(pendingRows()[0].option_staff_ids).toHaveLength(12);

    await tap(first[8].callback_data, { qid: 60 });
    expect(invoices()).toHaveLength(0);
    expect(edits).toHaveLength(1);
    const second = edits[0].markup!.inline_keyboard.map((r) => r[0]);
    expect(second.map((b) => b.text).slice(-2)).toEqual([
      "Ver más",
      "Cancelar",
    ]);
    expect(second).toHaveLength(4 + 2);
    // the last restaurant of the list (index 11, another company) is reachable on this page
    const lastOption = second[3];
    await tap(lastOption.callback_data);
    expect(invoices()).toHaveLength(1);
    // sorted by company then local: the last one is Stage Test 1 › Local Norte
    expect(String(invoices()[0].company_id)).toBe("co-stage");
    expect(store.kitchen_reports[0].location_id).toBe("loc-norte");
  });

  it("a page number that does not exist is rejected", async () => {
    await msg(photo(), 1701);
    const nonce = String(pendingRows()[0].nonce);
    await tap(`kr1:${nonce}:95`);
    expect(edits).toHaveLength(0);
    expect(logged()).toContain("callback rejected reason=bad_index");
  });
});

describe("one restaurant, joins and guidance", () => {
  it("a second QR replies with JOINED_ADDED naming the new restaurant", async () => {
    store.kitchen_staff = store.kitchen_staff.filter((r) => r.id === "st-demo");
    await msg({ text: `/start ${qrNorte.payload}` });
    expect(lastSent().text).toContain(
      "Ahora también estás en Stage Test 1 › Local Norte"
    );
    expect(
      store.kitchen_staff.filter((r) => r.telegram_user_id === COOK)
    ).toHaveLength(2);
  });

  it("one link: no pending rows, no buttons, name in the confirmation", async () => {
    store.kitchen_staff = store.kitchen_staff.filter((r) => r.id === "st-demo");
    await msg(photo(), 1800);
    expect(pendingRows()).toHaveLength(0);
    expect(lastSent().markup).toBeUndefined();
    expect(lastSent().text).toContain("Demo Resto › Local Centro");
  });

  it("an owner-paired chat that is not a cook still gets the guidance", async () => {
    store.kitchen_staff = [];
    store.restaurant_telegram_connections = [
      { id: "c1", company_id: "co-demo", chat_id: CHAT, is_active: true },
    ];
    await msg(photo(), 1900);
    expect(lastSent().text).toContain(
      "Este chat recibe el briefing de Demo Resto"
    );
    expect(pendingRows()).toHaveLength(0);
    expect(store.kitchen_reports ?? []).toHaveLength(0);
  });
});
