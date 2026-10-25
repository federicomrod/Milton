// Telegram webhook: photos (invoice / recipe / ask), the «factura» / «receta»
// follow-up, and price updates by text or voice. Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PRICE_UPDATE_NOTE_PREFIX } from "@/lib/restaurant/price-update-note";
import { makeFakeDb, type FakeStore, type Row } from "./helpers/fake-db";

const store: FakeStore = {};
const afterJobs: Promise<unknown>[] = [];
const replies: string[] = [];
const extractInvoice = vi.fn();
const classify = vi.fn();
const extractRecipe = vi.fn();
const openFile = vi.fn();
let transcript = "";
let failInvoiceInsert = false;
let failLinesInsert = false;
let failReread = false;
let isCook = true;

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
  sendTelegramMessage: async (_c: number, text: string) => {
    replies.push(text);
    return { ok: true };
  },
  TelegramConfigError: class extends Error {},
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    makeFakeDb(store, {
      fail: (table, mode) =>
        (failInvoiceInsert &&
          table === "supplier_invoices" &&
          mode === "insert") ||
        (failLinesInsert &&
          table === "supplier_invoice_lines" &&
          mode === "insert") ||
        (failReread && table === "supplier_invoices" && mode === "select"),
    }),
}));
vi.mock("@/lib/restaurant/telegram/files", () => ({
  openTelegramFile: (...a: unknown[]) => openFile(...a),
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
vi.mock("@/lib/restaurant/telegram/kitchen-links", () => ({
  listActiveLinks: async () =>
    isCook
      ? [
          {
            staffId: "st-1",
            companyId: "co-1",
            companyName: "Demo Resto",
            locationId: "loc-1",
            locationName: "Local Centro",
            telegramUserId: 9,
          },
        ]
      : [],
  validateLink: async () => null,
}));
vi.mock("@/lib/restaurant/telegram/kitchen-reports", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/restaurant/telegram/kitchen-reports")
    >();
  let clock = Date.now() - 60_000;
  return {
    ...actual,
    // Same contract as the real one: false on a duplicate delivery.
    recordKitchenReport: async (input: {
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
      clock += 1000;
      rows.push({
        id: `kr-${rows.length + 1}`,
        company_id: "co-1",
        staff_id: "st-1",
        telegram_chat_id: input.chatId,
        created_at: new Date(clock).toISOString(),
        ...input.report,
      });
      return true;
    },
  };
});

import { POST } from "@/app/api/telegram/webhook/route";
import { resetOwnerChatGuidance } from "@/lib/restaurant/telegram/owner-chat-guidance";
import { KITCHEN_COPY } from "@/lib/restaurant/telegram/kitchen-copy";
import { localDateKey } from "@/lib/restaurant/telegram/kitchen-media";

let nextId = 500;
const CHAT = 4242;
// 2026-03-05T03:30:00Z = 2026-03-04 21:30 in El Salvador (UTC-6).
const NIGHT_UTC = Date.parse("2026-03-05T03:30:00Z") / 1000;

async function send(extra: Record<string, unknown>, id = ++nextId) {
  const req = new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret" },
    body: JSON.stringify({
      message: {
        message_id: id,
        date: NIGHT_UTC,
        from: { id: 9, first_name: "Ana" },
        chat: { id: CHAT, type: "private" },
        ...extra,
      },
    }),
  });
  const res = await POST(req);
  await Promise.all(afterJobs.splice(0));
  return res;
}
const photo = (id = "file-" + nextId) => ({
  photo: [{ file_id: id, width: 100, height: 100 }],
});

function goodExtraction(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    extraction: {
      supplier_name: "Proveedor Demo",
      invoice_number: "A-1",
      invoice_date: "2026-03-01",
      due_date: null,
      currency: null,
      subtotal: null,
      tax_amount: null,
      total_amount: null,
      confidence_notes: [],
      lines: [
        {
          description: "Aguacate",
          supplier_item_name: null,
          supplier_sku: null,
          quantity: 10,
          unit: "lb",
          unit_cost: 1.5,
          line_total: 15,
          tax_amount: null,
        },
      ],
      ...over,
    },
  };
}

