// lib/restaurant/ask-milton-prompt.ts
//
// Intent detection, system prompt, schema validation, follow-up resolution,
// and deterministic fallback for the Ask Milton chat endpoint.

import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const SOURCE_AREAS = [
  "sales",
  "menu",
  "supplier",
  "invoice",
  "agent",
  "data_quality",
] as const;
export type SourceArea = (typeof SOURCE_AREAS)[number];

export interface AskMiltonSupportingFact {
  label: string;
  value: string;
  source_area: SourceArea;
}

export interface AskMiltonRelatedLink {
  label: string;
  href: string;
}

export interface AskMiltonAnswer {
  answer: string;
  supporting_facts: AskMiltonSupportingFact[];
  related_links: AskMiltonRelatedLink[];
  suggested_followups: string[];
  confidence_notes: string[];
}

const ALLOWED_HREFS = new Set([
  "/dashboard/restaurant",
  "/dashboard/restaurant/menu",
  "/dashboard/restaurant/ingredients",
  "/dashboard/restaurant/suppliers",
  "/dashboard/restaurant/invoices",
  "/dashboard/restaurant/agents",
  "/dashboard/restaurant/costs/upload",
  "/dashboard/restaurant/upload",
]);

function isString(x: unknown): x is string {
  return typeof x === "string";
}

export function isAskMiltonAnswer(v: unknown): v is AskMiltonAnswer {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!isString(o.answer)) return false;
  if (!Array.isArray(o.supporting_facts)) return false;
  if (!Array.isArray(o.related_links)) return false;
  if (!Array.isArray(o.suggested_followups)) return false;
  if (!Array.isArray(o.confidence_notes)) return false;
  if (
    !o.supporting_facts.every((f) => {
      if (!f || typeof f !== "object") return false;
      const r = f as Record<string, unknown>;
      return (
        isString(r.label) &&
        isString(r.value) &&
        isString(r.source_area) &&
        (SOURCE_AREAS as readonly string[]).includes(r.source_area)
      );
    })
  )
    return false;
  if (
    !o.related_links.every((l) => {
      if (!l || typeof l !== "object") return false;
      const r = l as Record<string, unknown>;
      return isString(r.label) && isString(r.href);
    })
  )
    return false;
  if (!o.suggested_followups.every(isString)) return false;
  if (!o.confidence_notes.every(isString)) return false;
  return true;
}

