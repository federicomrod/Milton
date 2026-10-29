// The Telegram webhook ALSO copies new photo / voice reports into Storage
// (mobile P0a, #430) without changing what the cook sees. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type Row } from "./helpers/fake-db";

const {
  store,
  afterJobs,
  sent,
  uploads,
  storageMode,
  classify,
  extractInvoice,
  extractRecipe,
} = vi.hoisted(() => ({
  store: {} as Record<string, Row[]>,
  afterJobs: [] as Promise<unknown>[],
  sent: [] as Array<{ chatId: number; text: string; markup?: unknown }>,
  uploads: [] as unknown[][],
  storageMode: { throws: false },
  classify: vi.fn(),
  extractInvoice: vi.fn(),
  extractRecipe: vi.fn(),
}));
const answers: Array<{ id: string; text?: string }> = [];
const edits: Array<{ messageId: number; text: string; markup?: unknown }> = [];
let transcript = "";
let questionId = 1000;

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
  sendTelegramMessage: async (
    chatId: number,
    text: string,
    options?: { replyMarkup?: (typeof sent)[number]["markup"] }
  ) => {
    sent.push({ chatId, text, markup: options?.replyMarkup });
    return { ok: true, messageId: ++questionId };
  },
  answerCallbackQuery: async (id: string, text?: string) => {
    answers.push({ id, text });
    return { ok: true };
  },
  editMessageText: async (
    _chatId: number,
    messageId: number,
    text: string,
    options?: { replyMarkup?: (typeof sent)[number]["markup"] }
  ) => {
    edits.push({ messageId, text, markup: options?.replyMarkup });
    return { ok: true };
  },
  TelegramConfigError: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => {
  const db = makeFakeDb(store);
  const admin = Object.assign(Object.create(db), {
    from: db.from.bind(db),
    storage: {
      from: () => ({
        upload: async (...a: unknown[]) => {
          uploads.push(a);
          if (storageMode.throws) throw new Error("storage down");
          return { error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
  });
  return { createAdminClient: () => admin };
});
vi.mock("@/lib/restaurant/telegram/files", () => ({
  openTelegramFile: async () => ({
    ok: true,
    contentLength: "4",
    body: new Response(new Uint8Array([1, 2, 3, 4])).body,
  }),
}));
vi.mock("@/lib/restaurant/telegram/photo-classify", () => ({
  classifyKitchenPhoto: (...a: unknown[]) => classify(...a),
}));
vi.mock("@/lib/restaurant/invoice-draft", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/restaurant/invoice-draft")>();
  return {
    ...actual,
    extractInvoiceFromImage: (...a: unknown[]) => extractInvoice(...a),
  };
});
vi.mock("@/lib/restaurant/telegram/kitchen-recipe-drafts", async (orig) => {
  const actual =
    await orig<
      typeof import("@/lib/restaurant/telegram/kitchen-recipe-drafts")
    >();
  return {
    ...actual,
    extractAndCreateRecipeDraft: (...a: unknown[]) => extractRecipe(...a),
  };
});
vi.mock("openai", () => {
  class FakeOpenAI {
    audio = { transcriptions: { create: async () => ({ text: transcript }) } };
  }
  return { default: FakeOpenAI, OpenAI: FakeOpenAI };
});
vi.mock("@/lib/restaurant/telegram/kitchen-reports", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-reports")
    >();
  return {
    ...actual,
    // Same contract as the real one: false on a duplicate delivery.
    recordKitchenReport: async (input: {
      companyId: string;
      locationId: string;
      staffId: string;
      chatId: number;
      report: Record<string, unknown>;
    }) => {
      const rows = (store.kitchen_reports ??= []);
      if (
        rows.some(
          (r) =>
            r.telegram_chat_id === input.chatId &&
            r.telegram_message_id === input.report.telegram_message_id
        )
      ) {
        return false;
      }
      rows.push({
        id: `kr-${rows.length + 1}`,
        company_id: input.companyId,
        location_id: input.locationId,
        staff_id: input.staffId,
        telegram_chat_id: input.chatId,
        created_at: new Date().toISOString(),
        ...input.report,
      });
      return true;
    },
  };
});

import { POST } from "@/app/api/telegram/webhook/route";
import { resetOwnerChatGuidance } from "@/lib/restaurant/telegram/owner-chat-guidance";
import { resetRoutingState } from "@/lib/restaurant/telegram/kitchen-routing";

const CHAT = 4242;
const COOK = 9;
let nextId = 100;

function seed() {
  for (const k of Object.keys(store)) delete store[k];
  store.companies = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Demo Resto" },
  ];
  store.restaurant_locations = [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Local Centro",
      status: "active",
      archived_at: null,
    },
  ];
  store.kitchen_staff = [
    {
      id: "st-demo",
      company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      location_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      telegram_user_id: COOK,
      is_active: true,
    },
  ];
  store.kitchen_pending_items = [];
  store.kitchen_routing_defaults = [];
}

