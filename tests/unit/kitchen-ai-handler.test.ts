/**
 * Tests for AI-first kitchen message handler.
 * Realistic El Salvador Spanish: slang, typos, mixed messages, edge cases.
 * All with mocked AI - no network calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  KitchenIntentResult,
  KitchenIntentContext,
} from "@/lib/restaurant/telegram/kitchen-intent-ai";

// Mock the AI interpreter
const mockAi = vi.fn();
const mockPriceSafe = vi.fn();
const mockOpenAmount = vi.fn();
const mockOpenUnit = vi.fn();
const mockFindOpen = vi.fn();
const mockComplete = vi.fn();

vi.mock(
  "@/lib/restaurant/telegram/kitchen-intent-ai",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/restaurant/telegram/kitchen-intent-ai")
      >();
    return {
      ...actual,
      interpretKitchenMessage: mockAi,
    };
  }
);

// The context reads the database: not what these tests are about.
vi.mock("@/lib/restaurant/telegram/kitchen-context", () => ({
  buildKitchenContext: async () => ({
    conversation: [],
    company_currency: "USD",
    ingredient_hints: [{ id: "ing-123", name: "Aguacate Hass" }],
    pending_question: null,
  }),
}));

const mockSendMessage = vi.fn();
const mockRecordReport = vi.fn();

vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: mockSendMessage,
}));

vi.mock("@/lib/restaurant/telegram/kitchen-reports", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-reports")
    >();
  return { ...actual, recordKitchenReport: mockRecordReport };
});

vi.mock("@/lib/restaurant/telegram/kitchen-media", () => ({
  processPriceUpdateSafe: mockPriceSafe,
}));

vi.mock(
  "@/lib/restaurant/telegram/price-unit-question",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/restaurant/telegram/price-unit-question")
      >();
    return {
      ...actual,
      openAmountQuestion: mockOpenAmount,
      openUnitQuestion: mockOpenUnit,
      findOpenUnitQuestion: mockFindOpen,
    };
  }
);

vi.mock(
  "@/lib/restaurant/telegram/kitchen-pending-answer",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/restaurant/telegram/kitchen-pending-answer")
      >();
    return { ...actual, completePendingQuestion: mockComplete };
  }
);

const STAFF = {
  id: "staff-1",
  company_id: "company-1",
  location_id: "loc-1",
  company_name: "Pupusería El Salvador",
  location_name: "Sucursal Centro",
};
const LINK = {
  telegramUserId: 1,
  staffId: "staff-1",
  companyId: "company-1",
  companyName: "Pupusería El Salvador",
  locationId: "loc-1",
  locationName: "Sucursal Centro",
} as never;

// A Supabase stand-in whose kitchen_reports update always succeeds.
const updates: Array<Record<string, unknown>> = [];
const admin = {
  from: () => {
    const chain: Record<string, unknown> = {};
    chain.update = (patch: Record<string, unknown>) => {
      updates.push(patch);
      return chain;
    };
    chain.eq = () => chain;
    chain.then = (res: (v: unknown) => unknown) => res({ error: null });
    return chain;
  },
} as never;

describe("AI kitchen handler - realistic messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    mockOpenAmount.mockResolvedValue({ ok: true, created: true });
    mockOpenUnit.mockResolvedValue({ ok: true, created: true });
    mockFindOpen.mockResolvedValue(null);
  });

  const testCases: Array<{
    desc: string;
    message: string;
    mockIntent: KitchenIntentResult["intent"];
    mockItems?: KitchenIntentResult["items"];
    expectedReply?: RegExp;
    shouldCreateDraft?: boolean;
  }> = [
    // Price updates
    {
      desc: "simple price with unit",
      message: "aguacate a 1.50 la libra",
      mockIntent: "price_update",
      mockItems: [
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 1.5,
          unit: "lb",
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },
    {
      desc: "price from supplier (El Salvador context)",
      message: "el proveedor subió el queso a 4.25 la libra",
      mockIntent: "price_update",
      mockItems: [
        {
          product: "queso",
          matched_ingredient_id: null,
          amount: 4.25,
          unit: "lb",
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },
    {
      desc: "ambiguous 3-digit (AI resolves with context)",
      message: "aguacate a 150",
      mockIntent: "price_update",
      mockItems: [
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 150,
          unit: null,
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },
    {
      desc: "voice follow-up after unit question",
      message: "por libra",
      mockIntent: "answer_to_pending",
      shouldCreateDraft: true, // Falls through to existing unit handler
    },

    // Stock reports
    {
      desc: "se acabó (86)",
      message: "ya no hay tomate",
      mockIntent: "stock_report",
      mockItems: [
        {
          product: "tomate",
          matched_ingredient_id: null,
          amount: 0,
          unit: null,
          currency: null,
        },
      ],
      shouldCreateDraft: true,
    },
    {
      desc: "merma/waste",
      message: "se quemó una bandeja de pollo",
      mockIntent: "stock_report",
      mockItems: [
        {
          product: "pollo",
          matched_ingredient_id: null,
          amount: 1,
          unit: "bandeja",
          currency: null,
        },
      ],
      shouldCreateDraft: true,
    },
    {
      desc: "se está acabando (running out)",
      message: "quedan pocos aguacates",
      mockIntent: "stock_report",
      mockItems: [
        {
          product: "aguacates",
          matched_ingredient_id: null,
          amount: 0,
          unit: null,
          currency: null,
        },
      ],
      shouldCreateDraft: true,
    },

    // Mixed messages
    {
      desc: "stock + price mixed",
      message: "se acabó el aguacate y ahora está a 3.50 la libra",
      mockIntent: "price_update", // Primary intent
      mockItems: [
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 3.5,
          unit: "lb",
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },

    // Questions
    {
      desc: "price question",
      message: "¿cuánto cuesta la pupusa?",
      mockIntent: "question",
      expectedReply: /no puedo responder preguntas/i,
    },
    {
      desc: "availability question",
      message: "¿a cuánto está el aguacate?",
      mockIntent: "question",
      expectedReply: /no puedo responder preguntas/i,
    },

    // Greetings / smalltalk
    {
      desc: "simple greeting",
      message: "hola",
      mockIntent: "greeting_or_smalltalk",
      expectedReply: /hola.*estoy aquí/i,
    },
    {
      desc: "thanks",
      message: "gracias",
      mockIntent: "greeting_or_smalltalk",
      expectedReply: /hola/i,
    },
    {
      desc: "buenos días",
      message: "buenos días",
      mockIntent: "greeting_or_smalltalk",
      expectedReply: /hola/i,
    },

    // Complaints
    {
      desc: "complaint about bot",
      message: "no funciona",
      mockIntent: "complaint_or_problem",
      expectedReply: /problema.*encargado/i,
    },
    {
      desc: "problem report",
      message: "tengo un problema con el sistema",
      mockIntent: "complaint_or_problem",
      expectedReply: /problema.*encargado/i,
    },

    // Unclear
    {
      desc: "unclear/gibberish",
      message: "asdf qwer",
      mockIntent: "unclear",
      expectedReply: /no entendí/i,
    },
    {
      desc: "unclear fragmented",
      message: "el...",
      mockIntent: "unclear",
      expectedReply: /no entendí/i,
    },

    // Typos and slang (El Salvador Spanish)
    {
      desc: "typo in price",
      message: "aguacte a 1.50 la libr",
      mockIntent: "price_update",
      mockItems: [
        {
          product: "aguacate",
          matched_ingredient_id: "ing-123",
          amount: 1.5,
          unit: "lb",
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },
    {
      desc: "colloquial (pisto = dinero)",
      message: "el tomate está caro, mucho pisto",
      mockIntent: "unclear", // Without price number
      expectedReply: /no entendí/i,
    },
    {
      desc: "informal - vos form",
      message: "mirá, el queso subió a 5 la libra",
      mockIntent: "price_update",
      mockItems: [
        {
          product: "queso",
          matched_ingredient_id: null,
          amount: 5,
          unit: "lb",
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },

    // Recipe
    {
      desc: "recipe with ingredients",
      message: "receta de pupusas: 2 libras de masa, 1 libra de queso",
      mockIntent: "recipe",
      shouldCreateDraft: true,
    },

    // Edge cases
    {
      desc: "number without context",
      message: "150",
      mockIntent: "unclear",
      expectedReply: /no entendí/i,
    },
    {
      desc: "very long message",
      message:
        "hola buenos días quería comentarte que ayer..." + " blah".repeat(100),
      mockIntent: "greeting_or_smalltalk",
      expectedReply: /hola/i,
    },
    {
      desc: "emoji only",
      message: "👍",
      mockIntent: "greeting_or_smalltalk",
      expectedReply: /hola/i,
    },
    {
      desc: "multiple prices",
      message: "tomate 0.80 la libra, cebolla 0.60 la libra, aguacate 1.50",
      mockIntent: "price_update",
      mockItems: [
        {
          product: "tomate",
          matched_ingredient_id: null,
          amount: 0.8,
          unit: "lb",
          currency: "USD",
        },
        {
          product: "cebolla",
          matched_ingredient_id: null,
          amount: 0.6,
          unit: "lb",
          currency: "USD",
        },
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 1.5,
          unit: null,
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },

    // AI timeout scenarios
    {
      desc: "AI timeout - null response",
      message: "esto es un mensaje normal",
      mockIntent: "unclear", // Will be null from mock, triggering fallback
      expectedReply: /no pude procesarlo/i, // Fallback reply
    },

    // Currency variations
    {
      desc: "explicit USD",
      message: "aguacate a 2 dólares la libra",
      mockIntent: "price_update",
      mockItems: [
        {
          product: "aguacate",
          matched_ingredient_id: null,
          amount: 2,
          unit: "lb",
          currency: "USD",
        },
      ],
      shouldCreateDraft: true,
    },
  ];

  const DRAFT = new Set([
    "simple price with unit",
    "price from supplier (El Salvador context)",
    "typo in price",
    "informal - vos form",
    "multiple prices",
    "explicit USD",
    "stock + price mixed",
  ]);
  const STOCK = new Set([
    "se acabó (86)",
    "merma/waste",
    "se está acabando (running out)",
  ]);

  testCases.forEach(
    ({ desc, message, mockIntent, mockItems, expectedReply }) => {
      it(desc, async () => {
        if (desc === "AI timeout - null response") {
          mockAi.mockResolvedValueOnce(null);
        } else {
          mockAi.mockResolvedValueOnce({
            intent: mockIntent,
            items: mockItems || [],
            clarify_question: null,
          });
        }

        const { handleWithAi } =
          await import("@/lib/restaurant/telegram/kitchen-ai-handler");

        const result = await handleWithAi({
          admin,
          staff: STAFF,
          chatId: 12345,
          messageId: 100,
          text: message,
          link: LINK,
        });

        const replies = mockSendMessage.mock.calls.map((c) => String(c[1]));
        const priceCall = mockPriceSafe.mock.calls[0]?.[0];

        if (expectedReply) {
          expect(result).toBe(true);
          expect(replies[0]).toMatch(expectedReply);
          expect(mockPriceSafe).not.toHaveBeenCalled();
        } else if (DRAFT.has(desc)) {
          // price_update (and the price items of a mixed message): a draft
          // through processPriceUpdate, never auto-approved.
          expect(result).toBe(true);
          expect(priceCall).toBeDefined();
          expect(priceCall.items.length).toBeGreaterThan(0);
          expect(
            priceCall.items.every(
              (i: { price: number | null }) => i.price === null || i.price > 0
            )
          ).toBe(true);
          if (desc === "multiple prices") {
            // All three are lines; the one without a unit is kept (unit null),
            // nobody is asked anything.
            expect(priceCall.items).toHaveLength(3);
            expect(priceCall.items[2]).toMatchObject({
              name: "aguacate",
              price: 1.5,
              unit: null,
            });
            expect(mockOpenUnit).not.toHaveBeenCalled();
          }
          if (desc === "stock + price mixed") {
            expect(priceCall.replySuffix).toContain("Cocina › Se agota");
          }
        } else if (STOCK.has(desc)) {
          expect(result).toBe(true);
          expect(mockPriceSafe).not.toHaveBeenCalled();
          expect(replies[0]).toMatch(/Cocina › (Se agota|Merma)/);
          expect(replies[0]).toContain(
            "Pupusería El Salvador › Sucursal Centro"
          );
        } else if (desc === "ambiguous 3-digit (AI resolves with context)") {
          // «aguacate a 150» is never decided alone and never asked: the line
          // is kept without a price for the manager.
          expect(result).toBe(true);
          expect(mockOpenAmount).not.toHaveBeenCalled();
          expect(priceCall.items).toEqual([
            { name: "aguacate", price: null, unit: null },
          ]);
        } else if (desc === "recipe with ingredients") {
          // The recipe flow continues in the webhook.
          expect(result).toBe(false);
        } else if (desc === "voice follow-up after unit question") {
          // Nothing is open any more: a short explanation, not a crash.
          expect(result).toBe(true);
          expect(replies[0]).toContain("No entendí");
        }
      });
    }
  );

  it("clarify_question never opens a question and the AI's own words are never sent: the product is kept without a price", async () => {
    mockAi.mockResolvedValueOnce({
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
      clarify_question: "¿Seguro que son 150 dólares? Dime tú",
    });
    const { handleWithAi } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");
    await handleWithAi({
      admin,
      staff: STAFF,
      chatId: 1,
      messageId: 7,
      text: "aguacate a 150",
      link: LINK,
    });
    expect(mockOpenAmount).not.toHaveBeenCalled();
    const sentText = mockSendMessage.mock.calls.map((c) => String(c[1])).join();
    expect(sentText).not.toContain("Seguro");
    expect(mockPriceSafe).toHaveBeenCalledTimes(1);
    expect(mockPriceSafe.mock.calls[0][0].items).toEqual([
      { name: "aguacate", price: null, unit: null },
    ]);
  });

  it("answer_to_pending resolves the open question with the validated answer", async () => {
    mockFindOpen.mockResolvedValue({
      id: "q1",
      optionStaffIds: ["staff-1"],
      payload: {
        price_unit_question: {
          items: [{ product: "queso", price: 3.25, currency: null }],
        },
      },
      telegramMessageId: -10_000_000_001,
    });
    mockComplete.mockResolvedValue("done");
    mockAi.mockResolvedValueOnce({
      intent: "answer_to_pending",
      items: [],
      clarify_question: null,
    });
    const { handleWithAi } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");
    const handled = await handleWithAi({
      admin,
      staff: STAFF,
      chatId: 1,
      messageId: 8,
      text: "por libra",
      link: LINK,
    });
    expect(handled).toBe(true);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][0].answer).toEqual({
      kind: "unit",
      unit: "lb",
    });
  });

  it("a stock report on a voice note is stored with its type and transcript", async () => {
    mockAi.mockResolvedValueOnce({
      intent: "stock_report",
      items: [],
      clarify_question: null,
    });
    const { handleWithAi } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");
    await handleWithAi({
      admin,
      staff: STAFF,
      chatId: 1,
      messageId: 9,
      text: "ya no hay tomate",
      origin: "voice",
      link: LINK,
    });
    expect(updates).toEqual([
      expect.objectContaining({
        report_type: "86",
        transcript: "ya no hay tomate",
      }),
    ]);
    expect(String(mockSendMessage.mock.calls[0][1])).toContain(
      "Cocina › Se agota"
    );
  });

  it("an AI timeout still answers a greeting and a question (never «No pude procesarlo»)", async () => {
    const { handleWithAi } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");
    for (const text of ["hola", "¿cuánto cuesta la pupusa?"]) {
      mockSendMessage.mockClear();
      mockAi.mockResolvedValueOnce(null);
      await handleWithAi({
        admin,
        staff: STAFF,
        chatId: 1,
        messageId: 10,
        text,
      });
      const reply = String(mockSendMessage.mock.calls[0][1]);
      expect(reply).not.toMatch(/no pude procesarlo/i);
    }
  });

  it("handles hard failure gracefully with fallback reply", async () => {
    mockAi.mockRejectedValueOnce(new Error("Database connection failed"));

    const { handleWithAi } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");

    const result = await handleWithAi({
      admin,
      staff: {
        id: "staff-1",
        company_id: "company-1",
        location_id: "loc-1",
        company_name: "Test Restaurant",
        location_name: "Main",
      },
      chatId: 12345,
      messageId: 100,
      text: "test message",
    });

    expect(result).toBe(true); // Handled (even if poorly)
    expect(mockSendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringMatching(/no pude procesarlo/i),
      undefined
    );
  });

  it("stores failed message as report (no data loss)", async () => {
    const { storeAsReport } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");

    mockRecordReport.mockResolvedValueOnce(true);

    await storeAsReport(
      {} as any,
      {
        id: "staff-1",
        company_id: "company-1",
        location_id: "loc-1",
        company_name: "Test",
        location_name: "Main",
      },
      12345,
      {
        telegram_message_id: 100,
        text: "failed message",
      }
    );

    expect(mockRecordReport).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        locationId: "loc-1",
        chatId: 12345,
      })
    );
  });
});
