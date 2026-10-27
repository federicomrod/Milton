// lib/restaurant/briefing-prompt.ts
//
// Prompt + JSON schema for the Milton Briefing OpenAI call. Kept separate
// from the API route so the same prompt text can be reused/tested and the
// route stays focused on transport.

import type { BriefingContext } from "@/lib/restaurant/briefing-context";
import { t } from "@/lib/restaurant/language";
import { formatUnitPricePair } from "@/lib/restaurant/price-trends";
import { noYesterdaySalesText } from "@/lib/restaurant/briefing-periods";

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
  "3. Margin covers only the sales that have a cost (`kpis.cost_coverage_pct`).",
  "   When you cite margin you may say it is based on that share of sales with",
  "   cost, but never put the coverage in the headline.",
  "4. If `data_quality` shows blockers (unmapped POS items, missing recipes,",
  "   unit mismatches, ingredients without costs), treat them as setup",
  "   priorities in the briefing.",
  "5. Be concise, practical, and action-oriented. Two to four sentences in",
  "   `summary`. Up to three items in `top_risks`, `top_opportunities`,",
  "   `recommended_actions`. Up to three notes in `confidence_notes`.",
  "6. Refer to specific items, ingredients, or suppliers by their exact",
  "   names from the context.",
  "7. Output VALID JSON only — no markdown, no commentary, no code fences.",
  '8. `context.preferred_language` is either "en" or "es". Write EVERY',
  "   field (headline, summary, top_risks, top_opportunities,",
  "   recommended_actions, confidence_notes) entirely in that language —",
  '   natural, professional Spanish for "es", never a mix. NEVER translate',
  "   restaurant names, dish/menu item names, ingredient names, or supplier",
  "   names — keep those exactly as given in `context`.",
  "9. Sales periods: `context.sales_periods.facts` holds already-formatted,",
  "   dated lines (yesterday vs the same weekday last week, last 7 days vs",
  "   the previous 7 days). When talking about sales, quote ONLY those lines",
  '   and ALWAYS with their date label (e.g. "Ayer, jue 22 oct"). Never',
  "   compute your own percentages or totals. If a line says there is no data",
  "   to compare, say so — never turn it into 0% or $0. If it says there are",
  "   no synced sales for yesterday, say the sync may not have run.",
  "10. `kpis` (revenue, orders, avg_ticket, margin, food cost, coverage)",
  "   cover `context.period_label` (all loaded POS data), NOT yesterday.",
  "   Never present them as yesterday's or last week's sales. When citing",
  "   margin or food cost, name that period. Never put the cost coverage in the",
  "   headline or summary (it appears in a separate team section).",
  "11. Ingredient price changes: quote `previous_cost` / `latest_cost` with",
  "   all their decimals (they can be fractions of a cent) and never round",
  "   them to 0. Items in `price_review_items` are NOT increases: no",
  '   percentage and no "up" wording; ask whether the price is right',
  '   ("¿Es correcto?").',
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
    ...(ctx.sales_periods && ctx.sales_periods.facts.length > 0
      ? [
          "Dated sales facts (quote exactly, with their date labels):",
          ...ctx.sales_periods.facts.map((f) => `- ${f}`),
          "",
        ]
      : []),
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

/**
 * Milton Language Foundation v1: every sentence template below is
 * bilingual via `t(lang, en, es)` — the deterministic fallback NEVER
 * silently reverts to English for a Spanish-preference company. Only
 * proper nouns (restaurant/dish/ingredient/supplier names, already plain
 * data from `ctx`) are left untranslated, per that rule.
 */
