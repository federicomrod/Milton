import { afterEach, describe, expect, it } from "vitest";
import {
  getSaveEpoch,
  installSaveEpochWatcher,
  subscribeSaveEpoch,
  withSaveEpoch,
} from "@/lib/restaurant/save-epoch";
import {
  clearTabs,
  getCachedTab,
  putTab,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";

function fakeWindow(status = 200) {
  const calls: string[] = [];
  const target = {
    fetch: (async (input: unknown, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response("{}", { status });
    }) as typeof fetch,
  };
  return { target, calls };
}

describe("save epoch: a copy never outlives a save", () => {
  afterEach(() => clearTabs());

  it("links stay clean until the first save, then carry the epoch", () => {
    expect(withSaveEpoch("/dashboard/restaurant/sales", 0)).toBe(
      "/dashboard/restaurant/sales"
    );
    expect(withSaveEpoch("/dashboard/restaurant/sales?location=l1", 3)).toBe(
      "/dashboard/restaurant/sales?location=l1&_e=3"
    );
    expect(withSaveEpoch("/x#frag", 2)).toBe("/x?_e=2#frag");
  });

  it("a successful write to /api bumps it; reads, failures and other paths do not", async () => {
    const { target } = fakeWindow();
    const off = installSaveEpochWatcher(target);
    const start = getSaveEpoch();
    await target.fetch("/api/restaurant/recipes/costing?vista=plato");
    await target.fetch("/api/restaurant/menu-dishes", { method: "POST" });
    expect(getSaveEpoch()).toBe(start + 1);
    await target.fetch("/somewhere/else", { method: "POST" });
    expect(getSaveEpoch()).toBe(start + 1);
    off();
    const failing = fakeWindow(500);
    const off2 = installSaveEpochWatcher(failing.target);
    await failing.target.fetch("/api/x", { method: "POST" });
    expect(getSaveEpoch()).toBe(start + 1);
    off2();
  });

  it("is installed once, and the uninstaller restores fetch", async () => {
    const { target } = fakeWindow();
    const original = target.fetch;
    const off = installSaveEpochWatcher(target);
    const wrapped = target.fetch;
    installSaveEpochWatcher(target);
    expect(target.fetch).toBe(wrapped);
    off();
    expect(target.fetch).toBe(original);
  });

  it("tells subscribers and makes the Menú tab copies stale", async () => {
    const { target } = fakeWindow();
    const off = installSaveEpochWatcher(target);
    putTab("k", {} as RecipeCostingWorkspace);
    expect(getCachedTab("k")?.fresh).toBe(true);
    let heard = 0;
    const unsubscribe = subscribeSaveEpoch(() => heard++);
    await target.fetch("/api/restaurant/costs/batches/1/undo", {
      method: "POST",
    });
    expect(heard).toBe(1);
    expect(getCachedTab("k")?.fresh).toBe(false);
    unsubscribe();
    off();
  });
});

// ---------------------------------------------------------------------------
// R1-15a: a preparation approved elsewhere never leaves a dish's editor
// telling the person to approve it again.
// ---------------------------------------------------------------------------

import {
  clearEditors,
  getCachedEditor,
  putEditor,
} from "@/lib/restaurant/recipe-costing/editor-cache";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  cachedPickerOptions,
  invalidatePickerOptions,
  rememberPickerOptions,
} from "@/lib/restaurant/recipe-costing/picker-cache";

const stateWith = (waiting: boolean) =>
  ({
    lines: [
      {
        kind: "component",
        amount: waiting ? null : 2.5,
        pending: waiting,
      },
    ],
  }) as unknown as EditorState;

describe("R1-15a: approving a preparation refreshes every dish", () => {
  afterEach(() => clearEditors());

  it("a copy with a preparation waiting for approval is never served", () => {
    putEditor("dish-8oz", stateWith(true));
    expect(getCachedEditor("dish-8oz")).toBeNull();
    putEditor("dish-8oz", stateWith(false));
    expect(getCachedEditor("dish-8oz")?.fresh).toBe(true);
  });

  it("approving a preparation (a successful write) drops every dish's cached editor and the picker", async () => {
    putEditor("dish-6oz", stateWith(false));
    putEditor("dish-8oz", stateWith(false));
    rememberPickerOptions([]);
    expect(cachedPickerOptions()).not.toBeNull();
    const { target } = fakeWindow();
    const off = installSaveEpochWatcher(target);
    await target.fetch("/api/restaurant/recipes/preparations/approve", {
      method: "POST",
    });
    expect(getCachedEditor("dish-6oz")).toBeNull();
    expect(getCachedEditor("dish-8oz")).toBeNull();
    expect(cachedPickerOptions()).toBeNull();
    off();
  });

  it("a plain edit of one dish does not throw away the other dishes' copies", async () => {
    putEditor("dish-next", stateWith(false));
    const { target } = fakeWindow();
    const off = installSaveEpochWatcher(target);
    await target.fetch("/api/restaurant/recipes/editor", { method: "POST" });
    expect(getCachedEditor("dish-next")).not.toBeNull();
    off();
    invalidatePickerOptions();
  });
});
