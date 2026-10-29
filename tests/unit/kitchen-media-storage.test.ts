import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildKitchenMediaPath,
  createKitchenMediaSignedUrl,
  uploadKitchenMedia,
} from "@/lib/restaurant/kitchen/media-storage";

const CO = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-03-07T10:00:00Z");

function adminWith(storage: unknown) {
  return { storage: { from: () => storage } } as unknown as SupabaseClient;
}

describe("buildKitchenMediaPath", () => {
  it("follows <company>/<location>/<yyyy>/<mm>/<id>.<ext>", () => {
    expect(
      buildKitchenMediaPath({
        companyId: CO,
        locationId: LOC,
        mediaId: MEDIA,
        mime: "image/jpeg",
        now,
      })
    ).toBe(`${CO}/${LOC}/2026/03/${MEDIA}.jpg`);
  });
  it("maps mimes to extensions and defaults to bin", () => {
    const ext = (mime: string | null) =>
      buildKitchenMediaPath({
        companyId: CO,
        locationId: LOC,
        mediaId: MEDIA,
        mime,
        now,
      }).split(".")[1];
    expect(ext("audio/ogg")).toBe("ogg");
    expect(ext("audio/mpeg")).toBe("mp3");
    expect(ext("audio/mp4")).toBe("m4a");
    expect(ext("image/heic")).toBe("heic");
    expect(ext("application/pdf")).toBe("pdf");
    expect(ext("text/plain")).toBe("bin");
    expect(ext(null)).toBe("bin");
  });
  it("rejects ids that are not UUIDs", () => {
    for (const bad of ["../x", "a/b", "not-a-uuid", ""]) {
      expect(() =>
        buildKitchenMediaPath({
          companyId: bad,
          locationId: LOC,
          mediaId: MEDIA,
          mime: "image/png",
        })
      ).toThrow();
    }
  });
});

describe("uploadKitchenMedia", () => {
  it("uploads with upsert false", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const r = await uploadKitchenMedia(
      adminWith({ upload }),
      "p",
      new Uint8Array([1]),
      "image/png"
    );
    expect(r).toEqual({ ok: true });
    expect(upload.mock.calls[0][2]).toMatchObject({
      upsert: false,
      contentType: "image/png",
    });
  });
  it("returns ok:false on an error result without leaking the message", async () => {
    const r = await uploadKitchenMedia(
      adminWith({
        upload: async () => ({ error: { message: "Bucket not found" } }),
      }),
      "p",
      new Uint8Array([1]),
      null
    );
    expect(r).toEqual({ ok: false, error: "upload failed" });
  });
  it("never throws", async () => {
    const r = await uploadKitchenMedia(
      adminWith({
        upload: async () => {
          throw new TypeError("boom");
        },
      }),
      "p",
      new Uint8Array([1]),
      null
    );
    expect(r.ok).toBe(false);
  });
});

describe("createKitchenMediaSignedUrl", () => {
  it("returns the url, or null on error / throw", async () => {
    const ok = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://x/s" }, error: null });
    expect(
      await createKitchenMediaSignedUrl(adminWith({ createSignedUrl: ok }), "p")
    ).toBe("https://x/s");
    expect(ok).toHaveBeenCalledWith("p", 300);
    expect(
      await createKitchenMediaSignedUrl(
        adminWith({
          createSignedUrl: async () => ({
            data: null,
            error: { message: "x" },
          }),
        }),
        "p"
      )
    ).toBeNull();
    expect(
      await createKitchenMediaSignedUrl(
        adminWith({
          createSignedUrl: async () => {
            throw new Error("x");
          },
        }),
        "p"
      )
    ).toBeNull();
  });
});
