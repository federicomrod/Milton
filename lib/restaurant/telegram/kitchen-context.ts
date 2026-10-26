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
import { looselySameName } from "@/lib/restaurant/kitchen-ingredient-match";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";

/**
 * Whose conversation this is. A Telegram chat can be linked to several
 * restaurants/companies: nothing outside the link may reach the prompt.
 * `companyId` is mandatory; location/staff narrow it further when known.
 */
export type KitchenContextScope = {
  companyId: string;
  locationId?: string | null;
  staffId?: string | null;
};

const CONTEXT_MESSAGE_LIMIT = 5;
const INGREDIENT_HINT_LIMIT = 10;

/**
 * Fetches last N messages from kitchen_reports for this chat, ONLY those of
 * the link's company (and location / staff when given).
 */
export async function fetchConversationHistory(
  admin: SupabaseClient,
  chatId: number,
  scope: KitchenContextScope
): Promise<ConversationMessage[]> {
  try {
    if (!scope?.companyId) return [];
    let query = admin
      .from("kitchen_reports")
      .select("text, transcript, created_at")
      .eq("telegram_chat_id", chatId)
      .eq("company_id", scope.companyId);
    if (scope.locationId) query = query.eq("location_id", scope.locationId);
    if (scope.staffId) query = query.eq("staff_id", scope.staffId);
    const { data, error } = await query
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

function messageGrams(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-zñáéíóúü]{3,}/g) ?? []).slice(
    0,
    40
  );
  const grams = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      grams.add(words.slice(i, i + n).join(" "));
    }
  }
  return [...grams];
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

    // Score each ingredient against every 1-3 word piece of the message
    // («aguacate a 1.50 la libra» has the piece «aguacate»): the whole
    // message never covers a name, so scoring it as one string finds nothing.
    const grams = messageGrams(messageText);
    const scored = data
      .map((ing) => ({
        id: ing.id,
        name: ing.name,
        score: Math.max(0, ...grams.map((g) => looselySameName(g, ing.name))),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, INGREDIENT_HINT_LIMIT);

    return scored.map((item) => ({ id: item.id, name: item.name }));
  } catch {
    return [];
  }
}

/** The pending item belongs to this link (staff ids carry the company). */
async function pendingBelongsToScope(
  optionStaffIds: string[],
  scope: KitchenContextScope,
  admin?: SupabaseClient
): Promise<boolean> {
  if (optionStaffIds.length === 0) return false;
  if (scope.staffId) return optionStaffIds.includes(scope.staffId);
  if (!admin) return false;
  const { data, error } = await admin
    .from("kitchen_staff")
    .select("id")
    .in("id", optionStaffIds)
    .eq("company_id", scope.companyId);
  return !error && Array.isArray(data) && data.length > 0;
}

/**
 * Checks for the open pending question (unit or amount) of THIS link. A
 * question opened for another company/location/staff of the same chat is
 * ignored. Without `scope.staffId` the `admin` client is needed to check the
 * company; with neither, nothing is returned (fail closed).
 */
export async function fetchPendingQuestion(
  chatId: number,
  scope: KitchenContextScope,
  admin?: SupabaseClient
): Promise<PendingQuestion | null> {
  try {
    const question = await findOpenUnitQuestion(chatId);
    if (!question) return null;
    if (!(await pendingBelongsToScope(question.optionStaffIds, scope, admin))) {
      return null;
    }

    const payload = (question.payload ?? {}) as Record<string, unknown>;
    const amountQ = payload.price_amount_question as
      | { items?: Array<{ product?: unknown }> }
      | undefined;
    if (amountQ) {
      const product = amountQ.items?.[0]?.product;
      if (typeof product !== "string" || !product.trim()) return null;
      return {
        question: `¿${product} está a cuánto?`,
        expected_answer: "amount",
      };
    }

    const items = itemsOfQuestion(question);
    if (!items || items.length === 0) return null;
    return {
      question: `¿El precio de ${items[0].product} es por libra, onza o unidad?`,
      expected_answer: "unit",
    };
  } catch {
    return null;
  }
}

/**
 * Gets company currency using the same source as existing price logic (PR #314).
 */
export async function getCompanyCurrency(
  admin: SupabaseClient,
  companyId: string
): Promise<Currency> {
  try {
    // Use the same currency resolution as all other price features
    const currency = await resolveCompanyCurrency(admin as never, companyId);
    // Validate it's one of our supported currencies
    if (
      ["USD", "MXN", "CRC", "GTQ", "HNL", "PEN", "EUR", "NIO"].includes(
        currency
      )
    ) {
      return currency as Currency;
    }
    // If not supported, fall back to USD
    return "USD";
  } catch {
    // On error, default to USD
    return "USD";
  }
}

/**
 * Builds full context for AI interpretation, scoped to the sender's link:
 * `scope` = { locationId, staffId } of the kitchen_staff row (the company
 * comes from `companyId`). Always pass both when the link is known.
 */
export async function buildKitchenContext(
  admin: SupabaseClient,
  chatId: number,
  companyId: string,
  messageText: string,
  scope: { locationId?: string | null; staffId?: string | null } = {}
): Promise<KitchenIntentContext> {
  const full: KitchenContextScope = { companyId, ...scope };
  const [conversation, ingredient_hints, pending_question, companyCurrency] =
    await Promise.all([
      fetchConversationHistory(admin, chatId, full),
      fetchIngredientHints(admin, companyId, messageText),
      fetchPendingQuestion(chatId, full, admin),
      getCompanyCurrency(admin, companyId),
    ]);

  return {
    conversation,
    company_currency: companyCurrency,
    ingredient_hints,
    pending_question,
  };
}
