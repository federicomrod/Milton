// The extract and from-extraction routes keep their status codes and body
// shapes after their logic moved to lib/restaurant/invoice-draft.
// Synthetic data only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";

const world = vi.hoisted(() => ({
  store: {} as Record<string, Record<string, unknown>[]>,
  denied: false,
  completion: null as unknown,
  throwOpenAI: null as string | null,
}));

vi.mock("@/lib/restaurant/api-auth", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  return {
    authAndCompany: async () => ({
      ok: true,
      supabase: makeFakeDb(world.store),
      companyId: "co-1",
      userId: "u-1",
    }),
  };
});
vi.mock("@/lib/auth/permissions", () => ({
  resolveActor: async () => ({}),
  requireCapability: () =>
    world.denied
      ? new Response(JSON.stringify({ error: "no" }), { status: 403 })
      : null,
}));
vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: async () => {
          if (world.throwOpenAI) throw new Error(world.throwOpenAI);
          return world.completion;
        },
      },
    };
  }
  return { OpenAI, default: OpenAI };
});

import { POST as extractPOST } from "@/app/api/restaurant/invoices/extract/route";
import { POST as fromPOST } from "@/app/api/restaurant/invoices/from-extraction/route";

const goodModel = {
  supplier_name: " Proveedor Demo ",
  invoice_number: "A-1",
  invoice_date: "2026-03-04",
  due_date: null,
  currency: "usd",
  subtotal: null,
  tax_amount: null,
  total_amount: null,
  lines: [
    {
      description: "Aguacate",
      supplier_item_name: null,
      supplier_sku: null,
      quantity: 10,
      unit: "kg",
      unit_cost: null,
      line_total: 20,
      tax_amount: null,
      confidence: "high",
      confidence_notes: null,
    },
  ],
  confidence_notes: [],
};
const reply = (content: string) => ({
  choices: [{ message: { content } }],
});

function upload(type: string, bytes = 8, name = "foto.png") {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return new NextRequest("http://localhost/api/restaurant/invoices/extract", {
    method: "POST",
    body: fd,
  });
}
const jsonReq = (body: unknown) =>
  new NextRequest("http://localhost/api/restaurant/invoices/from-extraction", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  world.store = {};
  world.denied = false;
  world.throwOpenAI = null;
  world.completion = reply(JSON.stringify(goodModel));
  process.env.OPENAI_API_KEY = "test-key";
});