export function sanitizeRelatedLinks(
  links: AskMiltonRelatedLink[]
): AskMiltonRelatedLink[] {
  return links.filter((l) => ALLOWED_HREFS.has(l.href)).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Intent detection — pure keyword matching, no AI
// ---------------------------------------------------------------------------

export type AskMiltonIntent =
  | "most_profitable_dish"
  | "least_profitable_dishes"
  | "expensive_ingredients"
  | "ingredient_usage"
  | "supplier_risk"
  | "invoices_needing_review"
  | "missing_recipes"
  | "cost_coverage"
  | "agent_recommendations"
  | "generic";

export function detectIntent(message: string): AskMiltonIntent {
  const m = message.toLowerCase();
  const has = (...words: string[]) => words.some((w) => m.includes(w));

  // ingredient_usage — must come before "recipe" and "ingredient" generics
  if (
    has(
      "which recipe",
      "what recipe",
      "recipes use",
      "recipe use",
      "recipe for",
      "dishes use",
      "where is",
      "where does",
      "what uses",
      "what dish uses",
      "which dish uses",
      "which menu item",
      "what menu item",
      "affected by",
      "use this ingredient",
      "use these ingredients",
      "use those ingredients"
    )
  ) {
    return "ingredient_usage";
  }
  if (has("most profitable", "highest margin", "best margin", "top margin")) {
    return "most_profitable_dish";
  }
  if (
    has(
      "least profitable",
      "lowest margin",
      "worst margin",
      "low margin",
      "which dishes should i fix",
      "fix first"
    )
  ) {
    return "least_profitable_dishes";
  }
  // Ingredient-cost intent — includes business-oriented phrasings (cost drivers,
  // margin impact, negotiation targets) as well as direct unit-cost questions.
  if (
    has(
      "most expensive ingredient",
      "expensive ingredient",
      "highest cost ingredient",
      "costliest",
      "priciest",
      "which ingredient",
      "ingredient cost",
      "biggest cost driver",
      "cost driver",
      "cost impact",
      "cost pressure",
      "which ingredients impact",
      "ingredients impact",
      "negotiate on ingredient",
      "should i negotiate",
      "which ingredient should",
      "ingredient spending",
      "ingredient expense",
      "what ingredients are",
      "which ingredients are"
    )
  ) {
    return "expensive_ingredients";
  }
  if (
    has(
      "supplier increase",
      "price increase",
      "price went up",
      "supplier risk",
      "supplier cost",
      "which supplier"
    )
  ) {
    return "supplier_risk";
  }
  if (has("invoice", "review", "need review", "pending invoice")) {
    return "invoices_needing_review";
  }
  if (
    has(
      "missing recipe",
      "no recipe",
      "without recipe",
      "recipe missing",
      "items without recipe",
      "items missing recipe"
    )
  ) {
    return "missing_recipes";
  }
  if (
    has(
      "cost coverage",
      "coverage incomplete",
      "costing incomplete",
      "coverage gap",
      "incomplete cost"
    )
  ) {
    return "cost_coverage";
  }
  if (
    has(
      "recommendation",
      "agent",
      "action",
      "what should i do",
      "this week",
      "do next",
      "priority"
    )
  ) {
    return "agent_recommendations";
  }
  if (has("margin", "profit", "food cost", "gross margin")) {
    return "least_profitable_dishes"; // generic margin question → show risks
  }
  // Broad ingredient/cost catch — comes after specific patterns above
  if (has("cost", "expensive", "ingredient", "price")) {
    return "expensive_ingredients";
  }
  if (has("recipe", "blocking")) {
    return "missing_recipes";
  }
  if (has("supplier", "vendor")) {
    return "supplier_risk";
  }
  return "generic";
}

// ---------------------------------------------------------------------------
// Follow-up reference resolution
//
// When the user says "these ingredients" / "those ingredients", we look at
// the previous assistant answer content for ingredient names that appear in
// ctx.expensive_ingredients or ctx.ingredient_usage, and return them so the
// prompt can resolve the reference explicitly.
// ---------------------------------------------------------------------------

export interface AskMiltonChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ResolvedEntities {
  /** Ingredient names resolved from a follow-up like "these ingredients". */
  resolved_ingredients: string[];
  /** Menu item names resolved from a follow-up like "those dishes". */
  resolved_menu_items: string[];
}

export function resolveFollowupReferences(
  message: string,
  conversation: AskMiltonChatTurn[],
  ctx: AskMiltonContext
): ResolvedEntities {
  const result: ResolvedEntities = {
    resolved_ingredients: [],
    resolved_menu_items: [],
  };
  const m = message.toLowerCase();
  const needsIngredients =
    m.includes("these ingredient") ||
    m.includes("those ingredient") ||
    m.includes("this ingredient") ||
    m.includes("those") ||
    m.includes("these") ||
    m.includes("what recipes use");

  const needsMenuItems =
    m.includes("those dishes") ||
    m.includes("these dishes") ||
    m.includes("those items") ||
    m.includes("these items") ||
    m.includes("those menu") ||
    m.includes("these menu");

  if (!needsIngredients && !needsMenuItems) return result;

  // Find the last assistant message
  const lastAssistant = [...conversation]
    .reverse()
    .find((t) => t.role === "assistant");
  if (!lastAssistant) return result;

  const prevText = lastAssistant.content.toLowerCase();

  if (needsIngredients) {
    // Look for ingredient names from expensive_ingredients and ingredient_usage
    const allNames = [
      ...ctx.expensive_ingredients.map((i) => i.name),
      ...ctx.ingredient_usage.map((u) => u.ingredient_name),
      ...ctx.ingredients.highest_unit_cost.map((i) => i.name),
    ];
    const unique = Array.from(new Set(allNames));
    for (const name of unique) {
      if (prevText.includes(name.toLowerCase())) {
        result.resolved_ingredients.push(name);
      }
    }
    result.resolved_ingredients = result.resolved_ingredients.slice(0, 5);
  }

  if (needsMenuItems) {
    const allMenuNames = [
      ...ctx.menu.most_profitable_items.map((i) => i.name),
      ...ctx.menu.least_profitable_items.map((i) => i.name),
      ...ctx.briefing.top_revenue_items.map((i) => i.name),
      ...ctx.briefing.low_margin_items.map((i) => i.name),
    ];
    const unique = Array.from(new Set(allMenuNames));
    for (const name of unique) {
      if (prevText.includes(name.toLowerCase())) {
        result.resolved_menu_items.push(name);
      }
    }
    result.resolved_menu_items = result.resolved_menu_items.slice(0, 5);
  }

  return result;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const ASK_MILTON_SYSTEM_PROMPT = [
  "You are Milton, an AI operating system for restaurant profitability.",
  "You answer like a practical restaurant profitability analyst speaking to",
  "a busy operator.",
  "",
  "Hard rules:",
  "1. Use ONLY data from the provided `context` JSON. Never invent or",
  "   estimate any number, name, supplier, ingredient, recipe, or status.",
  "2. If the user asks for something not in `context`, say: \"I don't have",
  '   that data in Milton yet." and explain what is missing.',
  "3. Every number you cite must be quotable from a field in `context`.",
  "4. If `context.briefing.kpis.cost_coverage_pct` is below 90, mention",
  "   that margin numbers only reflect part of revenue.",
  "5. If `context.briefing.data_quality` shows blockers (unmapped POS,",
  "   missing recipes, unit mismatches, missing ingredient costs), treat",
  "   them as setup priorities relevant to the answer.",
  "6. Do not claim you executed, updated, sent, fixed, ran an agent, or",
  "   created an action. You are read-only.",
  "7. Do not create or propose to create agent actions.",
  "8. Be concise and actionable. Keep `answer` under ~150 words unless the",
  "   user explicitly asks for detail.",
  "9. Refer to specific items, ingredients, and suppliers by their exact",
  "   names from the context.",
  "10. Output VALID JSON only — no markdown, no commentary, no code fences.",
  "11. `context.context_scope.mode` tells you whether this data is scoped",
  '   to ONE selected restaurant ("single_restaurant", named in',
  "   `context.context_scope.restaurant_name`) or consolidated across the",
  '   whole company ("consolidated"). When it is relevant to the question',
  "   (e.g. margins, sales, menu), make that scope clear in your answer —",
  '   e.g. "For {restaurant_name}, ..." vs "Across all your restaurants, ..."',
  '12. `context.briefing.preferred_language` is either "en" or "es". Write',
  "   your ENTIRE response (answer, supporting_facts, related_links",
  "   labels, suggested_followups, confidence_notes) in that language —",
  '   natural, professional Spanish for "es", never a mix. NEVER translate',
  "   restaurant names, dish/menu item names, ingredient names, or",
  "   supplier names — keep those exactly as given in `context`.",
  "",
  "Answering specific question types:",
  "- 'most profitable dish': Answer with the SINGLE top item from",
  "  `context.menu.most_profitable_items[0]` first, giving its name,",
  "  gross_margin_pct and gross_profit_per_item. Then optionally mention",
  "  the next 1-2 items. Do NOT give a generic margin summary.",
  "- 'least profitable': Lead with the worst-margin items from",
  "  `context.menu.least_profitable_items` with their gross_margin_pct.",
  "- 'which recipes use X ingredient': Answer ONLY from",
  "  `context.ingredient_usage`. Find the entry whose ingredient_name",
  "  matches X. Report used_in_direct and used_in_via_component.",
  "  If ingredient_usage is empty or X is not found, say:",
  '  "I don\'t have recipe usage for that ingredient in Milton yet."',
  "- 'most expensive / biggest cost drivers / ingredient cost impact':",
  "  Use this fallback order:",
  "  1. If `context.expensive_ingredients` has items, lead with those.",
  "     Show name, unit_cost, unit, supplier_name. Always add the note:",
  "     'Unit cost alone does not show profitability impact. What matters",
  "     is how much is used in recipes and how much those dishes sell.'",
  "  2. If expensive_ingredients is empty but `context.ingredient_usage`",
  "     has items with unit_cost > 0, use those sorted by cost descending.",
  "  3. If both are empty but `context.briefing.high_food_cost_items` or",
  "     `context.briefing.low_margin_items` have entries, say:",
  "     'I do not have a clean ingredient unit-cost ranking available,",
  "     but based on recipe/menu costing, the biggest cost-impact areas are…'",
  "     then list those dishes and their food cost %.",
  "  4. Only as a last resort, say what specific data is missing.",
  "     Never say 'I don't have that data' if any menu profitability data",
  "     exists.",
  "- Follow-up references ('these ingredients', 'those dishes'): If",
  "  `resolved_entities` is provided in the user prompt, use those names",
  "  as the target. Do not guess if resolved_entities is empty.",
  "- 'where is cost coverage incomplete': Explain the data quality blockers",
  "  from `context.briefing.data_quality` and `context.briefing.costing_blockers`.",
  "",
  "supporting_facts:",
  "  Each fact must quote a specific value present in the context.",
  '  `label` is human readable (e.g. "Gross margin").',
  '  `value` is the value as a short string (e.g. "73%" or "$12.40").',
  "  `source_area` ∈ sales | menu | supplier | invoice | agent | data_quality.",
  "  Return 0–4 facts. Skip when the answer is purely conversational.",
  "",
  "related_links:",
  "  Choose 0–4 links from this fixed allow-list only:",
  "    /dashboard/restaurant              (Cockpit)",
  "    /dashboard/restaurant/menu         (Menu & Recipes)",
  "    /dashboard/restaurant/ingredients  (Ingredients)",
  "    /dashboard/restaurant/suppliers    (Suppliers)",
  "    /dashboard/restaurant/invoices     (Supplier Invoices)",
  "    /dashboard/restaurant/agents       (Agents)",
  "    /dashboard/restaurant/costs/upload (Import Costs)",
  "    /dashboard/restaurant/upload       (POS Sales)",
  "  Never invent a different route.",
  "",
  "suggested_followups:",
  "  0–4 short questions the user might ask next, derived from data",
  "  actually in context.",
  "",
  "confidence_notes:",
  "  0–3 short notes flagging cost-coverage limits, missing data, or any",
  "  blocker that would change the interpretation.",
  "",
  "JSON schema:",
  "{",
  '  "answer": string,',
  '  "supporting_facts": [{ "label": string, "value": string, "source_area": string }],',
  '  "related_links": [{ "label": string, "href": string }],',
  '  "suggested_followups": string[],',
  '  "confidence_notes": string[]',
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

export function buildAskMiltonUserPrompt(
  ctx: AskMiltonContext,
  message: string,
  conversation: AskMiltonChatTurn[],
  intent: AskMiltonIntent,
  resolved: ResolvedEntities
): string {
  const parts: string[] = [
    "Answer the user's question using ONLY the context below.",
    "Respond with the JSON object specified in the system prompt.",
    "",
    `detected_intent = ${JSON.stringify(intent)}`,
  ];

  if (
    resolved.resolved_ingredients.length > 0 ||
    resolved.resolved_menu_items.length > 0
  ) {
    parts.push(`resolved_entities = ${JSON.stringify(resolved)}`);
  }

  parts.push(
    "",
    "recent_conversation = ",
    JSON.stringify(conversation.slice(-6), null, 0),
    "",
    "user_message = ",
    JSON.stringify(message),
    "",
    "context = ",
    JSON.stringify(ctx, null, 0)
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic fallback helpers
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

function fmtCurrencyDec(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n}%`;
}

// ---------------------------------------------------------------------------
// Bilingual related-link labels (Milton Language Foundation v1) — every
// deterministic answer below picks its related_links from this fixed
// allow-list via relatedLink(lang, href) instead of repeating literal
// English labels, so the label always matches the answer's language.
// ---------------------------------------------------------------------------

type RelatedLinkRoute =
  | "/dashboard/restaurant"
  | "/dashboard/restaurant/menu"
  | "/dashboard/restaurant/ingredients"
  | "/dashboard/restaurant/suppliers"
  | "/dashboard/restaurant/invoices"
  | "/dashboard/restaurant/agents"
  | "/dashboard/restaurant/costs/upload"
  | "/dashboard/restaurant/upload";

const RELATED_LINK_LABELS: Record<
  RelatedLinkRoute,
  { en: string; es: string }
> = {
  "/dashboard/restaurant": { en: "Cockpit", es: "Panel principal" },
  "/dashboard/restaurant/menu": {
    en: "Menu & Recipes",
    es: "Menú y Recetas",
  },
  "/dashboard/restaurant/ingredients": {
    en: "Ingredients",
    es: "Ingredientes",
  },
  "/dashboard/restaurant/suppliers": { en: "Suppliers", es: "Proveedores" },
  "/dashboard/restaurant/invoices": {
    en: "Supplier Invoices",
    es: "Facturas de Proveedores",
  },
  "/dashboard/restaurant/agents": { en: "Agents", es: "Agentes" },
  "/dashboard/restaurant/costs/upload": {
    en: "Import Costs",
    es: "Importar Costos",
  },
  "/dashboard/restaurant/upload": { en: "POS Sales", es: "Ventas del POS" },
};

function relatedLink(
  lang: PreferredLanguage,
  href: RelatedLinkRoute
): AskMiltonRelatedLink {
  return { label: RELATED_LINK_LABELS[href][lang], href };
}

// ---- Most profitable dish ----

function mostProfitableAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const items = ctx.menu.most_profitable_items;
  const c = ctx.briefing.currency;

  if (items.length === 0) {
    return {
      answer: t(
        lang,
        "I don't have enough complete costing data to identify your most profitable dish yet. Add recipes and ingredient costs to enable margin calculation.",
        "Aún no tengo suficientes datos de costeo completos para identificar tu platillo más rentable. Agrega recetas y costos de ingredientes para habilitar el cálculo de margen."
      ),
      supporting_facts: [],
      related_links: [
        relatedLink(lang, "/dashboard/restaurant/menu"),
        relatedLink(lang, "/dashboard/restaurant/ingredients"),
      ],
      suggested_followups: [
        t(
          lang,
          "Which menu items have missing recipes?",
          "¿Qué artículos del menú no tienen receta?"
        ),
        t(
          lang,
          "Where is cost coverage incomplete?",
          "¿Dónde está incompleta la cobertura de costo?"
        ),
      ],
      confidence_notes: [],
    };
  }

  const top = items[0];
  const lines: string[] = [];
  lines.push(
    t(
      lang,
      `Your most profitable dish is ${top.name} at ${pct(top.gross_margin_pct)} gross margin` +
        (top.gross_profit_per_item !== null
          ? ` (${fmtCurrencyDec(top.gross_profit_per_item, c)} profit per serving)`
          : "") +
        ".",
      `Tu platillo más rentable es ${top.name} con ${pct(top.gross_margin_pct)} de margen bruto` +
        (top.gross_profit_per_item !== null
          ? ` (${fmtCurrencyDec(top.gross_profit_per_item, c)} de utilidad por porción)`
          : "") +
        "."
    )
  );
  if (top.selling_price !== null && top.estimated_cost !== null) {
    lines.push(
      t(
        lang,
        `Selling price: ${fmtCurrencyDec(top.selling_price, c)}, estimated food cost: ${fmtCurrencyDec(top.estimated_cost, c)}.`,
        `Precio de venta: ${fmtCurrencyDec(top.selling_price, c)}, costo de alimentos estimado: ${fmtCurrencyDec(top.estimated_cost, c)}.`
      )
    );
  }
  if (items.length > 1) {
    const runners = items
      .slice(1, 3)
      .map((i) => `${i.name} (${pct(i.gross_margin_pct)})`)
      .join(", ");
    lines.push(
      t(lang, `Next best: ${runners}.`, `Los siguientes mejores: ${runners}.`)
    );
  }

  const notes: string[] = [];
  if (ctx.briefing.kpis.cost_coverage_pct < 90) {
    notes.push(
      t(
        lang,
        `Cost coverage is ${ctx.briefing.kpis.cost_coverage_pct}% — only items with complete recipes and ingredient costs appear in this list.`,
        `La cobertura de costo es ${ctx.briefing.kpis.cost_coverage_pct}% — solo los artículos con recetas y costos de ingredientes completos aparecen en esta lista.`
      )
    );
  }

  const facts: AskMiltonSupportingFact[] = [
    {
      label: top.name,
      value: pct(top.gross_margin_pct),
      source_area: "menu",
    },
  ];
  if (top.gross_profit_per_item !== null) {
    facts.push({
      label: t(
        lang,
        `${top.name} profit/serving`,
        `${top.name} utilidad/porción`
      ),
      value: fmtCurrencyDec(top.gross_profit_per_item, c),
      source_area: "menu",
    });
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which dishes are least profitable?",
        "¿Qué platillos son menos rentables?"
      ),
      t(
        lang,
        "Which ingredients are most expensive?",
        "¿Qué ingredientes son más costosos?"
      ),
      t(lang, "What should I do this week?", "¿Qué debería hacer esta semana?"),
    ],
    confidence_notes: notes,
  };
}

// ---- Least profitable dishes ----

function leastProfitableAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const items = ctx.menu.least_profitable_items;

  if (items.length === 0) {
    // Fall back to briefing low_margin_items
    return marginFallbackAnswer(ctx, lang);
  }

  const lines: string[] = [];
  const facts: AskMiltonSupportingFact[] = [];

  const worst = items[0];
  lines.push(
    t(
      lang,
      `Least profitable dish: ${worst.name} at ${pct(worst.gross_margin_pct)} gross margin` +
        (worst.food_cost_pct !== null
          ? ` (${pct(worst.food_cost_pct)} food cost)`
          : "") +
        ".",
      `Platillo menos rentable: ${worst.name} con ${pct(worst.gross_margin_pct)} de margen bruto` +
        (worst.food_cost_pct !== null
          ? ` (${pct(worst.food_cost_pct)} de costo de alimentos)`
          : "") +
        "."
    )
  );
  facts.push({
    label: worst.name,
    value: pct(worst.gross_margin_pct),
    source_area: "menu",
  });

  if (items.length > 1) {
    const rest = items
      .slice(1, 4)
      .map((i) => `${i.name} (${pct(i.gross_margin_pct)})`)
      .join(", ");
    lines.push(
      t(lang, `Also low-margin: ${rest}.`, `También con margen bajo: ${rest}.`)
    );
    for (const i of items.slice(1, 3)) {
      facts.push({
        label: i.name,
        value: pct(i.gross_margin_pct),
        source_area: "menu",
      });
    }
  }

  const missingCount = ctx.briefing.data_quality.menu_items_without_recipe;
  const notes: string[] = [];
  if (ctx.briefing.kpis.cost_coverage_pct < 90) {
    notes.push(
      t(
        lang,
        `Cost coverage ${ctx.briefing.kpis.cost_coverage_pct}% — only items with complete recipes are ranked here.`,
        `Cobertura de costo ${ctx.briefing.kpis.cost_coverage_pct}% — solo los artículos con recetas completas están clasificados aquí.`
      )
    );
  }
  if (missingCount > 0) {
    notes.push(
      t(
        lang,
        `${missingCount} item(s) without recipes are excluded.`,
        `${missingCount} artículo(s) sin receta quedaron excluidos.`
      )
    );
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant"),
    ],
    suggested_followups: [
      t(
        lang,
        "What is my most profitable dish?",
        "¿Cuál es mi platillo más rentable?"
      ),
      t(
        lang,
        "Which ingredients are most expensive?",
        "¿Qué ingredientes son más costosos?"
      ),
      t(
        lang,
        "Which menu items have missing recipes?",
        "¿Qué artículos del menú no tienen receta?"
      ),
    ],
    confidence_notes: notes,
  };
}

// ---- Generic margin fallback (when profitability data is empty) ----

function marginFallbackAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const b = ctx.briefing;
  const lines: string[] = [];
  const facts: AskMiltonSupportingFact[] = [];

  if (b.kpis.estimated_gross_margin_pct !== null) {
    lines.push(
      t(
        lang,
        `Estimated gross margin is ${pct(b.kpis.estimated_gross_margin_pct)} with food cost at ${pct(b.kpis.food_cost_pct)}.`,
        `El margen bruto estimado es ${pct(b.kpis.estimated_gross_margin_pct)} con un costo de alimentos de ${pct(b.kpis.food_cost_pct)}.`
      )
    );
    facts.push({
      label: t(lang, "Gross margin (est.)", "Margen bruto (est.)"),
      value: pct(b.kpis.estimated_gross_margin_pct),
      source_area: "menu",
    });
  } else if (b.kpis.estimated_gross_margin_pct_reason) {
    lines.push(b.kpis.estimated_gross_margin_pct_reason);
  }

  if (b.low_margin_items.length > 0) {
    const names = b.low_margin_items
      .slice(0, 3)
      .map((m) => `${m.name} (${pct(m.gross_margin_pct)})`)
      .join(", ");
    lines.push(
      t(
        lang,
        `Lowest-margin items: ${names}.`,
        `Artículos con menor margen: ${names}.`
      )
    );
    for (const m of b.low_margin_items.slice(0, 2)) {
      facts.push({
        label: m.name,
        value: pct(m.gross_margin_pct),
        source_area: "menu",
      });
    }
  }

  const notes: string[] = [];
  if (b.kpis.cost_coverage_pct < 90) {
    notes.push(
      t(
        lang,
        `Cost coverage is ${b.kpis.cost_coverage_pct}% — margin numbers only cover that share of revenue.`,
        `La cobertura de costo es ${b.kpis.cost_coverage_pct}% — los márgenes solo cubren esa parte de los ingresos.`
      )
    );
  }

  return {
    answer:
      lines.join(" ") ||
      t(
        lang,
        "No margin data available yet.",
        "Aún no hay datos de margen disponibles."
      ),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which dishes should I fix first?",
        "¿Qué platillos debería corregir primero?"
      ),
      t(
        lang,
        "Which menu items have missing recipes?",
        "¿Qué artículos del menú no tienen receta?"
      ),
      t(
        lang,
        "Which ingredients are most expensive?",
        "¿Qué ingredientes son más costosos?"
      ),
    ],
    confidence_notes: notes,
  };
}

// ---- Ingredient cost / cost drivers ----
//
// 4-tier fallback so there is always a useful answer:
//   Tier 1 — ingredient_cost_entries unit costs (most precise)
//   Tier 2 — ingredient_usage items that have a unit_cost
//   Tier 3 — high_food_cost_items / low_margin_items (menu cost lens)
//   Tier 4 — clear diagnostic, never generic "no data"
//
// All tiers append a business note about profitability impact.

function ingredientCostBusinessNote(lang: PreferredLanguage): string {
  return t(
    lang,
    "Unit cost alone does not show profitability impact. " +
      "What matters most is how much of the ingredient is used in recipes " +
      "and how much those dishes sell.",
    "El costo unitario por sí solo no muestra el impacto en la rentabilidad. " +
      "Lo que más importa es cuánto se usa el ingrediente en las recetas " +
      "y cuánto se venden esos platillos."
  );
}

function expensiveIngredientsAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const FOLLOWUPS = [
    t(
      lang,
      "Which dishes use these ingredients?",
      "¿Qué platillos usan estos ingredientes?"
    ),
    t(
      lang,
      "Which dishes have the highest food cost?",
      "¿Qué platillos tienen el mayor costo de alimentos?"
    ),
    t(
      lang,
      "Which supplier prices increased recently?",
      "¿Qué precios de proveedores subieron recientemente?"
    ),
    t(
      lang,
      "Which suppliers provide these ingredients?",
      "¿Qué proveedores surten estos ingredientes?"
    ),
  ];
  const LINKS: AskMiltonRelatedLink[] = [
    relatedLink(lang, "/dashboard/restaurant/ingredients"),
    relatedLink(lang, "/dashboard/restaurant/suppliers"),
  ];

  // ── Tier 1: authoritative unit costs from ingredient_cost_entries ──────────
  const items = ctx.expensive_ingredients;
  if (items.length > 0) {
    const lines: string[] = [];
    const facts: AskMiltonSupportingFact[] = [];

    const top = items[0];
    lines.push(
      t(
        lang,
        `Most expensive ingredient by unit cost: ${top.name} at ` +
          `${fmtCurrencyDec(top.unit_cost, top.currency)} per ${top.unit}` +
          (top.supplier_name ? ` (${top.supplier_name})` : "") +
          ".",
        `Ingrediente más costoso por costo unitario: ${top.name} a ` +
          `${fmtCurrencyDec(top.unit_cost, top.currency)} por ${top.unit}` +
          (top.supplier_name ? ` (${top.supplier_name})` : "") +
          "."
      )
    );
    facts.push({
      label: top.name,
      value: `${fmtCurrencyDec(top.unit_cost, top.currency)} / ${top.unit}`,
      source_area: "supplier",
    });

    if (items.length > 1) {
      const rest = items
        .slice(1, 5)
        .map(
          (i) =>
            `${i.name}: ${fmtCurrencyDec(i.unit_cost, i.currency)}/${i.unit}` +
            (i.supplier_name ? ` (${i.supplier_name})` : "")
        )
        .join("; ");
      lines.push(
        t(lang, `Also expensive: ${rest}.`, `También costosos: ${rest}.`)
      );
      for (const i of items.slice(1, 3)) {
        facts.push({
          label: i.name,
          value: `${fmtCurrencyDec(i.unit_cost, i.currency)} / ${i.unit}`,
          source_area: "supplier",
        });
      }
    }

    // Add usage context for the top ingredient when available
    if (top.used_in.length > 0) {
      lines.push(
        t(
          lang,
          `${top.name} is used in: ${top.used_in.slice(0, 4).join(", ")}.`,
          `${top.name} se usa en: ${top.used_in.slice(0, 4).join(", ")}.`
        )
      );
    }

    return {
      answer: lines.join(" "),
      supporting_facts: facts.slice(0, 4),
      related_links: LINKS,
      suggested_followups: FOLLOWUPS,
      confidence_notes: [ingredientCostBusinessNote(lang)],
    };
  }

  // ── Tier 2: ingredient_usage items that carry a unit_cost ─────────────────
  const usageWithCost = ctx.ingredient_usage
    .filter((u) => (u.unit_cost ?? 0) > 0)
    .sort((a, b) => (b.unit_cost ?? 0) - (a.unit_cost ?? 0))
    .slice(0, 5);

  if (usageWithCost.length > 0) {
    const c = ctx.briefing.currency;
    const lines: string[] = [];
    const facts: AskMiltonSupportingFact[] = [];

    const top = usageWithCost[0];
    lines.push(
      t(
        lang,
        `Highest-cost ingredient (from recipe data): ${top.ingredient_name} at ` +
          `${fmtCurrencyDec(top.unit_cost!, top.currency ?? c)} per ${top.unit}.`,
        `Ingrediente de mayor costo (de datos de receta): ${top.ingredient_name} a ` +
          `${fmtCurrencyDec(top.unit_cost!, top.currency ?? c)} por ${top.unit}.`
      )
    );
    facts.push({
      label: top.ingredient_name,
      value: `${fmtCurrencyDec(top.unit_cost!, top.currency ?? c)} / ${top.unit}`,
      source_area: "supplier",
    });

    if (usageWithCost.length > 1) {
      const rest = usageWithCost
        .slice(1)
        .map(
          (u) =>
            `${u.ingredient_name}: ${fmtCurrencyDec(u.unit_cost!, u.currency ?? c)}/${u.unit}`
        )
        .join("; ");
      lines.push(t(lang, `Also: ${rest}.`, `También: ${rest}.`));
      for (const u of usageWithCost.slice(1, 3)) {
        facts.push({
          label: u.ingredient_name,
          value: `${fmtCurrencyDec(u.unit_cost!, u.currency ?? c)} / ${u.unit}`,
          source_area: "supplier",
        });
      }
    }

    return {
      answer: lines.join(" "),
      supporting_facts: facts.slice(0, 4),
      related_links: LINKS,
      suggested_followups: FOLLOWUPS,
      confidence_notes: [ingredientCostBusinessNote(lang)],
    };
  }

  // ── Tier 3: menu cost lens — high food cost / low margin dishes ────────────
  const b = ctx.briefing;
  const highFoodCost = b.high_food_cost_items;
  const lowMargin = b.low_margin_items;

  if (highFoodCost.length > 0 || lowMargin.length > 0) {
    const lines: string[] = [];
    const facts: AskMiltonSupportingFact[] = [];

    lines.push(
      t(
        lang,
        "I do not have a clean ingredient unit-cost ranking available yet, " +
          "but based on recipe and menu costing, the biggest cost-impact areas are:",
        "Aún no tengo un ranking claro de costo unitario de ingredientes, " +
          "pero según el costeo de recetas y menú, las áreas de mayor impacto en costo son:"
      )
    );

    if (highFoodCost.length > 0) {
      const names = highFoodCost
        .slice(0, 3)
        .map((i) => `${i.name} (${pct(i.food_cost_pct)} food cost)`)
        .join(", ");
      lines.push(
        t(
          lang,
          `High food-cost dishes — ${names}.`,
          `Platillos con alto costo de alimentos — ${names}.`
        )
      );
      for (const i of highFoodCost.slice(0, 2)) {
        facts.push({
          label: i.name,
          value:
            pct(i.food_cost_pct) + t(lang, " food cost", " costo de alimentos"),
          source_area: "menu",
        });
      }
    }

    if (lowMargin.length > 0) {
      const names = lowMargin
        .slice(0, 3)
        .map((i) => `${i.name} (${pct(i.gross_margin_pct)} margin)`)
        .join(", ");
      lines.push(
        t(
          lang,
          `Low-margin dishes — ${names}.`,
          `Platillos de bajo margen — ${names}.`
        )
      );
      for (const i of lowMargin.slice(0, 2)) {
        facts.push({
          label: i.name,
          value: pct(i.gross_margin_pct) + t(lang, " margin", " margen"),
          source_area: "menu",
        });
      }
    }

    const notes = [ingredientCostBusinessNote(lang)];
    if (b.kpis.cost_coverage_pct < 90) {
      notes.push(
        t(
          lang,
          `Cost coverage is ${b.kpis.cost_coverage_pct}% — add ingredient prices to see per-item cost drivers.`,
          `La cobertura de costo es ${b.kpis.cost_coverage_pct}% — agrega precios de ingredientes para ver los factores de costo por artículo.`
        )
      );
    }

    return {
      answer: lines.join(" "),
      supporting_facts: facts.slice(0, 4),
      related_links: [
        relatedLink(lang, "/dashboard/restaurant/ingredients"),
        relatedLink(lang, "/dashboard/restaurant/costs/upload"),
        relatedLink(lang, "/dashboard/restaurant/menu"),
      ],
      suggested_followups: [
        t(
          lang,
          "Which dishes have the highest food cost?",
          "¿Qué platillos tienen el mayor costo de alimentos?"
        ),
        t(
          lang,
          "Which dishes are least profitable?",
          "¿Qué platillos son menos rentables?"
        ),
        t(
          lang,
          "Where is cost coverage incomplete?",
          "¿Dónde está incompleta la cobertura de costo?"
        ),
        t(
          lang,
          "Which supplier prices increased recently?",
          "¿Qué precios de proveedores subieron recientemente?"
        ),
      ],
      confidence_notes: notes,
    };
  }

  // ── Tier 4: no cost or menu data at all ───────────────────────────────────
  return {
    answer: t(
      lang,
      "No ingredient cost entries or menu profitability data is available yet. " +
        "Upload invoices or use Import Costs to start tracking ingredient prices, " +
        "and build recipes to see which dishes drive cost.",
      "Aún no hay costos de ingredientes ni datos de rentabilidad del menú disponibles. " +
        "Sube facturas o usa Importar Costos para empezar a registrar precios de ingredientes, " +
        "y crea recetas para ver qué platillos generan más costo."
    ),
    supporting_facts: [],
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/ingredients"),
      relatedLink(lang, "/dashboard/restaurant/costs/upload"),
      relatedLink(lang, "/dashboard/restaurant/invoices"),
    ],
    suggested_followups: [
      t(
        lang,
        "Where is cost coverage incomplete?",
        "¿Dónde está incompleta la cobertura de costo?"
      ),
      t(
        lang,
        "Which menu items have missing recipes?",
        "¿Qué artículos del menú no tienen receta?"
      ),
    ],
    confidence_notes: [
      t(
        lang,
        "No valid cost entries found in ingredient_cost_entries and no menu profitability data is available.",
        "No se encontraron costos válidos en ingredient_cost_entries y no hay datos de rentabilidad del menú disponibles."
      ),
    ],
  };
}

// ---- Ingredient usage (named or inferred) ----

function ingredientUsageAnswer(
  ctx: AskMiltonContext,
  message: string,
  resolved: ResolvedEntities,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const usageList = ctx.ingredient_usage;

  // Determine target ingredient names:
  // 1. Explicitly named in the message (search by name match)
  // 2. Resolved from follow-up ("these ingredients")
  const targetNames: string[] = [];

  // Check resolved entities first
  if (resolved.resolved_ingredients.length > 0) {
    targetNames.push(...resolved.resolved_ingredients);
  }

  // Then scan message for ingredient names from context
  const m = message.toLowerCase();
  for (const u of usageList) {
    if (m.includes(u.ingredient_name.toLowerCase())) {
      if (!targetNames.includes(u.ingredient_name)) {
        targetNames.push(u.ingredient_name);
      }
    }
  }
  // Also check expensive_ingredients names
  for (const e of ctx.expensive_ingredients) {
    if (m.includes(e.name.toLowerCase())) {
      if (!targetNames.includes(e.name)) {
        targetNames.push(e.name);
      }
    }
  }

  if (targetNames.length === 0) {
    // Generic: show all usage entries we have
    if (usageList.length === 0) {
      return {
        answer: t(
          lang,
          "I don't have recipe usage data for ingredients in Milton yet. Build recipes and ingredient cost entries to enable this view.",
          "Aún no tengo datos de uso de ingredientes en recetas en Milton. Crea recetas y costos de ingredientes para habilitar esta vista."
        ),
        supporting_facts: [],
        related_links: [
          relatedLink(lang, "/dashboard/restaurant/menu"),
          relatedLink(lang, "/dashboard/restaurant/ingredients"),
        ],
        suggested_followups: [
          t(
            lang,
            "Which ingredients are most expensive?",
            "¿Qué ingredientes son más costosos?"
          ),
        ],
        confidence_notes: [],
      };
    }
    const sample = usageList
      .slice(0, 5)
      .map((u) => {
        const all = [...u.used_in_direct, ...u.used_in_via_component].slice(
          0,
          4
        );
        return `${u.ingredient_name}: ${
          all.length > 0
            ? all.join(", ")
            : t(lang, "not linked to recipes yet", "sin vincular a recetas aún")
        }`;
      })
      .join(". ");
    return {
      answer: t(
        lang,
        `Top ingredient usage: ${sample}.`,
        `Principal uso de ingredientes: ${sample}.`
      ),
      supporting_facts: [],
      related_links: [
        relatedLink(lang, "/dashboard/restaurant/menu"),
        relatedLink(lang, "/dashboard/restaurant/ingredients"),
      ],
      suggested_followups: [
        t(
          lang,
          "Which ingredients are most expensive?",
          "¿Qué ingredientes son más costosos?"
        ),
      ],
      confidence_notes: [],
    };
  }

  // Answer for specific target ingredients
  const lines: string[] = [];
  const facts: AskMiltonSupportingFact[] = [];
  let found = 0;

  for (const name of targetNames.slice(0, 3)) {
    const entry = usageList.find(
      (u) => u.ingredient_name.toLowerCase() === name.toLowerCase()
    );
    if (!entry) {
      lines.push(
        t(
          lang,
          `I don't have recipe usage for "${name}" in Milton yet.`,
          `Aún no tengo el uso en recetas de "${name}" en Milton.`
        )
      );
      continue;
    }
    found++;
    const directList = entry.used_in_direct.slice(0, 6).join(", ");
    const viaList = entry.used_in_via_component.slice(0, 6).join(", ");
    const compList = entry.components_using.slice(0, 4).join(", ");

    const parts: string[] = [];
    if (entry.used_in_direct.length > 0) {
      parts.push(
        t(lang, `directly in: ${directList}`, `directamente en: ${directList}`)
      );
    }
    if (entry.components_using.length > 0) {
      parts.push(
        t(
          lang,
          `in component${entry.components_using.length > 1 ? "s" : ""} (${compList})`,
          `en componente${entry.components_using.length > 1 ? "s" : ""} (${compList})`
        )
      );
    }
    if (entry.used_in_via_component.length > 0) {
      parts.push(
        t(lang, `and therefore in: ${viaList}`, `y por lo tanto en: ${viaList}`)
      );
    }

    if (parts.length === 0) {
      lines.push(
        t(
          lang,
          `${entry.ingredient_name} is not linked to any recipes yet.`,
          `${entry.ingredient_name} aún no está vinculado a ninguna receta.`
        )
      );
    } else {
      lines.push(
        t(
          lang,
          `${entry.ingredient_name} appears ${parts.join(", ")}.`,
          `${entry.ingredient_name} aparece ${parts.join(", ")}.`
        )
      );
      facts.push({
        label: entry.ingredient_name,
        value: [
          ...entry.used_in_direct.slice(0, 2),
          ...entry.used_in_via_component.slice(0, 2),
        ]
          .join(", ")
          .slice(0, 60),
        source_area: "menu",
      });
    }
  }

  if (found === 0 && targetNames.length > 0) {
    return {
      answer: lines.join(" "),
      supporting_facts: [],
      related_links: [relatedLink(lang, "/dashboard/restaurant/menu")],
      suggested_followups: [
        t(
          lang,
          "Which ingredients are most expensive?",
          "¿Qué ingredientes son más costosos?"
        ),
      ],
      confidence_notes: [],
    };
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant/ingredients"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which of these dishes have the worst margin?",
        "¿Cuáles de estos platillos tienen el peor margen?"
      ),
      t(
        lang,
        "Which ingredients are most expensive?",
        "¿Qué ingredientes son más costosos?"
      ),
      t(lang, "What should I do this week?", "¿Qué debería hacer esta semana?"),
    ],
    confidence_notes: [],
  };
}

