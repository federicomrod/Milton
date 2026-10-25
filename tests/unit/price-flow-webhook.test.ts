// One price pipeline for text and voice: rules -> AI fallback -> ask the unit
// -> save. The AI is mocked; nothing touches the network. Synthetic data only.
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
  ai,
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
  ai: vi.fn(),
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
vi.mock("@/lib/restaurant/telegram/price-update-ai", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/price-update-ai")
    >();
  return { ...actual, askPriceAi: (...a: unknown[]) => ai(...a) };
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

function seed(restaurants: 1 | 2 = 1) {
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
  if (restaurants === 1) {
    store.kitchen_staff = store.kitchen_staff.slice(0, 1);
  }
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
  ai.mockReset().mockResolvedValue(null);
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

const unitAsk = (p: string) =>
  `¿El precio de ${p} es por libra, onza o unidad?`;
const questionRows = () =>
  pendingRows().filter((r) => Number(r.telegram_message_id) <= -10_000_000_000);
const NO_ACK = (m: { text: string }) => !m.text.includes("Recibido, gracias");
const drafts = () => invoices().filter((i) => i.status === "needs_review");
const lineUnits = () => (store.supplier_invoice_lines ?? []).map((l) => l.unit);

describe("rules: typos, comma decimals, dollars", () => {
  it("«Aguacate 1,50 la onzs» is a price update per onza", async () => {
    await msg({ text: "Aguacate 1,50 la onzs" });
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain("aguacate $1.50 la onza");
    expect(lastSent().text).not.toContain("Recibido, gracias");
    expect(ai).not.toHaveBeenCalled();
  });

  it.each([
    ["aguacate a 1.50 la libra", "aguacate $1.50 la libra"],
    ["el tomate subió a $0,80 la lb", "tomate $0.80 la libra"],
    ["cebolla 2 dólares el kilo", "cebolla $2.00 el kilo"],
  ])("%s", async (text, shown) => {
    await msg({ text });
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain(shown);
  });
});

describe("unit missing: ask once, save after the answer", () => {
  it("«queso 3.25» asks, saves nothing; «libra» completes it with lb", async () => {
    await msg({ text: "queso 3.25" });
    expect(lastSent().text).toBe(unitAsk("queso"));
    expect(drafts()).toHaveLength(0);
    expect(questionRows()).toHaveLength(1);
    expect(questionRows()[0].option_staff_ids).toEqual(["st-demo"]);

    await msg({ text: "libra" });
    expect(drafts()).toHaveLength(1);
    expect(lineUnits()).toEqual(["lb"]);
    expect(lastSent().text).toContain("queso $3.25 la libra");
    expect(sent.every(NO_ACK)).toBe(true);
    expect(questionRows()[0].resolved_at).toBeTruthy();
    expect(questionRows()[0].payload).toEqual({});
  });

  it("an unrelated message cancels the question silently and is handled normally", async () => {
    await msg({ text: "queso 3.25" });
    const before = sent.length;
    await msg({ text: "gracias por todo" });
    expect(sent.length).toBe(before + 1);
    expect(lastSent().text).toContain("Recibido, gracias");
    await msg({ text: "libra" });
    expect(drafts()).toHaveLength(0);
  });

  it("an answer after 15 minutes does nothing", async () => {
    await msg({ text: "queso 3.25" });
    vi.setSystemTime(Date.now() + 16 * MIN);
    await msg({ text: "libra" });
    expect(drafts()).toHaveLength(0);
    expect(sent.filter((s) => s.text.includes("Anoté"))).toHaveLength(0);
  });

  it("an expired question never says «no guardé lo que mandaste»", async () => {
    await msg({ text: "queso 3.25" });
    vi.setSystemTime(Date.now() + 16 * MIN);
    await msg({ text: "gracias" });
    expect(sent.some((s) => s.text === KITCHEN_COPY.ROUTING_EXPIRED)).toBe(
      false
    );
  });

  it("a webhook retry asks once and answers once", async () => {
    await msg({ text: "queso 3.25" }, 500);
    await msg({ text: "queso 3.25" }, 500);
    expect(sent.filter((s) => s.text === unitAsk("queso"))).toHaveLength(1);
    expect(questionRows()).toHaveLength(1);
    await msg({ text: "libra" }, 501);
    await msg({ text: "libra" }, 501);
    expect(drafts()).toHaveLength(1);
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("two prices without unit are asked together and share the answer", async () => {
    await msg({ text: "queso 3.25 y jamón 4.10" });
    expect(lastSent().text).toBe(unitAsk("queso y jamón"));
    await msg({ text: "por kilo" });
    expect(lineUnits()).toEqual(["kg", "kg"]);
  });
});

describe("voice goes through the same pipeline", () => {
  it("«un dólar cincuenta la libra» is 1.50 per lb and only the length is logged", async () => {
    transcript = "el aguacate ahora está a un dólar cincuenta la libra";
    await msg({ voice: { file_id: "VOICE-SECRET", duration: 3 } });
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain("aguacate $1.50 la libra");
    expect(logged()).toContain(`transcript_len=${transcript.length}`);
    expect(logged()).not.toContain("aguacate");
    expect(logged()).not.toContain("VOICE-SECRET");
  });

  it("a voice price without unit asks the unit too", async () => {
    transcript = "el queso a 3.25";
    await msg({ voice: { file_id: "V", duration: 3 } });
    expect(lastSent().text).toBe(unitAsk("queso"));
    expect(drafts()).toHaveLength(0);
  });
});

describe("AI fallback", () => {
  const text = "el aguacate (1,5) la libra";

  it("accepted when the price is in the text", async () => {
    ai.mockResolvedValue({
      items: [
        { product: "aguacate", price: 1.5, unit: "libra", currency: null },
      ],
    });
    await msg({ text });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain("aguacate $1.50 la libra");
  });

  it("a price that is not in the text is dropped", async () => {
    ai.mockResolvedValue({
      items: [
        { product: "aguacate", price: 9.99, unit: "libra", currency: null },
      ],
    });
    await msg({ text });
    expect(drafts()).toHaveLength(0);
    expect(lastSent().text).toBe(KITCHEN_COPY.PRICE_UPDATE_UNCLEAR);
  });

  it("unit null asks the unit question", async () => {
    ai.mockResolvedValue({
      items: [{ product: "aguacate", price: 1.5, unit: null, currency: null }],
    });
    await msg({ text: "el aguacate (1,5)" });
    expect(lastSent().text).toBe(unitAsk("aguacate"));
    expect(drafts()).toHaveLength(0);
    await msg({ text: "onza" });
    expect(lineUnits()).toEqual(["oz"]);
  });

  it("an invented unit asks instead of saving", async () => {
    ai.mockResolvedValue({
      items: [
        { product: "aguacate", price: 1.5, unit: "libra", currency: null },
      ],
    });
    await msg({ text: "el aguacate (1,5)" });
    expect(lastSent().text).toBe(unitAsk("aguacate"));
  });

  it("an AI error is «No entendí el precio», never a thank-you", async () => {
    ai.mockRejectedValue(new Error("boom"));
    await msg({ text });
    expect(lastSent().text).toBe(KITCHEN_COPY.PRICE_UPDATE_UNCLEAR);
    expect(drafts()).toHaveLength(0);
  });

  it("a timeout (null) is the same", async () => {
    ai.mockResolvedValue(null);
    await msg({ text });
    expect(lastSent().text).toBe(KITCHEN_COPY.PRICE_UPDATE_UNCLEAR);
  });
});

describe("«Recibido, gracias» only for messages that are not a price", () => {
  it("no number: the generic note", async () => {
    await msg({ text: "gracias por todo" });
    expect(lastSent().text).toContain("Recibido, gracias");
    expect(ai).not.toHaveBeenCalled();
  });

  it("reports with numbers stay reports", async () => {
    for (const t of [
      "quedan 3 porciones",
      "llegaron 5 cajas de tomate",
      "86 el aguacate",
      "1 hamburguesa",
      "nos vemos a las 3:30",
    ]) {
      sent.length = 0;
      await msg({ text: t });
      expect(sent.length).toBe(1);
      expect(sent[0].text).not.toBe(KITCHEN_COPY.PRICE_UPDATE_UNCLEAR);
    }
    expect(drafts()).toHaveLength(0);
  });

  it.each([
    "Aguacate 1,50 la onzs!!",
    "aguacate 1.5 x lbra",
    "tomate a 0,80 la libr",
    "el aguacate cuesta 1,5 la libra pero no se cuanto",
    "cebolla $1.2 el kilgramo",
    "pollo 2,5 la libbra",
  ])("%s is never a thank-you", async (t) => {
    await msg({ text: t });
    expect(sent.every(NO_ACK)).toBe(true);
  });
});

describe("two restaurants", () => {
  beforeEach(() => seed(2));

  it("parks first (nothing parsed or written), then the replay uses the new parser", async () => {
    await msg({ text: "Aguacate 1,50 la onzs" });
    expect(lastSent().text).toBe(KITCHEN_COPY.ROUTING_ASK);
    expect(drafts()).toHaveLength(0);
    expect(ai).not.toHaveBeenCalled();
    await tap(optionData(1));
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0].company_id).toBe("co-stage");
    expect(lastSent().text).toContain("aguacate $1.50 la onza");
  });

  it("the unit question belongs to the chosen restaurant and its answer saves there", async () => {
    await msg({ text: "queso 3.25" });
    await tap(optionData(1));
    expect(lastSent().text).toBe(unitAsk("queso"));
    expect(drafts()).toHaveLength(0);
    expect(questionRows()[0].option_staff_ids).toEqual(["st-stage"]);
    await msg({ text: "libra" });
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0].company_id).toBe("co-stage");
  });

  it("an expired unit question is closed silently, no expiry notice", async () => {
    await msg({ text: "queso 3.25" });
    await tap(optionData(0));
    vi.setSystemTime(Date.now() + 16 * MIN);
    sent.length = 0;
    await msg({ text: "se acabó el aguacate" });
    expect(sent.some((s) => s.text === KITCHEN_COPY.ROUTING_EXPIRED)).toBe(
      false
    );
  });
});
