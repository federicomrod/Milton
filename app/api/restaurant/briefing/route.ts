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
// Generation itself (buildBriefingContext + the OpenAI-or-deterministic
// choice) lives in lib/restaurant/briefing-generate.ts (Telegram Daily
// Briefing v1) so the Telegram send route can reuse the EXACT same
// pipeline — this route only adds transport (HTTP, location resolution,
// the compact context_summary for the dashboard card).
//
// Safety guarantees:
//   * The OpenAI key is read from server env only and never echoed back.
//   * The model never receives raw database rows — only the rounded summary
//     produced by buildBriefingContext().
//   * The model's response is parsed + schema-validated before being returned.
//   * No DB writes; no streaming; no chat memory.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { generateBriefing } from "@/lib/restaurant/briefing-generate";

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
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  // Multi-Restaurant UX v1: an optional `?location=` narrows the briefing
  // to one restaurant. Validated against the caller's OWN company before
  // being trusted — an id for another company (or garbage) simply never
  // matches and silently falls back to the consolidated briefing.
  const requestedLocationId = req.nextUrl.searchParams.get("location");
  let selected: { locationId: string; brandId: string | null } | null = null;
  if (requestedLocationId) {
    const context = await resolveRestaurantContext(
      supabase,
      companyId,
      requestedLocationId
    );
    selected = context.selected;
  }

  let ctx: BriefingContext;
  let briefing: Awaited<ReturnType<typeof generateBriefing>>["briefing"];
  let source: "openai" | "deterministic";
  try {
    ({ ctx, briefing, source } = await generateBriefing(
      supabase,
      companyId,
      selected
    ));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[briefing] context build failed:", msg);
    return NextResponse.json(
      { error: "Could not build briefing context", details: msg },
      { status: 500 }
    );
  }

  return NextResponse.json({
    source,
    generated_at: new Date().toISOString(),
    context_summary: buildContextSummary(ctx),
    briefing,
  });
}