// ---- Supplier risk ----

function supplierAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const c = ctx.briefing.currency;
  const facts: AskMiltonSupportingFact[] = [];
  const lines: string[] = [];

  if (ctx.briefing.top_suppliers.length > 0) {
    const top = ctx.briefing.top_suppliers[0];
    lines.push(
      t(
        lang,
        `Top supplier by spend: ${top.supplier_name} at ${fmtCurrency(top.total_spend, c)} (${pct(top.share_pct)} of total).`,
        `Principal proveedor por gasto: ${top.supplier_name} con ${fmtCurrency(top.total_spend, c)} (${pct(top.share_pct)} del total).`
      )
    );
    facts.push({
      label: top.supplier_name,
      value: fmtCurrency(top.total_spend, c),
      source_area: "supplier",
    });
  } else {
    lines.push(
      t(
        lang,
        "No supplier spend has been recorded yet.",
        "Aún no se ha registrado gasto con proveedores."
      )
    );
  }

  if (ctx.briefing.supplier_price_increases.length > 0) {
    const names = ctx.briefing.supplier_price_increases
      .slice(0, 3)
      .map((inc) => `${inc.ingredient_name} +${inc.pct_change}%`)
      .join(", ");
    lines.push(
      t(
        lang,
        `Recent price increases: ${names}.`,
        `Aumentos de precio recientes: ${names}.`
      )
    );
    for (const inc of ctx.briefing.supplier_price_increases.slice(0, 2)) {
      facts.push({
        label: inc.ingredient_name,
        value: `+${inc.pct_change}% to ${fmtCurrency(inc.latest_cost, c)} / ${inc.unit}`,
        source_area: "supplier",
      });
    }
  } else {
    lines.push(
      t(
        lang,
        "No supplier price increases detected in recent invoices.",
        "No se detectaron aumentos de precio de proveedores en facturas recientes."
      )
    );
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/suppliers"),
      relatedLink(lang, "/dashboard/restaurant/invoices"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which ingredients are most expensive?",
        "¿Qué ingredientes son más costosos?"
      ),
      t(
        lang,
        "What changed after the latest invoice?",
        "¿Qué cambió después de la última factura?"
      ),
      t(
        lang,
        "Which invoices still need review?",
        "¿Qué facturas aún necesitan revisión?"
      ),
    ],
    confidence_notes: [],
  };
}

