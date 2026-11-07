// The routes are thin: they authorize, validate the shape, and hand ONE command
// to the database. Nothing the browser sends can name a company, a total, a
// previous value or a provenance. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let role: string | null = "manager";
const calls: Array<{ fn: string; args: any }> = [];
let result: any;

vi.mock("@/lib/restaurant/api-lang", () => ({ apiLanguage: async () => "es" }));
vi.mock("@/lib/restaurant/fixed-costs-auth", () => ({
  authorizeFixedCosts: async () => ({
    ok: true,
    supabase: {},
    companyId: "company-from-session",
    userId: "u1",
    actor: {
      userId: "u1",
      companyId: "company-from-session",
      role,
      isMiltonStaff: false,
    },
  }),
}));
vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  resolveRestaurantContext: async (
    _s: unknown,
    _c: string,
    wanted: string | null
  ) =>
    wanted === "00000000-0000-4000-8000-00000000000a"
      ? { selected: { locationId: wanted, brandId: null }, locations: [] }
      : { selected: null, locations: [] },
}));
vi.mock("@/lib/restaurant/fixed-cost-upload-server", () => ({
  getDraft: async () => ({ id: "d1", version: 3, status: "draft", lines: [] }),
}));
vi.mock("@/lib/restaurant/fixed-cost-commands", async (orig) => {
  const real =
    await orig<typeof import("@/lib/restaurant/fixed-cost-commands")>();
  const spy = (fn: string) => async (_ctx: unknown, args: any) => {
    calls.push({ fn, args });
    return result;
  };
  return {
    ...real,
    approveUpload: spy("approveUpload"),
    previewUpload: spy("previewUpload"),
    undoCommand: spy("undoCommand"),
    copyMonth: spy("copyMonth"),
    previewCopy: spy("previewCopy"),
    saveTotals: spy("saveTotals"),
  };
});

