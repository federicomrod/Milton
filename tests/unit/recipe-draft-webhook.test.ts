import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const afterJobs: Promise<unknown>[] = [];
const replies: string[] = [];
const reports = new Set<string>();
const drafts: Array<{
  id: string;
  telegram_chat_id: number;
  telegram_message_id: number;
  dish_name: string;
  status: string;
}> = [];

const extractAndCreateRecipeDraft = vi.fn();
const updateDraftPortions = vi.fn();
const findActiveKitchenStaff = vi.fn();
const recordKitchenReport = vi.fn();
const sendTelegramMessage = vi.fn(async (_chatId: number, text: string) => {
  replies.push(text);
  return { ok: true };
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterJobs.push(Promise.resolve().then(() => fn()));
    },
  };
});

vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: (chatId: number, text: string) =>
    sendTelegramMessage(chatId, text),
}));

vi.mock("@/lib/restaurant/telegram/kitchen-reports", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-reports")
    >();
  return {
    ...actual,
    findActiveKitchenStaff: (...args: unknown[]) =>
      findActiveKitchenStaff(...args),
    recordKitchenReport: (...args: unknown[]) => recordKitchenReport(...args),
  };
});

vi.mock(
  "@/lib/restaurant/telegram/kitchen-recipe-drafts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/restaurant/telegram/kitchen-recipe-drafts")
      >();
    return {
      ...actual,
      extractAndCreateRecipeDraft: (...args: unknown[]) =>
        extractAndCreateRecipeDraft(...args),
      updateDraftPortions: (...args: unknown[]) => updateDraftPortions(...args),
    };
  }
);

function makeChain(table: string) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {};
  const self = chain as {
    select: () => typeof self;
    eq: (col: string, val: unknown) => typeof self;
    in: () => typeof self;
    order: () => typeof self;
    gte: () => typeof self;
    limit: () => typeof self;
    not: () => typeof self;
    maybeSingle: () => Promise<{ data: unknown; error: null }>;
    then: (
      resolve: (v: { data: unknown[]; error: null }) => unknown,
      reject: (e: unknown) => unknown
    ) => Promise<unknown>;
  };
  self.select = () => self;
  self.eq = (col, val) => {
    filters[col] = val;
    return self;
  };
  self.in = () => self;
  self.order = () => self;
  self.gte = () => self;
  self.limit = () => self;
  self.not = () => self;
  self.maybeSingle = async () => {
    if (table === "kitchen_recipe_drafts") {
      const found =
        drafts.find(
          (d) =>
            d.telegram_chat_id === filters.telegram_chat_id &&
            d.telegram_message_id === filters.telegram_message_id
        ) ??
        drafts.find((d) => d.id === filters.id) ??
        null;
      return { data: found, error: null };
    }
    if (table === "kitchen_reports") {
      return { data: { id: "report-1" }, error: null };
    }
    return { data: null, error: null };
  };
  self.then = (resolve, reject) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject);
  return self;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeChain(table),
  }),
}));

import { POST } from "@/app/api/telegram/webhook/route";

const SECRET = "webhook-secret";

function recipeUpdate(messageId: number) {
  return {
    message: {
      message_id: messageId,
      text: "esto salió para 2 porciones de pollo con arroz",
      from: { id: 99, first_name: "Ana" },
      chat: { id: 1001, type: "private" },
    },
  };
}

async function postUpdate(body: unknown) {
  const req = new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": SECRET,
    },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  await Promise.all(afterJobs.splice(0));
  return res;
}

describe("telegram webhook recipe drafts", () => {
  beforeEach(() => {
    afterJobs.length = 0;
    replies.length = 0;
    reports.clear();
    drafts.length = 0;
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    delete process.env.OPENAI_API_KEY;

    updateDraftPortions.mockReset();
    extractAndCreateRecipeDraft.mockReset();
    recordKitchenReport.mockReset();
    sendTelegramMessage.mockClear();
    findActiveKitchenStaff.mockReset();

    findActiveKitchenStaff.mockResolvedValue({
      id: "staff-1",
      company_id: "company-1",
      location_id: "loc-1",
      location_name: "Roma",
    });

    recordKitchenReport.mockImplementation(
      async (input: {
        chatId: number;
        report: { telegram_message_id: number };
      }) => {
        const key = `${input.chatId}:${input.report.telegram_message_id}`;
        if (reports.has(key)) return false;
        reports.add(key);
        return true;
      }
    );

    extractAndCreateRecipeDraft.mockImplementation(
      async (input: {
        chatId: number;
        messageId: number;
        dishName?: string;
      }) => {
        if (
          drafts.some(
            (d) =>
              d.telegram_chat_id === input.chatId &&
              d.telegram_message_id === input.messageId
          )
        ) {
          return { ok: false, error: "duplicate" };
        }
        drafts.push({
          id: `draft-${drafts.length + 1}`,
          telegram_chat_id: input.chatId,
          telegram_message_id: input.messageId,
          dish_name: "pollo con arroz",
          status: "draft",
        });
        return { ok: true, draftId: `draft-${drafts.length}` };
      }
    );

    updateDraftPortions.mockResolvedValue({ ok: true, draftId: "draft-1" });
  });

  it("the same Telegram update twice gives one draft and one reply", async () => {
    const update = recipeUpdate(42);
    const first = await postUpdate(update);
    const second = await postUpdate(update);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(drafts).toHaveLength(1);
    expect(extractAndCreateRecipeDraft).toHaveBeenCalledOnce();
    expect(replies).toHaveLength(1);
  });

  it("a sticker gets no reply", async () => {
    const res = await postUpdate({
      message: {
        message_id: 77,
        from: { id: 99, first_name: "Ana" },
        chat: { id: 1001, type: "private" },
        sticker: { file_id: "sticker-1", emoji: "👍" },
      },
    });

    expect(res.status).toBe(200);
    expect(replies).toHaveLength(0);
    expect(recordKitchenReport).not.toHaveBeenCalled();
    expect(extractAndCreateRecipeDraft).not.toHaveBeenCalled();
  });
});
