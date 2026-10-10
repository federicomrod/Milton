import { describe, it, expect } from "vitest";
import {
  createInFlightGuard,
  rangeForPreset,
} from "@/lib/restaurant/odoo/sync-control";

describe("createInFlightGuard", () => {
  it("drops a second call while the first is still running", async () => {
    const guard = createInFlightGuard();
    let started = 0;
    let resolveFirst!: () => void;
    const firstWork = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const first = guard.run(async () => {
      started += 1;
      await firstWork;
      return "first";
    });
    const second = guard.run(async () => {
      started += 1;
      return "second";
    });

    expect(guard.isInFlight()).toBe(true);
    const secondResult = await second;
    expect(secondResult).toEqual({ started: false });
    expect(started).toBe(1);

    resolveFirst();
    const firstResult = await first;
    expect(firstResult).toEqual({ started: true, value: "first" });
    expect(guard.isInFlight()).toBe(false);

    const third = await guard.run(async () => "third");
    expect(third).toEqual({ started: true, value: "third" });
    expect(started).toBe(1);
  });

  it("releases the guard when the first call throws", async () => {
    const guard = createInFlightGuard();
    await expect(
      guard.run(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(guard.isInFlight()).toBe(false);
    const next = await guard.run(async () => 42);
    expect(next).toEqual({ started: true, value: 42 });
  });
});

describe("rangeForPreset", () => {
  const now = new Date(2026, 9, 10); // 10 Oct 2026 local

  it("defaults last 7 days as an inclusive 7-day window ending today", () => {
    expect(rangeForPreset("last_7_days", now)).toEqual({
      start: "2026-10-04",
      end: "2026-10-10",
    });
  });

  it("covers yesterday, this month, and last month", () => {
    expect(rangeForPreset("yesterday", now)).toEqual({
      start: "2026-10-09",
      end: "2026-10-09",
    });
    expect(rangeForPreset("this_month", now)).toEqual({
      start: "2026-10-01",
      end: "2026-10-10",
    });
    expect(rangeForPreset("last_month", now)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });
});
