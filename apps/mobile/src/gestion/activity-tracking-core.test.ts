// Tests for pure activity tracking logic (node-compatible).

import { describe, it, expect } from "vitest";
import { shouldPing, throttleKey, THROTTLE_MS } from "./activity-tracking-core";

describe("throttleKey", () => {
  it("should be unique per user and surface", () => {
    expect(throttleKey("u1", "gestion")).toBe("milton_activity_u1_gestion");
    expect(throttleKey("u1", "cocina")).toBe("milton_activity_u1_cocina");
    expect(throttleKey("u2", "gestion")).toBe("milton_activity_u2_gestion");
  });

  it("should be different for each combination", () => {
    const u1g = throttleKey("u1", "gestion");
    const u1c = throttleKey("u1", "cocina");
    const u2g = throttleKey("u2", "gestion");

    expect(u1g).not.toBe(u1c);
    expect(u1g).not.toBe(u2g);
    expect(u1c).not.toBe(u2g);
  });
});

describe("shouldPing", () => {
  const now = Date.now();

  it("should return true when never pinged (lastPing = 0)", () => {
    expect(shouldPing(now, 0)).toBe(true);
  });

  it("should return true when last ping was >= THROTTLE_MS ago", () => {
    const lastPing = now - THROTTLE_MS;
    expect(shouldPing(now, lastPing)).toBe(true);

    const veryOld = now - THROTTLE_MS * 2;
    expect(shouldPing(now, veryOld)).toBe(true);
  });

  it("should return false when last ping was < THROTTLE_MS ago", () => {
    const recent = now - THROTTLE_MS / 2; // 7.5 minutes ago
    expect(shouldPing(now, recent)).toBe(false);

    const justNow = now - 1000; // 1 second ago
    expect(shouldPing(now, justNow)).toBe(false);
  });

  it("should handle edge case of exactly THROTTLE_MS", () => {
    const exactlyThrottleAgo = now - THROTTLE_MS;
    expect(shouldPing(now, exactlyThrottleAgo)).toBe(true);
  });
});
