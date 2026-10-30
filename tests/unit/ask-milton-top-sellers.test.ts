// Ask Milton «plato más vendido»: discounts never ranked, food first for
// «plato» questions, Menú's names, Ventas-style money and dates, and
// chips that open Ventas and Platos. Synthetic data only.

import { describe, expect, it } from "vitest";
import {
  applyCanonicalItemNames,
  buildSalesSnapshot,
  cleanPosItemName,
  salesItemKind,
  type SalesFactRow,
} from "@/lib/restaurant/ask-milton-sales";
import {
  buildDeterministicAnswer,
  formatDateRange,
  sanitizeRelatedLinks,
  type ResolvedEntities,
} from "@/lib/restaurant/ask-milton-prompt";
import {
  resolveAskMiltonAnswer,
  topSellingAnswerIsGrounded,
} from "@/lib/restaurant/ask-milton-ground";
import {
  ES_TZ,
  salesContext,
  salesFact,
} from "./helpers/ask-milton-sales-fixtures";

const none: ResolvedEntities = {
  resolved_ingredients: [],
} as unknown as ResolvedEntities;

const Q = "cual es el plato mas vendido de la ultima semanas?";

function lines(
  name: string,
  units: number,
  revenue: number,
  category: string | null,
  day = "2026-10-24"
): SalesFactRow[] {
  return [
    salesFact({
      sale_date: day,
      item_name: name,
      quantity: units,
      revenue,
      category,
      order_key: `${name}-${day}`,
    }),
  ];
}

function weekRows(): SalesFactRow[] {
  return [
    ...lines("Sodas", 252, 501, null, "2026-10-20"),
    ...lines("Tipico Nicaragüense (Huevo, Queso)", 153, 1224, "Desayunos"),
    ...lines("40% Descuento Banco Demo", 117, -350, null, "2026-10-22"),
    ...lines("Tortilla Normal (U) (Maíz)", 100, 50, "Desayunos"),
    ...lines("PUPUSA DE QUESO", 80, 160, "Desayunos", "2026-10-26"),
    ...lines("Extra queso", 90, 45, "Extras"),
  ];
}

function ctxFor(rows: SalesFactRow[], question = Q) {
  const ctx = salesContext(rows, "es");
  ctx.sales = buildSalesSnapshot(rows, ES_TZ, { question });
  return ctx;
}

describe("salesItemKind (Menú's rule)", () => {
  it("drops discounts, charges and lines with no positive net", () => {
    expect(
      salesItemKind({
        name: "40% Descuento Banco Demo",
        category: null,
        net_revenue: 10,
      })
    ).toBeNull();
    expect(
      salesItemKind({
        name: "Promo 2x1",
        category: "Descuentos",
        net_revenue: 5,
      })
    ).toBeNull();
    expect(
      salesItemKind({ name: "Comida", category: "Empleados", net_revenue: 5 })
    ).toBeNull();
    expect(
      salesItemKind({ name: "Propina", category: null, net_revenue: 5 })
    ).toBeNull();
    expect(
      salesItemKind({ name: "Algo", category: null, net_revenue: -3 })
    ).toBeNull();
  });

  it("tags drinks and extras from the category or a drink name", () => {
    expect(
      salesItemKind({ name: "Sodas", category: null, net_revenue: 5 })
    ).toBe("drink");
    expect(
      salesItemKind({ name: "Horchata", category: "Bebidas", net_revenue: 5 })
    ).toBe("drink");
    expect(
      salesItemKind({ name: "Queso", category: "Extras", net_revenue: 5 })
    ).toBe("extra");
    expect(
      salesItemKind({ name: "Pupusa", category: "Desayunos", net_revenue: 5 })
    ).toBe("food");
  });
});

describe("cleanPosItemName", () => {
  it("keeps the dish before the first bracket, in sentence case", () => {
    expect(cleanPosItemName("Tortilla Normal (U) (Maíz)")).toBe(
      "Tortilla normal"
    );
    expect(cleanPosItemName("Tortilla Normal (U)")).toBe("Tortilla normal");
    expect(cleanPosItemName("PUPUSA DE QUESO")).toBe("Pupusa de queso");
    expect(cleanPosItemName("Tipico Nicaragüense (Huevo, Queso)")).toBe(
      "Tipico nicaragüense"
    );
  });

  it("uses the menu's spelling only when a menu dish matches", () => {
    const snap = buildSalesSnapshot(weekRows(), ES_TZ, { question: Q });
    const named = applyCanonicalItemNames(snap, ["Típico Nicaragüense"]);
    expect(named.top_dishes_by_units[0].name).toBe("Típico nicaragüense");
    expect(named.top_items_by_units.map((i) => i.name)).toContain(
      "Tortilla normal"
    );
  });
});

