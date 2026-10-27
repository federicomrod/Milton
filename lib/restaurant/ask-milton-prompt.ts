// lib/restaurant/ask-milton-prompt.ts
//
// Intent detection, system prompt, schema validation, follow-up resolution,
// and deterministic fallback for the Ask Milton chat endpoint.

import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import {
  matchCategoryFromQuestion,
  type AskMiltonSalesSnapshot,
  type SalesDateBucket,
  type SalesSnapshotItem,
  type SalesWeekdayBucket,
} from "@/lib/restaurant/ask-milton-sales";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  dishFoodCostAnswer,
  rankDishesByFoodCost,
} from "@/lib/restaurant/ask-milton-dish-cost";
import {
  listSize,
  parseRequestedCount,
} from "@/lib/restaurant/ask-milton-count";
import { displayName } from "@/lib/restaurant/sentence-case";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import { SALES_HREF } from "@/lib/restaurant/navigation";
import {
  ASK_MILTON_MAX_FOLLOWUPS,
  ASK_MILTON_MAX_RELATED_LINKS,
} from "@/lib/restaurant/ask-milton-limits";

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
  "/dashboard/restaurant/menu/ingredientes",
  "/dashboard/restaurant/costs?tab=proveedores",
  "/dashboard/restaurant/costs?tab=compras",
  "/dashboard/restaurant/menu/platos",
  "/dashboard/restaurant/data?seccion=conexiones",
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

/** Ventas, optionally on its Platos tab and a custom date range. */
const VENTAS_HREF_RE =
  /^\/dashboard\/restaurant\/sales(\?(tab=platos|p=custom|desde=\d{4}-\d{2}-\d{2}|hasta=\d{4}-\d{2}-\d{2})(&(tab=platos|p=custom|desde=\d{4}-\d{2}-\d{2}|hasta=\d{4}-\d{2}-\d{2}))*)?$/;

export function isAllowedRelatedHref(href: string): boolean {
  return ALLOWED_HREFS.has(href) || VENTAS_HREF_RE.test(href);
}

export function sanitizeRelatedLinks(
  links: AskMiltonRelatedLink[]
): AskMiltonRelatedLink[] {
  return links
    .filter((l) => isAllowedRelatedHref(l.href))
    .slice(0, ASK_MILTON_MAX_RELATED_LINKS);
}

import type { AskMiltonIntent } from "@/lib/restaurant/prompts/intent";

export { detectIntent } from "@/lib/restaurant/prompts/intent";
export type { AskMiltonIntent } from "@/lib/restaurant/prompts/intent";
export { ASK_MILTON_SYSTEM_PROMPT } from "@/lib/restaurant/prompts/system";

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

  const requested = parseRequestedCount(message);
  if (requested !== null) {
    parts.push(
      `requested_count = ${requested}`,
      "The user asked for exactly that many items: list exactly that many (fewer only when the context has fewer, and say so)."
    );
  }

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

/** Same money format as Ventas and Menú: «$501», never «USD 501». */
function fmtCurrency(amount: number, currency: string): string {
  return formatMoneyEs(amount, currency, { decimals: 0 });
}