async function msg(extra: Record<string, unknown>) {
  const res = await POST(
    new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "s3cret" },
      body: JSON.stringify({
        message: {
          message_id: ++nextId,
          date: Math.floor(Date.now() / 1000),
          from: { id: COOK, first_name: "Ana" },
          chat: { id: CHAT, type: "private" },
          ...extra,
        },
      }),
    })
  );
  await Promise.all(afterJobs.splice(0));
  return res;
}

const photo = (uid: string) => ({
  photo: [{ file_id: "FILE-1", file_unique_id: uid, width: 100, height: 100 }],
  caption: "mise en place",
});
const voice = (uid: string) => ({
  voice: {
    file_id: "FILE-2",
    file_unique_id: uid,
    duration: 3,
    mime_type: "audio/ogg",
    file_size: 4,
  },
});

beforeEach(() => {
  seed();
  afterJobs.length = 0;
  sent.length = 0;
  uploads.length = 0;
  storageMode.throws = false;
  transcript = "hola";
  resetOwnerChatGuidance();
  resetRoutingState();
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  process.env.OPENAI_API_KEY = "test-key";
  classify
    .mockReset()
    .mockResolvedValue({ ok: true, kind: "other", confidence: "high" });
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      if (process.env.DBG) process.stdout.write(a.map(String).join(" ") + "\n");
    });
  }
});

async function runScenario(throws: boolean) {
  seed();
  sent.length = 0;
  uploads.length = 0;
  storageMode.throws = throws;
  await msg(voice("uniq-voice"));
  await msg(photo("uniq-photo"));
  return { replies: sent.map((s) => s.text), uploads: uploads.length };
}

describe("telegram media copy", () => {
  it("sends the same replies whether the copy works or Storage throws", async () => {
    const ok = await runScenario(false);
    const broken = await runScenario(true);
    expect(broken.replies).toEqual(ok.replies);
    expect(ok.uploads).toBe(2);
    expect(broken.uploads).toBe(2);
  });

  it("copies a new voice report once and skips a Telegram retry", async () => {
    const m = voice("uniq-1");
    const body = { ...m, message_id: 555 };
    for (let i = 0; i < 2; i++) {
      await POST(
        new NextRequest("http://localhost/api/telegram/webhook", {
          method: "POST",
          headers: { "x-telegram-bot-api-secret-token": "s3cret" },
          body: JSON.stringify({
            message: {
              ...body,
              date: Math.floor(Date.now() / 1000),
              from: { id: COOK, first_name: "Ana" },
              chat: { id: CHAT, type: "private" },
            },
          }),
        })
      );
      await Promise.all(afterJobs.splice(0));
    }
    expect(uploads).toHaveLength(1);
    expect(store.kitchen_media).toHaveLength(1);
    expect(store.kitchen_media[0].channel).toBe("telegram");
    expect(store.kitchen_media[0].source_ref).toBe("uniq-1");
  });

  it("does not copy anything for a text-only report", async () => {
    await msg({ text: "se acabó el limón" });
    expect(uploads).toHaveLength(0);
    expect(store.kitchen_media ?? []).toHaveLength(0);
  });

  it("never logs the Telegram file id", async () => {
    storageMode.throws = true;
    const calls: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      calls.push(a.map(String).join(" "));
    });
    await msg(voice("uniq-log"));
    expect(calls.join("\n")).not.toContain("FILE-2");
  });
});
