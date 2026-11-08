// lib/restaurant/ask-milton-run.ts
//
// The ONE Ask Milton engine, shared by the web route and the phone route
// (/api/mobile/v1/ask): context snapshot -> intent -> one model call (schema
// validated) -> grounding against the deterministic numbers -> suggested
// actions. Read-only; no writes, no stored memory. The model only ever sees the
// rounded context, so a missing input stays missing (the deterministic answer
// says so instead of inventing a figure).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAskMiltonContext,
  type AskMiltonContext,
} from "@/lib/restaurant/ask-milton-context";
import {
  ASK_MILTON_SYSTEM_PROMPT,
  buildAskMiltonUserPrompt,
  detectIntent,
  isAskMiltonAnswer,
  resolveFollowupReferences,
  sanitizeRelatedLinks,
  type AskMiltonAnswer,
  type AskMiltonChatTurn,
  type AskMiltonIntent,
  type ResolvedEntities,
} from "@/lib/restaurant/ask-milton-prompt";
import { resolveAskMiltonAnswer } from "@/lib/restaurant/ask-milton-ground";
import {
  generateSuggestedActions,
  type SuggestedAction,
} from "@/lib/restaurant/ask-milton-actions";
import {
  aiUnavailableFor,
  logAiFallback,
  runChat,
  type AiUnavailable,
} from "@/lib/ai/call";
import { ASK_MILTON_MAX_FOLLOWUPS } from "@/lib/restaurant/ask-milton-limits";

export const ASK_MAX_MESSAGE_CHARS = 2_000;
export const ASK_MAX_CONVERSATION_TURNS = 6;

export function parseConversation(raw: unknown): AskMiltonChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: AskMiltonChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const role = r.role === "user" || r.role === "assistant" ? r.role : null;
    const content = typeof r.content === "string" ? r.content : null;
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, ASK_MAX_MESSAGE_CHARS) });
  }
  return out.slice(-ASK_MAX_CONVERSATION_TURNS);
}

// ---------------------------------------------------------------------------
// OpenAI caller — isolated so any failure cleanly falls back.
// ---------------------------------------------------------------------------

interface OpenAICallOutcome {
  answer: AskMiltonAnswer | null;
  unavailable: AiUnavailable;
}

async function callOpenAI(
  companyId: string,
  ctx: AskMiltonContext,
  message: string,
  conversation: AskMiltonChatTurn[],
  intent: AskMiltonIntent,
  resolved: ResolvedEntities
): Promise<OpenAICallOutcome> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const result = await runChat({
    feature: "ask-milton",
    companyId,
    params: {
      model,
      messages: [
        { role: "system", content: ASK_MILTON_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildAskMiltonUserPrompt(
            ctx,
            message,
            conversation,
            intent,
            resolved
          ),
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    },
  });
  if (!result.ok) {
    if (result.kind !== "not_configured") {
      console.error("[ask-milton] openai call failed:", result.kind);
    }
    return { answer: null, unavailable: aiUnavailableFor(result) };
  }

  const fallback = (): OpenAICallOutcome => {
    logAiFallback({
      feature: "ask-milton",
      companyId,
      model,
      kind: "bad_output",
    });
    return { answer: null, unavailable: null };
  };
  const raw = result.value.choices?.[0]?.message?.content ?? "";
  if (!raw) {
    console.error("[ask-milton] openai returned empty content");
    return fallback();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[ask-milton] openai response was not valid JSON");
    return fallback();
  }
  if (!isAskMiltonAnswer(parsed)) {
    console.error("[ask-milton] openai response failed schema validation");
    return fallback();
  }
  return {
    answer: {
      answer: parsed.answer,
      supporting_facts: parsed.supporting_facts.slice(0, 6),
      related_links: sanitizeRelatedLinks(parsed.related_links),
      suggested_followups: parsed.suggested_followups.slice(
        0,
        ASK_MILTON_MAX_FOLLOWUPS
      ),
      confidence_notes: parsed.confidence_notes.slice(0, 3),
    },
    unavailable: null,
  };
}

export interface AskMiltonPayload extends AskMiltonAnswer {
  source: "openai" | "deterministic";
  generated_at: string;
  suggested_actions: SuggestedAction[];
  ai_unavailable: AiUnavailable;
}

/** Throws if the context cannot be built (the caller answers with its own error). */
export async function runAskMilton(args: {
  supabase: SupabaseClient;
  companyId: string;
  message: string;
  conversation: AskMiltonChatTurn[];
  selected: { locationId: string; brandId: string | null } | null;
}): Promise<AskMiltonPayload> {
  const { supabase, companyId, message, conversation, selected } = args;
  const intent = detectIntent(message);
  const ctx = await buildAskMiltonContext(supabase, companyId, selected, {
    question: message,
  });
  const resolved = resolveFollowupReferences(message, conversation, ctx);
  const { answer: aiAnswer, unavailable } = await callOpenAI(
    companyId,
    ctx,
    message,
    conversation,
    intent,
    resolved
  );
  // Prompt rules alone do not constrain the live model for `best_sales_day`
  // (issue #108): ground / replace against the deterministic computation.
  const { answer, source } = resolveAskMiltonAnswer(
    aiAnswer,
    ctx,
    message,
    intent,
    resolved
  );
  const suggested_actions = generateSuggestedActions(
    message,
    ctx,
    intent,
    ctx.briefing.preferred_language
  );
  return {
    source,
    generated_at: new Date().toISOString(),
    ...answer,
    suggested_actions,
    ai_unavailable: unavailable,
  };
}
