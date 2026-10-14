// R1-12: the browser-side caches for the recipe editor and the Menú tabs.
// Synthetic data only.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import {
  EDITOR_FRESH_MS,
  EDITOR_KEEP_MS,
  clearEditors,
  dropEditorsForProduct,
  editorQuery,
  getCachedEditor,
  onEditorsCleared,
  prefetchEditor,
  putEditor,
} from "@/lib/restaurant/recipe-costing/editor-cache";
import {
  TAB_FRESH_MS,
  TAB_KEEP_MS,
  clearTabs,
  getCachedTab,
  loadTab,
  markTabsStale,
  menuTabKey,
  putTab,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";

const editor = (tag: string) => ({ version_id: tag }) as unknown as EditorState;
const workspace = (tag: string) =>
  ({ company_id: tag }) as unknown as RecipeCostingWorkspace;

describe("editor cache", () => {
  beforeEach(() => clearEditors());

  it("builds the same query the editor API takes", () => {
    expect(editorQuery({ odooProductId: 7, locationId: "loc-1" })).toBe(
      "odoo_product_id=7&location_id=loc-1"
    );
    expect(editorQuery({ odooProductId: 7 })).toBe("odoo_product_id=7");
    expect(editorQuery({ componentId: "c-1", odooProductId: 7 })).toBe(
      "component_id=c-1"
    );
  });

  it("a fresh entry needs no request; an older one is shown but re-read", () => {
    putEditor("k", editor("a"), { now: 1_000 });
    expect(getCachedEditor("k", 1_000 + EDITOR_FRESH_MS)?.fresh).toBe(true);
    const older = getCachedEditor("k", 1_000 + EDITOR_FRESH_MS + 1);
    expect(older?.fresh).toBe(false);
    expect(older?.state).toEqual(editor("a"));
  });

  it("is forgotten after the keep window", () => {
    putEditor("k", editor("a"), { now: 0 });
    expect(getCachedEditor("k", EDITOR_KEEP_MS + 1)).toBeNull();
  });

  it("drops one dish after it is approved, keeps the others", () => {
    putEditor("a", editor("a"), { productId: 1 });
    putEditor("b", editor("b"), { productId: 2 });
    dropEditorsForProduct(1);
    expect(getCachedEditor("a")).toBeNull();
    expect(getCachedEditor("b")).not.toBeNull();
  });

  it("a catalog edit empties everything, and a read already on its way is not stored", async () => {
    putEditor("a", editor("a"));
    let resolve!: (s: EditorState) => void;
    const pending = prefetchEditor(
      "late",
      () => new Promise<EditorState>((r) => (resolve = r))
    );
    clearEditors();
    resolve(editor("late"));
    await pending;
    expect(getCachedEditor("a")).toBeNull();
    expect(getCachedEditor("late")).toBeNull();
  });

  it("prefetch reads once, skips a fresh entry and survives a failed read", async () => {
    const load = vi.fn(async () => editor("n"));
    await Promise.all([prefetchEditor("n", load), prefetchEditor("n", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(getCachedEditor("n")?.state).toEqual(editor("n"));
    await prefetchEditor("n", load);
    expect(load).toHaveBeenCalledTimes(1);

    await prefetchEditor("bad", async () => {
      throw new Error("offline");
    });
    expect(getCachedEditor("bad")).toBeNull();
    await prefetchEditor("none", async () => null);
    expect(getCachedEditor("none")).toBeNull();
  });

  it("warming skips a copy younger than maxAgeMs, even when it is past fresh", async () => {
    putEditor("w", editor("old"), { now: 0 });
    const load = vi.fn(async () => editor("new"));
    await prefetchEditor("w", load, {
      now: EDITOR_FRESH_MS + 5_000,
      maxAgeMs: 60_000,
    });
    expect(load).not.toHaveBeenCalled();
    await prefetchEditor("w", load, {
      now: 61_000,
      maxAgeMs: 60_000,
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tells listeners when everything is forgotten, and stops after unsubscribe", () => {
    const heard = vi.fn();
    const off = onEditorsCleared(heard);
    clearEditors();
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    clearEditors();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("keeps at most 40 dishes, oldest first out", () => {
    for (let i = 0; i < 45; i++) putEditor(`k${i}`, editor(String(i)));
    expect(getCachedEditor("k0")).toBeNull();
    expect(getCachedEditor("k44")).not.toBeNull();
  });
});

describe("Menú tab cache", () => {
  beforeEach(() => clearTabs());

  it("keys by tab, restaurant and period", () => {
    expect(menuTabKey("plato", { location: "l1", from: "a", to: "b" })).toBe(
      "plato|l1|a|b"
    );
    expect(menuTabKey("plato", {})).not.toBe(menuTabKey("resumen", {}));
    expect(menuTabKey("plato", { location: "l1" })).not.toBe(
      menuTabKey("plato", { location: "l2" })
    );
  });

  it("fresh, then stale-but-shown, then gone", () => {
    putTab("k", workspace("a"), 0);
    expect(getCachedTab("k", TAB_FRESH_MS)?.fresh).toBe(true);
    expect(getCachedTab("k", TAB_FRESH_MS + 1)?.fresh).toBe(false);
    expect(getCachedTab("k", TAB_KEEP_MS + 1)).toBeNull();
  });

  it("a save makes every tab stale, so the next visit re-reads it", () => {
    putTab("k", workspace("a"));
    expect(getCachedTab("k")?.fresh).toBe(true);
    markTabsStale();
    const after = getCachedTab("k");
    expect(after?.fresh).toBe(false);
    expect(after?.data).toEqual(workspace("a"));
  });

  it("reads a tab once at a time and stores the answer", async () => {
    const load = vi.fn(async () => workspace("x"));
    const [a, b] = await Promise.all([loadTab("t", load), loadTab("t", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(getCachedTab("t")?.data).toEqual(workspace("x"));
  });

  it("a failed read stores nothing", async () => {
    expect(
      await loadTab("t", async () => {
        throw new Error("offline");
      })
    ).toBeNull();
    expect(getCachedTab("t")).toBeNull();
  });

  it("a save while a read is in flight: its answer is not cached; the read is repeated", async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls++;
      const answer = workspace(calls === 1 ? "pre-save" : "post-save");
      if (calls === 1) markTabsStale(); // the save lands mid-flight
      return answer;
    });
    const got = await loadTab("t", load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(got).toEqual(workspace("post-save"));
    expect(getCachedTab("t")?.data).toEqual(workspace("post-save"));
  });

  it("saves that keep arriving: nothing cached, nothing returned", async () => {
    const got = await loadTab("t", async () => {
      markTabsStale();
      return workspace("pre-save");
    });
    expect(got).toBeNull();
    expect(getCachedTab("t")).toBeNull();
  });
});