// ---- Invoices ----

function invoiceAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const c = ctx.briefing.currency;
  const lines: string[] = [];
  const facts: AskMiltonSupportingFact[] = [];
  const unknown = t(lang, "Unknown", "Desconocido");

  lines.push(
    t(
      lang,
      `${ctx.invoices.total_recent} recent invoice(s): ${ctx.invoices.posted_count} posted, ${ctx.invoices.needs_review_count} awaiting review.`,
      `${ctx.invoices.total_recent} factura(s) reciente(s): ${ctx.invoices.posted_count} registrada(s), ${ctx.invoices.needs_review_count} esperando revisión.`
    )
  );
  facts.push({
    label: t(lang, "Needs review", "Necesita revisión"),
    value: String(ctx.invoices.needs_review_count),
    source_area: "invoice",
  });
  facts.push({
    label: t(lang, "Posted", "Registrada"),
    value: String(ctx.invoices.posted_count),
    source_area: "invoice",
  });

  if (ctx.invoices.needs_review.length > 0) {
    const sample = ctx.invoices.needs_review
      .slice(0, 3)
      .map(
        (i) =>
          `${i.supplier_name ?? unknown} ${i.invoice_number ?? ""} (${i.invoice_date})`
      )
      .join("; ");
    lines.push(
      t(lang, `Needs review: ${sample}.`, `Necesita revisión: ${sample}.`)
    );
  }
  if (ctx.invoices.latest.length > 0) {
    const i = ctx.invoices.latest[0];
    if (i.total_amount !== null) {
      lines.push(
        t(
          lang,
          `Latest: ${i.supplier_name ?? unknown} for ${fmtCurrency(i.total_amount, i.currency || c)} on ${i.invoice_date} (${i.status}).`,
          `Más reciente: ${i.supplier_name ?? unknown} por ${fmtCurrency(i.total_amount, i.currency || c)} el ${i.invoice_date} (${i.status}).`
        )
      );
    }
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/invoices"),
      relatedLink(lang, "/dashboard/restaurant/suppliers"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which suppliers increased prices?",
        "¿Qué proveedores subieron precios?"
      ),
      t(
        lang,
        "What changed after the latest invoice?",
        "¿Qué cambió después de la última factura?"
      ),
    ],
    confidence_notes: [],
  };
}

