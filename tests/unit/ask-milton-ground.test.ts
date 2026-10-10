import { describe, expect, it } from "vitest";
import type { AskMiltonAnswer } from "@/lib/restaurant/ask-milton-prompt";
import { resolveAskMiltonAnswer } from "@/lib/restaurant/ask-milton-ground";
import {
  july2026AverageBeatsTotalRows,
  july2026UnevenRows,
  salesContext,
} from "./helpers/ask-milton-sales-fixtures";

const none = { resolved_ingredients: [], resolved_menu_items: [] };

function mockModelAnswer(
  overrides: Partial<AskMiltonAnswer> = {}
): AskMiltonAnswer {
  return {
    answer: "",
    supporting_facts: [],
    related_links: [{ label: "Cockpit", href: "/dashboard/restaurant" }],
    suggested_followups: ["¿Cuáles son los artículos más vendidos?"],
    confidence_notes: [],
    ...overrides,
  };
}

/** Staging LLM reply after PR #110 (issue #108) — ranked by raw Friday
 *  total, no day count, no average, ambiguous chips. */
const STAGING_ES_NONCOMPLIANT = mockModelAnswer({
  answer:
    "El día de la semana que vendimos más en julio fue el viernes, con un ingreso total de $10,650 a través de 384 pedidos. El mejor día individual fue el sábado 25 de julio, con $2,774 en ingresos.",
  supporting_facts: [
    {
      label: "Ingreso total el viernes",
      value: "$10,650",
      source_area: "sales",
    },
    { label: "Pedidos el viernes", value: "384", source_area: "sales" },
    {
      label: "Mejor día individual",
      value: "Sábado 25 de julio con $2,774",
      source_area: "sales",
    },
  ],
});

const STAGING_EN_NONCOMPLIANT = mockModelAnswer({
  answer:
    "The weekday we sold the most in July was Friday, with total revenue of $10,650 across 384 orders. The best single date was Saturday 25 July, with $2,774 in revenue.",
  supporting_facts: [
    { label: "Friday total revenue", value: "$10,650", source_area: "sales" },
    { label: "Friday orders", value: "384", source_area: "sales" },
    {
      label: "Best individual day",
      value: "Saturday 25 July with $2,774",
      source_area: "sales",
    },
  ],
});

function expectCompliantEs(answer: AskMiltonAnswer) {
  expect(answer.answer).toMatch(/promedio por día/i);
  expect(answer.answer).toMatch(/5 jueves/);
  expect(answer.answer).toMatch(/total/i);
  expect(answer.answer).toMatch(/número de días no es igual/i);
  expect(answer.answer).toMatch(/mejor día individual/i);
  expect(answer.answer).toMatch(/17 de julio/i);
  expect(answer.supporting_facts.map((f) => f.label)).toEqual(
    expect.arrayContaining([
      "Total de los 5 jueves",
      "Promedio por jueves",
      "Mejor día individual",
    ])
  );
}

function expectCompliantEn(answer: AskMiltonAnswer) {
  expect(answer.answer).toMatch(/average per day/i);
  expect(answer.answer).toMatch(/5 Thursdays/);
  expect(answer.answer).toMatch(/total/i);
  expect(answer.answer).toMatch(/uneven/i);
  expect(answer.answer).toMatch(/Best single date/i);
  expect(answer.answer).toMatch(/17 July/i);
  expect(answer.supporting_facts.map((f) => f.label)).toEqual(
    expect.arrayContaining([
      "Total across 5 Thursdays",
      "Average per Thursday",
      "Best single date",
    ])
  );
}

