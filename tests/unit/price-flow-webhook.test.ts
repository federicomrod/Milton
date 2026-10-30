// One price pipeline for text and voice: rules -> AI fallback -> save. Every
// product becomes a line (never dropped, never a follow-up question): what was
// not said shows «Sin precio» / «Falta» in Compras. The AI is mocked; nothing
// touches the network. Synthetic data only.
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
  intentAi,
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
  intentAi: vi.fn(),
}));
let transcript = "";
let whisperFails = false;
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
// The AI interpreter (kitchen-intent-ai) is mocked: no network. Default = down (null).
vi.mock(
  "@/lib/restaurant/telegram/kitchen-intent-ai",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/restaurant/telegram/kitchen-intent-ai")
      >();
    return {
      ...actual,
      interpretKitchenMessage: (...a: unknown[]) => intentAi(...a),
    };
  }
);
vi.mock("openai", () => {
  class FakeOpenAI {
    audio = {
      transcriptions: {
        create: async () => {
          if (whisperFails) throw new Error("whisper down");
          return { text: transcript };
        },
      },
    };
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
import { parseMissing } from "@/lib/restaurant/invoice-missing";

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
  whisperFails = false;
  resetOwnerChatGuidance();
  resetRoutingState();
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  process.env.OPENAI_API_KEY = "test-key";
  ai.mockReset().mockResolvedValue(null);
  intentAi.mockReset().mockResolvedValue(null);
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

const questionRows = () =>
  pendingRows().filter((r) => Number(r.telegram_message_id) <= -10_000_000_000);
const NO_ACK = (m: { text: string }) => !m.text.includes("Recibido, gracias");
const drafts = () => invoices().filter((i) => i.status === "needs_review");
const missingOf = (l: Row) => parseMissing(l.notes);

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

describe("unit missing: kept as a line with «Falta», never asked", () => {
  it("«queso 3.25» is saved at once, the unit and quantity are «Falta»", async () => {
    await msg({ text: "queso 3.25" });
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain("queso $3.25");
    expect(lastSent().text).not.toContain("¿");
    expect(questionRows()).toHaveLength(0);
    const line = (store.supplier_invoice_lines ?? [])[0];
    expect(line.description).toBe("queso");
    expect(Number(line.unit_cost)).toBe(3.25);
    expect(missingOf(line)).toEqual(["quantity", "unit"]);
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("a later «libra» is not an answer to anything: nothing more is saved", async () => {
    await msg({ text: "queso 3.25" });
    await msg({ text: "libra" });
    expect(drafts()).toHaveLength(1);
    expect(questionRows()).toHaveLength(0);
  });

  it("an unrelated message is answered normally, nothing is left open", async () => {
    await msg({ text: "queso 3.25" });
    const before = sent.length;
    await msg({ text: "gracias por todo" });
    expect(sent.length).toBe(before + 1);
    expect(lastSent().text).toContain("Estoy aquí para anotar");
    expect(sent.some((s) => s.text.includes("Dejé sin guardar"))).toBe(false);
  });

  it("a webhook retry saves and answers once", async () => {
    await msg({ text: "queso 3.25" }, 500);
    await msg({ text: "queso 3.25" }, 500);
    expect(drafts()).toHaveLength(1);
    expect(sent.filter((s) => s.text.includes("queso $3.25"))).toHaveLength(1);
  });

  it("two prices without unit are two lines of one draft", async () => {
    await msg({ text: "queso 3.25 y jamón 4.10" });
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["queso|3.25|unidad", "jamón|4.1|unidad"]);
    expect((store.supplier_invoice_lines ?? []).map(missingOf)).toEqual([
      ["quantity", "unit"],
      ["quantity", "unit"],
    ]);
    expect(questionRows()).toHaveLength(0);
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

  it("a voice price without unit is kept too, with «Falta» for the unit", async () => {
    transcript = "el queso a 3.25";
    await msg({ voice: { file_id: "V", duration: 3 } });
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain("queso $3.25");
    expect(missingOf((store.supplier_invoice_lines ?? [])[0])).toContain(
      "unit"
    );
  });
});

describe("AI fallback", () => {
  const text = "el aguacate (1,5) la libra";

  it("accepted when the price is in the text", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "aguacate",
          price: 1.5,
          unit: "libra",
          currency: null,
          said: "(1,5) la libra",
        },
      ],
    });
    await msg({ text });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain("aguacate $1.50 la libra");
  });

  it("a price that is not in the text is not trusted: the product is kept without a price", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "aguacate",
          price: 9.99,
          unit: "libra",
          currency: null,
          said: "(1,5) la libra",
        },
      ],
    });
    await msg({ text });
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["aguacate|null|unidad"]);
    expect(lastSent().text).toContain("aguacate");
    expect(lastSent().text).not.toContain("9.99");
  });

  it("unit null keeps the line with «Falta» for the unit", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "aguacate",
          price: 1.5,
          unit: null,
          currency: null,
          said: "(1,5)",
        },
      ],
    });
    await msg({ text: "el aguacate (1,5)" });
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["aguacate|1.5|unidad"]);
    expect(missingOf((store.supplier_invoice_lines ?? [])[0])).toContain(
      "unit"
    );
    expect(questionRows()).toHaveLength(0);
  });

  it("an invented unit is not used: the unit is «Falta»", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "aguacate",
          price: 1.5,
          unit: "libra",
          currency: null,
          said: "(1,5)",
        },
      ],
    });
    await msg({ text: "el aguacate (1,5)" });
    expect(lineSummary()).toEqual(["aguacate|1.5|unidad"]);
    expect(missingOf((store.supplier_invoice_lines ?? [])[0])).toContain(
      "unit"
    );
  });

  it("an AI error never loses the product: it is kept without a price, never a thank-you", async () => {
    ai.mockRejectedValue(new Error("boom"));
    await msg({ text });
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["aguacate|null|unidad"]);
    expect(lastSent().text).toContain("aguacate");
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("a timeout (null) is the same", async () => {
    ai.mockResolvedValue(null);
    await msg({ text });
    expect(lineSummary()).toEqual(["aguacate|null|unidad"]);
  });
});