function fmtCurrencyDec(amount: number, currency: string): string {
  return formatMoneyEs(amount, currency, { decimals: 2 });
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
  | "/dashboard/restaurant/menu/ingredientes"
  | "/dashboard/restaurant/costs?tab=proveedores"
  | "/dashboard/restaurant/costs?tab=compras"
  | "/dashboard/restaurant/menu/platos"
  | "/dashboard/restaurant/data?seccion=conexiones";

const RELATED_LINK_LABELS: Record<
  RelatedLinkRoute,
  { en: string; es: string }
> = {
  "/dashboard/restaurant": { en: "Cockpit", es: "Panel principal" },
  "/dashboard/restaurant/menu": {
    en: "Menu",
    es: "Menú",
  },
  "/dashboard/restaurant/menu/ingredientes": {
    en: "Ingredients",
    es: "Ingredientes",
  },
  "/dashboard/restaurant/costs?tab=proveedores": {
    en: "Suppliers",
    es: "Proveedores",
  },
  "/dashboard/restaurant/costs?tab=compras": {
    en: "Supplier Invoices",
    es: "Facturas de Proveedores",
  },
  "/dashboard/restaurant/menu/platos": {
    en: "Dishes",
    es: "Platos",
  },
  "/dashboard/restaurant/data?seccion=conexiones": {
    en: "Connections",
    es: "Conexiones",
  },
};

function relatedLink(
  lang: PreferredLanguage,
  href: RelatedLinkRoute
): AskMiltonRelatedLink {
  return { label: RELATED_LINK_LABELS[href][lang], href };
}

/**
 * Ventas on the same dates the answer used (custom range), optionally on
 * its Platos tab, so the chip opens the numbers the answer quoted.
 */
export function ventasLink(
  lang: PreferredLanguage,
  period: { start: string | null; end: string | null },
  tab?: "platos"
): AskMiltonRelatedLink {
  const q = new URLSearchParams();
  if (tab) q.set("tab", tab);
  if (period.start && period.end) {
    q.set("p", "custom");
    q.set("desde", period.start);
    q.set("hasta", period.end);
  }
  const query = q.toString();
  return {
    label: t(lang, "Sales", "Ventas"),
    href: query ? `${SALES_HREF}?${query}` : SALES_HREF,
  };
}

// ---- Most profitable dish ----

function mostProfitableAnswer(
  ctx: AskMiltonContext,
  message: string,
  lang: PreferredLanguage
): AskMiltonAnswer {
  // Same «aprobado»-only ranking as Menú › Resumen when it exists, so the
  // best list never disagrees with the worst list or with Resumen.
  if (rankDishesByFoodCost(ctx, 1, "best").ranked.length > 0) {
    return dishFoodCostAnswer(ctx, lang, message, "best");
  }
  const items = ctx.menu.most_profitable_items;
  const extra = Math.max(0, listSize(message, 3) - 1);
  const c = ctx.briefing.currency;

  if (items.length === 0) {
    return {
      answer: t(
        lang,
        "I don't have enough complete costing data to identify your most profitable dish yet. Add recipes and ingredient costs to enable margin calculation.",
        "Aún no tengo suficientes datos de costeo completos para identificar tu plato más rentable. Agrega recetas y costos de ingredientes para habilitar el cálculo de margen."
      ),
      supporting_facts: [],
      related_links: [
        relatedLink(lang, "/dashboard/restaurant/menu"),
        relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
      ],
      suggested_followups: [
        t(
          lang,
          "Which dishes have missing recipes?",
          "¿Qué platos no tienen receta?"
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
      `Your most profitable dish is ${displayName(top.name)} at ${pct(top.gross_margin_pct)} gross margin` +
        (top.gross_profit_per_item !== null
          ? ` (${fmtCurrencyDec(top.gross_profit_per_item, c)} profit per serving)`
          : "") +
        ".",
      `Tu plato más rentable es ${displayName(top.name)} con ${pct(top.gross_margin_pct)} de margen bruto` +
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
        `It sells for ${fmtCurrencyDec(top.selling_price, c)} and its ingredients cost ${fmtCurrencyDec(top.estimated_cost, c)}.`,
        `Se vende en ${fmtCurrencyDec(top.selling_price, c)} y sus ingredientes cuestan ${fmtCurrencyDec(top.estimated_cost, c)}.`
      )
    );
  }
  if (items.length > 1 && extra > 0) {
    const runners = items
      .slice(1, 1 + extra)
      .map((i) => `${displayName(i.name)} (${pct(i.gross_margin_pct)})`)
      .join(", ");
    lines.push(t(lang, `Then: ${runners}.`, `Le siguen: ${runners}.`));
  }

  const notes: string[] = [];
  if (ctx.briefing.kpis.cost_coverage_pct < 90) {
    notes.push(
      t(
        lang,
        `Cost coverage is ${ctx.briefing.kpis.cost_coverage_pct}% — only items with complete recipes and ingredient costs appear in this list.`,
        `La cobertura de costo es ${ctx.briefing.kpis.cost_coverage_pct}% — solo los platos con receta y costos de ingredientes completos aparecen en esta lista.`
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
        "¿Qué platos son menos rentables?"
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

// ---- Ingredient cost / cost drivers ----
//
// 4-tier fallback so there is always a useful answer:
//   Tier 1 — ingredient_cost_entries unit costs (most precise)
//   Tier 2 — ingredient_usage items that have a unit_cost
//   Tier 3 — high_food_cost_items / low_margin_items (menu cost lens)
//   Tier 4 — clear diagnostic, never generic "no data"
//
function expensiveIngredientsAnswer(
  ctx: AskMiltonContext,
  message: string,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const requested = parseRequestedCount(message);
  const size = requested ?? 5;
  const FOLLOWUPS = [
    t(
      lang,
      "Which dishes use these ingredients?",
      "¿Qué platos usan estos ingredientes?"
    ),
    t(
      lang,
      "Which dishes have the highest food cost?",
      "¿Qué platos tienen el mayor costo de alimentos?"
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
    relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
    relatedLink(lang, "/dashboard/restaurant/costs?tab=proveedores"),
  ];

  // ── Tier 0 (R1-16c): the latest confirmed prices, ranked ────────────────
  const prices = ctx.ingredient_prices;
  if (prices.top_by_unit_cost.length > 0) {
    const top = prices.top_by_unit_cost.slice(0, size);
    const money = (i: (typeof top)[number]) =>
      `${fmtCurrencyDec(i.price, i.currency)}/${i.unit}`;
    const line = (i: (typeof top)[number], idx: number) =>
      `${idx + 1}. ${displayName(i.name)} — ${money(i)}`;
    const n = top.length;
    const lines = [
      requested !== null && n < requested
        ? t(
            lang,
            `Only ${n} ingredients have a price so far:`,
            `Por ahora solo ${n} ingredientes tienen precio:`
          )
        : n === 1
          ? t(
              lang,
              "Your most expensive ingredient by latest price:",
              "Tu ingrediente más caro por su último precio:"
            )
          : t(
              lang,
              `Your ${n} most expensive ingredients by latest price:`,
              `Tus ${n} ingredientes más caros por su último precio:`
            ),
      ...top.map(line),
    ];
    if (prices.unpriced_count > 0) {
      lines.push(
        "",
        t(
          lang,
          prices.unpriced_count === 1
            ? "Note: 1 ingredient is still «Sin precio», so it isn't in this list."
            : `Note: ${prices.unpriced_count} ingredients are still «Sin precio», so they aren't in this list.`,
          prices.unpriced_count === 1
            ? "Ojo: 1 ingrediente sigue «Sin precio», así que no entra en esta lista."
            : `Ojo: ${prices.unpriced_count} ingredientes siguen «Sin precio», así que no entran en esta lista.`
        )
      );
    }
    return {
      answer: lines.join("\n"),
      supporting_facts: [],
      related_links: LINKS,
      suggested_followups: FOLLOWUPS,
      confidence_notes: [],
    };
  }

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
        .slice(1, size)
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
      confidence_notes: [],
    };
  }

  // ── Tier 2: ingredient_usage items that carry a unit_cost ─────────────────
  const usageWithCost = ctx.ingredient_usage
    .filter((u) => (u.unit_cost ?? 0) > 0)
    .sort((a, b) => (b.unit_cost ?? 0) - (a.unit_cost ?? 0))
    .slice(0, size);

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
      confidence_notes: [],
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
          `Platos con alto costo de alimentos — ${names}.`
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
          `Platos de bajo margen — ${names}.`
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

    const notes: string[] = [];
    if (b.kpis.cost_coverage_pct < 90) {
      notes.push(
        t(
          lang,
          `Cost coverage is ${b.kpis.cost_coverage_pct}% — add ingredient prices to see per-item cost drivers.`,
          `La cobertura de costo es ${b.kpis.cost_coverage_pct}% — agrega precios de ingredientes para ver qué pesa más en el costo de cada plato.`
        )
      );
    }

    return {
      answer: lines.join(" "),
      supporting_facts: facts.slice(0, 4),
      related_links: [
        relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
        relatedLink(lang, "/dashboard/restaurant/menu/platos"),
        relatedLink(lang, "/dashboard/restaurant/menu"),
      ],
      suggested_followups: [
        t(
          lang,
          "Which dishes have the highest food cost?",
          "¿Qué platos tienen el mayor costo de alimentos?"
        ),
        t(
          lang,
          "Which dishes are least profitable?",
          "¿Qué platos son menos rentables?"
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
        "y crea recetas para ver qué platos generan más costo."
    ),
    supporting_facts: [],
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
      relatedLink(lang, "/dashboard/restaurant/menu/platos"),
      relatedLink(lang, "/dashboard/restaurant/costs?tab=compras"),
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
        "¿Qué platos no tienen receta?"
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
          relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
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
        relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
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
      relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which of these dishes have the worst margin?",
        "¿Cuáles de estos platos tienen el peor margen?"
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
      relatedLink(lang, "/dashboard/restaurant/costs?tab=proveedores"),
      relatedLink(lang, "/dashboard/restaurant/costs?tab=compras"),
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
      relatedLink(lang, "/dashboard/restaurant/costs?tab=compras"),
      relatedLink(lang, "/dashboard/restaurant/costs?tab=proveedores"),
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
        b.data_quality.menu_items_without_recipe === 1
          ? "1 plato del menú no tiene receta."
          : `${b.data_quality.menu_items_without_recipe} platos del menú no tienen receta.`
      )
    );
    facts.push({
      label: t(lang, "Dishes without recipe", "Platos sin receta"),
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
        `Platos que venden mucho y no tienen receta: ${names}.`
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
        "Todos los platos del menú tienen receta."
      )
    );
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [
      relatedLink(lang, "/dashboard/restaurant/menu"),
      relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which dishes should I fix first?",
        "¿Qué platos debería corregir primero?"
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
        `${dq.unmapped_pos_items} productos del POS sin vincular a un plato`
      )
    );
    facts.push({
      label: t(lang, "Unmapped POS items", "Productos del POS sin vincular"),
      value: String(dq.unmapped_pos_items),
      source_area: "data_quality",
    });
  }
  if (dq.menu_items_without_recipe > 0) {
    blockers.push(
      t(
        lang,
        `${dq.menu_items_without_recipe} menu item(s) without a recipe`,
        `${dq.menu_items_without_recipe} platos sin receta`
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
      relatedLink(lang, "/dashboard/restaurant/menu/ingredientes"),
      relatedLink(lang, "/dashboard/restaurant/data?seccion=conexiones"),
    ],
    suggested_followups: [
      t(
        lang,
        "Which menu items have missing recipes?",
        "¿Qué platos no tienen receta?"
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
    related_links: [relatedLink(lang, "/dashboard/restaurant")],
    suggested_followups: [
      t(lang, "What should I do this week?", "¿Qué debería hacer esta semana?"),
      t(
        lang,
        "Which dishes should I fix first?",
        "¿Qué platos debería corregir primero?"
      ),
    ],
    confidence_notes: [],
  };
}

// ---- Sales snapshot (top items / best weekday) ----

const WEEKDAY_LABELS: Record<string, { en: string; es: string }> = {
  Sunday: { en: "Sunday", es: "domingo" },
  Monday: { en: "Monday", es: "lunes" },
  Tuesday: { en: "Tuesday", es: "martes" },
  Wednesday: { en: "Wednesday", es: "miércoles" },
  Thursday: { en: "Thursday", es: "jueves" },
  Friday: { en: "Friday", es: "viernes" },
  Saturday: { en: "Saturday", es: "sábado" },
};

function weekdayLabel(key: string, lang: PreferredLanguage): string {
  return WEEKDAY_LABELS[key]?.[lang] ?? key;
}

function weekdayCountPhrase(
  key: string,
  count: number,
  lang: PreferredLanguage
): string {
  const label = weekdayLabel(key, lang);
  if (lang === "es") {
    const plural =
      label === "sábado" ? "sábados" : label === "domingo" ? "domingos" : label;
    return `${count} ${plural}`;
  }
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

const MONTH_LABELS: Record<number, { en: string; es: string }> = {
  1: { en: "January", es: "enero" },
  2: { en: "February", es: "febrero" },
  3: { en: "March", es: "marzo" },
  4: { en: "April", es: "abril" },
  5: { en: "May", es: "mayo" },
  6: { en: "June", es: "junio" },
  7: { en: "July", es: "julio" },
  8: { en: "August", es: "agosto" },
  9: { en: "September", es: "septiembre" },
  10: { en: "October", es: "octubre" },
  11: { en: "November", es: "noviembre" },
  12: { en: "December", es: "diciembre" },
};

function formatDateKey(dateKey: string, lang: PreferredLanguage): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = MONTH_LABELS[month]?.[lang] ?? match[2];
  if (lang === "es") {
    return `${day} de ${monthLabel} de ${year}`;
  }
  return `${day} ${monthLabel} ${year}`;
}

/** «20 de octubre», with the year only when it is not the current one. */
function formatDayMonth(
  dateKey: string,
  lang: PreferredLanguage,
  currentYear: number
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const year = Number(match[1]);
  if (year !== currentYear) return formatDateKey(dateKey, lang);
  const monthLabel = MONTH_LABELS[Number(match[2])]?.[lang] ?? match[2];
  const day = Number(match[3]);
  return lang === "es" ? `${day} de ${monthLabel}` : `${monthLabel} ${day}`;
}

/**
 * «del 20 al 26 de octubre» / «del 28 de septiembre al 4 de octubre» /
 * «del 28 de diciembre de 2025 al 3 de enero de 2026». The year is left
 * out when the whole range is in the current year.
 */
export function formatDateRange(
  start: string,
  end: string,
  lang: PreferredLanguage,
  currentYear: number = new Date().getFullYear()
): string {
  const s = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  if (!s || !e) return t(lang, `${start} – ${end}`, `del ${start} al ${end}`);
  const sameYear = s[1] === e[1];
  const showYear = !(sameYear && Number(e[1]) === currentYear);
  const endText = showYear
    ? formatDateKey(end, lang)
    : formatDayMonth(end, lang, currentYear);
  if (start === end) {
    return t(lang, `on ${endText}`, `el ${endText}`);
  }
  if (sameYear && s[2] === e[2]) {
    const yearEs = showYear ? ` de ${e[1]}` : "";
    const yearEn = showYear ? `, ${e[1]}` : "";
    const monthLabel = MONTH_LABELS[Number(e[2])] ?? { en: e[2], es: e[2] };
    return t(
      lang,
      `${monthLabel.en} ${Number(s[3])}–${Number(e[3])}${yearEn}`,
      `del ${Number(s[3])} al ${Number(e[3])} de ${monthLabel.es}${yearEs}`
    );
  }
  const startText = sameYear
    ? formatDayMonth(start, lang, Number(s[1]))
    : formatDateKey(start, lang);
  return t(lang, `${startText} – ${endText}`, `del ${startText} al ${endText}`);
}

function formatBestDate(
  date: SalesDateBucket,
  lang: PreferredLanguage
): string {
  return `${weekdayLabel(date.weekday, lang)} ${formatDateKey(date.date, lang)}`;
}

function weekdayAvgUnits(d: SalesWeekdayBucket): number {
  return d.day_count > 0 ? d.units / d.day_count : 0;
}

function salesUnavailableAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const reason = ctx.sales.unavailable_reason;
  return {
    answer: t(
      lang,
      reason === "read_error"
        ? "I couldn't read POS sales just now, so I don't have a reliable sales breakdown yet."
        : "I don't have POS sales in Milton for this restaurant and period yet. Upload or sync sales to see top items and busiest days.",
      reason === "read_error"
        ? "No pude leer las ventas del POS ahora, así que aún no tengo un desglose de ventas confiable."
        : "Aún no tengo ventas de POS en Milton para este restaurante y período. Sube o sincroniza ventas para ver lo más vendido y los días más fuertes."
    ),
    supporting_facts: [],
    related_links: [
      relatedLink(lang, "/dashboard/restaurant"),
      relatedLink(lang, "/dashboard/restaurant/data?seccion=conexiones"),
    ],
    suggested_followups: [
      t(
        lang,
        "Where is cost coverage incomplete?",
        "¿Dónde está incompleta la cobertura de costo?"
      ),
    ],
    confidence_notes: reason
      ? [
          t(
            lang,
            `Sales snapshot unavailable (${reason}).`,
            `Instantánea de ventas no disponible (${reason}).`
          ),
        ]
      : [],
  };
}

function pickCategoryWeekdays(
  sales: AskMiltonSalesSnapshot,
  category: string | null
): { category: string | null; weekdays: SalesWeekdayBucket[] } {
  if (category) {
    const match = sales.by_category_weekday.find(
      (c) => c.category === category
    );
    if (match) return { category, weekdays: match.weekdays };
  }
  return { category: null, weekdays: sales.by_weekday };
}

function pickCategoryItems(
  sales: AskMiltonSalesSnapshot,
  category: string | null
): { category: string | null; items: SalesSnapshotItem[] } {
  if (category) {
    const match = sales.top_items_by_category.find(
      (c) => c.category === category
    );
    if (match && match.items.length > 0) {
      return { category, items: match.items };
    }
  }
  return { category: null, items: sales.top_items_by_units };
}

/**
 * The window a sales answer covers, in words: «en los últimos 7 días (del
 * 21 al 27 de octubre de 2026)» or «en octubre de 2026». Always the real
 * dates of `sales.period`, so a month is never called «la última semana».
 */
export function salesPeriodPhrase(
  period: AskMiltonSalesSnapshot["period"],
  lang: PreferredLanguage,
  fallback: string,
  currentYear: number = new Date().getFullYear()
): string {
  const { start, end } = period;
  if (!start || !end) return fallback;
  const range = formatDateRange(start, end, lang, currentYear);
  if (period.source === "last_week" || period.source === "last_days") {
    const days = period.days ?? 7;
    return t(
      lang,
      `in the last ${days} days of sales (${range})`,
      `en los últimos ${days} días con ventas (${range})`
    );
  }
  const m = /^(\d{4})-(\d{2})-01$/.exec(start);
  if (m && start.slice(0, 7) === end.slice(0, 7)) {
    const monthLabel = MONTH_LABELS[Number(m[2])]?.[lang] ?? m[2];
    const year = Number(m[1]) === currentYear ? "" : m[1];
    return t(
      lang,
      year ? `in ${monthLabel} ${year}` : `in ${monthLabel}`,
      year ? `en ${monthLabel} de ${year}` : `en ${monthLabel}`
    );
  }
  return lang === "es" ? range : `from ${range}`;
}

function asksForDishes(message: string): boolean {
  const m = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  // input matcher: keep «platillo»
  return /\b(plato|platos|platillo|platillos|dish|dishes)\b/.test(m);
}

/** True for a list that tags kinds (snapshots built by this version). */
function hasKinds(items: SalesSnapshotItem[]): boolean {
  return items.some((i) => i.kind !== undefined);
}

/**
 * «Plato» questions rank food (Menú's rule: drinks, extras and
 * modifiers are not dishes). A list without kinds is used as is.
 */
export function pickTopSellers(
  sales: AskMiltonSalesSnapshot,
  message: string,
  category: string | null
): { category: string | null; items: SalesSnapshotItem[]; dishesOnly: boolean } {
  const picked = pickCategoryItems(sales, category);
  if (!asksForDishes(message)) return { ...picked, dishesOnly: false };
  if (picked.category) {
    const food = picked.items.filter((i) => i.kind === "food");
    if (hasKinds(picked.items) && food.length > 0) {
      return { ...picked, items: food, dishesOnly: true };
    }
    return { ...picked, dishesOnly: false };
  }
  const dishes = sales.top_dishes_by_units ?? [];
  if (dishes.length > 0) {
    return { category: null, items: dishes, dishesOnly: true };
  }
  return { ...picked, dishesOnly: false };
}

function topSellingItemsAnswer(
  ctx: AskMiltonContext,
  message: string,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const sales = ctx.sales;
  if (!sales.available) return salesUnavailableAnswer(ctx, lang);

  const categories = sales.by_category.map((c) => c.key).filter(Boolean);
  const category = matchCategoryFromQuestion(message, categories);
  const picked = pickTopSellers(sales, message, category);
  const requested = parseRequestedCount(message);
  const items = picked.items.slice(0, requested ?? 4);
  const c = sales.totals.currency || ctx.briefing.currency;
  const period = salesPeriodPhrase(
    sales.period,
    lang,
    ctx.briefing.period_label
  );

  if (items.length === 0) {
    return salesUnavailableAnswer(ctx, lang);
  }

  const dishes = asksForDishes(message);
  const nounOne = dishes ? t(lang, "dish", "plato") : t(lang, "item", "producto");
  const nounMany = dishes
    ? t(lang, "dishes", "platos")
    : t(lang, "items", "productos");
  const scope = picked.category
    ? t(lang, ` in ${picked.category}`, ` en ${picked.category}`)
    : "";
  const units = (n: number) =>
    t(
      lang,
      `${roundUnits(n)} ${roundUnits(n) === 1 ? "unit" : "units"}`,
      `${roundUnits(n)} ${roundUnits(n) === 1 ? "unidad" : "unidades"}`
    );
  const row = (i: SalesSnapshotItem, idx: number) =>
    `${idx + 1}. ${i.name} — ${units(i.units)} · ${fmtCurrency(i.revenue, c)}`;

  const lines: string[] = [];
  if (requested !== null && requested > 1) {
    const n = items.length;
    lines.push(
      n < requested
        ? t(
            lang,
            `I only have ${n} ${nounMany}${scope} with sales ${period}:`,
            `Solo tengo ${n} ${nounMany}${scope} con ventas ${period}:`
          )
        : t(
            lang,
            `Your ${n} best-selling ${nounMany}${scope} ${period}:`,
            `Tus ${n} ${nounMany} más vendidos${scope} ${period}:`
          ),
      ...items.map(row)
    );
  } else {
    const top = items[0];
    lines.push(
      t(
        lang,
        `Your best-selling ${nounOne}${scope} ${period} is ${top.name}: ${units(top.units)} for ${fmtCurrency(top.revenue, c)}.`,
        `Tu ${nounOne} más vendido${scope} ${period} es ${top.name}: ${units(top.units)} por ${fmtCurrency(top.revenue, c)}.`
      )
    );
    const rest = requested === 1 ? [] : items.slice(1);
    if (rest.length > 0) {
      lines.push(
        t(lang, "Then:", "Le siguen:"),
        ...rest.map((i, idx) => row(i, idx + 1))
      );
    }
  }

  // A drink that outsold the top dish is worth a line of its own.
  if (picked.dishesOnly && !picked.category) {
    const drink = sales.top_items_by_units.find((i) => i.kind === "drink");
    if (drink && drink.units > items[0].units) {
      lines.push(
        t(
          lang,
          `The best-selling drink was ${drink.name} (${units(drink.units)}).`,
          `La bebida más vendida fue ${drink.name} (${units(drink.units)}).`
        )
      );
    }
  }

  const facts: AskMiltonSupportingFact[] = items.slice(0, 3).map((i) => ({
    label: i.name,
    value: `${roundUnits(i.units)} / ${fmtCurrency(i.revenue, c)}`,
    source_area: "sales",
  }));

  return {
    answer: lines.join("\n"),
    supporting_facts: facts,
    related_links: salesItemLinks(lang, sales),
    suggested_followups: topSellingFollowups(lang, items[0], dishes),
    confidence_notes: sales.period.truncated
      ? [
          t(
            lang,
            "POS read hit the safety cap — totals may be partial.",
            "La lectura del POS alcanzó el tope de seguridad — los totales pueden ser parciales."
          ),
        ]
      : [],
  };
}

/** Sales answers open Ventas (same dates, Platos tab) and Menú › Platos. */
export function salesItemLinks(
  lang: PreferredLanguage,
  sales: AskMiltonSalesSnapshot
): AskMiltonRelatedLink[] {
  return [
    ventasLink(lang, sales.period, "platos"),
    relatedLink(lang, "/dashboard/restaurant/menu/platos"),
  ];
}

/** Follow-ups Milton can answer from the same snapshot and Menú. */
function topSellingFollowups(
  lang: PreferredLanguage,
  top: SalesSnapshotItem,
  dishes: boolean
): string[] {
  return [
    t(
      lang,
      "Which day of the week do I sell the most?",
      "¿Qué día de la semana vendo más?"
    ),
    dishes || top.kind === "food"
      ? t(
          lang,
          "What is my most profitable dish?",
          "¿Cuál es mi plato más rentable?"
        )
      : t(
          lang,
          "What are my 5 best-selling dishes?",
          "¿Cuáles son mis 5 platos más vendidos?"
        ),
  ];
}

function bestSalesDayAnswer(
  ctx: AskMiltonContext,
  message: string,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const sales = ctx.sales;
  if (!sales.available) return salesUnavailableAnswer(ctx, lang);

  const categories = sales.by_category.map((c) => c.key).filter(Boolean);
  const category = matchCategoryFromQuestion(message, categories);
  const picked = pickCategoryWeekdays(sales, category);
  const ranked = [...picked.weekdays].sort((a, b) => {
    if (picked.category) {
      return (
        weekdayAvgUnits(b) - weekdayAvgUnits(a) ||
        b.avg_revenue_per_day - a.avg_revenue_per_day
      );
    }
    return (
      b.avg_revenue_per_day - a.avg_revenue_per_day ||
      b.avg_orders_per_day - a.avg_orders_per_day
    );
  });
  const top = ranked[0];
  if (!top || (top.units === 0 && top.revenue === 0)) {
    return salesUnavailableAnswer(ctx, lang);
  }

  const c = sales.totals.currency || ctx.briefing.currency;
  const period = salesPeriodPhrase(
    sales.period,
    lang,
    ctx.briefing.period_label
  );
  const scope = picked.category
    ? t(lang, `${picked.category} items`, `${picked.category}`)
    : t(lang, "all sales", "tus ventas");
  const dayPhrase = weekdayCountPhrase(top.key, top.day_count, lang);
  const dayLabel = weekdayLabel(top.key, lang);
  const runners = ranked
    .slice(1, 3)
    .filter((d) => d.units > 0 || d.revenue > 0)
    .map((d) => {
      const avg = picked.category
        ? `${roundUnits(weekdayAvgUnits(d))} ${t(lang, "units/day", "unidades/día")}`
        : `${fmtCurrency(d.avg_revenue_per_day, c)}/${t(lang, "day", "día")}`;
      return `${weekdayLabel(d.key, lang)} (${avg}, ${t(lang, "total", "total")} ${fmtCurrency(d.revenue, c)})`;
    })
    .join(", ");

  const lines = [
    t(
      lang,
      `Strongest weekday for ${scope} ${period}, ranked by average per day: ${dayLabel} — ${fmtCurrency(top.avg_revenue_per_day, c)}/day and ${top.avg_orders_per_day} orders/day across ${dayPhrase} (total ${fmtCurrency(top.revenue, c)}, ${top.orders} orders).`,
      `El día de la semana más fuerte para ${scope} ${period}, según el promedio por día: ${dayLabel} — ${fmtCurrency(top.avg_revenue_per_day, c)}/día y ${top.avg_orders_per_day} pedidos/día en ${dayPhrase} (total ${fmtCurrency(top.revenue, c)}, ${top.orders} pedidos).`
    ),
  ];
  if (runners) {
    lines.push(t(lang, `Next: ${runners}.`, `Siguen: ${runners}.`));
  }

  const dayCounts = picked.weekdays
    .filter((d) => d.day_count > 0)
    .map((d) => d.day_count);
  const unevenCounts = new Set(dayCounts).size > 1;
  if (unevenCounts) {
    const countList = picked.weekdays
      .filter((d) => d.day_count > 0)
      .map((d) => weekdayCountPhrase(d.key, d.day_count, lang))
      .join(", ");
    lines.push(
      t(
        lang,
        `Weekday counts in this period are uneven (${countList}), so a raw total would favor days that appear more often.`,
        `En este período el número de días no es igual para todos (${countList}), así que un total crudo favorecería a los días que aparecen más veces.`
      )
    );
  }

  if (!picked.category && sales.best_date) {
    lines.push(
      t(
        lang,
        `Best single date: ${formatBestDate(sales.best_date, lang)} — ${fmtCurrency(sales.best_date.revenue, c)}, ${sales.best_date.orders} orders.`,
        `El mejor día individual fue el ${formatBestDate(sales.best_date, lang)} — ${fmtCurrency(sales.best_date.revenue, c)}, ${sales.best_date.orders} pedidos.`
      )
    );
  }

  const facts: AskMiltonSupportingFact[] = [
    {
      label: t(lang, `Total across ${dayPhrase}`, `Total de los ${dayPhrase}`),
      value: fmtCurrency(top.revenue, c),
      source_area: "sales",
    },
    {
      label: t(lang, `Average per ${dayLabel}`, `Promedio por ${dayLabel}`),
      value: fmtCurrency(top.avg_revenue_per_day, c),
      source_area: "sales",
    },
  ];
  if (!picked.category && sales.best_date) {
    facts.push({
      label: t(lang, "Best single date", "Mejor día individual"),
      value: `${formatBestDate(sales.best_date, lang)} — ${fmtCurrency(sales.best_date.revenue, c)}`,
      source_area: "sales",
    });
  }

  return {
    answer: lines.join(" "),
    supporting_facts: facts.slice(0, 4),
    related_links: [ventasLink(lang, sales.period)],
    suggested_followups: [
      t(
        lang,
        "Which breakfast items sell the most?",
        "¿Cuáles son los desayunos más vendidos?"
      ),
      t(
        lang,
        "What is my most profitable dish?",
        "¿Cuál es mi plato más rentable?"
      ),
    ],
    confidence_notes: [
      t(
        lang,
        `Weekdays use ${sales.period.timezone}, not UTC.`,
        `Los días de la semana usan ${sales.period.timezone}, no UTC.`
      ),
    ],
  };
}

function roundUnits(n: number): number {
  return Math.round(n);
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
        `${ctx.briefing.data_quality.menu_items_without_recipe} platos aún necesitan receta.`
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
    ],
    suggested_followups: [
      t(
        lang,
        "What is my most profitable dish?",
        "¿Cuál es mi plato más rentable?"
      ),
      t(
        lang,
        "Which dishes are least profitable?",
        "¿Qué platos son menos rentables?"
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
  let answer: AskMiltonAnswer;
  switch (intent) {
    case "most_profitable_dish":
      answer = mostProfitableAnswer(ctx, message, lang);
      break;
    case "least_profitable_dishes":
    case "dish_food_cost":
      answer = dishFoodCostAnswer(ctx, lang, message, "worst");
      break;
    case "expensive_ingredients":
      answer = expensiveIngredientsAnswer(ctx, message, lang);
      break;
    case "ingredient_usage":
      answer = ingredientUsageAnswer(ctx, message, resolved, lang);
      break;
    case "supplier_risk":
      answer = supplierAnswer(ctx, lang);
      break;
    case "invoices_needing_review":
      answer = invoiceAnswer(ctx, lang);
      break;
    case "missing_recipes":
      answer = missingRecipesAnswer(ctx, lang);
      break;
    case "cost_coverage":
      answer = costCoverageAnswer(ctx, lang);
      break;
    case "agent_recommendations":
      answer = agentAnswer(ctx, lang);
      break;
    case "top_selling_items":
      answer = topSellingItemsAnswer(ctx, message, lang);
      break;
    case "best_sales_day":
      answer = bestSalesDayAnswer(ctx, message, lang);
      break;
    default:
      answer = genericBriefingAnswer(ctx, lang);
  }
  return capAnswerChrome(answer);
}

function capAnswerChrome(answer: AskMiltonAnswer): AskMiltonAnswer {
  return {
    ...answer,
    related_links: sanitizeRelatedLinks(answer.related_links),
    suggested_followups: answer.suggested_followups.slice(
      0,
      ASK_MILTON_MAX_FOLLOWUPS
    ),
  };
}
