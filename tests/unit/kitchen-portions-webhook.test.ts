// Telegram webhook: the answer to «¿Para cuántas porciones salió?» is read
// BEFORE anything is stored as a kitchen report. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

const store: FakeStore = {};
const send = vi.fn(async () => ({ ok: true }));
const record = vi.fn(async () => true);
let failDraftUpdate = false;

vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: (...a: unknown[]) => send(...(a as [])),
  TelegramConfigError: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    makeFakeDb(store, {
      fail: (table, mode) =>
        failDraftUpdate &&
        table === "kitchen_recipe_drafts" &&
        mode === "update",
    }),
}));
vi.mock("@/lib/restaurant/telegram/kitchen-links", () => ({
  listActiveLinks: async () => [
    {
      staffId: "st-1",
      companyId: "co-1",
      companyName: "Demo Resto",
      locationId: "loc-1",
      locationName: "Local Centro",
      telegramUserId: 9,
    },
  ],
  validateLink: async () => null,
}));
vi.mock("@/lib/restaurant/telegram/kitchen-reports", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-reports")
    >();
  return {
    ...actual,
    recordKitchenReport: (...a: unknown[]) => record(...(a as [])),
  };
});

import { POST } from "@/app/api/telegram/webhook/route";

let messageId = 100;
function update(text: string | null, extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret" },
    body: JSON.stringify({
      message: {
        message_id: ++messageId,
        ...(text === null ? {} : { text }),
        from: { id: 9 },
        chat: { id: 555, type: "private" },
        ...extra,
      },
    }),
  });
}

function waitingDraft(ageMs = 60_000) {
  store.kitchen_recipe_drafts = [
    {
      id: "d-1",
      company_id: "co-1",
      staff_id: "st-1",
      telegram_chat_id: 555,
      telegram_message_id: 1,
      status: "awaiting_portions",
      portions: null,
      total_cost: 10,
      dish_name: "Devil Bacon Cheeseburger",
      created_at: new Date(Date.now() - ageMs).toISOString(),
    },
  ];
  store.kitchen_recipe_draft_lines = [
    { id: "l-1", draft_id: "d-1", total_quantity: 4 },
  ];
}

beforeEach(() => {
  failDraftUpdate = false;
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  send.mockClear();
  record.mockClear();
  store.kitchen_recipe_drafts = [];
  store.kitchen_recipe_draft_lines = [];
  store.kitchen_reports = [];
});

describe("a draft is waiting for portions", () => {
  it("«1 hamburguesa» fills Porciones, leaves awaiting_portions and is not a report", async () => {
    waitingDraft();
    const res = await POST(update("1 hamburguesa"));
    expect(res.status).toBe(200);
    expect(store.kitchen_recipe_drafts[0]).toMatchObject({
      portions: 1,
      status: "draft",
    });
    expect(store.kitchen_recipe_draft_lines[0].per_portion_quantity).toBe(4);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      555,
      "Listo: 1 porción. Ya está en Cocina de Demo Resto › Local Centro para revisar."
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("«para 3» → «Listo: 3 porciones…»", async () => {
    waitingDraft();
    await POST(update("para 3"));
    expect(store.kitchen_recipe_drafts[0].portions).toBe(3);
    expect(send).toHaveBeenCalledWith(
      555,
      "Listo: 3 porciones. Ya está en Cocina de Demo Resto › Local Centro para revisar."
    );
  });

  it("an answer that is not a number → «No entendí…», no report, no «Recibido»", async () => {
    waitingDraft();
    await POST(update("mmm no sé"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      555,
      "No entendí. ¿Para cuántas porciones salió? Responde con un número, por ejemplo: 2."
    );
    expect(record).not.toHaveBeenCalled();
    expect(store.kitchen_recipe_drafts[0].status).toBe("awaiting_portions");
    expect(
      send.mock.calls.some((c) =>
        String((c as unknown[])[1]).includes("Recibido")
      )
    ).toBe(false);
  });

  it("if the draft cannot be updated the cook still gets an answer: «No entendí…», no report", async () => {
    waitingDraft();
    failDraftUpdate = true;
    await POST(update("2"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      555,
      "No entendí. ¿Para cuántas porciones salió? Responde con un número, por ejemplo: 2."
    );
    expect(record).not.toHaveBeenCalled();
    expect(store.kitchen_recipe_drafts[0].status).toBe("awaiting_portions");
  });

  it("a real report («se acabó…») is still stored and acknowledged", async () => {
    waitingDraft();
    await POST(update("2 cajas de limón se acabó"));
    expect(record).toHaveBeenCalledTimes(1);
    expect(store.kitchen_recipe_drafts[0].status).toBe("awaiting_portions");
    expect(String((send.mock.calls[0] as unknown[])[1])).toContain("Recibido");
  });

  it("a photo is never read as the answer", async () => {
    waitingDraft();
    await POST(
      update(null, { photo: [{ file_id: "f1", width: 10, height: 10 }] })
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(store.kitchen_recipe_drafts[0].status).toBe("awaiting_portions");
  });

  it("a draft older than 2 hours is not waiting any more", async () => {
    waitingDraft(3 * 60 * 60 * 1000);
    await POST(update("2"));
    expect(record).toHaveBeenCalledTimes(1);
    expect(store.kitchen_recipe_drafts[0].status).toBe("awaiting_portions");
  });

  it("another chat's draft is not touched", async () => {
    waitingDraft();
    store.kitchen_recipe_drafts[0].telegram_chat_id = 777;
    await POST(update("2"));
    expect(store.kitchen_recipe_drafts[0].status).toBe("awaiting_portions");
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe("no draft waiting: unchanged", () => {
  it("«1 hamburguesa» is an ordinary report with the usual acknowledgement", async () => {
    await POST(update("1 hamburguesa"));
    expect(record).toHaveBeenCalledTimes(1);
    expect(String((send.mock.calls[0] as unknown[])[1])).toContain("Recibido");
  });
});
