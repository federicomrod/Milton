// lib/restaurant/briefing-generate.ts
//
// The ONE briefing generation pipeline — builds the structured context via
// buildBriefingContext(), then either calls OpenAI (if OPENAI_API_KEY is
// configured) or falls back to the deterministic template generator.
//
// Extracted from app/api/restaurant/briefing/route.ts (Telegram Daily
// Briefing v1) so every consumer — the dashboard briefing card AND the
// Telegram send route — shares this exact code path. There is deliberately
// no second briefing engine: Telegram only adds a presentation-layer
// formatter (lib/restaurant/telegram/briefing-formatter.ts) around the
// same BriefingContext / BriefingOutput this file produces.
//
// Safety guarantees (unchanged from the original route):
//   * The OpenAI key is read from server env only and never echoed back.
//   * The model never receives raw database rows — only the rounded
//     summary produced by buildBriefingContext().
//   * The model's response is parsed + schema-validated before use.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBriefingContext,
  type BriefingContext,
  type BriefingSyncStatus,
} from "@/lib/restaurant/briefing-context";
import {
  aiUnavailableFor,
  logAiFallback,
  runChat,
  type AiUnavailable,
} from "@/lib/ai/call";
import type { ProfitabilitySelection } from "@/lib/restaurant/profitability-server";
import {
  BRIEFING_SYSTEM_PROMPT,
  buildBriefingUserPrompt,
  buildDeterministicBriefing,
  isBriefingOutput,
  type BriefingOutput,
} from "@/lib/restaurant/briefing-prompt";

export interface GeneratedBriefing {
  ctx: BriefingContext;
  briefing: BriefingOutput;
  source: "openai" | "deterministic";
  /** "quota" when the AI account is out of quota/billing; the UI says so once. */
  ai_unavailable: AiUnavailable;
}

// ---------------------------------------------------------------------------
// OpenAI caller — isolated so any failure cleanly falls back to deterministic.
// ---------------------------------------------------------------------------

async function callOpenAI(
  ctx: BriefingContext,
  companyId: string
): Promise<{ briefing: BriefingOutput | null; unavailable: AiUnavailable }> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const result = await runChat({
    feature: "briefing-generate",
    companyId,
    params: {
      model,
      messages: [
        { role: "system", content: BRIEFING_SYSTEM_PROMPT },
        { role: "user", content: buildBriefingUserPrompt(ctx) },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    },
  });
  if (!result.ok) {
    if (result.kind !== "not_configured") {
      console.error("[briefing-generate] openai call failed:", result.kind);
    }
    return { briefing: null, unavailable: aiUnavailableFor(result) };
  }

  const fallback = () => {
    logAiFallback({
      feature: "briefing-generate",
      companyId,
      model,
      kind: "bad_output",
    });
    return { briefing: null, unavailable: null };
  };
  const raw = result.value.choices?.[0]?.message?.content ?? "";
  if (!raw) {
    console.error("[briefing-generate] openai returned empty content");
    return fallback();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[briefing-generate] openai response was not valid JSON");
    return fallback();
  }
  if (!isBriefingOutput(parsed)) {
    console.error(
      "[briefing-generate] openai response failed schema validation"
    );
    return fallback();
  }
  // Cap array sizes — defensive, in case the model ignored the prompt limit.
  return {
    briefing: {
      headline: parsed.headline,
      summary: parsed.summary,
      top_risks: parsed.top_risks.slice(0, 3),
      top_opportunities: parsed.top_opportunities.slice(0, 3),
      recommended_actions: parsed.recommended_actions.slice(0, 3),
      confidence_notes: parsed.confidence_notes.slice(0, 3),
    },
    unavailable: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param selected Multi-Restaurant UX v1: when set, scopes the briefing to
 *   a single restaurant (consolidated otherwise). Must already be
 *   validated by the caller against the resolved company — see
 *   lib/restaurant/restaurant-context-server.ts.
 */
export async function generateBriefing(
  supabase: SupabaseClient,
  companyId: string,
  selected?: ProfitabilitySelection | null,
  options?: {
    /**
     * ONLY for the cron (service role, no user session): read rows directly
     * instead of the member-gated RPCs. Never pass it from a user-facing route.
     */
    serverTrusted?: boolean;
    syncStatus?: BriefingSyncStatus;
  }
): Promise<GeneratedBriefing> {
  const ctx = await buildBriefingContext(supabase, companyId, selected, {
    serverTrusted: options?.serverTrusted,
    syncStatus: options?.syncStatus,
  });
  const { briefing: aiBriefing, unavailable } = await callOpenAI(
    ctx,
    companyId
  );
  const briefing = aiBriefing ?? buildDeterministicBriefing(ctx);
  const source: "openai" | "deterministic" = aiBriefing
    ? "openai"
    : "deterministic";
  return { ctx, briefing, source, ai_unavailable: unavailable };
}