const invoices = () => store.supplier_invoices ?? [];
const lastReply = () => replies[replies.length - 1];

const consoleCalls: string[] = [];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  afterJobs.length = 0;
  replies.length = 0;
  consoleCalls.length = 0;
  transcript = "";
  failInvoiceInsert = false;
  failLinesInsert = false;
  failReread = false;
  isCook = true;
  resetOwnerChatGuidance();
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
  process.env.OPENAI_API_KEY = "test-key";
  extractInvoice.mockReset().mockResolvedValue(goodExtraction());
  classify.mockReset().mockResolvedValue({
    ok: true,
    kind: "other",
    confidence: "high",
  });
  extractRecipe.mockReset().mockResolvedValue({ ok: true, draftId: "d-1" });
  openFile.mockReset().mockImplementation(async () => ({
    ok: true,
    contentLength: "4",
    body: new Response(new Uint8Array([1, 2, 3, 4])).body,
  }));
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(args.map(String).join(" "));
    });
  }
});

describe("photo routing", () => {
  it("caption «receta» goes to the recipe draft, no classifier, no immediate ACK", async () => {
    await send({ ...photo(), caption: "Receta de la casa" });
    expect(classify).not.toHaveBeenCalled();
    expect(extractRecipe).toHaveBeenCalledTimes(1);
    expect(extractRecipe.mock.calls[0][0]).toMatchObject({
      mediaKind: "photo",
      companyId: "co-1",
    });
    expect(replies.join("|")).not.toContain("Se lo pasamos");
  });

  it.each(["factura", "Boleta de hoy", "recibo", "ticket", "compra del día"])(
    "caption «%s» goes to the invoice path",
    async (caption) => {
      await send({ ...photo(), caption });
      expect(classify).not.toHaveBeenCalled();
      expect(extractInvoice).toHaveBeenCalledTimes(1);
      expect(invoices()).toHaveLength(1);
    }
  );

  it("a report caption (merma) gets the report ACK and no vision call", async () => {
    await send({ ...photo(), caption: "merma de tomate" });
    expect(classify).not.toHaveBeenCalled();
    expect(extractInvoice).not.toHaveBeenCalled();
    expect(extractRecipe).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Recibido, gracias");
  });

  it("no caption + classifier invoice: invoice draft, a single reply (no immediate ACK)", async () => {
    classify.mockResolvedValue({
      ok: true,
      kind: "invoice",
      confidence: "high",
    });
    await send(photo());
    expect(classify).toHaveBeenCalledTimes(1);
    expect(invoices()).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(extractInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ notesLanguage: "es" })
    );
    expect(replies[0]).toContain("Guardé la factura de Proveedor Demo");
    expect(replies[0]).toContain("en Demo Resto › Local Centro");
    expect(replies[0]).toContain("leí 1 línea");
  });

  it("no caption + classifier recipe (medium): recipe draft", async () => {
    classify.mockResolvedValue({
      ok: true,
      kind: "recipe",
      confidence: "medium",
    });
    await send(photo());
    expect(extractRecipe).toHaveBeenCalledTimes(1);
    expect(extractRecipe.mock.calls[0][0].mediaKind).toBe("photo");
    expect(invoices()).toHaveLength(0);
  });

  it.each([
    ["other", { ok: true, kind: "other", confidence: "high" }],
    ["low confidence", { ok: true, kind: "invoice", confidence: "low" }],
    ["error", { ok: false, reason: "timeout" }],
  ])("classifier %s asks «¿factura o receta?»", async (_n, verdict) => {
    classify.mockResolvedValue(verdict);
    await send(photo());
    expect(replies).toEqual([
      "✅ Recibí la foto. ¿Es una factura o una receta? Responde «factura» o «receta».",
    ]);
    expect(invoices()).toHaveLength(0);
    expect(extractRecipe).not.toHaveBeenCalled();
  });

  it("an image document is read like a photo; a PDF is not", async () => {
    await send({
      document: {
        file_id: "doc-1",
        mime_type: "image/png",
        file_name: "a.png",
      },
      caption: "factura",
    });
    expect(invoices()).toHaveLength(1);
    expect(store.kitchen_reports?.[0]).toMatchObject({
      media_kind: "photo",
      telegram_file_id: "doc-1",
      media_mime: "image/png",
    });

    replies.length = 0;
    await send({
      document: { file_id: "doc-2", mime_type: "application/pdf" },
      caption: "factura",
    });
    expect(store.kitchen_reports).toHaveLength(1);
    expect(replies).toEqual([]);
    expect(extractInvoice).toHaveBeenCalledTimes(1);
  });
});

