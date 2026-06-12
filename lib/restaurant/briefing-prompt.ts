// lib/restaurant/briefing-prompt.ts
//
// Prompt + JSON schema for the Milton Briefing OpenAI call. Kept separate
// from the API route so the same prompt text can be reused/tested and the
// route stays focused on transport.

import type { BriefingContext } from "@/lib/restaurant/briefing-context";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export interface BriefingOutput {
  headline: string;
  summary: string;
  top_risks: string[];
  top_opportunities: string[];
  recommended_actions: string[];
  confidence_notes: string[];
}

export function isBriefingOutput(v: unknown): v is BriefingOutput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.headline === "string" &&
    typeof o.summary === "string" &&
    Array.isArray(o.top_risks) &&
    Array.isArray(o.top_opportunities) &&
    Array.isArray(o.recommended_actions) &&
    Array.isArray(o.confidence_notes) &&
    o.top_risks.every((x) => typeof x === "string") &&
    o.top_opportunities.every((x) => typeof x === "string") &&
    o.recommended_actions.every((x) => typeof x === "string") &&
    o.confidence_notes.every((x) => typeof x === "string")
  );
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const BRIEFING_SYSTEM_PROMPT = [
  "You are Milton, a restaurant profitability analyst speaking to a busy",
  "general manager.",
  "",
  "Strict rules:",
  "1. Only use numbers, names, and statuses that appear in the provided",
  "   `context` JSON. Do not invent, extrapolate, or estimate any value.",
  "2. If a metric is null, do NOT cite a number for it. You may mention the",
  "   accompanying `*_reason` field instead.",
  "3. If `kpis.cost_coverage_pct` is below 90, explicitly note that margin",
  "   numbers cover only part of revenue.",
  "4. If `data_quality` shows blockers (unmapped POS items, missing recipes,",
  "   unit mismatches, ingredients without costs), treat them as setup",
  "   priorities in the briefing.",
  "5. Be concise, practical, and action-oriented. Two to four sentences in",
  "   `summary`. Up to three items in `top_risks`, `top_opportunities`,",
  "   `recommended_actions`. Up to three notes in `confidence_notes`.",
  "6. Refer to specific items, ingredients, or suppliers by their exact",
  "   names from the context.",
  "7. Output VALID JSON only — no markdown, no commentary, no code fences.",
  "",
  "JSON schema:",
  "{",
  '  "headline": string,             // 8-14 words, plain text',
  '  "summary": string,              // 2-4 sentences',
  '  "top_risks": string[],          // up to 3 items',
  '  "top_opportunities": string[],  // up to 3 items',
  '  "recommended_actions": string[],// up to 3 items',
  '  "confidence_notes": string[]    // up to 3 items',
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// Build the user-side payload
// ---------------------------------------------------------------------------

export function buildBriefingUserPrompt(ctx: BriefingContext): string {
  return [
    "Write a briefing for the restaurant manager using ONLY the context below.",
    "Reply with the JSON object specified in the system prompt.",
    "",
    "context = ",
    JSON.stringify(ctx, null, 2),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic fallback
//
// Used when OPENAI_API_KEY is missing or the model call fails. It composes
// the same JSON shape directly from the structured context so the UI never
// has to special-case "no AI" beyond the source badge.
// ---------------------------------------------------------------------------

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

export function buildDeterministicBriefing(
  ctx: BriefingContext
): BriefingOutput {
  const c = ctx.currency;
  const k = ctx.kpis;

  // Headline
  const headline =
    k.revenue > 0
      ? `${ctx.restaurant_name}: ${fmtCurrency(k.revenue, c)} in revenue`
      : `${ctx.restaurant_name}: no POS revenue recorded yet`;

  // Summary
  const summaryParts: string[] = [];
  if (k.revenue > 0) {
    summaryParts.push(
      `Revenue across ${ctx.period_label} is ${fmtCurrency(k.revenue, c)} on ${k.units_sold.toLocaleString("es-MX")} units sold.`
    );
  } else {
    summaryParts.push(
      `No POS revenue is loaded for ${ctx.restaurant_name} yet — import sales to see live KPIs.`
    );
  }
  if (k.cost_coverage_pct < 90) {
    summaryParts.push(
      `Cost coverage is ${k.cost_coverage_pct}% — margin numbers only reflect that share of revenue.`
    );
  }
  if (k.estimated_gross_margin_pct !== null) {
    summaryParts.push(
      `Estimated gross margin is ${k.estimated_gross_margin_pct}% with food cost at ${k.food_cost_pct ?? "—"}%.`
    );
  } else if (k.estimated_gross_margin_pct_reason) {
    summaryParts.push(k.estimated_gross_margin_pct_reason);
  }
  const summary = summaryParts.join(" ");

  // Risks
  const risks: string[] = [];
  for (const item of ctx.low_margin_items.slice(0, 2)) {
    risks.push(
      `${item.name} margin is only ${item.gross_margin_pct ?? "—"}% — review pricing or portion.`
    );
  }
  for (const trend of ctx.supplier_price_increases.slice(0, 1)) {
    risks.push(
      `${trend.ingredient_name} price up ${trend.pct_change}% (now ${fmtCurrency(trend.latest_cost, c)} per ${trend.unit}).`
    );
  }
  if (risks.length < 3 && ctx.open_recommendations.critical > 0) {
    risks.push(
      `${ctx.open_recommendations.critical} critical agent recommendation${ctx.open_recommendations.critical === 1 ? "" : "s"} still open.`
    );
  }

  // Opportunities
  const opps: string[] = [];
  for (const item of ctx.top_revenue_items.slice(0, 2)) {
    if (item.gross_margin_pct !== null && item.gross_margin_pct >= 60) {
      opps.push(
        `${item.name} drives ${fmtCurrency(item.revenue, c)} at ${item.gross_margin_pct}% margin — protect placement and stock.`
      );
    } else if (item.revenue > 0) {
      opps.push(
        `${item.name} brings ${fmtCurrency(item.revenue, c)} in revenue across ${item.units_sold} units.`
      );
    }
  }
  if (opps.length === 0 && ctx.top_revenue_items.length > 0) {
    const t = ctx.top_revenue_items[0];
    opps.push(
      `${t.name} is your top seller with ${fmtCurrency(t.revenue, c)} in revenue.`
    );
  }

  // Recommended actions
  const actions: string[] = [];
  if (ctx.high_revenue_missing_recipe.length > 0) {
    const it = ctx.high_revenue_missing_recipe[0];
    actions.push(
      `Add a recipe for ${it.name} (${fmtCurrency(it.revenue, c)} in revenue, no cost computed).`
    );
  }
  if (ctx.costing_blockers.length > 0) {
    const b = ctx.costing_blockers[0];
    actions.push(`Fix ${b.name} costing: ${b.message}.`);
  }
  if (ctx.data_quality.unmapped_pos_items > 0 && actions.length < 3) {
    actions.push(
      `Map ${ctx.data_quality.unmapped_pos_items} POS item name${ctx.data_quality.unmapped_pos_items === 1 ? "" : "s"} to menu items so revenue links to recipes.`
    );
  }
  if (
    ctx.data_quality.ingredients_without_cost_entries > 0 &&
    actions.length < 3
  ) {
    actions.push(
      `Upload cost entries for ${ctx.data_quality.ingredients_without_cost_entries} ingredient${ctx.data_quality.ingredients_without_cost_entries === 1 ? "" : "s"} that still have no price.`
    );
  }
  if (actions.length === 0 && ctx.open_recommendations.total > 0) {
    actions.push(
      `Review ${ctx.open_recommendations.total} open agent recommendation${ctx.open_recommendations.total === 1 ? "" : "s"} in the Agent Control Center.`
    );
  }

  // Confidence notes
  const notes: string[] = [];
  if (k.cost_coverage_pct < 90) {
    notes.push(
      `Cost coverage is ${k.cost_coverage_pct}% — margin estimates only apply to that share of revenue.`
    );
  }
  if (k.orders === null && k.orders_reason) {
    notes.push(k.orders_reason);
  }
  if (
    ctx.data_quality.menu_items_without_recipe > 0 ||
    ctx.data_quality.recipes_with_unit_mismatch > 0
  ) {
    notes.push(
      `${ctx.data_quality.menu_items_without_recipe} menu items lack a recipe; ${ctx.data_quality.recipes_with_unit_mismatch} recipe(s) have unit mismatches blocking cost.`
    );
  }

  return {
    headline,
    summary,
    top_risks: risks.slice(0, 3),
    top_opportunities: opps.slice(0, 3),
    recommended_actions: actions.slice(0, 3),
    confidence_notes: notes.slice(0, 3),
  };
}