// ---- Missing recipes / cost coverage ----

function missingRecipesAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const b = ctx.briefing;
  const lines: string[] = [];
  const facts: AskMiltonSupportingFact[] = [];

  if (b.data_quality.menu_items_without_recipe > 0) {
    lines.push(
      t(
        lang,
        `${b.data_quality.menu_items_without_recipe} menu item(s) have no recipe.`,
        `${b.data_quality.menu_items_without_recipe} artículo(s) del menú no tienen receta.`
      )
    );
    facts.push({
      label: t(lang, "Items without recipe", "Artículos sin receta"),
      value: String(b.data_quality.menu_items_without_recipe),
      source_area: "data_quality",
    });
  }
  if (b.high_revenue_missing_recipe.length > 0) {
    const names = b.high_revenue_missing_recipe
      .slice(0, 4)
      .map((m) => m.name)
      .join(", ");
    lines.push(
      t(
        lang,
        `High-revenue items missing a recipe: ${names}.`,
        `Artículos de alto ingreso sin receta: ${names}.`
      )
    );
  }
  if (b.costing_blockers.length > 0) {
    const blk = b.costing_blockers
      .slice(0, 3)
      .map((b2) => `${b2.name} (${b2.status})`)
      .join(", ");
    lines.push(
      t(lang, `Costing blockers: ${blk}.`, `Bloqueos de costeo: ${blk}.`)
    );
    facts.push({
      label: t(lang, "Costing blockers", "Bloqueos de costeo"),
      value: String(b.costing_blockers.length),
      source_area: "data_quality",
    });
  }
  if (lines.length === 0) {
    lines.push(
      t(
        lang,
        "All menu items appear to have recipes attached.",
        "Todos los artículos del menú parecen tener una receta asignada."
      )
    );
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant/ingredients"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which dishes should I fix first?",
        "¿Qué platillos debería corregir primero?"
      ),
      t(
        lang,
        "Where is cost coverage incomplete?",
        "¿Dónde está incompleta la cobertura de costo?"
      ),
    ],
    confidence_notes: [],
  };
}

function costCoverageAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const b = ctx.briefing;
  const dq = b.data_quality;
  const lines: string[] = [];
  const facts: AskMiltonSupportingFact[] = [];

  lines.push(
    t(
      lang,
      `Cost coverage is ${b.kpis.cost_coverage_pct}%.`,
      `La cobertura de costo es ${b.kpis.cost_coverage_pct}%.`
    )
  );
  facts.push({
    label: t(lang, "Cost coverage", "Cobertura de costo"),
    value: pct(b.kpis.cost_coverage_pct),
    source_area: "data_quality",
  });

  const blockers: string[] = [];
  if (dq.unmapped_pos_items > 0) {
    blockers.push(
      t(
        lang,
        `${dq.unmapped_pos_items} POS item(s) unmapped to menu items`,
        `${dq.unmapped_pos_items} artículo(s) del POS sin vincular a artículos del menú`
      )
    );
    facts.push({
      label: t(lang, "Unmapped POS items", "Artículos del POS sin vincular"),
      value: String(dq.unmapped_pos_items),
      source_area: "data_quality",
    });
  }
  if (dq.menu_items_without_recipe > 0) {
    blockers.push(
      t(
        lang,
        `${dq.menu_items_without_recipe} menu item(s) without a recipe`,
        `${dq.menu_items_without_recipe} artículo(s) del menú sin receta`
      )
    );
  }
  if (dq.recipes_with_unit_mismatch > 0) {
    blockers.push(
      t(
        lang,
        `${dq.recipes_with_unit_mismatch} recipe(s) with unit mismatches`,
        `${dq.recipes_with_unit_mismatch} receta(s) con discrepancias de unidad`
      )
    );
  }
  if (dq.ingredients_without_cost_entries > 0) {
    blockers.push(
      t(
        lang,
        `${dq.ingredients_without_cost_entries} ingredient(s) with no cost entries`,
        `${dq.ingredients_without_cost_entries} ingrediente(s) sin costos registrados`
      )
    );
  }

  if (blockers.length > 0) {
    lines.push(
      t(
        lang,
        `Gaps: ${blockers.join("; ")}.`,
        `Brechas: ${blockers.join("; ")}.`
      )
    );
  } else if (b.kpis.cost_coverage_pct >= 90) {
    lines.push(
      t(
        lang,
        "Coverage is strong. Fix any remaining costing blockers to reach 100%.",
        "La cobertura es sólida. Corrige los bloqueos de costeo restantes para llegar al 100%."
      )
    );
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant/ingredients"),
      relatedLink(lang, "/dashboard/restaurant/upload"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which menu items have missing recipes?",
        "¿Qué artículos del menú no tienen receta?"
      ),
      t(
        lang,
        "Which ingredients are most expensive?",
        "¿Qué ingredientes son más costosos?"
      ),
    ],
    confidence_notes: [],
  };
}

