// The «Archivo subido» author row of uploaded drafts is a sentinel: it is not
// a cook, not team, never receives Telegram. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, type FakeStore } from "./helpers/fake-db";
import {
  UPLOAD_AUTHOR_NAME,
  UPLOAD_CHAT_ID,
  getOrCreateUploadAuthor,
  uploadAuthorTelegramId,
  uploadMessageId,
} from "@/lib/restaurant/recipe-upload/author";
import { parseKitchenAttentionPayload } from "@/lib/restaurant/kitchen-attention";
import type { SupabaseClient } from "@supabase/supabase-js";

const { holder } = vi.hoisted(() => ({
  holder: { store: {} as FakeStore },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeFakeDb(holder.store),
}));

const COMPANY = "co-1";
const LOC_A = "aaaaaaaa-1111-2222-3333-444444444444";
const LOC_B = "bbbbbbbb-1111-2222-3333-444444444444";

function seed(): FakeStore {
  return {
    kitchen_staff: [],
    restaurant_locations: [
      {
        id: LOC_A,
        company_id: COMPANY,
        name: "Local A",
        status: "active",
        archived_at: null,
      },
      {
        id: LOC_B,
        company_id: COMPANY,
        name: "Local B",
        status: "active",
        archived_at: null,
      },
    ],
    companies: [{ id: COMPANY, name: "Empresa" }],
  };
}
let cached: { store: FakeStore; db: SupabaseClient } | null = null;
const admin = () => {
  if (!cached || cached.store !== holder.store) {
    cached = {
      store: holder.store,
      db: makeFakeDb(holder.store) as unknown as SupabaseClient,
    };
  }
  return cached.db;
};

describe("getOrCreateUploadAuthor", () => {
  beforeEach(() => {
    holder.store = seed();
  });

  it("creates ONE inactive, removed, negative-id row per location", async () => {
    const a1 = await getOrCreateUploadAuthor(admin(), COMPANY, LOC_A);
    const a2 = await getOrCreateUploadAuthor(admin(), COMPANY, LOC_A);
    const b = await getOrCreateUploadAuthor(admin(), COMPANY, LOC_B);
    expect(a1.ok && a2.ok && b.ok).toBe(true);
    if (!a1.ok || !a2.ok || !b.ok) return;
    expect(a1.staffId).toBe(a2.staffId);
    expect(b.staffId).not.toBe(a1.staffId);
    expect(holder.store.kitchen_staff).toHaveLength(2);
    const row = holder.store.kitchen_staff[0];
    expect(row).toMatchObject({
      company_id: COMPANY,
      location_id: LOC_A,
      display_name: UPLOAD_AUTHOR_NAME,
      role: "kitchen",
      is_active: false,
      chat_id: UPLOAD_CHAT_ID,
    });
    expect(row.removed_at).toBeTruthy();
    expect(row.telegram_user_id as number).toBeLessThan(0);
    expect(row.telegram_user_id).toBe(uploadAuthorTelegramId(LOC_A));
    expect(holder.store.kitchen_staff[1].telegram_user_id).not.toBe(
      row.telegram_user_id
    );
  });

  it("handles a unique-key race by re-reading", async () => {
    let raced = false;
    const db = makeFakeDb(holder.store, {
      fail: (table, mode) => {
        if (table === "kitchen_staff" && mode === "insert" && !raced) {
          raced = true;
          holder.store.kitchen_staff.push({
            id: "winner",
            company_id: COMPANY,
            location_id: LOC_A,
            telegram_user_id: uploadAuthorTelegramId(LOC_A),
          });
          return { code: "23505", message: "dup" };
        }
        return false;
      },
    }) as unknown as SupabaseClient;
    expect(await getOrCreateUploadAuthor(db, COMPANY, LOC_A)).toEqual({
      ok: true,
      staffId: "winner",
    });
  });

  it("message ids are negative and unique per draft", () => {
    const ids = [0, 1, 2, 3].map((i) => uploadMessageId(i));
    expect(ids.every((n) => n < 0)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(uploadMessageId(0, 1)).not.toBe(uploadMessageId(0, 0));
  });
});

describe("who can see the author row", () => {
  beforeEach(async () => {
    holder.store = seed();
    holder.store.kitchen_staff.push({
      id: "cook-1",
      company_id: COMPANY,
      location_id: LOC_A,
      telegram_user_id: 777,
      chat_id: 777,
      display_name: "Ana",
      role: "kitchen",
      is_active: true,
      joined_at: "2026-01-01",
    });
    await getOrCreateUploadAuthor(admin(), COMPANY, LOC_A);
  });

  it("is not in the «Equipo de cocina» list (is_active filter)", async () => {
    const { data } = await admin()
      .from("kitchen_staff")
      .select("id, display_name, location_id, joined_at")
      .eq("is_active", true)
      .order("joined_at", { ascending: false });
    expect((data ?? []).map((r) => r.display_name)).toEqual(["Ana"]);
  });

  it("listActiveLinks and validateLink never return it", async () => {
    const { listActiveLinks, validateLink } =
      await import("@/lib/restaurant/telegram/kitchen-links");
    const author = holder.store.kitchen_staff.find(
      (r) => r.display_name === UPLOAD_AUTHOR_NAME
    )!;
    expect(await listActiveLinks(author.telegram_user_id as number)).toEqual(
      []
    );
    expect(
      await validateLink(author.telegram_user_id as number, author.id as string)
    ).toBeNull();
    // a real cook is still listed
    expect(await listActiveLinks(777)).toHaveLength(1);
  });

  it("is not counted as team by Kitchen insights", () => {
    const bundle = parseKitchenAttentionPayload(
      {
        reports: [],
        drafts: [],
        staff: [
          { id: "cook-1", display_name: "Ana", is_active: true },
          { id: "author", display_name: UPLOAD_AUTHOR_NAME, is_active: false },
        ],
      },
      "UTC"
    );
    expect(bundle.staff.map((s) => s.display_name)).toEqual(["Ana"]);
  });
});