describe("buildSalesSnapshot item lists", () => {
  it("never lists a discount line, keeps it in the totals", () => {
    const snap = buildSalesSnapshot(weekRows(), ES_TZ, { question: Q });
    const names = snap.top_items_by_units.map((i) => i.name);
    expect(names.some((n) => /descuento/i.test(n))).toBe(false);
    expect(snap.excluded_item_count).toBe(1);
    // 501 + 1224 − 350 + 50 + 160 + 45
    expect(snap.totals.revenue).toBe(1630);
  });

  it("ranks food only in top_dishes_by_units", () => {
    const snap = buildSalesSnapshot(weekRows(), ES_TZ, { question: Q });
    expect(snap.top_items_by_units[0].name).toBe("Sodas");
    expect(snap.top_dishes_by_units.map((i) => i.name)).toEqual([
      "Tipico nicaragüense",
      "Tortilla normal",
      "Pupusa de queso",
    ]);
  });
});

describe("top-selling answer", () => {
  it("answers a «plato» question with dishes, a numbered list and the drink apart", () => {
    const out = buildDeterministicAnswer(
      ctxFor(weekRows()),
      Q,
      "top_selling_items",
      none
    );
    const year = new Date().getFullYear();
    const range =
      year === 2026
        ? "del 20 al 26 de octubre"
        : "del 20 al 26 de octubre de 2026";
    expect(out.answer.split("\n")).toEqual([
      `Tu plato más vendido en los últimos 7 días con ventas (${range}) es Tipico nicaragüense: 153 unidades por $1,224.`,
      "Le siguen:",
      "2. Tortilla normal — 100 unidades · $50",
      "3. Pupusa de queso — 80 unidades · $160",
      "La bebida más vendida fue Sodas (252 unidades).",
    ]);
    expect(out.answer).not.toMatch(/USD|Descuento/);
  });

  it("a «producto» question keeps every product but never a discount", () => {
    const out = buildDeterministicAnswer(
      ctxFor(weekRows(), "lo más vendido de la última semana"),
      "¿qué producto se vendió más la última semana?",
      "top_selling_items",
      none
    );
    expect(out.answer).toMatch(/es Sodas: 252 unidades por \$501\./);
    expect(out.answer).not.toMatch(/Descuento|bebida más vendida/);
  });

  it("chips open Ventas on the same dates and Platos; follow-ups are on topic", () => {
    const out = buildDeterministicAnswer(
      ctxFor(weekRows()),
      Q,
      "top_selling_items",
      none
    );
    expect(out.related_links).toEqual([
      {
        label: "Ventas",
        href: "/dashboard/restaurant/sales?tab=platos&p=custom&desde=2026-10-20&hasta=2026-10-26",
      },
      { label: "Platos", href: "/dashboard/restaurant/menu/platos" },
    ]);
    expect(sanitizeRelatedLinks(out.related_links)).toHaveLength(2);
    expect(out.suggested_followups).toEqual([
      "¿Qué día de la semana vendo más?",
      "¿Cuál es mi plato más rentable?",
    ]);
    expect(out.related_links.map((l) => l.label)).not.toContain(
      "Panel principal"
    );
  });

  it("the model path keeps its words but uses the rule path's chips", () => {
    const ctx = ctxFor(weekRows());
    const ai = {
      answer: "Tu plato más vendido fue Tipico nicaragüense (153 unidades).",
      supporting_facts: [],
      related_links: [
        { label: "Panel principal", href: "/dashboard/restaurant" },
        {
          label: "Conexiones",
          href: "/dashboard/restaurant/data?seccion=conexiones",
        },
      ],
      suggested_followups: ["¿Qué días vendemos más desayunos?"],
      confidence_notes: [],
    };
    const { answer, source } = resolveAskMiltonAnswer(
      ai,
      ctx,
      Q,
      "top_selling_items",
      none
    );
    expect(source).toBe("openai");
    expect(answer.answer).toBe(ai.answer);
    expect(answer.related_links.map((l) => l.label)).toEqual([
      "Ventas",
      "Platos",
    ]);
  });

  it("grounding rejects a drink as the top plato and «USD» amounts", () => {
    const ctx = ctxFor(weekRows());
    expect(
      topSellingAnswerIsGrounded("Tu plato más vendido es Sodas (252).", ctx, Q)
    ).toBe(false);
    expect(
      topSellingAnswerIsGrounded(
        "Tu plato más vendido es Tipico nicaragüense: 153 por USD 1,224.",
        ctx,
        Q
      )
    ).toBe(false);
    expect(
      topSellingAnswerIsGrounded(
        "Tu plato más vendido es Tipico nicaragüense: 153 por $1,224.",
        ctx,
        Q
      )
    ).toBe(true);
  });
});

describe("formatDateRange", () => {
  it("omits the current year and joins months", () => {
    expect(formatDateRange("2026-10-20", "2026-10-26", "es", 2026)).toBe(
      "del 20 al 26 de octubre"
    );
    expect(formatDateRange("2026-09-28", "2026-10-04", "es", 2026)).toBe(
      "del 28 de septiembre al 4 de octubre"
    );
    expect(formatDateRange("2025-10-20", "2025-10-26", "es", 2026)).toBe(
      "del 20 al 26 de octubre de 2025"
    );
    expect(formatDateRange("2025-12-28", "2026-01-03", "es", 2026)).toBe(
      "del 28 de diciembre de 2025 al 3 de enero de 2026"
    );
    expect(formatDateRange("2026-10-20", "2026-10-26", "en", 2026)).toBe(
      "October 20–26"
    );
  });
});