describe("«factura» / «receta» follow-up", () => {
  it("reprocesses the most recent undecided photo exactly once", async () => {
    await send(photo("old"), 1001);
    await send(photo("new"), 1002);
    expect(replies).toHaveLength(2);
    replies.length = 0;

    await send({ text: "Factura." });
    expect(extractInvoice).toHaveBeenCalledTimes(1);
    expect(invoices()).toHaveLength(1);
    expect(
      (store.invoice_events as Row[])[0].metadata as Record<string, unknown>
    ).toMatchObject({ kitchen_report_id: "kr-2", source: "telegram" });
    expect(lastReply()).toContain("Guardé la factura");

    // The same word again goes to the OLDER photo (the newest is decided).
    await send({ text: "factura" });
    expect(invoices()).toHaveLength(2);
    // Nothing left: ordinary behaviour (stored as a report, ACK), no 3rd invoice.
    await send({ text: "factura" });
    expect(invoices()).toHaveLength(2);
    expect(extractInvoice).toHaveBeenCalledTimes(2);
  });

  it("«receta» reprocesses the photo as a recipe once", async () => {
    await send(photo("p1"), 2001);
    await send({ text: "RECETA!" });
    expect(extractRecipe).toHaveBeenCalledTimes(1);
    expect(extractRecipe.mock.calls[0][0]).toMatchObject({
      mediaKind: "photo",
      messageId: 2001,
      telegramFileId: "p1",
    });
  });

  it("does nothing special when no photo is pending", async () => {
    await send({ text: "factura" });
    expect(extractInvoice).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Recibido, gracias");
  });

  it("ignores a photo older than 30 minutes", async () => {
    await send(photo("p1"), 3001);
    (store.kitchen_reports as Row[])[0].created_at = new Date(
      Date.now() - 31 * 60 * 1000
    ).toISOString();
    await send({ text: "factura" });
    expect(extractInvoice).not.toHaveBeenCalled();
  });

  it("does not pick a photo that already has a recipe draft", async () => {
    await send(photo("p1"), 4001);
    (store.kitchen_recipe_drafts ??= []).push({
      id: "d-9",
      kitchen_report_id: "kr-1",
    });
    await send({ text: "receta" });
    // Falls through to the old text behaviour; the photo is not reprocessed.
    expect(
      extractRecipe.mock.calls.filter((c) => c[0].mediaKind === "photo")
    ).toHaveLength(0);
  });
});