import { POST as approve } from "@/app/api/restaurant/fixed-costs/upload/approve/route";
import { POST as undo } from "@/app/api/restaurant/fixed-costs/upload/undo/route";
import { GET as previewGET } from "@/app/api/restaurant/fixed-costs/upload/preview/route";
import {
  GET as copyGET,
  POST as copyPOST,
} from "@/app/api/restaurant/fixed-costs/copy/route";
import { es } from "@/lib/i18n/es";

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const OK = { ok: true, value: { status: "applied" } };
const KEY = "11111111-1111-4111-8111-111111111111";
const UUID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  role = "manager";
  calls.length = 0;
  result = OK;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("approve", () => {
  const body = {
    draftId: "d1",
    draftVersion: 3,
    commandKey: KEY,
    expected: { "group|2026-10-01|servicios": 0, bad: "x" },
    lineIds: ["l1", 7, "l2"],
    decisions: { l1: "replace", l2: "evil", l3: "add" },
    // everything below is something a forged request might try
    companyId: "someone-else",
    total: 1,
    previous: { amount: 1 },
  };

  it("hands the database only validated ids, versions and decisions; the company is the session's", async () => {
    const res = await approve(post("/x", body));
    expect(res.status).toBe(200);
    expect(calls[0]!.fn).toBe("approveUpload");
    expect(calls[0]!.args).toEqual({
      commandKey: KEY,
      draftId: "d1",
      expectedDraftVersion: 3,
      expected: { "group|2026-10-01|servicios": 0 },
      lineIds: ["l1", "l2"],
      decisions: { l1: "replace", l3: "add" },
    });
    expect(JSON.stringify(calls[0]!.args)).not.toMatch(/someone-else|previous/);
  });

  it("a request without the reviewed versions or a command key is refused before the database", async () => {
    for (const bad of [
      { draftId: "d1" },
      { ...body, commandKey: undefined },
      { ...body, draftVersion: "3" },
      { ...body, expected: undefined },
    ]) {
      const res = await approve(post("/x", bad));
      expect(res.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("an overlap is a 409 with the choices and nothing is written", async () => {
    result = {
      ok: true,
      value: { status: "needs_decision", conflicts: [{ lineId: "l1" }] },
    };
    const res = await approve(post("/x", body));
    expect(res.status).toBe(409);
    expect((await res.json()).conflicts).toEqual([{ lineId: "l1" }]);
  });

  it("a stale review is a 409 that says to reload", async () => {
    result = { ok: false, failure: "stale", reason: "stale_version" };
    const res = await approve(post("/x", body));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.stale).toBe(true);
    expect(j.error).toBe(es.costs.fixed.staleReload);
  });

  it("another company's or missing draft looks the same: 404", async () => {
    result = { ok: false, failure: "not_found", reason: "not_found" };
    expect((await approve(post("/x", body))).status).toBe(404);
  });

  it("a read-only role never reaches the database", async () => {
    role = "member";
    expect((await approve(post("/x", body))).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("undo", () => {
  it("sends the command id and key only; forged previous values are dropped", async () => {
    const res = await undo(
      post("/x", {
        commandId: UUID,
        commandKey: KEY,
        draftId: "d1",
        applied: [
          { category: "servicios", total: 1, previous: { amount: 999999 } },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(calls[0]!.args).toEqual({ commandId: UUID, commandKey: KEY });
  });

  it("changes since → 409 with the usual message; a bad id is refused early", async () => {
    result = { ok: false, failure: "conflict", reason: "changed_since" };
    const res = await undo(post("/x", { commandId: UUID, commandKey: KEY }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(es.costs.fixedUpload.undoChanged);
    calls.length = 0;
    expect(
      (await undo(post("/x", { commandId: "nope", commandKey: KEY }))).status
    ).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe("preview and copy", () => {
  it("the upload preview is a pure read: only previewUpload is called", async () => {
    result = { ok: true, value: { keys: [] } };
    const res = await previewGET(
      new NextRequest("http://localhost/x?draftId=d1")
    );
    expect(res!.status).toBe(200);
    expect(calls.map((c) => c.fn)).toEqual(["previewUpload"]);
  });

  it("the copy GET is a preview and never calls the writing command", async () => {
    result = { ok: true, value: { categories: [] } };
    const res = await copyGET(
      new NextRequest(
        "http://localhost/x?month=2026-11&location=00000000-0000-4000-8000-00000000000a"
      )
    );
    expect(res!.status).toBe(200);
    expect(calls.map((c) => c.fn)).toEqual(["previewCopy"]);
    expect(calls[0]!.args).toMatchObject({
      from: "2026-10-01",
      to: "2026-11-01",
    });
  });

  it("the copy POST needs a key, filters categories, and refuses a restaurant of another company", async () => {
    const good = {
      month: "2026-11",
      commandKey: KEY,
      location_id: "00000000-0000-4000-8000-00000000000a",
      categories: ["servicios", "bogus"],
      decisions: { servicios: "replace", otros: "evil" },
      expected: { k: 0, j: "x" },
    };
    expect((await copyPOST(post("/x", good))).status).toBe(200);
    expect(calls[0]!.args).toMatchObject({
      from: "2026-10-01",
      to: "2026-11-01",
      categories: ["servicios"],
      decisions: { servicios: "replace" },
      expected: { k: 0 },
    });
    calls.length = 0;
    expect(
      (await copyPOST(post("/x", { ...good, commandKey: undefined }))).status
    ).toBe(400);
    expect(
      (
        await copyPOST(
          post("/x", {
            ...good,
            location_id: "00000000-0000-4000-8000-0000000000ff",
          })
        )
      ).status
    ).toBe(400);
    expect(calls).toEqual([]);
  });

  it("a conflicting destination comes back as a 409 with the choices", async () => {
    result = {
      ok: true,
      value: {
        status: "needs_decision",
        conflicts: [{ category: "servicios" }],
      },
    };
    const res = await copyPOST(
      post("/x", {
        month: "2026-11",
        commandKey: KEY,
        categories: ["servicios"],
        expected: {},
      })
    );
    expect(res.status).toBe(409);
  });
});