describe("POST /invoices/extract", () => {
  it("success: 200 with extraction, original_file_name, source_type", async () => {
    const res = await extractPOST(upload("image/png"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "extraction",
      "original_file_name",
      "source_type",
    ]);
    expect(body.original_file_name).toBe("foto.png");
    expect(body.source_type).toBe("image");
    expect(body.extraction.supplier_name).toBe("Proveedor Demo");
    expect(body.extraction.currency).toBe("USD");
    expect(body.extraction.lines[0]).toMatchObject({
      derived_unit_cost: true,
      unit_cost: 2,
      missing_line_total: false,
    });
  });

  it("403 without prices.edit", async () => {
    world.denied = true;
    expect((await extractPOST(upload("image/png"))).status).toBe(403);
  });

  it("400 empty file, 415 pdf and other types", async () => {
    let res = await extractPOST(upload("image/png", 0));
    expect([res.status, (await res.json()).error]).toEqual([400, "Empty file"]);
    res = await extractPOST(upload("application/pdf"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/^PDF extraction will be added/);
    res = await extractPOST(upload("text/plain"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/^Unsupported file type/);
  });

  it("400 when the file is over 10 MB", async () => {
    const res = await extractPOST(upload("image/png", 10 * 1024 * 1024 + 1));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("File too large (max 10 MB)");
  });

  it("502 with the same messages for each upstream failure", async () => {
    world.completion = reply("");
    let res = await extractPOST(upload("image/png"));
    expect([res.status, (await res.json()).error]).toEqual([
      502,
      "Model returned no content.",
    ]);
    world.completion = reply("not json");
    res = await extractPOST(upload("image/png"));
    expect((await res.json()).error).toBe(
      "Model output was not valid JSON. Try a clearer image."
    );
    world.completion = reply('{"lines": 3}');
    res = await extractPOST(upload("image/png"));
    expect((await res.json()).error).toBe(
      "Model output did not match the invoice extraction schema."
    );
    world.throwOpenAI = "boom";
    res = await extractPOST(upload("image/png"));
    expect([res.status, (await res.json()).error]).toEqual([
      502,
      "OpenAI call failed: boom",
    ]);
    delete process.env.OPENAI_API_KEY;
    res = await extractPOST(upload("image/png"));
    expect([res.status, (await res.json()).error]).toEqual([
      502,
      "OpenAI API key is not configured on the server.",
    ]);
  });
});

describe("POST /invoices/from-extraction", () => {
  it("success: 200 { invoice, lines_inserted, auto_matched, unmatched }", async () => {
    const res = await fromPOST(jsonReq({ extraction: goodModel }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "auto_matched",
      "invoice",
      "lines_inserted",
      "unmatched",
    ]);
    expect(body).toMatchObject({
      lines_inserted: 1,
      auto_matched: 0,
      unmatched: 1,
    });
    expect(body.invoice).toMatchObject({
      status: "needs_review",
      source_type: "image",
      created_by_user_id: "u-1",
    });
    const events = world.store.invoice_events;
    expect(events.map((e) => e.event_type)).toEqual(["uploaded", "created"]);
    expect(events[1].metadata).toEqual({ source: "ai_extraction" });
    expect(world.store.ingredient_cost_entries ?? []).toHaveLength(0);
  });

  it("keeps coercing missing numbers (quantity 1, unit, total 0)", async () => {
    const bare = {
      ...goodModel,
      lines: [
        {
          ...goodModel.lines[0],
          quantity: null,
          unit: null,
          line_total: null,
        },
      ],
    };
    await fromPOST(jsonReq({ extraction: bare }));
    expect(world.store.supplier_invoice_lines[0]).toMatchObject({
      quantity: 1,
      unit: "unit",
      line_total: 0,
    });
  });

  it("403 without prices.edit", async () => {
    world.denied = true;
    expect((await fromPOST(jsonReq({ extraction: goodModel }))).status).toBe(
      403
    );
  });

  it("400 for bad JSON, bad schema, no date, no lines", async () => {
    const bad = new NextRequest("http://localhost/x", {
      method: "POST",
      body: "{",
    });
    let res = await fromPOST(bad);
    expect([res.status, (await res.json()).error]).toEqual([
      400,
      "Body must be JSON",
    ]);
    res = await fromPOST(jsonReq({ extraction: { lines: 1 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(
      /^extraction did not match the invoice extraction schema/
    );
    res = await fromPOST(
      jsonReq({ extraction: { ...goodModel, invoice_date: null } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^invoice_date is required/);
    res = await fromPOST(jsonReq({ extraction: { ...goodModel, lines: [] } }));
    expect([res.status, (await res.json()).error]).toEqual([
      400,
      "At least one line is required.",
    ]);
    expect(world.store.supplier_invoices ?? []).toHaveLength(0);
  });

  it("500 shapes when the database refuses", async () => {
    const store: FakeStore = world.store;
    const failing = makeFakeDb(store, {
      fail: (table) => table === "supplier_invoices",
    });
    const mod = await import("@/lib/restaurant/api-auth");
    const spy = vi.spyOn(mod, "authAndCompany").mockResolvedValue({
      ok: true,
      supabase: failing,
      companyId: "co-1",
      userId: "u-1",
    } as never);
    const res = await fromPOST(jsonReq({ extraction: goodModel }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Could not create invoice",
      details: "forced failure",
    });
    spy.mockRestore();
  });
});