export function buildDeterministicBriefing(
  ctx: BriefingContext
): BriefingOutput {
  const c = ctx.currency;
  const k = ctx.kpis;
  const lang = ctx.preferred_language;

  const sp = ctx.sales_periods;

  // Headline
  const headline = sp
    ? sp.yesterday.current.sales !== null
      ? t(
          lang,
          `${ctx.restaurant_name}: ${fmtCurrency(sp.yesterday.current.sales, c)} in sales (${sp.yesterday.current.label})`,
          `${ctx.restaurant_name}: ${fmtCurrency(sp.yesterday.current.sales, c)} en ventas (${sp.yesterday.current.label})`
        )
      : `${ctx.restaurant_name}: ${noYesterdaySalesText(lang)}`
    : k.revenue > 0
      ? t(
          lang,
          `${ctx.restaurant_name}: ${fmtCurrency(k.revenue, c)} in revenue`,
          `${ctx.restaurant_name}: ${fmtCurrency(k.revenue, c)} en ingresos`
        )
      : t(
          lang,
          `${ctx.restaurant_name}: no POS revenue recorded yet`,
          `${ctx.restaurant_name}: aún no hay ingresos de POS registrados`
        );

  // Summary
  const summaryParts: string[] = [];
  if (sp) {
    // Dated, labelled periods; the same facts the AI is told to quote.
    summaryParts.push(sp.facts.join(". ") + ".");
    summaryParts.push(
      t(
        lang,
        `Margin and food cost cover ${ctx.period_label}.`,
        `El margen y el costo de alimentos cubren ${ctx.period_label}.`
      )
    );
  } else {
    // The dated periods could not be built: never fall back to all-time totals.
    summaryParts.push(
      t(lang, "No data to compare.", "Sin datos para comparar.")
    );
  }
  if (!sp && k.cost_coverage_pct < 90) {
    summaryParts.push(
      t(
        lang,
        `Cost coverage is ${k.cost_coverage_pct}% — margin numbers only reflect that share of revenue.`,
        `La cobertura de costo es ${k.cost_coverage_pct}% — los márgenes solo reflejan esa parte de los ingresos.`
      )
    );
  }
  if (k.estimated_gross_margin_pct !== null) {
    summaryParts.push(
      t(
        lang,
        `Estimated gross margin is ${k.estimated_gross_margin_pct}% with food cost at ${k.food_cost_pct ?? "—"}%.`,
        `El margen bruto estimado es ${k.estimated_gross_margin_pct}% con un costo de alimentos de ${k.food_cost_pct ?? "—"}%.`
      )
    );
  } else if (k.estimated_gross_margin_pct_reason) {
    summaryParts.push(k.estimated_gross_margin_pct_reason);
  }
  const summary = summaryParts.join(" ");

  // Risks
  const risks: string[] = [];
  for (const item of ctx.low_margin_items.slice(0, 2)) {
    risks.push(
      t(
        lang,
        `${item.name} margin is only ${item.gross_margin_pct ?? "—"}% — review pricing or portion.`,
        `El margen de ${item.name} es de solo ${item.gross_margin_pct ?? "—"}% — revisa el precio o la porción.`
      )
    );
  }
  for (const trend of ctx.supplier_price_increases.slice(0, 1)) {
    const p = formatUnitPricePair(trend.previous_cost, trend.latest_cost, c);
    risks.push(
      t(
        lang,
        `${trend.ingredient_name} price up ${trend.pct_change}% (${p.previous} → ${p.latest} per ${trend.unit}).`,
        `El precio de ${trend.ingredient_name} subió ${trend.pct_change}% (${p.previous} → ${p.latest} por ${trend.unit}).`
      )
    );
  }
  for (const item of (ctx.price_review_items ?? []).slice(0, 1)) {
    const p = formatUnitPricePair(item.previous_cost, item.latest_cost, c);
    risks.push(
      t(
        lang,
        `${item.ingredient_name}: the price changed from ${p.previous} to ${p.latest} per ${item.unit}. Is that right?`,
        `${item.ingredient_name}: el precio cambió de ${p.previous} a ${p.latest} por ${item.unit}. ¿Es correcto?`
      )
    );
  }

  // Opportunities
  const opps: string[] = [];
  for (const item of ctx.top_revenue_items.slice(0, 2)) {
    if (item.gross_margin_pct !== null && item.gross_margin_pct >= 60) {
      opps.push(
        t(
          lang,
          `${item.name} drives ${fmtCurrency(item.revenue, c)} at ${item.gross_margin_pct}% margin — protect placement and stock.`,
          `${item.name} genera ${fmtCurrency(item.revenue, c)} con ${item.gross_margin_pct}% de margen — protege su ubicación en el menú y su inventario.`
        )
      );
    } else if (item.revenue > 0) {
      opps.push(
        t(
          lang,
          `${item.name} brings ${fmtCurrency(item.revenue, c)} in revenue across ${item.units_sold} units.`,
          `${item.name} genera ${fmtCurrency(item.revenue, c)} en ingresos con ${item.units_sold} unidades.`
        )
      );
    }
  }
  if (opps.length === 0 && ctx.top_revenue_items.length > 0) {
    const top = ctx.top_revenue_items[0];
    opps.push(
      t(
        lang,
        `${top.name} is your top seller with ${fmtCurrency(top.revenue, c)} in revenue.`,
        `${top.name} es tu producto más vendido con ${fmtCurrency(top.revenue, c)} en ingresos.`
      )
    );
  }

  // Recommended actions
  const actions: string[] = [];
  if (ctx.high_revenue_missing_recipe.length > 0) {
    const it = ctx.high_revenue_missing_recipe[0];
    actions.push(
      t(
        lang,
        `Add a recipe for ${it.name} (${fmtCurrency(it.revenue, c)} in revenue, no cost computed).`,
        `Agrega una receta para ${it.name} (${fmtCurrency(it.revenue, c)} en ingresos, sin costo calculado).`
      )
    );
  }
  if (ctx.costing_blockers.length > 0) {
    const b = ctx.costing_blockers[0];
    actions.push(
      t(
        lang,
        `Fix ${b.name} costing: ${b.message}.`,
        `Corrige el costeo de ${b.name}: ${b.message}.`
      )
    );
  }
  if (ctx.data_quality.unmapped_pos_items > 0 && actions.length < 3) {
    actions.push(
      t(
        lang,
        `Map ${ctx.data_quality.unmapped_pos_items} POS item name${ctx.data_quality.unmapped_pos_items === 1 ? "" : "s"} to menu items so revenue links to recipes.`,
        `Vincula ${ctx.data_quality.unmapped_pos_items} nombre${ctx.data_quality.unmapped_pos_items === 1 ? "" : "s"} de producto del POS a artículos del menú para que los ingresos se conecten con las recetas.`
      )
    );
  }
  if (
    ctx.data_quality.ingredients_without_cost_entries > 0 &&
    actions.length < 3
  ) {
    actions.push(
      t(
        lang,
        `Upload cost entries for ${ctx.data_quality.ingredients_without_cost_entries} ingredient${ctx.data_quality.ingredients_without_cost_entries === 1 ? "" : "s"} that still have no price.`,
        `Sube costos para ${ctx.data_quality.ingredients_without_cost_entries} ingrediente${ctx.data_quality.ingredients_without_cost_entries === 1 ? "" : "s"} que aún no tiene${ctx.data_quality.ingredients_without_cost_entries === 1 ? "" : "n"} precio.`
      )
    );
  }

  // Confidence notes
  const notes: string[] = [];
  if (k.cost_coverage_pct < 90) {
    notes.push(
      t(
        lang,
        `Cost coverage is ${k.cost_coverage_pct}% — margin estimates only apply to that share of revenue.`,
        `La cobertura de costo es ${k.cost_coverage_pct}% — las estimaciones de margen solo aplican a esa parte de los ingresos.`
      )
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
      t(
        lang,
        `${ctx.data_quality.menu_items_without_recipe} menu items lack a recipe; ${ctx.data_quality.recipes_with_unit_mismatch} recipe(s) have unit mismatches blocking cost.`,
        `${ctx.data_quality.menu_items_without_recipe} artículos del menú no tienen receta; ${ctx.data_quality.recipes_with_unit_mismatch} receta(s) tienen discrepancias de unidad que bloquean el costeo.`
      )
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
