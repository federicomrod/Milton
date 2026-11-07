// Only owner, admin and manager (costs.fixed) upload, edit or approve; an
// analyst, a viewer or a cook (member) gets 403 and nothing is read or written.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let role: string | null = "manager";
const touched: string[] = [];

vi.mock("@/lib/restaurant/api-lang", () => ({ apiLanguage: async () => "es" }));
vi.mock("@/lib/restaurant/fixed-costs-auth", () => ({
  authorizeFixedCosts: async () => ({
    ok: true,
    supabase: {
      from: (t: string) => {
        touched.push(t);
        const q: Record<string, unknown> = {};
        const self = () => q;
        Object.assign(q, {
          select: self,
          eq: self,
          order: self,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        });
        return q;
      },
    },
    companyId: "c1",
    userId: "u1",
    actor: { userId: "u1", companyId: "c1", role, isMiltonStaff: false },
  }),
}));
vi.mock("@/lib/restaurant/restaurant-context-server", () => ({
  resolveRestaurantContext: async () => ({ selected: null, locations: [] }),
}));

import {
  GET,
  PATCH,
  POST,
} from "@/app/api/restaurant/fixed-costs/upload/route";
import { POST as APPROVE } from "@/app/api/restaurant/fixed-costs/upload/approve/route";

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const upload = () => {
  const form = new FormData();
  form.set("file", new File(["Renta;5"], "demo.csv", { type: "text/csv" }));
  form.set("month", "2026-10-01");
  return new NextRequest("http://localhost/api/restaurant/fixed-costs/upload", {
    method: "POST",
    body: form,
  });
};

beforeEach(() => {
  role = "manager";
  touched.length = 0;
});

describe.each(["analyst", "viewer", "member", null])("role %s", (r) => {
  it("gets 403 on every upload route and nothing is touched", async () => {
    role = r;
    expect((await GET()).status).toBe(403);
    expect((await POST(upload())).status).toBe(403);
    expect(
      (
        await PATCH(
          json("/api/restaurant/fixed-costs/upload", "PATCH", { draftId: "d" })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await APPROVE(
          json("/api/restaurant/fixed-costs/upload/approve", "POST", {
            draftId: "d",
          })
        )
      ).status
    ).toBe(403);
    expect(touched).toHaveLength(0);
  });
});

describe.each(["owner", "admin", "manager"])("role %s", (r) => {
  it("is allowed in (GET answers 200)", async () => {
    role = r;
    expect((await GET()).status).toBe(200);
  });
});

describe("validation", () => {
  it("a missing file is a 400 and a type we cannot read is refused", async () => {
    const empty = new NextRequest(
      "http://localhost/api/restaurant/fixed-costs/upload",
      {
        method: "POST",
        body: new FormData(),
      }
    );
    expect((await POST(empty)).status).toBe(400);
    const form = new FormData();
    form.set(
      "file",
      new File(["x"], "virus.exe", { type: "application/x-msdownload" })
    );
    form.set("month", "2026-10-01");
    const res = await POST(
      new NextRequest("http://localhost/api/restaurant/fixed-costs/upload", {
        method: "POST",
        body: form,
      })
    );
    expect(res.status).toBe(415);
  });
});
