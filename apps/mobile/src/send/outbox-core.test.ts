import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  afterFailure,
  backoffMs,
  isDue,
  newItem,
  sendItem,
  type SendDeps,
} from "./outbox-core";

const ticket = (over: Record<string, unknown> = {}) => ({
  reportId: "r-1",
  uploadUrl: "https://storage.example.test/upload?token=SIGNED",
  uploadToken: "SIGNED",
  path: "co/loc/2026/10/r-1.jpg",
  expiresInS: 7200,
  duplicate: false,
  ...over,
});

function deps(over: Partial<SendDeps["api"]> = {}, status = 200) {
  const api = {
    text: vi.fn(async () => ({
      reportId: "r",
      mediaId: null,
      duplicate: false,
    })),
    uploadTicket: vi.fn(async () => ticket()),
    uploadComplete: vi.fn(async () => ({
      reportId: "r-1",
      mediaId: "r-1",
      duplicate: false,
    })),
    ...over,
  };
  const upload = vi.fn(async () => ({ status }));
  return { api, upload, d: { api, upload } as unknown as SendDeps };
}

const photo = () =>
  newItem({
    id: "client-ref-photo-1",
    kind: "photo",
    fileUri: "file:///a.jpg",
    mime: "image/jpeg",
    sizeBytes: 2000,
    text: "tomate",
  });

describe("backoff and due", () => {
  it("doubles from 2 s and stops at 5 minutes", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffMs(30)).toBe(300_000);
  });

  it("is due when waiting or failed, not permanent, and the time has come", () => {
    const item = newItem({ id: "client-ref-1", kind: "text", text: "hola" });
    expect(isDue(item, 0)).toBe(true);
    expect(isDue({ ...item, state: "sending" }, 0)).toBe(false);
    expect(isDue({ ...item, state: "sent" }, 0)).toBe(false);
    expect(isDue({ ...item, state: "failed", nextAttemptAt: 1000 }, 999)).toBe(
      false
    );
    expect(isDue({ ...item, state: "failed", nextAttemptAt: 1000 }, 1000)).toBe(
      true
    );
    expect(isDue({ ...item, state: "failed", permanent: true }, 99999)).toBe(
      false
    );
  });
});

describe("sendItem", () => {
  it("text goes straight to kitchen/text with its clientRef", async () => {
    const { api, upload, d } = deps();
    const item = newItem({
      id: "client-ref-text-1",
      kind: "text",
      text: "se acabó el limón",
    });
    expect(await sendItem(item, d)).toEqual({ ok: true });
    expect(api.text).toHaveBeenCalledWith({
      text: "se acabó el limón",
      clientRef: "client-ref-text-1",
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("a photo: ticket, then PUT to the signed URL, then complete", async () => {
    const { api, upload, d } = deps();
    expect(await sendItem(photo(), d)).toEqual({ ok: true });
    expect(api.uploadTicket).toHaveBeenCalledWith({
      kind: "photo",
      mime: "image/jpeg",
      sizeBytes: 2000,
      clientRef: "client-ref-photo-1",
      text: "tomate",
      durationS: null,
    });
    expect(upload).toHaveBeenCalledWith({
      url: "https://storage.example.test/upload?token=SIGNED",
      fileUri: "file:///a.jpg",
      mime: "image/jpeg",
    });
    expect(api.uploadComplete).toHaveBeenCalledWith({
      reportId: "r-1",
      clientRef: "client-ref-photo-1",
      path: "co/loc/2026/10/r-1.jpg",
    });
  });

  it("an already stored file skips the PUT and completes (idempotent)", async () => {
    const { api, upload, d } = deps({
      uploadTicket: vi.fn(async () =>
        ticket({ uploadUrl: null, uploadToken: null, duplicate: true })
      ),
    });
    expect(await sendItem(photo(), d)).toEqual({ ok: true });
    expect(upload).not.toHaveBeenCalled();
    expect(api.uploadComplete).toHaveBeenCalledTimes(1);
  });

  it("a retry reuses the SAME clientRef, so nothing is stored twice", async () => {
    const seen: string[] = [];
    const down = deps({
      uploadTicket: async (input) => {
        seen.push(input.clientRef);
        throw new ApiError("network");
      },
    });
    const item = photo();
    const first = await sendItem(item, down.d);
    expect(first).toEqual({ ok: false, permanent: false, offline: true });
    const failed = afterFailure(item, first as never, 1000);
    expect(failed).toMatchObject({
      state: "failed",
      attempts: 1,
      offline: true,
      nextAttemptAt: 3000,
    });

    const up = deps({
      uploadTicket: async (input) => {
        seen.push(input.clientRef);
        return ticket();
      },
    });
    expect(await sendItem(failed, up.d)).toEqual({ ok: true });
    expect(seen).toEqual(["client-ref-photo-1", "client-ref-photo-1"]);
  });

  it("a failed PUT is retryable, except too big / refused type", async () => {
    expect(await sendItem(photo(), deps({}, 500).d)).toEqual({
      ok: false,
      permanent: false,
      offline: false,
    });
    expect(await sendItem(photo(), deps({}, 403).d)).toEqual({
      ok: false,
      permanent: false,
      offline: false,
    });
    expect(await sendItem(photo(), deps({}, 413).d)).toEqual({
      ok: false,
      permanent: true,
      offline: false,
    });
    expect(await sendItem(photo(), deps({}, 415).d)).toEqual({
      ok: false,
      permanent: true,
      offline: false,
    });
  });

  it("complete before the file arrived (409) is retryable; a refused type (415) is not", async () => {
    const early = deps({
      uploadComplete: vi.fn(async () =>
        Promise.reject(new ApiError("client", 409))
      ),
    });
    expect(await sendItem(photo(), early.d)).toEqual({
      ok: false,
      permanent: false,
      offline: false,
    });
    const refused = deps({
      uploadTicket: vi.fn(async () =>
        Promise.reject(new ApiError("client", 415))
      ),
    });
    expect(await sendItem(photo(), refused.d)).toEqual({
      ok: false,
      permanent: true,
      offline: false,
    });
  });

  it("server trouble and timeouts are retryable; an item without a file is permanent", async () => {
    const boom = deps({
      text: vi.fn(async () => Promise.reject(new ApiError("server", 500))),
    });
    expect(
      await sendItem(
        newItem({ id: "client-ref-2", kind: "text", text: "x" }),
        boom.d
      )
    ).toEqual({
      ok: false,
      permanent: false,
      offline: false,
    });
    const slow = deps({
      text: vi.fn(async () => Promise.reject(new ApiError("timeout"))),
    });
    expect(
      await sendItem(
        newItem({ id: "client-ref-3", kind: "text", text: "x" }),
        slow.d
      )
    ).toMatchObject({
      permanent: false,
      offline: true,
    });
    expect(
      await sendItem(newItem({ id: "client-ref-4", kind: "photo" }), deps().d)
    ).toEqual({
      ok: false,
      permanent: true,
      offline: false,
    });
  });

  it("a signed-out cook's items wait instead of being dropped", async () => {
    const out = deps({
      text: vi.fn(async () =>
        Promise.reject(new ApiError("unauthorized", 401))
      ),
    });
    expect(
      await sendItem(
        newItem({ id: "client-ref-5", kind: "text", text: "x" }),
        out.d
      )
    ).toMatchObject({
      permanent: false,
    });
  });
});
