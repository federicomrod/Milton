import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, openFile } = vi.hoisted(() => ({
  state: {
    report: null as null | Record<string, unknown>,
    media: null as null | { storage_path: string },
    mediaThrows: false,
    signed: "https://signed.example/abc" as string | null,
  },
  openFile: vi.fn(),
}));

vi.mock("@/lib/restaurant/api-auth", () => ({
  authAndCompany: async () => ({ ok: true, companyId: "co-a" }),
}));
vi.mock("@/lib/restaurant/telegram/files", () => ({
  openTelegramFile: (...a: unknown[]) => openFile(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => {
        if (table === "kitchen_media") {
          if (state.mediaThrows) throw new Error("relation missing");
          return { data: state.media, error: null };
        }
        return { data: state.report, error: null };
      };
      return chain;
    },
    storage: {
      from: () => ({
        createSignedUrl: async () =>
          state.signed
            ? { data: { signedUrl: state.signed }, error: null }
            : { data: null, error: { message: "x" } },
      }),
    },
  }),
}));

import { GET } from "@/app/api/restaurant/kitchen/reports/[id]/media/route";

const ID = "44444444-4444-4444-8444-444444444444";
const call = () =>
  GET(new NextRequest("http://localhost/api/x"), {
    params: Promise.resolve({ id: ID }),
  });

beforeEach(() => {
  state.report = {
    company_id: "co-a",
    media_kind: "photo",
    media_mime: "image/jpeg",
    telegram_file_id: "F1",
  };
  state.media = null;
  state.mediaThrows = false;
  state.signed = "https://signed.example/abc";
  openFile.mockReset().mockResolvedValue({
    ok: true,
    contentLength: "3",
    body: new Response(new Uint8Array([1, 2, 3])).body,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET kitchen report media", () => {
  it("redirects to a signed URL when a Storage copy exists", async () => {
    state.media = { storage_path: "co/loc/2026/03/m.jpg" };
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://signed.example/abc");
    expect(openFile).not.toHaveBeenCalled();
  });
  it("proxies from Telegram when there is no copy", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(openFile).toHaveBeenCalledWith("F1");
  });
  it("falls back to Telegram when the table or bucket does not exist yet", async () => {
    state.mediaThrows = true;
    expect((await call()).status).toBe(200);
    state.mediaThrows = false;
    state.media = { storage_path: "p" };
    state.signed = null;
    expect((await call()).status).toBe(200);
    expect(openFile).toHaveBeenCalledTimes(2);
  });
  it("gives another company the same 404 as before", async () => {
    state.report = { ...state.report, company_id: "co-b" };
    state.media = { storage_path: "p" };
    const res = await call();
    expect(res.status).toBe(404);
    expect(openFile).not.toHaveBeenCalled();
  });
});
void NextResponse;