// ---- Agent recommendations ----

function agentAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const b = ctx.briefing;
  const facts: AskMiltonSupportingFact[] = [];
  const lines: string[] = [];

  lines.push(
    t(
      lang,
      `${b.open_recommendations.total} open recommendation(s): ${b.open_recommendations.critical} critical, ${b.open_recommendations.warning} warning, ${b.open_recommendations.info} info.`,
      `${b.open_recommendations.total} recomendación(es) abierta(s): ${b.open_recommendations.critical} crítica(s), ${b.open_recommendations.warning} de advertencia, ${b.open_recommendations.info} informativa(s).`
    )
  );
  facts.push({
    label: t(lang, "Open recommendations", "Recomendaciones abiertas"),
    value: String(b.open_recommendations.total),
    source_area: "agent",
  });
  if (b.open_recommendations.by_agent.length > 0) {
    const sample = b.open_recommendations.by_agent
      .slice(0, 3)
      .map((g) => `${g.agent_key} (${g.severity}, ${g.count})`)
      .join("; ");
    lines.push(t(lang, `By agent: ${sample}.`, `Por agente: ${sample}.`));
  }
  const openActions = ctx.agent_actions.open;
  if (openActions.length > 0) {
    lines.push(
      t(
        lang,
        `${openActions.length} open action(s); most recent: "${openActions[0].title}".`,
        `${openActions.length} acción(es) abierta(s); la más reciente: "${openActions[0].title}".`
      )
    );
    facts.push({
      label: t(lang, "Open actions", "Acciones abiertas"),
      value: String(openActions.length),
      source_area: "agent",
    });
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/agents"),
      relatedLink(lang, "/dashboard/restaurant"),
    ],
    suggested_followups: [
      t(lang, "What should I do this week?", "¿Qué debería hacer esta semana?"),
      t(
        lang,
        "Which dishes should I fix first?",
        "¿Qué platillos debería corregir primero?"
      ),
    ],
    confidence_notes: [],
  };
}

