/**
 * Conversation context for AI-first kitchen message interpretation.
 * Fetches last ~5 messages, ingredient hints, pending questions from existing tables.
 * NO new migrations needed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConversationMessage,
  IngredientHint,
  PendingQuestion,
  KitchenIntentContext,
  Currency,
} from "./kitchen-intent-ai";
import { findOpenUnitQuestion, itemsOfQuestion } from "./price-unit-question";
import { distinguishingWords, looselySameName } from "@/lib/restaurant/kitchen-ingredient-match";

const CONTEXT_MESSAGE_LIMIT = 5;
const INGREDIENT_HINT_LIMIT = 10;

/**
 * Fetches last N messages from kitchen_reports for this chat.
 * Returns user messages and any bot replies we can reconstruct.
 */
export async function fetchConversationHistory(
  admin: SupabaseClient,
  chatId: number
): Promise<ConversationMessage[]> {
  try {
    const { data, error } = await admin
      .from("kitchen_reports")
      .select("text, transcript, created_at")
      .eq("telegram_chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(CONTEXT_MESSAGE_LIMIT);

    if (error || !data) return [];

    return data
      .reverse()
      .map((row): ConversationMessage => {
        const text = row.transcript || row.text || "";
        return {
          role: "user",
          text: text.slice(0, 500), // Truncate for context
          timestamp: row.created_at,
        };
      })
      .filter((msg) => msg.text.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Finds top N ingredients by fuzzy match to the message text.
 * Uses distinguishingWords and looselySameName from kitchen-ingredient-match.
 */
export async function fetchIngredientHints(
  admin: SupabaseClient,
  companyId: string,
  messageText: string
): Promise<IngredientHint[]> {
  try {
    // Fetch active ingredients for company
    const { data, error } = await admin
      .from("ingredients")
      .select("id, name")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .order("name")
      .limit(200); // Reasonable limit for scoring

    if (error || !data) return [];

    // Score each ingredient against the message
    const scored = data
      .map((ing) => ({
        id: ing.id,
        name: ing.name,
        score: looselySameName(messageText, ing.name),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, INGREDIENT_HINT_LIMIT);

    return scored.map((item) => ({ id: item.id, name: item.name }));
  } catch {
    return [];
  }
}

/**
 * Checks for open pending question (unit or amount question).
 * Uses existing kitchen_pending_items table.
 */
export async function fetchPendingQuestion(
  chatId: number
): Promise<PendingQuestion | null> {
  try {
    const question = await findOpenUnitQuestion(chatId);
    if (!question) return null;

    const items = itemsOfQuestion(question);
    if (!items || items.length === 0) return null;

    const first = items[0];
    // Check if it's a unit question or amount question based on payload
    const payload = question.payload as Record<string, unknown>;
    
    if (payload.price_amount_question) {
      return {
        question: `¿${first.product} está a cuánto?`,
        expected_answer: "amount",
      };
    }

    // Default: unit question
    return {
      question: `¿El precio de ${first.product} es por libra, onza o unidad?`,
      expected_answer: "unit",
    };
  } catch {
    return null;
  }
}

/**
 * Gets company currency. Defaults to USD (first client in El Salvador).
 * TODO: Add company-level currency field when available.
 */
export async function getCompanyCurrency(
  admin: SupabaseClient,
  companyId: string
): Promise<Currency> {
  try {
    // Check if company has any ingredients with currency
    const { data, error } = await admin
      .from("ingredients")
      .select("currency")
      .eq("company_id", companyId)
      .not("currency", "is", null)
      .limit(1)
      .maybeSingle();

    if (!error && data?.currency) {
      const cur = data.currency.toUpperCase();
      if (["USD", "MXN", "CRC", "GTQ", "HNL", "PEN", "EUR", "NIO"].includes(cur)) {
        return cur as Currency;
      }
    }
  } catch {
    // Fall through to default
  }

  // Default to USD (first client in El Salvador)
  return "USD";
}

/**
 * Builds full context for AI interpretation.
 */
export async function buildKitchenContext(
  admin: SupabaseClient,
  chatId: number,
  companyId: string,
  messageText: string
): Promise<KitchenIntentContext> {
  const [conversation, ingredient_hints, pending_question, companyCurrency] = await Promise.all([
    fetchConversationHistory(admin, chatId),
    fetchIngredientHints(admin, companyId, messageText),
    fetchPendingQuestion(chatId),
    getCompanyCurrency(admin, companyId),
  ]);

  return {
    conversation,
    company_currency: companyCurrency,
    ingredient_hints,
    pending_question,
  };
}
