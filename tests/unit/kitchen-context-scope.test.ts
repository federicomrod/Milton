/**
 * A Telegram chat linked to two companies: nothing from the other company
 * reaches the AI context or the prompt. Fake Supabase, no network.
 */
import { describe, it, expect, vi } from "vitest";

const openQuestion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/restaurant/telegram/price-unit-question", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/restaurant/telegram/price-unit-question")
  >("@/lib/restaurant/telegram/price-unit-question");
  return { ...actual, findOpenUnitQuestion: openQuestion };
});
vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: vi.fn(async () => "USD"),
}));

import {
  buildKitchenContext,
  fetchPendingQuestion,
} from "@/lib/restaurant/telegram/kitchen-context";
import {
  buildSystemPrompt,
  buildUserPrompt,
} from "@/lib/restaurant/telegram/kitchen-intent-ai";

type Row = Record<string, unknown>;

/** Minimal chainable fake: honours eq / in / is filters, order and limit. */
function fakeAdmin(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = (col: string, v: unknown) => {
      rows = rows.filter((r) => r[col] === v);
      return q;
    };
    q.in = (col: string, vs: unknown[]) => {
      rows = rows.filter((r) => vs.includes(r[col]));
      return q;
    };
    q.is = (col: string, v: unknown) => {
      rows = rows.filter((r) => (r[col] ?? null) === v);
      return q;
    };
    q.order = (col: string, o: { ascending: boolean }) => {
      rows.sort((a, b) =>
        String(a[col]) < String(b[col])
          ? o.ascending
            ? -1
            : 1
          : o.ascending
            ? 1
            : -1
      );
      return q;
    };
    q.limit = (n: number) => {
      rows = rows.slice(0, n);
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null });
    return q;
  };
  return { from } as never;
}

const CHAT = 555;
const A = "company-a";
const B = "company-b";

const reports: Row[] = [
  {
    telegram_chat_id: CHAT,
    company_id: A,
    location_id: "loc-a",
    staff_id: "st-a",
    text: "aguacate de A",
    transcript: null,
    created_at: "2026-01-01T10:00:00Z",
  },
  {
    telegram_chat_id: CHAT,
    company_id: B,
    location_id: "loc-b",
    staff_id: "st-b",
    text: "SECRETO_DE_B precio de langosta",
    transcript: null,
    created_at: "2026-01-01T11:00:00Z",
  },
  {
    telegram_chat_id: CHAT,
    company_id: B,
    location_id: "loc-b",
    staff_id: "st-b",
    text: null,
    transcript: "SECRETO_VOZ_DE_B",
    created_at: "2026-01-01T12:00:00Z",
  },
  {
    telegram_chat_id: CHAT,
    company_id: A,
    location_id: "loc-a2",
    staff_id: "st-a2",
    text: "otro local de A",
    transcript: null,
    created_at: "2026-01-01T09:00:00Z",
  },
];
const ingredients: Row[] = [
  { id: "ing-a", company_id: A, name: "Aguacate Hass", archived_at: null },
  { id: "ing-b", company_id: B, name: "Aguacate SECRETO_B", archived_at: null },
];