describe("resolveAskMiltonAnswer — best_sales_day grounding", () => {
  it("replaces the staging Spanish AI answer with a compliant one", () => {
    const ctx = salesContext(july2026UnevenRows(), "es");
    const { answer, source } = resolveAskMiltonAnswer(
      STAGING_ES_NONCOMPLIANT,
      ctx,
      "¿Qué día de la semana vendimos más en julio?",
      "best_sales_day",
      none
    );
    expect(source).toBe("deterministic");
    expectCompliantEs(answer);
    expect(answer.answer).not.toMatch(/10,650|10650/);
    expect(answer.suggested_followups).toEqual(
      STAGING_ES_NONCOMPLIANT.suggested_followups
    );
  });

  it("replaces a non-compliant English AI answer with a compliant one", () => {
    const ctx = salesContext(july2026UnevenRows(), "en");
    const { answer, source } = resolveAskMiltonAnswer(
      STAGING_EN_NONCOMPLIANT,
      ctx,
      "Which weekday did we sell the most in July?",
      "best_sales_day",
      none
    );
    expect(source).toBe("deterministic");
    expectCompliantEn(answer);
  });

  it("ranks by average when the model ranks by raw total", () => {
    const ctx = salesContext(july2026AverageBeatsTotalRows(), "en");
    const { answer } = resolveAskMiltonAnswer(
      mockModelAnswer({
        answer:
          "Thursday sold the most in July with a total of $29,230 across 5 Thursdays.",
        supporting_facts: [
          {
            label: "Thursday total",
            value: "$29,230",
            source_area: "sales",
          },
        ],
      }),
      ctx,
      "Which weekday sold the most in July?",
      "best_sales_day",
      none
    );
    expect(answer.answer).toMatch(/Saturday/i);
    expect(answer.answer).toMatch(/average per day/i);
    expect(answer.answer).toMatch(/4 Saturdays/);
    expect(answer.supporting_facts[0]?.label).toBe("Total across 4 Saturdays");
  });

  it("keeps a compliant AI answer and still injects unambiguous chips", () => {
    const ctx = salesContext(july2026UnevenRows(), "es");
    const compliant = mockModelAnswer({
      answer:
        "El día de la semana más fuerte, según el promedio por día, fue el jueves: USD 5,846/día en 5 jueves (total USD 29,230). En este período el número de días no es igual para todos, así que un total crudo favorecería a los días que aparecen más veces. El mejor día individual fue el viernes 17 de julio de 2026.",
      supporting_facts: [
        {
          label: "Ingreso del jueves",
          value: "USD 29,230",
          source_area: "sales",
        },
      ],
    });
    const { answer, source } = resolveAskMiltonAnswer(
      compliant,
      ctx,
      "¿Qué día de la semana vendimos más en julio?",
      "best_sales_day",
      none
    );
    expect(source).toBe("openai");
    expect(answer.answer).toBe(compliant.answer);
    expect(answer.supporting_facts.map((f) => f.label)).toEqual(
      expect.arrayContaining([
        "Total de los 5 jueves",
        "Promedio por jueves",
        "Mejor día individual",
      ])
    );
  });

  it("does not treat 170 as the best-date day 17", () => {
    const ctx = salesContext(july2026UnevenRows(), "es");
    const mentions170 = mockModelAnswer({
      answer:
        "El día de la semana más fuerte, según el promedio por día, fue el jueves: USD 5,846/día en 5 jueves (total USD 29,230). En este período el número de días no es igual para todos. El mejor día individual fue el viernes 170 de julio de 2026.",
    });
    const { answer, source } = resolveAskMiltonAnswer(
      mentions170,
      ctx,
      "¿Qué día de la semana vendimos más en julio?",
      "best_sales_day",
      none
    );
    expect(source).toBe("deterministic");
    expect(answer.answer).toMatch(/17 de julio/i);
    expect(answer.answer).not.toMatch(/\b170\b/);
  });

  it("does not rewrite unrelated intents", () => {
    const ctx = salesContext(july2026UnevenRows(), "es");
    const ai = mockModelAnswer({
      answer: "El artículo más vendido es Pupusa de queso.",
      supporting_facts: [
        { label: "Pupusa de queso", value: "20", source_area: "sales" },
      ],
    });
    const { answer, source } = resolveAskMiltonAnswer(
      ai,
      ctx,
      "¿Cuáles son los artículos más vendidos?",
      "top_selling_items",
      none
    );
    expect(source).toBe("openai");
    expect(answer).toEqual(ai);
  });

  it("falls back to the deterministic answer when the model is missing", () => {
    const ctx = salesContext(july2026UnevenRows(), "es");
    const { answer, source } = resolveAskMiltonAnswer(
      null,
      ctx,
      "¿Qué día de la semana vendimos más en julio?",
      "best_sales_day",
      none
    );
    expect(source).toBe("deterministic");
    expectCompliantEs(answer);
  });
});