describe("invoice path (Telegram, strict)", () => {
  it("stores only really-read lines, unpriced ones go to the notes", async () => {
    extractInvoice.mockResolvedValue(
      goodExtraction({
        lines: [
          goodExtraction().extraction.lines[0],
          {
            description: "Cilantro",
            supplier_item_name: null,
            supplier_sku: null,
            quantity: 2,
            unit: "atado",
            unit_cost: null,
            line_total: null,
            tax_amount: null,
          },
          {
            description: "Limón",
            supplier_item_name: null,
            supplier_sku: null,
            quantity: null,
            unit: null,
            unit_cost: 3,
            line_total: null,
            tax_amount: null,
          },
        ],
      })
    );
    await send({ ...photo(), caption: "factura" });
    const lines = store.supplier_invoice_lines as Row[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 10, line_total: 15 });
    expect(lines.some((l) => l.line_total === 0)).toBe(false);
    expect(invoices()[0]).toMatchObject({
      status: "needs_review",
      source_type: "image",
      created_by_user_id: null,
      original_file_name: expect.stringMatching(/^telegram-\d+\.jpg$/),
    });
    expect(String(invoices()[0].notes)).toContain(
      "Líneas sin precio (leídas de la foto): Cilantro"
    );
    expect(String(invoices()[0].notes)).toContain(
      "Líneas sin cantidad (leídas de la foto): Limón"
    );
    expect(String(invoices()[0].notes)).toContain(
      "Factura enviada por Telegram. Valores leídos de la foto: revisa antes de aprobar."
    );
    expect(lastReply()).toContain(
      "1 línea quedó sin precio. 1 línea quedó sin cantidad."
    );
    expect(store.ingredient_cost_entries ?? []).toHaveLength(0);
  });

  it("a missing date uses the message date in the company's local zone, with a note", async () => {
    store.restaurant_pos_connections = [
      { company_id: "co-1", is_active: true, timezone: "America/El_Salvador" },
    ];
    extractInvoice.mockResolvedValue(goodExtraction({ invoice_date: null }));
    await send({ ...photo(), caption: "factura" });
    expect(invoices()[0].invoice_date).toBe("2026-03-04");
    expect(String(invoices()[0].notes)).toContain(
      "No se leyó la fecha en la foto"
    );
  });

  it("a duplicate delivery creates no second invoice or reply", async () => {
    await send({ ...photo(), caption: "factura" }, 777);
    await send({ ...photo(), caption: "factura" }, 777);
    expect(invoices()).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(extractInvoice).toHaveBeenCalledTimes(1);
  });

  it("the same report is never invoiced twice (existing invoice event)", async () => {
    await send({ ...photo(), caption: "factura" }, 778);
    await send({ text: "factura" });
    expect(invoices()).toHaveLength(1);
  });

  it("unreadable: INVOICE_UNREADABLE and no invoice", async () => {
    extractInvoice.mockResolvedValue({
      ok: false,
      reason: "timeout",
      message: "x",
    });
    await send({ ...photo(), caption: "factura" });
    expect(replies).toEqual([
      "No pude leer la factura. Manda otra foto: que se vea completa, de frente y con buena luz.",
    ]);
    expect(invoices()).toHaveLength(0);
  });

  it("no usable lines and a failed download are unreadable too", async () => {
    extractInvoice.mockResolvedValue(
      goodExtraction({
        lines: [
          {
            description: "Cilantro",
            supplier_item_name: null,
            supplier_sku: null,
            quantity: 1,
            unit: "atado",
            unit_cost: null,
            line_total: null,
            tax_amount: null,
          },
        ],
      })
    );
    await send({ ...photo(), caption: "factura" });
    expect(invoices()).toHaveLength(0);
    expect(lastReply()).toContain("No pude leer la factura");

    openFile.mockResolvedValue({ ok: false, error: "x" });
    await send({ ...photo(), caption: "factura" });
    expect(lastReply()).toContain("No pude leer la factura");
    expect(invoices()).toHaveLength(0);
  });

  it("a file over the 20 MB bot limit is unreadable without calling vision", async () => {
    openFile.mockResolvedValue({
      ok: true,
      contentLength: String(21 * 1024 * 1024),
      body: new Response(new Uint8Array([1])).body,
    });
    await send({ ...photo(), caption: "factura" });
    expect(extractInvoice).not.toHaveBeenCalled();
    expect(lastReply()).toContain("No pude leer la factura");
  });
});

