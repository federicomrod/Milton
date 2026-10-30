import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "99999999-9999-4999-8999-999999999999";
const LOC_A = "22222222-2222-4222-8222-222222222222";
const LOC_B = "88888888-8888-4888-8888-888888888888";
const STAFF = "44444444-4444-4444-8444-444444444441";
const STAFF_2 = "44444444-4444-4444-8444-444444444442";
const TOKEN = "device-token-for-cook-one-0000000000000000000";
const REF = "client-ref-0001";

const h = vi.hoisted(() => ({
  schedule: vi.fn(),
  state: { db: null as any },
  ingestSpy: vi.fn(),
}));

vi.mock("@/lib/restaurant/kitchen/pipeline/app-message", () => ({
  scheduleAppProcessing: (...a: unknown[]) => h.schedule(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => h.state.db.client,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: vi.fn(),
  getCachedCompanyId: vi.fn(),
}));
vi.mock("@/lib/restaurant/supabase-sales", () => ({
  resolveCompanyIdForUser: vi.fn(),
}));
vi.mock("@/lib/profile-service-server", () => ({
  isUserAdminServer: async () => false,
}));
// The real ingest runs (it registers the stored object); the spy only records.
vi.mock("@/lib/restaurant/kitchen/pipeline/ingest", async (orig) => {
  const actual =
    await orig<typeof import("@/lib/restaurant/kitchen/pipeline/ingest")>();
  return {
    ...actual,
    ingestKitchenMedia: (input: unknown) => {
      h.ingestSpy(input);
      return actual.ingestKitchenMedia(input as never);
    },
  };
});

import { hashToken } from "@/lib/restaurant/kitchen/app-identity";
import { KITCHEN_MEDIA_MAX_BYTES } from "@/lib/restaurant/kitchen/media-storage";
import { POST as uploadsPOST } from "@/app/api/mobile/v1/kitchen/uploads/route";
import { POST as completePOST } from "@/app/api/mobile/v1/kitchen/uploads/complete/route";

const post = (path: string, body: unknown, token: string | null = TOKEN) =>
  new NextRequest(`http://localhost/api/mobile/v1/kitchen/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const ticketBody = (over: Record<string, unknown> = {}) => ({
  kind: "photo",
  mime: "image/jpeg",
  sizeBytes: 200_000,
  clientRef: REF,
  text: "se acabó el limón",
  ...over,
});

beforeEach(() => {
  h.state.db = createFakeDb({
    restaurant_locations: [
      { id: LOC_A, company_id: CO_A, name: "Centro", status: "active" },
      { id: LOC_B, company_id: CO_B, name: "Otro", status: "active" },
    ],
    kitchen_staff: [
      {
        id: STAFF,
        company_id: CO_A,
        location_id: LOC_A,
        display_name: "Luis",
        is_active: true,
        can_see_costs: false,
      },
      {
        id: STAFF_2,
        company_id: CO_A,
        location_id: LOC_A,
        display_name: "Ana",
        is_active: true,
        can_see_costs: false,
      },
    ],
    kitchen_devices: [
      {
        id: "55555555-5555-4555-8555-555555555551",
        company_id: CO_A,
        staff_id: STAFF,
        token_hash: hashToken(TOKEN),
        revoked_at: null,
        last_seen_at: null,
      },
    ],
    kitchen_reports: [],
    kitchen_media: [],
  });
  h.ingestSpy.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function ticket(over: Record<string, unknown> = {}) {
  const res = await uploadsPOST(post("uploads", ticketBody(over)));
  return { res, body: await res.json() };
}

/** Pretend the phone PUT the file to the signed URL. */
function putObject(path: string, bytes = 200_000) {
  h.state.db.objects.set(path, bytes);
}

describe("POST kitchen/uploads", () => {
  it("issues a signed upload URL for a valid kind, mime and size, and creates the app report", async () => {
    const { res, body } = await ticket();
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.duplicate).toBe(false);
    expect(body.uploadUrl).toContain("SIGNED-TOKEN");
    expect(body.uploadToken).toBe("SIGNED-TOKEN");
    expect(body.expiresInS).toBe(7200);
    expect(body.path).toMatch(
      new RegExp(`^${CO_A}/${LOC_A}/\\d{4}/\\d{2}/${body.reportId}\\.jpg$`)
    );
    expect(h.state.db.signedUploads).toEqual([body.path]);
    expect(h.state.db.tables.kitchen_reports[0]).toMatchObject({
      id: body.reportId,
      company_id: CO_A,
      location_id: LOC_A,
      staff_id: STAFF,
      channel: "app",
      client_ref: REF,
      media_kind: "photo",
      media_mime: "image/jpeg",
      media_size_bytes: 200_000,
      telegram_chat_id: null,
    });
    // Nothing was uploaded through the server.
    expect(h.state.db.uploads).toHaveLength(0);
  });

  it("accepts a voice note with codec parameters and a PDF", async () => {
    const voice = await ticket({
      kind: "voice",
      mime: "audio/mp4; codecs=mp4a.40.2",
      clientRef: "client-ref-voice",
      durationS: 12.4,
    });
    expect(voice.res.status).toBe(201);
    expect(voice.body.path).toMatch(/\.m4a$/);
    expect(h.state.db.tables.kitchen_reports[0].media_duration_s).toBe(12);
    const pdf = await ticket({
      kind: "document",
      mime: "application/pdf",
      clientRef: "client-ref-pdf1",
    });
    expect(pdf.res.status).toBe(201);
    expect(h.state.db.tables.kitchen_reports[1].media_kind).toBeNull();
  });

  it("refuses a bad kind, mime, size or clientRef without creating anything", async () => {
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ kind: "video" }, 400],
      [{ clientRef: "x" }, 400],
      [{ mime: "text/plain" }, 415],
      [{ mime: "application/zip", kind: "document" }, 415],
      [{ kind: "voice", mime: "image/jpeg" }, 415],
      [{ kind: "photo", mime: "audio/mpeg" }, 415],
      [{ sizeBytes: 0 }, 400],
      [{ sizeBytes: "big" }, 400],
      [{ sizeBytes: KITCHEN_MEDIA_MAX_BYTES + 1 }, 413],
    ];
    for (const [over, status] of cases) {
      const { res } = await ticket(over);
      expect(res.status, JSON.stringify(over)).toBe(status);
    }
    expect(h.state.db.tables.kitchen_reports).toHaveLength(0);
    expect(h.state.db.signedUploads).toHaveLength(0);
  });

  it("the same clientRef gives the same report and path (retry), and no URL once the file is stored", async () => {
    const first = await ticket();
    const retry = await ticket();
    expect(retry.res.status).toBe(200);
    expect(retry.body.reportId).toBe(first.body.reportId);
    expect(retry.body.path).toBe(first.body.path);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.uploadUrl).toContain("SIGNED-TOKEN");
    expect(h.state.db.tables.kitchen_reports).toHaveLength(1);

    putObject(first.body.path);
    await completePOST(
      post("uploads/complete", {
        reportId: first.body.reportId,
        clientRef: REF,
        path: first.body.path,
      })
    );
    const again = await ticket();
    expect(again.body).toMatchObject({
      duplicate: true,
      uploadUrl: null,
      uploadToken: null,
      expiresInS: 0,
    });
  });

  it("a revoked or missing device is 401", async () => {
    h.state.db.tables.kitchen_devices[0].revoked_at = new Date().toISOString();
    expect((await uploadsPOST(post("uploads", ticketBody()))).status).toBe(401);
    expect(
      (await uploadsPOST(post("uploads", ticketBody(), null))).status
    ).toBe(401);
    expect(h.state.db.signedUploads).toHaveLength(0);
  });

  it("ignores any company or location the client sends", async () => {
    const { body } = await ticket({ companyId: CO_B, locationId: LOC_B });
    expect(body.path.startsWith(`${CO_A}/${LOC_A}/`)).toBe(true);
  });
});

describe("POST kitchen/uploads/complete", () => {
  const complete = (b: Record<string, unknown>) =>
    completePOST(post("uploads/complete", b));

  it("before the file is in Storage it is a 409 and registers nothing", async () => {
    const { body } = await ticket();
    const res = await complete({
      reportId: body.reportId,
      clientRef: REF,
      path: body.path,
    });
    expect(res.status).toBe(409);
    expect(h.state.db.tables.kitchen_media).toHaveLength(0);
    expect(h.ingestSpy).not.toHaveBeenCalled();
  });

  it("registers the stored object through ingestKitchenMedia({ channel: 'app' }) without moving bytes", async () => {
    const { body } = await ticket();
    putObject(body.path, 123_456);
    const res = await complete({
      reportId: body.reportId,
      clientRef: REF,
      path: body.path,
    });
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out).toMatchObject({ reportId: body.reportId, duplicate: false });
    expect(out.mediaId).toBe(body.reportId);

    expect(h.ingestSpy).toHaveBeenCalledTimes(1);
    expect(h.ingestSpy.mock.calls[0][0]).toMatchObject({
      channel: "app",
      companyId: CO_A,
      locationId: LOC_A,
      staffId: STAFF,
      kitchenReportId: body.reportId,
      kind: "photo",
      mime: "image/jpeg",
      sizeBytes: 123_456,
      sourceRef: `${STAFF}:${REF}`,
      storedAtPath: body.path,
    });
    expect(h.state.db.tables.kitchen_media).toHaveLength(1);
    expect(h.state.db.tables.kitchen_media[0]).toMatchObject({
      id: body.reportId,
      company_id: CO_A,
      location_id: LOC_A,
      kitchen_report_id: body.reportId,
      channel: "app",
      storage_path: body.path,
      source_ref: `${STAFF}:${REF}`,
    });
    // Registering moved no bytes.
    expect(h.state.db.uploads).toHaveLength(0);
  });

  it("calling it twice, even at once, leaves one media row and says duplicate", async () => {
    const { body } = await ticket();
    putObject(body.path);
    const args = { reportId: body.reportId, clientRef: REF, path: body.path };
    const [a, b] = await Promise.all([complete(args), complete(args)]);
    const later = await complete(args);
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(
      true
    );
    expect(later.status).toBe(200);
    expect(await later.json()).toMatchObject({
      mediaId: body.reportId,
      duplicate: true,
    });
    expect(h.state.db.tables.kitchen_media).toHaveLength(1);
  });

  it("a path of another company or location is 403", async () => {
    const { body } = await ticket();
    const base = (c: string, l: string) =>
      `${c}/${l}/2026/10/${body.reportId}.jpg`;
    for (const path of [
      base(CO_B, LOC_A),
      base(CO_A, LOC_B),
      base(CO_B, LOC_B),
      `${CO_A}/${LOC_A}/2026/10/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
    ]) {
      putObject(path);
      const res = await complete({
        reportId: body.reportId,
        clientRef: REF,
        path,
      });
      expect(res.status, path).toBe(403);
    }
    expect(h.state.db.tables.kitchen_media).toHaveLength(0);
  });

  it("junk paths are 403, and another cook's report is a 404", async () => {
    const { body } = await ticket();
    putObject("../../etc/passwd");
    expect(
      (
        await complete({
          reportId: body.reportId,
          clientRef: REF,
          path: "../../etc/passwd",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await complete({
          reportId: body.reportId,
          clientRef: "other-client-ref",
          path: body.path,
        })
      ).status
    ).toBe(404);
    h.state.db.tables.kitchen_reports[0].staff_id = STAFF_2;
    putObject(body.path);
    expect(
      (
        await complete({
          reportId: body.reportId,
          clientRef: REF,
          path: body.path,
        })
      ).status
    ).toBe(404);
    expect(h.state.db.tables.kitchen_media).toHaveLength(0);
  });

  it("an object over the cap is refused and removed", async () => {
    const { body } = await ticket();
    putObject(body.path, KITCHEN_MEDIA_MAX_BYTES + 1);
    const res = await complete({
      reportId: body.reportId,
      clientRef: REF,
      path: body.path,
    });
    expect(res.status).toBe(413);
    expect(h.state.db.objects.has(body.path)).toBe(false);
    expect(h.state.db.tables.kitchen_media).toHaveLength(0);
  });

  it("a revoked device is 401", async () => {
    const { body } = await ticket();
    putObject(body.path);
    h.state.db.tables.kitchen_devices[0].revoked_at = new Date().toISOString();
    const res = await complete({
      reportId: body.reportId,
      clientRef: REF,
      path: body.path,
    });
    expect(res.status).toBe(401);
    expect(h.ingestSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    expect((await complete({})).status).toBe(400);
    expect(
      (await complete({ reportId: "nope", clientRef: REF, path: "p" })).status
    ).toBe(400);
  });
});

describe("app messages go through the shared pipeline", () => {
  const complete = (b: Record<string, unknown>) =>
    completePOST(post("uploads/complete", b));

  it("a voice note is scheduled for the pipeline once it is registered; a photo is not", async () => {
    h.schedule.mockClear();
    const voice = (
      await ticket({
        kind: "voice",
        mime: "audio/mp4",
        clientRef: "client-ref-voice-1",
        durationS: 8,
      })
    ).body;
    putObject(voice.path, 50_000);
    expect(
      (
        await complete({
          reportId: voice.reportId,
          clientRef: "client-ref-voice-1",
          path: voice.path,
        })
      ).status
    ).toBe(201);
    expect(h.schedule).toHaveBeenCalledWith({
      staffId: STAFF,
      reportId: voice.reportId,
    });

    h.schedule.mockClear();
    const photo = (await ticket({ clientRef: "client-ref-photo-9" })).body;
    putObject(photo.path);
    await complete({
      reportId: photo.reportId,
      clientRef: "client-ref-photo-9",
      path: photo.path,
    });
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("nothing is scheduled when the upload is refused", async () => {
    h.schedule.mockClear();
    const voice = (
      await ticket({
        kind: "voice",
        mime: "audio/mp4",
        clientRef: "client-ref-voice-2",
      })
    ).body;
    // The file never arrived.
    expect(
      (
        await complete({
          reportId: voice.reportId,
          clientRef: "client-ref-voice-2",
          path: voice.path,
        })
      ).status
    ).toBe(409);
    expect(h.schedule).not.toHaveBeenCalled();
  });
});

describe("logging", () => {
  it("never logs the device token, the signed URL or its token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {})
    );
    const { body } = await ticket();
    putObject(body.path);
    await completePOST(
      post("uploads/complete", {
        reportId: body.reportId,
        clientRef: REF,
        path: body.path,
      })
    );
    await completePOST(
      post("uploads/complete", {
        reportId: body.reportId,
        clientRef: REF,
        path: "bad",
      })
    );
    const logged = spies
      .flatMap((s) => s.mock.calls)
      .map((a) => a.map(String).join(" "))
      .join("\n");
    for (const secret of [
      TOKEN,
      hashToken(TOKEN),
      "SIGNED-TOKEN",
      "storage.example",
      "Bearer",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
