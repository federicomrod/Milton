import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AskMiltonAnswer } from "@/lib/restaurant/ask-milton-prompt";
import {
  july2026UnevenRows,
  salesContext,
} from "./helpers/ask-milton-sales-fixtures";

const STAGING_ES_NONCOMPLIANT: AskMiltonAnswer = {
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
  related_links: [{ label: "Cockpit", href: "/dashboard/restaurant" }],
  suggested_followups: ["¿Cuáles son los artículos más vendidos?"],
  confidence_notes: [],
};

const createCompletion = vi.fn();

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: vi.fn().mockResolvedValue({
    ok: true,
    supabase: {},
    companyId: "company-1",
    userId: "user-1",
  }),
}));

vi.mock("@/lib/restaurant/ask-milton-context", () => ({
  buildAskMiltonContext: vi.fn(),
}));

vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  resolveRestaurantContext: vi.fn(),
}));

vi.mock("openai", () => ({
  OpenAI: class {
    chat = {
      completions: {
        create: (...args: unknown[]) => createCompletion(...args),
      },
    };
  },
}));

import { POST } from "@/app/api/restaurant/ask-milton/route";
import { buildAskMiltonContext } from "@/lib/restaurant/ask-milton-context";

describe("POST /api/restaurant/ask-milton — best_sales_day AI path", () => {
  beforeEach(() => {
    createCompletion.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
    vi.mocked(buildAskMiltonContext).mockResolvedValue(
      salesContext(july2026UnevenRows(), "es")
    );
  });

  it("grounds a non-compliant model reply so the shown answer is compliant", async () => {
    createCompletion.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify(STAGING_ES_NONCOMPLIANT) } },
      ],
    });

    const req = new NextRequest("http://localhost/api/restaurant/ask-milton", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "¿Qué día de la semana vendimos más en julio?",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      answer: string;
      supporting_facts: { label: string }[];
    };

    expect(createCompletion).toHaveBeenCalledOnce();
    expect(body.source).toBe("deterministic");
    expect(body.answer).toMatch(/promedio por día/i);
    expect(body.answer).toMatch(/5 jueves/);
    expect(body.answer).toMatch(/número de días no es igual/i);
    expect(body.answer).toMatch(/mejor día individual/i);
    expect(body.answer).toMatch(/17 de julio/i);
    expect(body.answer).not.toMatch(/10,650|10650/);
    expect(body.supporting_facts.map((f) => f.label)).toEqual(
      expect.arrayContaining([
        "Total de los 5 jueves",
        "Promedio por jueves",
        "Mejor día individual",
      ])
    );
  });
});
