import { describe, expect, it } from "vitest";
import { outboxOnSignIn, pinGate } from "./stay-signed-in";

describe("outbox after a confirmed revoke", () => {
  it("is kept when the same cook signs back in", () => {
    expect(outboxOnSignIn("staff-1", "staff-1")).toBe("keep");
  });
  it("is cleared for a different cook", () => {
    expect(outboxOnSignIn("staff-1", "staff-2")).toBe("clear");
  });
  it("is cleared when nobody is remembered (after «Cerrar sesión» or a fresh phone)", () => {
    expect(outboxOnSignIn(null, "staff-1")).toBe("clear");
  });
});

describe("PIN gate", () => {
  it("forces creating a PIN when there is none, and changing a temporary one", () => {
    expect(pinGate({ set: false, mustChange: false })).toBe("create");
    expect(pinGate({ set: true, mustChange: true })).toBe("change");
    expect(pinGate({ set: false, mustChange: true })).toBe("change");
    expect(pinGate({ set: true, mustChange: false })).toBe("none");
  });
  it("never blocks on an unknown state (offline, older server)", () => {
    expect(pinGate(null)).toBe("none");
    expect(pinGate(undefined)).toBe("none");
  });
});