// ---- Generic briefing ----

function genericBriefingAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const k = ctx.briefing.kpis;
  const c = ctx.briefing.currency;
  const facts: AskMiltonSupportingFact[] = [];
  const notes: string[] = [];

  if (k.revenue > 0) {
    facts.push({
      label: t(lang, "Revenue", "Ingresos"),
      value: fmtCurrency(k.revenue, c),
      source_area: "sales",
    });
  }
  facts.push({
    label: t(lang, "Cost coverage", "Cobertura de costo"),
    value: pct(k.cost_coverage_pct),
    source_area: "data_quality",
  });
  if (k.estimated_gross_margin_pct !== null) {
    facts.push({
      label: t(lang, "Gross margin (est.)", "Margen bruto (est.)"),
      value: pct(k.estimated_gross_margin_pct),
      source_area: "menu",
    });
  }
  if (ctx.briefing.open_recommendations.total > 0) {
    facts.push({
      label: t(lang, "Open recommendations", "Recomendaciones abiertas"),
      value: String(ctx.briefing.open_recommendations.total),
      source_area: "agent",
    });
  }
  if (k.cost_coverage_pct < 90) {
    notes.push(
      t(
        lang,
        `Cost coverage is ${k.cost_coverage_pct}% — margin numbers only reflect that share of revenue.`,
        `La cobertura de costo es ${k.cost_coverage_pct}% — los márgenes solo reflejan esa parte de los ingresos.`
      )
    );
  }
  if (ctx.briefing.data_quality.menu_items_without_recipe > 0) {
    notes.push(
      t(
        lang,
        `${ctx.briefing.data_quality.menu_items_without_recipe} menu item(s) still need a recipe.`,
        `${ctx.briefing.data_quality.menu_items_without_recipe} artículo(s) del menú aún necesitan receta.`
      )
    );
  }

  const summary =
    k.revenue > 0
      ? t(
          lang,
          `Across ${ctx.briefing.period_label}, ${ctx.briefing.restaurant_name} recorded ${fmtCurrency(k.revenue, c)} in revenue with ${pct(k.cost_coverage_pct)} cost coverage. Estimated gross margin is ${pct(k.estimated_gross_margin_pct)}.`,
          `En ${ctx.briefing.period_label}, ${ctx.briefing.restaurant_name} registró ${fmtCurrency(k.revenue, c)} en ingresos con ${pct(k.cost_coverage_pct)} de cobertura de costo. El margen bruto estimado es ${pct(k.estimated_gross_margin_pct)}.`
        )
      : t(
          lang,
          `${ctx.briefing.restaurant_name} has no POS revenue loaded yet. Upload sales data to start tracking margin.`,
          `${ctx.briefing.restaurant_name} aún no tiene ingresos de POS cargados. Sube datos de ventas para empezar a rastrear el margen.`
        );

  return {
    answer: summary,
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant"),
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant/agents"),
    ],
    suggested_followups: [
      t(
        lang,
        "What is my most profitable dish?",
        "¿Cuál es mi platillo más rentable?"
      ),
      t(
        lang,
        "Which dishes are least profitable?",
        "¿Qué platillos son menos rentables?"
      ),
      t(
        lang,
        "Which ingredients are most expensive?",
        "¿Qué ingredientes son más costosos?"
      ),
      t(
        lang,
        "Where is cost coverage incomplete?",
        "¿Dónde está incompleta la cobertura de costo?"
      ),
    ],
    confidence_notes: notes.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Main deterministic dispatcher
// ---------------------------------------------------------------------------

export function buildDeterministicAnswer(
  ctx: AskMiltonContext,
  message: string,
  intent: AskMiltonIntent,
  resolved: ResolvedEntities
): AskMiltonAnswer {
  // Milton Language Foundation v1: every branch below is bilingual — the
  // deterministic fallback never silently reverts to English for a
  // Spanish-preference company. See lib/restaurant/language.ts.
  const lang = ctx.briefing.preferred_language;
  switch (intent) {
    case "most_profitable_dish":
      return mostProfitableAnswer(ctx, lang);
    case "least_profitable_dishes":
      return leastProfitableAnswer(ctx, lang);
    case "expensive_ingredients":
      return expensiveIngredientsAnswer(ctx, lang);
    case "ingredient_usage":
      return ingredientUsageAnswer(ctx, message, resolved, lang);
    case "supplier_risk":
      return supplierAnswer(ctx, lang);
    case "invoices_needing_review":
      return invoiceAnswer(ctx, lang);
    case "missing_recipes":
      return missingRecipesAnswer(ctx, lang);
    case "cost_coverage":
      return costCoverageAnswer(ctx, lang);
    case "agent_recommendations":
      return agentAnswer(ctx, lang);
    default:
      return genericBriefingAnswer(ctx, lang);
  }
}
