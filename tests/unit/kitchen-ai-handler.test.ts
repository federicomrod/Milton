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

const mockSendMessage = vi.fn();
const mockRecordReport = vi.fn();

vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: mockSendMessage,
}));

vi.mock("@/lib/restaurant/telegram/kitchen-reports", () => ({
  recordKitchenReport: mockRecordReport,
}));

describe("AI kitchen handler - realistic messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expectedReply: /Anotado/i, // Assuming existing unit handler deals with this
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
      expectedReply: /preguntas.*pronto/i,
    },
    {
      desc: "availability question",
      message: "¿a cuánto está el aguacate?",
      mockIntent: "question",
      expectedReply: /preguntas.*pronto/i,
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

  testCases.forEach(
    ({
      desc,
      message,
      mockIntent,
      mockItems,
      expectedReply,
      shouldCreateDraft,
    }) => {
      it(desc, async () => {
        // Setup mock AI response
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
          admin: {} as any,
          staff: {
            id: "staff-1",
            company_id: "company-1",
            location_id: "loc-1",
            company_name: "Pupusería El Salvador",
            location_name: "Sucursal Centro",
          },
          chatId: 12345,
          messageId: 100,
          text: message,
        });

        // Check if handled based on intent
        if (expectedReply) {
          expect(result).toBe(true);
          expect(mockSendMessage).toHaveBeenCalled();
          const sentMessage = mockSendMessage.mock.calls[0][1];
          expect(sentMessage).toMatch(expectedReply);
        }

        if (shouldCreateDraft) {
          // For price_update, stock_report, recipe intents
          // These should return false to let specialized handlers deal with them
          expect(result).toBe(false);
        }
      });
    }
  );

  it("handles hard failure gracefully with fallback reply", async () => {
    mockAi.mockRejectedValueOnce(new Error("Database connection failed"));

    const { handleWithAi } =
      await import("@/lib/restaurant/telegram/kitchen-ai-handler");

    const result = await handleWithAi({
      admin: {} as any,
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