describe("«Recibido, gracias» only for messages that are not a price", () => {
  it("no number: the AI interpreter answers it, never a bare «Recibido»", async () => {
    intentAi.mockResolvedValue({
      intent: "greeting_or_smalltalk",
      items: [],
      clarify_question: null,
    });
    await msg({ text: "gracias por todo" });
    expect(intentAi).toHaveBeenCalledTimes(1);
    expect(lastSent().text).toContain("Estoy aquí para anotar");
    expect(lastSent().text).not.toContain("Recibido, gracias");
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

  it("a price without a unit is saved in the chosen restaurant, with no question", async () => {
    await msg({ text: "queso 3.25" });
    await tap(optionData(1));
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0].company_id).toBe("co-stage");
    expect(questionRows()).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// Item by item: spoken numbers, partial success, one combined reply
// ---------------------------------------------------------------------------

const voice = (t: string, id?: number) => {
  transcript = t;
  return msg({ voice: { file_id: "VOICE-SECRET", duration: 5 } }, id);
};
const lines = () => store.supplier_invoice_lines ?? [];
const lineSummary = () =>
  lines().map((l) => `${l.description}|${l.unit_cost}|${l.unit}`);
const NOTHING_LOST = (m: { text: string }) =>
  !m.text.includes("Recibido, gracias");

describe("voice: spoken prices become drafts", () => {
  it("«Aguacate a uno cincuenta la onza.» is aguacate $1.50 per oz, not «Recibido»", async () => {
    await voice("Aguacate a uno cincuenta la onza.");
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["aguacate|1.5|oz"]);
    expect(lastSent().text).toContain("aguacate $1.50 la onza");
    expect(sent.every(NOTHING_LOST)).toBe(true);
    expect(ai).not.toHaveBeenCalled();
  });

  it("«Aguacate a uno cincuenta.» is saved with «Falta» for the unit", async () => {
    await voice("Aguacate a uno cincuenta.");
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["aguacate|1.5|unidad"]);
    expect(missingOf((store.supplier_invoice_lines ?? [])[0])).toContain(
      "unit"
    );
  });

  it.each([
    ["Aguacate, uno con cincuenta la libra.", "lb"],
    ["el aguacate a un dólar con cincuenta la onza", "oz"],
    ["Aguacate a 1 con 50 la onza.", "oz"],
    ["aguacate 1,50 la onza", "oz"],
    ["Aguacate a uno cincuenta (la onza)", "oz"],
  ])("%s -> $1.50 draft", async (t, unit) => {
    await voice(t);
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual([`aguacate|1.5|${unit}`]);
    expect(sent.every(NOTHING_LOST)).toBe(true);
  });

  it("«Aguacate a 150 la onza.» never saves 150 by itself and never asks: the line has no price", async () => {
    await voice("Aguacate a 150 la onza.");
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["aguacate|null|oz"]);
    expect(lastSent().text).not.toContain("150");
    expect(lastSent().text).not.toContain("¿");
    expect(sent.every(NOTHING_LOST)).toBe(true);
    expect(questionRows()).toHaveLength(0);
  });

  it("quantity talk with numbers is never a price and never a bare «Recibido» (AI interpreter, not the price AI)", async () => {
    for (const t of [
      "quedan tres porciones",
      "llegaron 5 cajas de tomate",
      "Se usan 2 libras de masa para las pupusas.",
      "1 hamburguesa",
    ]) {
      sent.length = 0;
      await voice(t);
      expect(sent).toHaveLength(1);
      expect(sent[0].text).not.toContain("Recibido, gracias");
    }
    expect(drafts()).toHaveLength(0);
    expect(ai).not.toHaveBeenCalled();
    expect(intentAi).toHaveBeenCalled();
  });

  it("a long note: ten ingredients, one without a price, ALL kept (the unpriced one shows «Sin precio»)", async () => {
    await voice(
      "Precios de hoy. Harina, uno veinticinco la libra. Chicharrón, tres cincuenta la libra. Quesillo, cuatro dólares la libra. Aguacate a uno con cincuenta la onza. Tomate, 80 centavos la libra. Cebolla a 75 centavos la libra. Aceite a dos cincuenta el litro. Sal a cinco centavos la onza. Queso a 4.25 la libra. El agua tibia no tiene precio."
    );
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual([
      "harina|1.25|lb",
      "chicharrón|3.5|lb",
      "quesillo|4|lb",
      "aguacate|1.5|oz",
      "tomate|0.8|lb",
      "cebolla|0.75|lb",
      "aceite|2.5|litro",
      "sal|0.05|oz",
      "queso|4.25|lb",
      "agua tibia|null|unidad",
    ]);
    expect(sent).toHaveLength(1);
    expect(lastSent().text).toContain("agua tibia");
    expect(lastSent().text).not.toContain("No entendí");
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("one message, several prices: partial success, ONE reply", () => {
  const list =
    "Precios para las pupusas revueltas. Masa de maíz a 75 centavos la libra, chicharrón a tres cincuenta la libra, quesillo a 4.25 la libra, frijoles a 1.20, aceite a 2.50 el litro. El agua tibia no tiene precio.";

  const check = async () => {
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual([
      "masa de maíz|0.75|lb",
      "chicharrón|3.5|lb",
      "quesillo|4.25|lb",
      "aceite|2.5|litro",
      "frijoles|1.2|unidad",
      "agua tibia|null|unidad",
    ]);
    expect(lines().some((l) => l.unit_cost === 0)).toBe(false);
    expect(sent).toHaveLength(1);
    const reply = lastSent().text;
    expect(reply).toContain("Anoté en Demo Resto:");
    expect(reply).toContain("masa de maíz $0.75 la libra");
    expect(reply).toContain("aceite $2.50 el litro");
    expect(reply).toContain("frijoles $1.20");
    expect(reply).toContain("agua tibia");
    expect(reply).not.toContain("$0.00");
    expect(reply).not.toContain("¿");
    expect(questionRows()).toHaveLength(0);
    expect(ai).not.toHaveBeenCalled();
  };

  it("voice, with commas", async () => {
    await voice(list);
    await check();
  });

  it("text, with commas", async () => {
    await msg({ text: list });
    await check();
  });

  it("same text split by periods only", async () => {
    await msg({ text: list.replace(/, /g, ". ") });
    await check();
  });

  it("twelve items in one note: all twelve saved", async () => {
    const names =
      "ajo apio arroz azúcar café canela chile harina leche maíz nuez orégano".split(
        " "
      );
    await msg({ text: names.map((n) => `${n} a 1.10 la libra`).join(", ") });
    expect(drafts()).toHaveLength(1);
    expect(lines()).toHaveLength(12);
    expect(sent).toHaveLength(1);
  });

  it("over the limit: 25 saved and the rest is named, never silently dropped", async () => {
    const names = Array.from(
      { length: 28 },
      (_, i) =>
        `prod${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${i > 25 ? "z" : ""}`
    );
    await msg({ text: names.map((n) => `${n} a 1.10 la libra`).join(", ") });
    expect(lines()).toHaveLength(25);
    expect(lastSent().text).toContain("Procesé los primeros 25 precios");
    expect(lastSent().text).toContain(names[27]);
  });

  it("mixed unit / no unit: both are lines of one draft; the missing unit is «Falta»", async () => {
    await msg({ text: "tomate 0.80 la libra y cebolla $0.45" });
    expect(lineSummary()).toEqual(["tomate|0.8|lb", "cebolla|0.45|unidad"]);
    expect(sent).toHaveLength(1);
    expect(lastSent().text).toContain("tomate $0.80 la libra");
    expect(lastSent().text).toContain("cebolla $0.45");
    expect(lastSent().text).not.toContain("¿");
    expect(lines().map(missingOf)).toEqual([
      ["quantity"],
      ["quantity", "unit"],
    ]);
  });

  it("an unreadable price keeps the product without a price, the rest is saved", async () => {
    await msg({
      text: "tomate 0.80 la libra, sal (1,5) la libr, cebolla 0.45 el kilo",
    });
    // AI mocked to null: «sal» keeps its name, its price stays empty.
    expect(lineSummary()).toEqual([
      "tomate|0.8|lb",
      "cebolla|0.45|kg",
      "sal|null|unidad",
    ]);
    expect(sent).toHaveLength(1);
    expect(lastSent().text).toContain("sal");
  });
});

describe("AI fallback is per item and strict", () => {
  const text =
    "masa (0,75) la libra, tomate a 0.80 la libra, sal (0,10) la libra";

  it("a price that cannot be traced to the text: that product is kept without a price", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "masa",
          price: 0.75,
          unit: "libra",
          currency: null,
          said: "(0,75) la libra",
        },
        {
          product: "sal",
          price: 9.99,
          unit: "libra",
          currency: null,
          said: "(0,10) la libra",
        },
      ],
    });
    await msg({ text });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(
      lines()
        .map((l) => l.description)
        .sort()
    ).toEqual(["masa", "sal", "tomate"]);
    expect(lines()).toHaveLength(3);
    expect(sent).toHaveLength(1);
    expect(lastSent().text).toContain("sal");
    expect(lastSent().text).not.toContain("9.99");
  });

  it("«masa de maíz» from the AI is saved with the transcript's word: «masa»", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "masa de maíz",
          price: 0.75,
          unit: "libra",
          currency: null,
          said: "(0,75) la libra",
        },
      ],
    });
    await msg({ text: "masa (0,75) la libra, tomate a 0.80 la libra" });
    expect(
      lines()
        .map((l) => l.description)
        .sort()
    ).toEqual(["masa", "tomate"]);
  });

  it("a `said` that is not in the transcript is not trusted: the product keeps no price", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "masa",
          price: 0.75,
          unit: "libra",
          currency: null,
          said: "a setenta y cinco la libra",
        },
      ],
    });
    await msg({ text: "masa (0,75) la libra, tomate a 0.80 la libra" });
    expect(lineSummary()).toEqual(["tomate|0.8|lb", "masa|null|unidad"]);
    expect(lastSent().text).toContain("masa");
  });

  it("the AI cannot turn a quantity into a price", async () => {
    ai.mockResolvedValue({
      items: [
        {
          product: "masa",
          price: 2,
          unit: "libra",
          currency: null,
          said: "2 libras",
        },
      ],
    });
    await msg({
      text: "tomate a 0.80 la libra, usé 2 libras de masa (0,75) la libra",
    });
    expect(lines().map((l) => l.description)).not.toContain("masa");
  });

  it("the AI is not called when the rules read everything", async () => {
    await msg({ text: "tomate 0.80 la libra, cebolla 0.45 el kilo" });
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("voice that could not be heard", () => {
  it("Whisper failure: «No pude escuchar el audio», never «Recibido»", async () => {
    whisperFails = true;
    await voice("lo que sea");
    expect(sent).toHaveLength(1);
    expect(lastSent().text).toBe(KITCHEN_COPY.VOICE_UNREADABLE);
    expect(lastSent().text).toBe(
      "No pude escuchar el audio. Mándalo otra vez o escríbelo."
    );
    expect(logged()).toContain("route=transcribe_failed");
  });

  it("an empty transcript is the same", async () => {
    await voice("   ");
    expect(lastSent().text).toBe(KITCHEN_COPY.VOICE_UNREADABLE);
  });
});

describe("logs: ids and counts only", () => {
  it("voice logs transcript_len, route and counts, never the words", async () => {
    const t = "Aguacate a uno cincuenta la onza. Frijoles a 1.20.";
    await voice(t);
    const log = logged();
    expect(log).toContain(`transcript_len=${t.length}`);
    expect(log).toContain("route=price_partial");
    expect(log).toContain("items_saved=1");
    expect(log).toContain("items_unit_asked=1");
    expect(log).toContain("items_unclear=0");
    expect(log).toContain("items_skipped_no_price=0");
    expect(log).toContain("ai_called=false");
    expect(log).not.toMatch(/aguacate|frijoles|cincuenta|VOICE-SECRET/i);
  });

  it("text logs text_len and route", async () => {
    const t = "tomate 0.80 la libra, sal (1,5) la libr";
    await msg({ text: t });
    const log = logged();
    expect(log).toContain(`text_len=${t.length}`);
    expect(log).toContain("route=price_partial");
    expect(log).toContain("items_unclear=1");
    expect(log).toContain("ai_called=true");
    expect(log).not.toMatch(/tomate|sal \(/i);
  });

  it("a message the AI interpreter answers is logged as route=ai_handled", async () => {
    await msg({ text: "gracias por todo" });
    expect(logged()).toContain("route=ai_handled");
    expect(logged()).not.toContain("gracias por todo");
  });
});

describe("AI price fallback error handling (S1)", () => {
  it("when the price AI throws the product is still kept, never silence", async () => {
    // Mock AI to throw
    ai.mockRejectedValue(new Error("timeout"));
    // Use a message format that rules can't parse (parentheses) so AI is called
    const t = "el aguacate (1,5) la libra";
    await msg({ text: t });
    // Flush after jobs to ensure async error handling completes
    await Promise.all(afterJobs.splice(0));
    // The product is kept (no price) and the cook gets a reply.
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain("aguacate");
  });

  it("fallback message never sent for non-price messages", async () => {
    ai.mockRejectedValue(new Error("timeout"));
    await msg({ text: "gracias" }); // no price intent
    await Promise.all(afterJobs.splice(0));
    expect(
      sent.every((s) => !s.text.includes("No pude leer los precios"))
    ).toBe(true);
  });
});

describe("confirmation markup (M1)", () => {
  it("keeps «Cambiar restaurante» on the confirmation for multi-restaurant cooks", async () => {
    seed(2); // Two restaurants for multi-restaurant scenario
    await msg({ text: "queso 3.25" });
    // Select a restaurant first (tap button 0)
    await tap(optionData(0));
    // Once a restaurant is chosen, the next confirmation carries the button.
    await msg({ text: "queso 3.25" });
    const confirmations = sent.filter((s) => s.text.includes("queso"));
    expect(confirmations.length).toBeGreaterThan(0);
    const confirmation = confirmations[confirmations.length - 1];
    expect(confirmation.markup).toBeDefined();
    expect(confirmation.markup?.inline_keyboard).toBeDefined();
    expect(confirmation.markup?.inline_keyboard.length).toBeGreaterThan(0);
  });

  it("no markup for single-restaurant cooks", async () => {
    seed(1); // Single restaurant
    await msg({ text: "queso 3.25" });
    const confirmations = sent.filter((s) => s.text.includes("queso"));
    expect(confirmations.length).toBeGreaterThan(0);
    const confirmation = confirmations[confirmations.length - 1];
    expect(confirmation.markup).toBeUndefined();
  });
});

describe("nothing the cook says is dropped (Telegram, same as the app)", () => {
  it("«Hoy compramos pan a 2 dólares el kilo y unos tomates» (voice, with Whisper's final period): 2 lines", async () => {
    await voice("Hoy compramos pan a 2 dólares el kilo y unos tomates.");
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["pan|2|kg", "tomates|null|unidad"]);
    expect(lines().map(missingOf)).toEqual([
      ["quantity"],
      ["quantity", "unit"],
    ]);
    // Never a total for a line whose price is unknown.
    expect(Number(lines()[1].line_total)).toBe(0);
    expect(lastSent().text).toContain("pan $2.00 el kilo");
    expect(lastSent().text).toContain("tomates");
    expect(lastSent().text).not.toContain("¿");
    expect(questionRows()).toHaveLength(0);
    expect(sent.every(NOTHING_LOST)).toBe(true);
  });

  it("«se acabó el queso y compramos 3 kg de harina»: 1 Cocina alert + 1 Compras line", async () => {
    intentAi.mockResolvedValue({
      intent: "stock_report",
      items: [
        {
          product: "queso",
          matched_ingredient_id: null,
          amount: 0,
          unit: null,
          currency: null,
        },
      ],
      clarify_question: null,
    });
    await msg({ text: "se acabó el queso y compramos 3 kg de harina" });
    // Compras: the flour, with quantity and unit, no price.
    expect(drafts()).toHaveLength(1);
    expect(lineSummary()).toEqual(["harina|null|kg"]);
    expect(Number(lines()[0].quantity)).toBe(3);
    expect(missingOf(lines()[0])).toEqual([]);
    // Cocina: one stock alert, for the cheese.
    const reports = (store.kitchen_reports ?? []).filter(
      (r) => r.report_type === "86"
    );
    expect(reports).toHaveLength(1);
    expect(sent.some((s) => s.text.includes("Cocina › Se agota"))).toBe(true);
    expect(sent.every(NOTHING_LOST)).toBe(true);
  });
});
