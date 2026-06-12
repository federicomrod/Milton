// app/api/restaurant/briefing/route.ts
//
// GET /api/restaurant/briefing
//
// Builds a structured briefing context for the authenticated user's restaurant
// and returns a JSON briefing object.
//   - If OPENAI_API_KEY is configured, calls OpenAI server-side to phrase the
//     briefing. The model is instructed to only use numbers present in the
//     context — see lib/restaurant/briefing-prompt.ts.
//   - Otherwise (or on any OpenAI failure), returns a deterministic fallback
//     generated entirely from the same context. The UI distinguishes the two
//     via the `source` field.
//
// Safety guarantees:
//   * The OpenAI key is read from server env only and never echoed back.
//   * The model never receives raw database rows — only the rounded summary
//     produced by buildBriefingContext().
//   * The model's response is parsed + schema-validated before being returned.
//   * No DB writes; no streaming; no chat memory.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  buildBriefingContext,
  type BriefingContext,
} from "@/lib/restaurant/briefing-context";
import {
  BRIEFING_SYSTEM_PROMPT,
  buildBriefingUserPrompt,
  buildDeterministicBriefing,
  isBriefingOutput,
  type BriefingOutput,
} from "@/lib/restaurant/briefing-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Compact summary returned alongside the briefing — gives the card a few
// headline numbers to render WITHOUT having to send the entire context back
// to the browser.
// ---------------------------------------------------------------------------

function buildContextSummary(ctx: BriefingContext) {
  return {
    restaurant_name: ctx.restaurant_name,
    period_label: ctx.period_label,
    currency: ctx.currency,
    revenue: ctx.kpis.revenue,
    orders: ctx.kpis.orders,
    cost_coverage_pct: ctx.kpis.cost_coverage_pct,
    estimated_gross_margin_pct: ctx.kpis.estimated_gross_margin_pct,
    food_cost_pct: ctx.kpis.food_cost_pct,
    open_recommendations_total: ctx.open_recommendations.total,
    open_recommendations_critical: ctx.open_recommendations.critical,
  };
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
    console.error("[briefing] openai sdk import failed:", err);
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
      console.error("[briefing] openai returned empty content");
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("[briefing] openai response was not valid JSON:", err);
      return null;
    }
    if (!isBriefingOutput(parsed)) {
      console.error("[briefing] openai response failed schema validation");
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
      "[briefing] openai call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  let ctx: BriefingContext;
  try {
    ctx = await buildBriefingContext(supabase, companyId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[briefing] context build failed:", msg);
    return NextResponse.json(
      { error: "Could not build briefing context", details: msg },
      { status: 500 }
    );
  }

  const aiBriefing = await callOpenAI(ctx);
  const briefing = aiBriefing ?? buildDeterministicBriefing(ctx);
  const source: "openai" | "deterministic" = aiBriefing
    ? "openai"
    : "deterministic";

  return NextResponse.json({
    source,
    generated_at: new Date().toISOString(),
    context_summary: buildContextSummary(ctx),
    briefing,
  });
}
