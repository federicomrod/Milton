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
