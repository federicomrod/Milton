import { describe, expect, it } from "vitest";
import { de, en, es } from "../i18n/strings";
import {
  digitsOnly,
  isPinFormat,
  isWeakPin,
  lockMinutes,
  normalizeKitchenCode,
  pinLoginOutcome,
  pinProblem,
} from "./pin";

describe("PIN rules (same as the server)", () => {
  it("4 to 6 digits only", () => {
    for (const ok of ["4821", "48213", "482135"])
      expect(isPinFormat(ok)).toBe(true);
    for (const bad of ["", "123", "1234567", "48a1", "48 21", "４８２１"])
      expect(isPinFormat(bad)).toBe(false);
  });
  it("refuses the same digit and straight runs", () => {
    for (const weak of [
      "0000",
      "1111",
      "999999",
      "1234",
      "4321",
      "123456",
      "6789",
      "9876",
      "3210",
    ])
      expect(isWeakPin(weak)).toBe(true);
    for (const fine of ["4821", "1357", "1243", "0123 ".trim() + "9"]) {
      expect(isWeakPin(fine)).toBe(false);
    }
  });
  it("reports the first problem; a matching good PIN is fine", () => {
    expect(pinProblem("12")).toBe("format");
    expect(pinProblem("1234")).toBe("weak");
    expect(pinProblem("4821", "4822")).toBe("mismatch");
    expect(pinProblem("4821", "4821")).toBeNull();
    expect(pinProblem("4821")).toBeNull();
  });
  it("every problem has friendly text in es, en and de", () => {
    for (const d of [es, en, de]) {
      for (const p of ["format", "weak", "mismatch"] as const) {
        expect(d.pin[p].length).toBeGreaterThan(5);
      }
    }
  });
  it("keeps only digits and tidies the kitchen code", () => {
    expect(digitsOnly("4a8 2-1999")).toBe("482199");
    expect(normalizeKitchenCode(" k7m 2qx ")).toBe("K7M2QX");
  });
});

describe("PIN login outcomes", () => {
  it("a failed login never says which part was wrong (one outcome)", () => {
    expect(pinLoginOutcome({ status: 401, reason: "failed" })).toEqual({
      kind: "failed",
    });
    expect(pinLoginOutcome({ status: 401 })).toEqual({ kind: "failed" });
  });
  it("a lock shows the minutes left, rounded up, at least one", () => {
    expect(
      pinLoginOutcome({ status: 429, reason: "locked", retryAfterSeconds: 840 })
    ).toEqual({ kind: "locked", minutes: 14 });
    expect(lockMinutes(61)).toBe(2);
    expect(lockMinutes(5)).toBe(1);
    expect(lockMinutes(undefined)).toBe(15);
  });
  it("trouble reaching Milton keeps the generic messages", () => {
    expect(pinLoginOutcome({ kind: "network" })).toEqual({ kind: "other" });
    expect(pinLoginOutcome({ status: 503 })).toEqual({ kind: "other" });
    expect(pinLoginOutcome(null)).toEqual({ kind: "other" });
  });
  it("the PIN screen texts exist and the «ask your boss» line is there", () => {
    expect(es.login.askBoss).toBe(
      "Pide a tu encargado un PIN o un nuevo enlace."
    );
    for (const d of [es, en, de]) {
      expect(d.login.failed).not.toMatch(/código.*incorrect|name.*wrong/i);
      expect(d.login.locked).toContain("{minutes}");
    }
  });
});
