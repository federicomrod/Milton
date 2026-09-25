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
} from "@/lib/restaurant/briefing-context";
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
}

// ---------------------------------------------------------------------------
// OpenAI caller — isolated so any failure cleanly falls back to deterministic.
// ---------------------------------------------------------------------------

async function callOpenAI(
  ctx: BriefingContext
): Promise<BriefingOutput | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch (err) {
    console.error("[briefing-generate] openai sdk import failed:", err);
    return null;
  }
  if (!OpenAIctor) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAIctor({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: BRIEFING_SYSTEM_PROMPT },
        { role: "user", content: buildBriefingUserPrompt(ctx) },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      console.error("[briefing-generate] openai returned empty content");
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(
        "[briefing-generate] openai response was not valid JSON:",
        err
      );
      return null;
    }
    if (!isBriefingOutput(parsed)) {
      console.error(
        "[briefing-generate] openai response failed schema validation"
      );
      return null;
    }
    // Cap array sizes — defensive, in case the model ignored the prompt limit.
    return {
      headline: parsed.headline,
      summary: parsed.summary,
      top_risks: parsed.top_risks.slice(0, 3),
      top_opportunities: parsed.top_opportunities.slice(0, 3),
      recommended_actions: parsed.recommended_actions.slice(0, 3),
      confidence_notes: parsed.confidence_notes.slice(0, 3),
    };
  } catch (err) {
    console.error(
      "[briefing-generate] openai call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
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
  selected?: ProfitabilitySelection | null
): Promise<GeneratedBriefing> {
  const ctx = await buildBriefingContext(supabase, companyId, selected);
  const aiBriefing = await callOpenAI(ctx);
  const briefing = aiBriefing ?? buildDeterministicBriefing(ctx);
  const source: "openai" | "deterministic" = aiBriefing
    ? "openai"
    : "deterministic";
  return { ctx, briefing, source };
}