describe("invoice destination and honest failures", () => {
  const invoiceReq = () => send({ ...photo(), caption: "factura" });

  it("saves in the cook's company and names the destination", async () => {
    await invoiceReq();
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({
      company_id: "co-1",
      status: "needs_review",
      source_type: "image",
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Demo Resto › Local Centro");
    expect(replies[0]).toContain("Queda como borrador en Costos › Compras");
    expect(store.ingredient_cost_entries ?? []).toHaveLength(0);
    expect(
      consoleCalls.some((c) =>
        /^\[kitchen-media\] invoice draft saved id=\S+ company=co-1 lines=1 unpriced=0/.test(
          c
        )
      )
    ).toBe(true);
  });

  it("an unpriced line is listed in the notes and the reply says so", async () => {
    extractInvoice.mockResolvedValue(
      goodExtraction({
        lines: [
          goodExtraction().extraction.lines[0],
          {
            description: "Cilantro",
            supplier_item_name: null,
            supplier_sku: null,
            quantity: 2,
            unit: "atado",
            unit_cost: null,
            line_total: null,
            tax_amount: null,
          },
        ],
      })
    );
    await invoiceReq();
    expect(store.supplier_invoice_lines).toHaveLength(1);
    expect(String(invoices()[0].notes)).toContain("Cilantro");
    expect(lastReply()).toContain("1 línea quedó sin precio.");
  });

  it("header insert error: INVOICE_SAVE_FAILED, never the success copy", async () => {
    failInvoiceInsert = true;
    await invoiceReq();
    expect(replies).toEqual([KITCHEN_COPY.INVOICE_SAVE_FAILED]);
    expect(invoices()).toHaveLength(0);
    expect(
      consoleCalls.some((c) =>
        c.includes("[kitchen-media] invoice save failed reason=invoice_failed")
      )
    ).toBe(true);
  });

  it("lines insert error: the orphan header is deleted and INVOICE_SAVE_FAILED is sent", async () => {
    failLinesInsert = true;
    await invoiceReq();
    expect(replies).toEqual([KITCHEN_COPY.INVOICE_SAVE_FAILED]);
    expect(invoices()).toHaveLength(0);
    expect(store.invoice_events ?? []).toHaveLength(0);
    expect(
      consoleCalls.some((c) =>
        c.includes("[kitchen-media] invoice save failed reason=lines_failed")
      )
    ).toBe(true);
  });

  it("re-read finds nothing: INVOICE_SAVE_FAILED", async () => {
    failReread = true;
    await invoiceReq();
    expect(replies).toEqual([KITCHEN_COPY.INVOICE_SAVE_FAILED]);
    expect(consoleCalls.some((c) => c.includes("reason=reread_failed"))).toBe(
      true
    );
  });

  it("currency mismatch gets its own message", async () => {
    extractInvoice.mockResolvedValue(goodExtraction({ currency: "EUR" }));
    await invoiceReq();
    expect(replies).toEqual([KITCHEN_COPY.INVOICE_CURRENCY_MISMATCH]);
    expect(invoices()).toHaveLength(0);
  });

  it("extraction failure stays INVOICE_UNREADABLE", async () => {
    extractInvoice.mockResolvedValue({
      ok: false,
      reason: "timeout",
      message: "x",
    });
    await invoiceReq();
    expect(replies).toEqual([KITCHEN_COPY.INVOICE_UNREADABLE]);
  });

  it("logs carry ids and reasons only", async () => {
    failInvoiceInsert = true;
    await invoiceReq();
    const logged = consoleCalls.join("\n");
    for (const needle of ["https://", "data:image", "test-key", "s3cret"]) {
      expect(logged).not.toContain(needle);
    }
  });
});

describe("recipe and photo failures", () => {
  it("recipe extraction failure: RECIPE_SAVE_FAILED", async () => {
    extractRecipe.mockResolvedValue({ ok: false, error: "Create failed" });
    await send({ ...photo(), caption: "receta" });
    expect(replies).toEqual([KITCHEN_COPY.RECIPE_SAVE_FAILED]);
  });

  it("recipe received names the destination", async () => {
    await send({ ...photo(), caption: "receta" });
    expect(lastReply()).toContain("en Cocina de Demo Resto › Local Centro");
  });

  it("a thrown error while processing a photo sends the generic failure, not PHOTO_ASK_KIND", async () => {
    classify.mockRejectedValue(new Error("boom"));
    await send(photo());
    expect(replies).toEqual([KITCHEN_COPY.PHOTO_PROCESS_FAILED]);
  });
});

describe("owner-paired chat that is not a cook", () => {
  beforeEach(() => {
    isCook = false;
    store.restaurant_telegram_connections = [
      { id: "c1", company_id: "co-1", chat_id: CHAT, is_active: true },
    ];
    store.companies = [{ id: "co-1", name: "Demo Resto" }];
  });

  it("answers once with guidance, writes nothing, then stays quiet for 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await send({ ...photo(), caption: "factura" });
      expect(replies).toEqual([
        "Este chat recibe el briefing de Demo Resto. Para mandar facturas, recetas o precios, escanea el QR de cocina en Milton (Cocina › Equipo de cocina) con este Telegram.",
      ]);
      expect(invoices()).toHaveLength(0);
      expect(store.kitchen_reports ?? []).toHaveLength(0);
      expect(extractInvoice).not.toHaveBeenCalled();

      await send({ ...photo(), caption: "factura" });
      expect(replies).toHaveLength(1);

      vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
      await send({ ...photo(), caption: "factura" });
      expect(replies).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unknown sender in an unpaired chat gets silence", async () => {
    store.restaurant_telegram_connections = [];
    await send({ ...photo(), caption: "factura" });
    expect(replies).toEqual([]);
    expect(invoices()).toHaveLength(0);
  });
});

describe("briefing pairing: chat already connected", () => {
  it("replies in Spanish without naming any restaurant", async () => {
    const pairing = await import("@/lib/restaurant/telegram/pairing");
    vi.spyOn(pairing, "consumePairingCode").mockResolvedValue({
      ok: false,
      reason: "chat_already_connected",
    });
    await send({ text: "/start ABCDEFGHIJKL" });
    expect(replies).toEqual([KITCHEN_COPY.BRIEFING_CHAT_ALREADY_CONNECTED]);
  });
});

describe("price updates", () => {
  it("text: needs_review draft, nothing applied, no REPORT_ACK", async () => {
    await send({ text: "el aguacate subió a 1.50 la libra" });
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({
      status: "needs_review",
      source_type: "manual",
      supplier_id: null,
    });
    expect(
      String(invoices()[0].notes).startsWith(PRICE_UPDATE_NOTE_PREFIX)
    ).toBe(true);
    expect(store.supplier_invoice_lines?.[0]).toMatchObject({
      description: "aguacate",
      quantity: 1,
      unit: "lb",
      unit_cost: 1.5,
      line_total: 1.5,
    });
    expect((store.invoice_events as Row[]).map((e) => e.metadata)).toEqual([
      expect.objectContaining({ kind: "price_update", source: "telegram" }),
      expect.objectContaining({ kind: "price_update", source: "telegram" }),
    ]);
    expect(store.ingredient_cost_entries ?? []).toHaveLength(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain(
      "Anoté en Demo Resto: aguacate $1.50 la libra."
    );
    expect(replies[0]).not.toContain("Se lo pasamos");
  });

  it("a failed save answers PRICE_SAVE_FAILED, never the «no entendí» copy", async () => {
    failInvoiceInsert = true;
    await send({ text: "el aguacate subió a 1.50 la libra" });
    expect(replies).toEqual([
      "No pude guardar el precio. Vuelve a mandarlo en un momento.",
    ]);
    expect(invoices()).toHaveLength(0);
  });

  it("the reply shows the company's currency symbol and the unit as a person says it", async () => {
    await send({
      text: "el tomate subió a 0.80 el kilo y el aguacate a 1.50 la libra",
    });
    expect(replies[0]).toContain(
      "tomate $0.80 el kilo, aguacate $1.50 la libra"
    );
  });

  it("unclear: asks for price and unit, no draft", async () => {
    await send({ text: "el aguacate subió" });
    expect(replies).toEqual([
      "No entendí el precio. Escribe producto, precio y unidad, por ejemplo: «aguacate $1.50 la libra».",
    ]);
    expect(invoices()).toHaveLength(0);
  });

  it("duplicate delivery creates one draft and one reply", async () => {
    await send({ text: "el aguacate subió a 1.50 la libra" }, 900);
    await send({ text: "el aguacate subió a 1.50 la libra" }, 900);
    expect(invoices()).toHaveLength(1);
    expect(replies).toHaveLength(1);
  });

  it("the message date becomes the company-local date", async () => {
    store.restaurant_pos_connections = [
      { company_id: "co-1", is_active: true, timezone: "America/El_Salvador" },
    ];
    await send({ text: "el aguacate subió a 1.50 la libra" });
    expect(invoices()[0].invoice_date).toBe("2026-03-04");
  });

  it("voice: report words win, then price, then recipe, else ACK", async () => {
    const voice = { voice: { file_id: "v1", duration: 3 } };

    transcript = "se acabó el aguacate";
    await send(voice);
    expect(replies.pop()).toContain("Recibido, gracias");
    expect(invoices()).toHaveLength(0);

    transcript = "el aguacate subió a 1.50 la libra";
    await send(voice);
    expect(invoices()).toHaveLength(1);
    expect(lastReply()).not.toContain("(de tu nota de voz)");
    expect(extractRecipe).not.toHaveBeenCalled();

    transcript = "receta de pollo con arroz para 2 porciones";
    await send(voice);
    expect(extractRecipe).toHaveBeenCalledTimes(1);
    expect(invoices()).toHaveLength(1);

    replies.length = 0;
    transcript = "buenos días a todos";
    await send(voice);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Recibido, gracias");

    transcript = "subió el aguacate";
    await send(voice);
    expect(lastReply()).toContain("No entendí el precio");
    expect(invoices()).toHaveLength(1);
  });
});

describe("local date helper", () => {
  it("converts near midnight in a non-UTC zone", () => {
    expect(localDateKey(NIGHT_UTC, "America/El_Salvador")).toBe("2026-03-04");
    expect(localDateKey(NIGHT_UTC, "UTC")).toBe("2026-03-05");
    expect(localDateKey(NIGHT_UTC, "Asia/Tokyo")).toBe("2026-03-05");
    expect(localDateKey(NIGHT_UTC, "Not/AZone")).toBe("2026-03-05");
  });
});

describe("safety", () => {
  it("never writes prices and never logs tokens, URLs, content or transcripts", async () => {
    transcript = "el aguacate subió a 1.50 la libra";
    await send({ voice: { file_id: "v-secret", duration: 2 } });
    classify.mockResolvedValue({ ok: false, reason: "upstream" });
    await send(photo("photo-secret-id"));
    await send({ ...photo("photo-secret-id-2"), caption: "factura" });
    const logged = consoleCalls.join("\n");
    for (const needle of [
      "aguacate",
      "photo-secret-id",
      "v-secret",
      "https://",
      "data:image",
      "test-key",
      "s3cret",
    ]) {
      expect(logged).not.toContain(needle);
    }
    expect(store.ingredient_cost_entries ?? []).toHaveLength(0);
  });

  it("kitchen-media never calls the price writers", () => {
    const src = readFileSync(
      "lib/restaurant/telegram/kitchen-media.ts",
      "utf8"
    ).replace(/\/\/.*$/gm, "");
    for (const banned of [
      "setIngredientPrice",
      "addCostEntry",
      "ingredient_cost_entries",
    ]) {
      expect(src).not.toContain(banned);
    }
  });
});
