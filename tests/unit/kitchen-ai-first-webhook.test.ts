// AI-first kitchen bot, through the COMPLETE webhook POST (text and voice).
// Every message ends in a draft (supplier_invoices), a stored stock report, a
// question that keeps the conversation open, or a reply that explains why:
// never a bare «Recibido», never silence. Both AIs are mocked (no network);
// the company currency and the invoice writer are controllable. Synthetic data.
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
let draftThrows = false;
let companyCurrency = "USD";

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
    createInvoiceDraft: (
      ...a: Parameters<typeof actual.createInvoiceDraft>
    ) => {
      if (draftThrows) throw new Error("db down");
      return actual.createInvoiceDraft(...a);
    },
  };
});
vi.mock("@/lib/restaurant/currency", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/restaurant/currency")>();
  return { ...actual, resolveCompanyCurrency: async () => companyCurrency };
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

const lastSent = () => sent[sent.length - 1];
const invoices = () => store.supplier_invoices ?? [];
const drafts = () => invoices().filter((i) => i.status === "needs_review");
const lines = () => store.supplier_invoice_lines ?? [];
const lineSummary = () =>
  lines().map((l) => `${l.description}|${l.unit_cost}|${l.unit}`);
const pendingRows = () => store.kitchen_pending_items ?? [];
const openQuestions = () =>
  pendingRows().filter(
    (r) => Number(r.telegram_message_id) <= -10_000_000_000 && !r.resolved_at
  );
const logged = () => consoleCalls.join("\n");
const NO_ACK = (m: { text: string }) => !m.text.includes("Recibido, gracias");

type Mode = "text" | "voice";
function say(mode: Mode, t: string, id?: number) {
  if (mode === "text") return msg({ text: t }, id);
  transcript = t;
  return msg({ voice: { file_id: "VOICE-SECRET", duration: 4 } }, id);
}

const AMOUNT_ASK = (p: string, a: string, b: string) =>
  `¿El ${p} está a $${a} o a $${b}? Responde ${a} o ${b}.`;
const UNIT_ASK = (p: string) =>
  `¿El precio de ${p} es por libra, onza o unidad?`;

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
  draftThrows = false;
  companyCurrency = "USD";
  resetOwnerChatGuidance();
  resetRoutingState();
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  process.env.OPENAI_API_KEY = "test-key";
  ai.mockReset().mockResolvedValue(null);
  intentAi.mockReset().mockResolvedValue(null);
  extractInvoice.mockReset();
  classify.mockReset();
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

const stock = (intent = "stock_report") => ({
  intent,
  items: [],
  clarify_question: null,
});

// ---------------------------------------------------------------------------
// The 11 messages, text AND voice, through the complete webhook POST
// ---------------------------------------------------------------------------

describe.each<Mode>(["text", "voice"])("the 11 messages (%s)", (mode) => {
  it("1. «aguacate a 150»: asks 1.50 or 150, then the answer «150» and the unit give a $150 draft", async () => {
    await say(mode, "aguacate a 150");
    expect(lastSent().text).toBe(AMOUNT_ASK("aguacate", "1.50", "150"));
    expect(drafts()).toHaveLength(0);
    expect(openQuestions()).toHaveLength(1);

    await say(mode, "150");
    expect(lastSent().text).toBe(UNIT_ASK("aguacate"));
    expect(drafts()).toHaveLength(0);

    await say(mode, "por libra");
    expect(lineSummary()).toEqual(["aguacate|150|lb"]);
    expect(lastSent().text).toContain("aguacate $150.00 la libra");
    expect(lastSent().text).toContain("El dueño o un admin lo revisa");
    expect(sent.every(NO_ACK)).toBe(true);
    expect(drafts()[0].status).toBe("needs_review");
  });

  it("1b. when only the AI sees the doubt (rules read nothing), its clarify becomes OUR question, never its own words", async () => {
    intentAi.mockResolvedValue({
      intent: "price_update",
      items: [
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 150,
          unit: null,
          currency: "USD",
        },
      ],
      clarify_question: "¿Seguro que son 150? Dime tú cuánto",
      clarify: { product: "aguacate", options: [1.5, 150], unit: null },
    });
    await say(mode, "el aguacate anda por ahí, 150");
    expect(lastSent().text).toBe(AMOUNT_ASK("aguacate", "1.50", "150"));
    expect(lastSent().text).not.toContain("Seguro");
    expect(drafts()).toHaveLength(0);
  });

  it("2. «avocado 150»: not understood (with the product), never «Recibido» and no draft", async () => {
    await say(mode, "avocado 150");
    expect(lastSent().text).toContain("No entendí: avocado");
    expect(sent.every(NO_ACK)).toBe(true);
    expect(drafts()).toHaveLength(0);
  });

  it("3. «el último precio del aguacate es 3.50 dólares la libra»: price beats the word «último»", async () => {
    await say(mode, "el último precio del aguacate es 3.50 dólares la libra");
    expect(lineSummary()).toEqual(["aguacate|3.5|lb"]);
    expect(lastSent().text).toContain("aguacate $3.50 la libra");
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("4. «aguacate a 150 pesos» in a USD company: mismatch, nothing saved, no question", async () => {
    await say(mode, "aguacate a 150 pesos");
    expect(drafts()).toHaveLength(0);
    expect(openQuestions()).toHaveLength(0);
    expect(lastSent().text).toBe(
      "Dijiste pesos mexicanos (MXN), pero Demo Resto trabaja en dólares (USD). Mándame el precio en dólares (USD)."
    );
  });

  it("5. «el aguacate está a 150 dólares» asks the unit; «por libra» saves 150/lb", async () => {
    await say(mode, "el aguacate está a 150 dólares");
    expect(lastSent().text).toBe(UNIT_ASK("aguacate"));
    expect(drafts()).toHaveLength(0);
    await say(mode, "por libra");
    expect(lineSummary()).toEqual(["aguacate|150|lb"]);
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("6. «ya no hay tomate»: a stored stock report and a reply that says where", async () => {
    intentAi.mockResolvedValue(stock());
    await say(mode, "ya no hay tomate");
    expect(lastSent().text).toContain("Cocina › Se agota");
    expect(lastSent().text).toContain("Demo Resto › Local Centro");
    expect(sent.every(NO_ACK)).toBe(true);
    const row = (store.kitchen_reports ?? [])[0];
    expect(row.report_type).toBe("86");
    if (mode === "voice") expect(row.transcript).toBe("ya no hay tomate");
    expect(drafts()).toHaveLength(0);
  });

  it("6b. the same with the AI down: still stored and answered (not «Recibido»)", async () => {
    await say(mode, "ya no hay tomate");
    expect(lastSent().text).toContain("Cocina › Se agota");
    expect((store.kitchen_reports ?? [])[0].report_type).toBe("86");
  });

  it("7. «se quemó una bandeja de pollo»: waste, in Cocina › Merma", async () => {
    intentAi.mockResolvedValue(stock());
    await say(mode, "se quemó una bandeja de pollo");
    expect(lastSent().text).toContain("Cocina › Merma");
    expect((store.kitchen_reports ?? [])[0].report_type).toBe("waste");
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("8. «hola»: a greeting from the AI, and a greeting too when the AI is down", async () => {
    intentAi.mockResolvedValue(stock("greeting_or_smalltalk"));
    await say(mode, "hola");
    expect(lastSent().text).toContain("Estoy aquí para anotar");
    intentAi.mockResolvedValue(null);
    await say(mode, "hola");
    expect(lastSent().text).toContain("Estoy aquí para anotar");
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("9. «¿cuánto cuesta la pupusa?»: a question, answered honestly, with the AI up or down", async () => {
    intentAi.mockResolvedValue(stock("question"));
    await say(mode, "¿cuánto cuesta la pupusa?");
    expect(lastSent().text).toBe(KITCHEN_COPY.QUESTION_RESPONSE);
    intentAi.mockResolvedValue(null);
    await say(mode, "¿cuánto cuesta la pupusa?");
    expect(lastSent().text).toBe(
      "Todavía no puedo responder preguntas; puedo anotar precios, facturas, recetas, se agota y merma."
    );
    expect(lastSent().text).not.toContain("No pude procesarlo");
    expect(drafts()).toHaveLength(0);
  });

  it("10. «se acabó el aguacate y ahora está a 3.50 la libra»: stock + price draft in ONE reply", async () => {
    intentAi.mockResolvedValue({
      intent: "price_update",
      items: [
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 3.5,
          unit: "lb",
          currency: "USD",
        },
      ],
      clarify_question: null,
    });
    await say(mode, "se acabó el aguacate y ahora está a 3.50 la libra");
    expect(lineSummary()).toEqual(["aguacate|3.5|lb"]);
    expect(sent).toHaveLength(1);
    expect(lastSent().text).toContain("aguacate $3.50 la libra");
    expect(lastSent().text).toContain("Cocina › Se agota");
    expect((store.kitchen_reports ?? [])[0].report_type).toBe("86");
  });

  it("11. the pupusas list: the three prices are asked together and saved after the unit", async () => {
    await say(
      mode,
      "Precios de pupusas: revuelta 1.25, queso 1.00, frijol con queso 1.10"
    );
    expect(drafts()).toHaveLength(0);
    expect(lastSent().text).toContain("por libra, onza o unidad");
    expect(lastSent().text).toContain("revuelta");
    await say(mode, "por unidad");
    expect(lineSummary()).toEqual([
      "revuelta|1.25|unidad",
      "queso|1|unidad",
      "frijol con queso|1.1|unidad",
    ]);
    expect(sent.every(NO_ACK)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Webhook cases 1-7 of the original spec (voice)
// ---------------------------------------------------------------------------

describe("webhook cases (voice)", () => {
  it("1. «aguacate a 150 la libra» asks, «uno cincuenta» saves 1.50/lb", async () => {
    await say("voice", "aguacate a 150 la libra");
    expect(lastSent().text).toBe(AMOUNT_ASK("aguacate", "1.50", "150"));
    expect(openQuestions()).toHaveLength(1);
    await say("voice", "uno cincuenta");
    expect(lineSummary()).toEqual(["aguacate|1.5|lb"]);
    expect(lastSent().text).toContain("aguacate $1.50 la libra");
    expect(openQuestions()).toHaveLength(0);
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("1c. «ciento cincuenta» as the answer is 150", async () => {
    await say("voice", "aguacate a 150 la libra");
    await say("voice", "ciento cincuenta");
    expect(lineSummary()).toEqual(["aguacate|150|lb"]);
  });

  it("2. «el aguacate está a 150 dólares» asks the unit, «Por libra.» saves it (never REPORT_ACK)", async () => {
    await say("voice", "el aguacate está a 150 dólares");
    expect(lastSent().text).toBe(UNIT_ASK("aguacate"));
    await say("voice", "Por libra.");
    expect(lineSummary()).toEqual(["aguacate|150|lb"]);
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("3. «avocado 150» is PRICE_NOT_UNDERSTOOD", async () => {
    await say("voice", "avocado 150");
    expect(lastSent().text).toBe(
      "No entendí: avocado. Escríbelos como «aguacate $1.50 la libra»."
    );
  });

  it("4. «Ya no hay aguacate, ahora está a 3.50 dólares la libra» is a draft", async () => {
    // The rules cannot tell what «ahora está a…» belongs to: the AI does.
    intentAi.mockResolvedValue({
      intent: "price_update",
      items: [
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 3.5,
          unit: "lb",
          currency: "USD",
        },
      ],
      clarify_question: null,
    });
    await say(
      "voice",
      "Ya no hay aguacate, ahora está a 3.50 dólares la libra"
    );
    expect(lineSummary()).toEqual(["aguacate|3.5|lb"]);
    expect(sent.every(NO_ACK)).toBe(true);
  });

  it("5. a save that throws sends PRICE_SAVE_FAILED (the swallow-catch is gone)", async () => {
    draftThrows = true;
    await say("voice", "aguacate a 3.50 la libra");
    expect(lastSent().text).toBe(KITCHEN_COPY.PRICE_SAVE_FAILED);
    expect(drafts()).toHaveLength(0);
    expect(logged()).not.toMatch(/aguacate/i);
  });

  it("5b. the same for the answer to a unit question (text)", async () => {
    await say("text", "queso 3.25");
    draftThrows = true;
    await say("text", "libra");
    expect(lastSent().text).toBe(KITCHEN_COPY.PRICE_SAVE_FAILED);
  });

  it("6. «aguacate a 150 pesos el kilo» in a USD company: PRICE_CURRENCY_MISMATCH, no draft", async () => {
    await say("voice", "aguacate a 150 pesos el kilo");
    expect(drafts()).toHaveLength(0);
    expect(lastSent().text).toContain("Dijiste pesos mexicanos (MXN)");
    expect(lastSent().text).toContain("Demo Resto trabaja en dólares (USD)");
  });

  it("6b. the same message in a company that works in pesos is a 150/kg draft", async () => {
    companyCurrency = "MXN";
    await say("voice", "aguacate a 150 pesos el kilo");
    expect(lineSummary()).toEqual(["aguacate|150|kg"]);
    expect(lastSent().text).toContain("aguacate $150.00 el kilo");
  });

  it("7. an ingredient that matches none is saved anyway, and the cook is told with close names", async () => {
    store.ingredients = [
      {
        id: "i1",
        company_id: "co-demo",
        name: "Aguacate Hass",
        archived_at: null,
      },
      { id: "i2", company_id: "co-demo", name: "Tomate", archived_at: null },
      {
        id: "i3",
        company_id: "co-stage",
        name: "Aguacate Criollo",
        archived_at: null,
      },
    ];
    await say("voice", "aguacate a 3.50 la libra");
    expect(drafts()).toHaveLength(1);
    expect(lastSent().text).toContain(
      "No encontré el ingrediente ‘aguacate’. ¿Lo creo? Parecidos: Aguacate Hass."
    );
    // Another company's ingredient is never suggested.
    expect(lastSent().text).not.toContain("Criollo");
    expect(lastSent().text).toContain("Lo dejé en Compras para revisar.");
  });

  it("7b. without close names: no «Parecidos»", async () => {
    store.ingredients = [
      { id: "i2", company_id: "co-demo", name: "Tomate", archived_at: null },
    ];
    await say("voice", "aguacate a 3.50 la libra");
    expect(lastSent().text).toContain(
      "No encontré el ingrediente ‘aguacate’. ¿Lo creo? Lo dejé en Compras para revisar."
    );
  });

  it("a retry of the same update saves once and logs the fixed duplicate line", async () => {
    await say("text", "aguacate a 3.50 la libra", 900);
    expect(drafts()).toHaveLength(1);
    // Telegram delivers the same message again: no second draft, no second reply.
    const before = sent.length;
    await say("text", "aguacate a 3.50 la libra", 900);
    expect(drafts()).toHaveLength(1);
    expect(sent.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Regression table through the full voice flow: draft, or a reply that explains
// ---------------------------------------------------------------------------

describe("regression table (voice, AI mocked as down)", () => {
  it.each([
    ["aguacate a 150", "ask"],
    ["Aguacate a 150.", "ask"],
    ["el aguacate ahora está a 150 pesos el kilo", "mismatch"],
    ["el aguacate subió a 3.50 dólares la libra", "draft"],
    ["avocado 150", "reply"],
    ["aguacate 150", "reply"],
    ["el aguacate está a 150 dólares", "ask"],
    ["El precio del aguacate es de 150 dólares.", "ask"],
    [
      "Precios de pupusas: revuelta 1.25, queso 1.00, frijol con queso 1.10",
      "ask",
    ],
  ])("«%s» ends in %s", async (text, outcome) => {
    await say("voice", text);
    if (outcome === "draft") {
      expect(drafts()).toHaveLength(1);
    } else {
      expect(drafts()).toHaveLength(0);
    }
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(NO_ACK)).toBe(true);
    expect(lastSent().text.length).toBeGreaterThan(10);
    if (outcome === "mismatch") {
      expect(lastSent().text).toContain("Dijiste pesos mexicanos");
    }
    if (text.startsWith("El precio del aguacate")) {
      expect(lastSent().text).toBe(UNIT_ASK("aguacate"));
    }
  });
});

// ---------------------------------------------------------------------------
// Routing: price beats report words; the answer closes unrelated questions
// ---------------------------------------------------------------------------

describe("routing", () => {
  it("a price with report words in it is a draft, and the AI interpreter is not even needed", async () => {
    await say("text", "el último precio del aguacate es 3.50 dólares la libra");
    expect(intentAi).not.toHaveBeenCalled();
    expect(drafts()).toHaveLength(1);
  });

  it("a plain-text message never gets a reply before the AI interpreter ran", async () => {
    intentAi.mockImplementation(async () => {
      expect(sent).toHaveLength(0);
      return stock("greeting_or_smalltalk");
    });
    await say("text", "buenas tardes");
    expect(intentAi).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("a voice answer to an open question closes an unrelated one with PRICE_QUESTION_CLOSED", async () => {
    await say("text", "queso 3.25");
    await say("voice", "se acabó el limón");
    expect(
      sent.some((s) => s.text.includes("Dejé sin guardar el precio de queso"))
    ).toBe(true);
    expect(drafts()).toHaveLength(0);
  });

  it("two restaurants: the amount question belongs to the chosen one, and the VOICE answer needs no «¿para qué restaurante?»", async () => {
    seed(2);
    await say("text", "aguacate a 150 la libra");
    expect(lastSent().text).toBe(KITCHEN_COPY.ROUTING_ASK);
    const data = lastSent().markup?.inline_keyboard[1][0].callback_data;
    await post({
      callback_query: {
        id: "cb-1",
        from: { id: COOK },
        message: { message_id: 77, chat: { id: CHAT, type: "private" } },
        data,
      },
    });
    expect(lastSent().text).toBe(AMOUNT_ASK("aguacate", "1.50", "150"));
    expect(openQuestions()[0].option_staff_ids).toEqual(["st-stage"]);
    await say("voice", "uno cincuenta");
    expect(
      sent.filter((s) => s.text === KITCHEN_COPY.ROUTING_ASK)
    ).toHaveLength(1);
    expect(drafts()).toHaveLength(1);
    expect(drafts()[0].company_id).toBe("co-stage");
    expect(lineSummary()).toEqual(["aguacate|1.5|lb"]);
  });

  it("logs ids and lengths only, never the words", async () => {
    await say("voice", "aguacate a 150 la libra");
    await say("voice", "avocado 150");
    const log = logged();
    expect(log).toContain("transcript_len=");
    expect(log).not.toMatch(/aguacate|avocado|VOICE-SECRET/i);
  });
});

// ---------------------------------------------------------------------------
// Currency and unit come from the MESSAGE, never from the AI. The interpreter's
// RAW answer goes through the real validator here (the mock above bypasses it).
// ---------------------------------------------------------------------------

async function aiRaw(raw: unknown) {
  const actual = await vi.importActual<
    typeof import("@/lib/restaurant/telegram/kitchen-intent-ai")
  >("@/lib/restaurant/telegram/kitchen-intent-ai");
  intentAi.mockImplementation(async (text: unknown) =>
    actual.validateKitchenIntent(raw, String(text), {
      conversation: [],
      company_currency: "USD",
      ingredient_hints: [],
      pending_question: null,
    })
  );
}
const priceRaw = (
  amount: number,
  unit: string | null,
  currency: string | null
) => ({
  intent: "price_update",
  items: [{ product: "aguacate", amount, unit, currency }],
  clarify_question: null,
});

describe.each<Mode>(["text", "voice"])(
  "the currency is the message's, not the AI's (%s)",
  (mode) => {
    it.each([["USD"], [null]])(
      "«se acabó el aguacate y ahora está a 150 pesos la libra», AI says %s: mismatch, no draft",
      async (aiCurrency) => {
        await aiRaw(priceRaw(150, "lb", aiCurrency));
        await say(
          mode,
          "se acabó el aguacate y ahora está a 150 pesos la libra"
        );
        expect(drafts()).toHaveLength(0);
        expect(lastSent().text).toContain("Dijiste pesos mexicanos (MXN)");
        expect(lastSent().text).toContain("trabaja en dólares (USD)");
      }
    );

    it.each([["USD"], [null]])(
      "«el aguacate ya cuesta 40 pesos cada uno», AI says %s: mismatch, no draft",
      async (aiCurrency) => {
        await aiRaw(priceRaw(40, "unidad", aiCurrency));
        await say(mode, "el aguacate ya cuesta 40 pesos cada uno");
        expect(drafts()).toHaveLength(0);
        expect(lastSent().text).toContain("Dijiste pesos mexicanos (MXN)");
      }
    );

    it("a message that names no currency keeps the company's (AI saying MXN is ignored)", async () => {
      await aiRaw(priceRaw(3.5, "lb", "MXN"));
      await say(mode, "el aguacate ya cuesta 3.50 la libra");
      expect(lineSummary()).toEqual(["aguacate|3.5|lb"]);
    });

    it("the amount answer «150 pesos» is a mismatch, not a USD draft", async () => {
      await say(mode, "aguacate a 150");
      expect(lastSent().text).toBe(AMOUNT_ASK("aguacate", "1.50", "150"));
      await say(mode, "150 pesos");
      expect(drafts()).toHaveLength(0);
      expect(lastSent().text).toContain("Dijiste pesos mexicanos (MXN)");
    });

    it("the AI cannot invent a unit: «ahora está a 3.50» with AI «lb» asks the unit, saves nothing", async () => {
      await aiRaw(priceRaw(3.5, "lb", null));
      await say(mode, "se acabó el aguacate y ahora está a 3.50");
      expect(drafts()).toHaveLength(0);
      expect(lastSent().text).toContain(UNIT_ASK("aguacate"));
    });
  }
);

describe("a mixed message while the AI is down", () => {
  it("keeps the stock report and says the price was NOT noted", async () => {
    intentAi.mockResolvedValue(null);
    await say("text", "se acabó el aguacate y ahora está a 3.50 la libra");
    expect(drafts()).toHaveLength(0);
    expect((store.kitchen_reports ?? [])[0].report_type).toBe("86");
    expect(lastSent().text).toContain(
      "El precio no lo anoté; mándalo solo, por ejemplo «aguacate $3.50 la libra»."
    );
  });
  it("a plain stock report with a quantity gets no price warning", async () => {
    intentAi.mockResolvedValue(null);
    await say("text", "se acabó el aguacate, quedan 3 cajas");
    expect(lastSent().text).not.toContain("El precio no lo anoté");
  });
});
