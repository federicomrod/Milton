import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    existing: null as null | { id: string; storage_path: string },
    insertError: false,
    uploadError: false,
    tableMissing: false,
    inserts: [] as Record<string, unknown>[],
    uploads: [] as string[],
    removed: [] as string[][],
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () =>
              state.tableMissing
                ? { data: null, error: { message: "relation missing" } }
                : { data: state.existing, error: null },
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        if (state.insertError) return { error: { message: "nope" } };
        state.inserts.push(row);
        return { error: null };
      },
    }),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (state.uploadError) return { error: { message: "no bucket" } };
          state.uploads.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

import { ingestKitchenMedia } from "@/lib/restaurant/kitchen/pipeline/ingest";

const CO = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";

function input(over: Record<string, unknown> = {}) {
  return {
    channel: "telegram" as const,
    companyId: CO,
    locationId: LOC,
    staffId: null,
    kitchenReportId: null,
    kind: "photo" as const,
    mime: "image/jpeg",
    sourceRef: "uniq-1",
    getBytes: async () => new Uint8Array([1, 2, 3]),
    ...over,
  };
}

beforeEach(() => {
  state.existing = null;
  state.insertError = false;
  state.uploadError = false;
  state.tableMissing = false;
  state.inserts = [];
  state.uploads = [];
  state.removed = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ingestKitchenMedia", () => {
  it("uploads once and inserts one row", async () => {
    const r = await ingestKitchenMedia(input());
    expect(r.ok).toBe(true);
    expect(state.uploads).toHaveLength(1);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      company_id: CO,
      channel: "telegram",
      source_ref: "uniq-1",
      size_bytes: 3,
    });
    expect(state.uploads[0].startsWith(`${CO}/${LOC}/`)).toBe(true);
    if (r.ok) expect(r.duplicate).toBe(false);
  });
  it("skips the upload for a duplicate (channel, sourceRef)", async () => {
    state.existing = { id: "m-1", storage_path: "x/y.jpg" };
    const getBytes = vi.fn();
    const r = await ingestKitchenMedia(input({ getBytes }));
    expect(r).toEqual({
      ok: true,
      mediaId: "m-1",
      storagePath: "x/y.jpg",
      duplicate: true,
    });
    expect(getBytes).not.toHaveBeenCalled();
    expect(state.uploads).toHaveLength(0);
  });
  it("fails on null bytes, oversized files and unsupported mimes", async () => {
    expect(
      (await ingestKitchenMedia(input({ getBytes: async () => null }))).ok
    ).toBe(false);
    expect(
      (
        await ingestKitchenMedia(
          input({ getBytes: async () => new Uint8Array(25 * 1024 * 1024 + 1) })
        )
      ).ok
    ).toBe(false);
    expect(
      (await ingestKitchenMedia(input({ sizeBytes: 26 * 1024 * 1024 }))).ok
    ).toBe(false);
    expect((await ingestKitchenMedia(input({ mime: "video/mp4" }))).ok).toBe(
      false
    );
    expect((await ingestKitchenMedia(input({ mime: null }))).ok).toBe(false);
    expect(state.uploads).toHaveLength(0);
  });
  it("removes the uploaded object when the insert fails", async () => {
    state.insertError = true;
    const r = await ingestKitchenMedia(input());
    expect(r.ok).toBe(false);
    expect(state.removed).toHaveLength(1);
    expect(state.removed[0]).toEqual([expect.stringContaining(CO)]);
  });
  it("returns ok:false when the bucket or table does not exist yet", async () => {
    state.uploadError = true;
    expect((await ingestKitchenMedia(input())).ok).toBe(false);
    state.uploadError = false;
    state.tableMissing = true;
    expect((await ingestKitchenMedia(input())).ok).toBe(false);
  });
  it("never throws, even when getBytes or an id is bad", async () => {
    await expect(
      ingestKitchenMedia(
        input({
          getBytes: async () => {
            throw new Error("boom");
          },
        })
      )
    ).resolves.toMatchObject({ ok: false });
    await expect(
      ingestKitchenMedia(input({ companyId: "../evil" }))
    ).resolves.toMatchObject({ ok: false });
  });
});
