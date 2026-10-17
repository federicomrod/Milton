// Routes: webhook (private chat only), disconnect and pairing-code (owner/admin only).
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn(async () => ({ ok: true }));
const consume = vi.fn(async () => ({ ok: true as const, companyId: "co-1" }));
const disconnect = vi.fn(async () => ({
  ok: true as const,
  disconnected: true,
  chatId: 555,
}));
const createCode = vi.fn(async () => ({
  ok: true as const,
  issued: { code: "CODE", expiresAt: "2999-01-01" },
}));
let role: string | null = "owner";

vi.mock("@/lib/restaurant/telegram/send", () => ({
  sendTelegramMessage: (...a: unknown[]) => send(...(a as [])),
  TelegramConfigError: class extends Error {},
}));
vi.mock("@/lib/restaurant/telegram/pairing", () => ({
  consumePairingCode: (...a: unknown[]) => consume(...(a as [])),
  disconnectTelegram: (...a: unknown[]) => disconnect(...(a as [])),
  createPairingCode: (...a: unknown[]) => createCode(...(a as [])),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({
    ok: true,
    supabase: {},
    companyId: "co-1",
    userId: "u-1",
  }),
}));
vi.mock("@/lib/restaurant/cost-workbook/reset-auth", () => ({
  loadCompanyMembershipRole: async () => ({ role }),
}));

import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { DELETE as disconnectRoute } from "@/app/api/restaurant/telegram/connection/route";
import { POST as pairingCodeRoute } from "@/app/api/restaurant/telegram/pairing-code/route";

function update(chatType: string, text = "/start CODE12345678") {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret" },
    body: JSON.stringify({
      message: { text, from: { id: 9 }, chat: { id: 555, type: chatType } },
    }),
  });
}

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  send.mockClear();
  consume.mockClear();
  disconnect.mockClear();
  createCode.mockClear();
  role = "owner";
});

describe("webhook: a manager code is only accepted in a private chat", () => {
  it.each(["group", "supergroup", "channel"])(
    "%s: generic Spanish reply, the code is NOT consumed",
    async (type) => {
      const res = await webhook(update(type));
      expect(res.status).toBe(200);
      expect(consume).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith(
        555,
        "Abre el enlace de Milton en un chat privado con el bot."
      );
    }
  );
  it("private chat: the code is consumed", async () => {
    await webhook(update("private"));
    expect(consume).toHaveBeenCalledWith("CODE12345678", 555);
  });
});

describe("disconnect and pairing code are owner/admin only", () => {
  it.each(["manager", "analyst", "viewer", "member", null])(
    "role %s → 403, nothing is changed",
    async (r) => {
      role = r;
      const res = await disconnectRoute();
      expect(res.status).toBe(403);
      expect(disconnect).not.toHaveBeenCalled();
      const issued = await pairingCodeRoute();
      expect(issued.status).toBe(403);
      expect(createCode).not.toHaveBeenCalled();
    }
  );
  it.each(["owner", "admin"])(
    "role %s → disconnects THIS company and tells the old chat",
    async (r) => {
      role = r;
      const res = await disconnectRoute();
      expect(res.status).toBe(200);
      expect(disconnect).toHaveBeenCalledWith("co-1"); // from auth, never from the client
      expect(send).toHaveBeenCalledWith(
        555,
        "Este chat ya no recibe los briefings de Milton."
      );
      expect((await pairingCodeRoute()).status).toBe(200);
    }
  );
});