describe("kitchen context is scoped to the link", () => {
  it("company A context has no text, ingredient or pending question of company B", async () => {
    openQuestion.mockResolvedValue({
      id: "p1",
      optionStaffIds: ["st-b"],
      payload: {
        price_unit_question: {
          items: [{ product: "SECRETO_B", price: 3, currency: null }],
        },
      },
    });
    const admin = fakeAdmin({
      kitchen_reports: reports,
      ingredients,
      kitchen_staff: [
        { id: "st-a", company_id: A },
        { id: "st-b", company_id: B },
      ],
    });

    const context = await buildKitchenContext(
      admin,
      CHAT,
      A,
      "aguacate a 1.50 la libra",
      {
        locationId: "loc-a",
        staffId: "st-a",
      }
    );

    const everything = JSON.stringify(context);
    expect(everything).not.toContain("SECRETO");
    expect(everything).not.toContain("langosta");
    expect(context.conversation.map((m) => m.text)).toEqual(["aguacate de A"]);
    expect(context.ingredient_hints).toEqual([
      { id: "ing-a", name: "Aguacate Hass" },
    ]);
    expect(context.pending_question).toBeNull();

    const prompt =
      buildSystemPrompt(context) +
      "\n" +
      buildUserPrompt("aguacate a 1.50 la libra", context);
    expect(prompt).not.toContain("SECRETO");
    expect(prompt).not.toContain("langosta");
    expect(prompt).toContain("aguacate de A");
  });

  it("company B sees only its own text", async () => {
    openQuestion.mockResolvedValue(null);
    const admin = fakeAdmin({ kitchen_reports: reports, ingredients });
    const context = await buildKitchenContext(admin, CHAT, B, "hola", {
      locationId: "loc-b",
      staffId: "st-b",
    });
    expect(context.conversation.map((m) => m.text)).toEqual([
      "SECRETO_DE_B precio de langosta",
      "SECRETO_VOZ_DE_B",
    ]);
    expect(JSON.stringify(context)).not.toContain("aguacate de A");
  });

  it("with only the company (no location/staff) it still filters by company", async () => {
    openQuestion.mockResolvedValue(null);
    const admin = fakeAdmin({ kitchen_reports: reports, ingredients });
    const context = await buildKitchenContext(admin, CHAT, A, "hola");
    expect(context.conversation.map((m) => m.text).sort()).toEqual([
      "aguacate de A",
      "otro local de A",
    ]);
  });

  it("location/staff narrow the history further", async () => {
    openQuestion.mockResolvedValue(null);
    const admin = fakeAdmin({ kitchen_reports: reports, ingredients });
    const context = await buildKitchenContext(admin, CHAT, A, "hola", {
      locationId: "loc-a2",
      staffId: "st-a2",
    });
    expect(context.conversation.map((m) => m.text)).toEqual([
      "otro local de A",
    ]);
  });
});

describe("fetchPendingQuestion is scoped", () => {
  const unitQ = (staff: string[]) => ({
    id: "p1",
    optionStaffIds: staff,
    payload: {
      price_unit_question: {
        items: [{ product: "aguacate", price: 3, currency: null }],
      },
    },
  });

  it("returns the question of the same staff link", async () => {
    openQuestion.mockResolvedValue(unitQ(["st-a"]));
    const q = await fetchPendingQuestion(CHAT, {
      companyId: A,
      staffId: "st-a",
    });
    expect(q?.expected_answer).toBe("unit");
  });

  it("ignores a question opened for another staff/company", async () => {
    openQuestion.mockResolvedValue(unitQ(["st-b"]));
    expect(
      await fetchPendingQuestion(CHAT, { companyId: A, staffId: "st-a" })
    ).toBeNull();
  });

  it("checks the company through kitchen_staff when staffId is unknown", async () => {
    openQuestion.mockResolvedValue(unitQ(["st-b"]));
    const admin = fakeAdmin({
      kitchen_staff: [
        { id: "st-a", company_id: A },
        { id: "st-b", company_id: B },
      ],
    });
    expect(
      await fetchPendingQuestion(CHAT, { companyId: A }, admin)
    ).toBeNull();
    expect(
      (await fetchPendingQuestion(CHAT, { companyId: B }, admin))
        ?.expected_answer
    ).toBe("unit");
  });

  it("fails closed without staff id or admin client", async () => {
    openQuestion.mockResolvedValue(unitQ(["st-a"]));
    expect(await fetchPendingQuestion(CHAT, { companyId: A })).toBeNull();
  });

  it("reads an amount question payload", async () => {
    openQuestion.mockResolvedValue({
      id: "p2",
      optionStaffIds: ["st-a"],
      payload: {
        price_amount_question: {
          items: [
            {
              product: "aguacate",
              options: [1.5, 150],
              unit: null,
              currency: null,
            },
          ],
        },
      },
    });
    const q = await fetchPendingQuestion(CHAT, {
      companyId: A,
      staffId: "st-a",
    });
    expect(q?.expected_answer).toBe("amount");
    expect(q?.question).toContain("aguacate");
  });
});
