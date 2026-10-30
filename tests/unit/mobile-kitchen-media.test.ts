import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-supabase";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "99999999-9999-4999-8999-999999999999";
const LOC_A = "22222222-2222-4222-8222-222222222222";
const LOC_B = "88888888-8888-4888-8888-888888888888";
const STAFF = "44444444-4444-4444-8444-444444444441";
const TOKEN = "device-token-for-cook-one-0000000000000000000";

const h = vi.hoisted(() => ({
  schedule: vi.fn(),
  state: { db: null as any },
  ingest: vi.fn(),
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
vi.mock("@/lib/restaurant/kitchen/pipeline/ingest", () => ({
  ingestKitchenMedia: (...a: unknown[]) => h.ingest(...a),
}));

import { hashToken } from "@/lib/restaurant/kitchen/app-identity";
import { KITCHEN_MEDIA_MAX_BYTES } from "@/lib/restaurant/kitchen/media-storage";
import { POST as mediaPOST } from "@/app/api/mobile/v1/kitchen/media/route";
import { POST as textPOST } from "@/app/api/mobile/v1/kitchen/text/route";

type Parts = {
  bytes?: number;
  type?: string;
  kind?: string;
  clientRef?: string | null;
  text?: string;
  durationS?: string;
  extra?: Record<string, string>;
  noFile?: boolean;
};

function upload(parts: Parts = {}, token: string | null = TOKEN) {
  const form = new FormData();
  if (!parts.noFile) {
    form.set(
      "file",
      new File([new Uint8Array(parts.bytes ?? 64)], "f.bin", {
        type: parts.type ?? "image/jpeg",
      })
    );
  }
  form.set("kind", parts.kind ?? "photo");
  if (parts.clientRef !== null) {
    form.set("clientRef", parts.clientRef ?? "client-ref-0001");
  }
  if (parts.text) form.set("text", parts.text);
  if (parts.durationS) form.set("durationS", parts.durationS);
  for (const [k, v] of Object.entries(parts.extra ?? {})) form.set(k, v);
  return new NextRequest("http://localhost/api/mobile/v1/kitchen/media", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

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
  h.ingest.mockReset().mockImplementation(async (input: any) => {
    const row = {
      id:
        "aaaaaaaa-0000-4000-8000-00000000000" +
        (h.state.db.tables.kitchen_media.length + 1),
      company_id: input.companyId,
      kitchen_report_id: input.kitchenReportId,
    };
    h.state.db.tables.kitchen_media.push(row);
    return { ok: true, mediaId: row.id, storagePath: "p", duplicate: false };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/mobile/v1/kitchen/media", () => {
  it("creates an app report and stores the file through ingestKitchenMedia({channel: 'app'})", async () => {
    const res = await mediaPOST(
      upload({
        text: "se acabó el limón",
        kind: "photo",
        clientRef: "client-ref-0001",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ duplicate: false });
    expect(body.reportId).toBeTruthy();
    expect(body.mediaId).toBeTruthy();

    expect(h.ingest).toHaveBeenCalledTimes(1);
    const arg = h.ingest.mock.calls[0][0];
    expect(arg).toMatchObject({
      channel: "app",
      companyId: CO_A,
      locationId: LOC_A,
      staffId: STAFF,
      kitchenReportId: body.reportId,
      kind: "photo",
      mime: "image/jpeg",
      sizeBytes: 64,
      sourceRef: `${STAFF}:client-ref-0001`,
    });
    expect(typeof arg.getBytes).toBe("function");
    expect((await arg.getBytes()).byteLength).toBe(64);

    const report = h.state.db.tables.kitchen_reports[0];
    expect(report).toMatchObject({
      company_id: CO_A,
      location_id: LOC_A,
      staff_id: STAFF,
      channel: "app",
      client_ref: "client-ref-0001",
      telegram_chat_id: null,
      telegram_message_id: null,
      media_kind: "photo",
      media_mime: "image/jpeg",
      report_type: "86",
      text: "se acabó el limón",
    });
  });

  it("the same clientRef again returns the existing report and stores nothing twice", async () => {
    const first = await (
      await mediaPOST(upload({ clientRef: "client-ref-dup1" }))
    ).json();
    const second = await mediaPOST(upload({ clientRef: "client-ref-dup1" }));
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toEqual({
      reportId: first.reportId,
      mediaId: first.mediaId,
      duplicate: true,
    });
    expect(h.ingest).toHaveBeenCalledTimes(1);
    expect(h.state.db.tables.kitchen_reports).toHaveLength(1);
    expect(h.state.db.tables.kitchen_media).toHaveLength(1);
  });

  it("repairs a report whose upload failed earlier (report exists, no media yet)", async () => {
    h.ingest.mockResolvedValueOnce({ ok: false, error: "upload failed" });
    const failed = await mediaPOST(upload({ clientRef: "client-ref-fix1" }));
    expect(failed.status).toBe(502);
    // The half-made report was removed, so the retry starts clean.
    expect(h.state.db.tables.kitchen_reports).toHaveLength(0);
    const retry = await mediaPOST(upload({ clientRef: "client-ref-fix1" }));
    expect(retry.status).toBe(201);
  });

  it("two cooks may reuse a clientRef without colliding on the stored file", async () => {
    await mediaPOST(upload({ clientRef: "client-ref-same" }));
    expect(h.ingest.mock.calls[0][0].sourceRef).toBe(
      `${STAFF}:client-ref-same`
    );
  });

  it("a file over 25 MB is a 413 and never reaches ingest or the database", async () => {
    const res = await mediaPOST(upload({ bytes: KITCHEN_MEDIA_MAX_BYTES + 1 }));
    expect(res.status).toBe(413);
    expect(h.ingest).not.toHaveBeenCalled();
    expect(h.state.db.tables.kitchen_reports).toHaveLength(0);
  });

  it("a declared body far over the cap is refused before the body is read", async () => {
    const req = upload({});
    const big = new NextRequest(req.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(KITCHEN_MEDIA_MAX_BYTES + 5 * 1024 * 1024),
      },
      body: "--x--",
    });
    expect((await mediaPOST(big)).status).toBe(413);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("a type outside the bucket list, or one that does not fit the kind, is a 415", async () => {
    for (const parts of [
      { type: "text/plain", kind: "photo" },
      { type: "application/zip", kind: "document" },
      { type: "image/jpeg", kind: "voice" },
      { type: "audio/mpeg", kind: "photo" },
      { type: "image/png", kind: "document" },
    ] as Parts[]) {
      const res = await mediaPOST(upload(parts));
      expect(res.status, JSON.stringify(parts)).toBe(415);
    }
    expect(h.ingest).not.toHaveBeenCalled();
    expect(h.state.db.tables.kitchen_reports).toHaveLength(0);
  });

  it("accepts a voice note with codec parameters and a PDF document", async () => {
    const voice = await mediaPOST(
      upload({
        type: "audio/mp4; codecs=mp4a.40.2",
        kind: "voice",
        clientRef: "client-ref-voice",
        durationS: "12.4",
      })
    );
    expect(voice.status).toBe(201);
    expect(h.ingest.mock.calls[0][0]).toMatchObject({
      kind: "voice",
      mime: "audio/mp4",
      durationS: 12,
    });
    const pdf = await mediaPOST(
      upload({
        type: "application/pdf",
        kind: "document",
        clientRef: "client-ref-pdf1",
      })
    );
    expect(pdf.status).toBe(201);
    // kitchen_reports.media_kind only allows photo | voice.
    expect(h.state.db.tables.kitchen_reports[1].media_kind).toBeNull();
  });

  it("rejects a missing file, kind or clientRef with 400", async () => {
    expect((await mediaPOST(upload({ noFile: true }))).status).toBe(400);
    expect((await mediaPOST(upload({ kind: "video" }))).status).toBe(400);
    expect((await mediaPOST(upload({ clientRef: null }))).status).toBe(400);
    expect((await mediaPOST(upload({ clientRef: "x" }))).status).toBe(400);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("a revoked device is 401 and nothing is stored", async () => {
    h.state.db.tables.kitchen_devices[0].revoked_at = new Date().toISOString();
    expect((await mediaPOST(upload())).status).toBe(401);
    expect((await mediaPOST(upload({}, null))).status).toBe(401);
    expect(h.ingest).not.toHaveBeenCalled();
    expect(h.state.db.tables.kitchen_reports).toHaveLength(0);
  });

  it("a device of company A cannot touch company B's location, whatever the form says", async () => {
    const res = await mediaPOST(
      upload({
        clientRef: "client-ref-evil",
        extra: {
          companyId: CO_B,
          company_id: CO_B,
          locationId: LOC_B,
          location_id: LOC_B,
          staffId: "x",
        },
      })
    );
    expect(res.status).toBe(201);
    const arg = h.ingest.mock.calls[0][0];
    expect(arg.companyId).toBe(CO_A);
    expect(arg.locationId).toBe(LOC_A);
    expect(arg.staffId).toBe(STAFF);
    expect(h.state.db.tables.kitchen_reports[0]).toMatchObject({
      company_id: CO_A,
      location_id: LOC_A,
    });
  });
});

describe("POST /api/mobile/v1/kitchen/text", () => {
  const send = (body: unknown, token: string | null = TOKEN) =>
    textPOST(
      new NextRequest("http://localhost/api/mobile/v1/kitchen/text", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
    );

  it("creates a text report and dedupes by clientRef", async () => {
    const a = await send({
      text: "queda poco limón",
      clientRef: "client-ref-text1",
    });
    expect(a.status).toBe(201);
    const b = await send({
      text: "queda poco limón",
      clientRef: "client-ref-text1",
    });
    expect(b.status).toBe(200);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(jb).toEqual({
      reportId: ja.reportId,
      mediaId: null,
      duplicate: true,
    });
    expect(h.state.db.tables.kitchen_reports).toHaveLength(1);
    expect(h.state.db.tables.kitchen_reports[0]).toMatchObject({
      channel: "app",
      report_type: "running_out",
      media_kind: null,
      telegram_chat_id: null,
    });
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("schedules the message for the shared pipeline (once per request)", async () => {
    h.schedule.mockClear();
    const res = await send({
      text: "se nos acaba el queso fresco",
      clientRef: "client-ref-text9",
    });
    const body = await res.json();
    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(h.schedule).toHaveBeenCalledWith({
      staffId: STAFF,
      reportId: body.reportId,
    });
    h.schedule.mockClear();
    expect(
      (await send({ text: " ", clientRef: "client-ref-text10" })).status
    ).toBe(400);
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("caps the text at 2000 characters and needs text, clientRef and a live device", async () => {
    await send({ text: "a".repeat(2500), clientRef: "client-ref-long1" });
    expect(h.state.db.tables.kitchen_reports[0].text).toHaveLength(2000);
    expect(
      (await send({ text: "  ", clientRef: "client-ref-text2" })).status
    ).toBe(400);
    expect((await send({ text: "hola" })).status).toBe(400);
    expect(
      (await send({ text: "hola", clientRef: "client-ref-text3" }, null)).status
    ).toBe(401);
  });
});
