import { describe, expect, it } from "vitest";
import {
  outboxOnSignIn,
  pinGate,
  readTokenPatiently,
  startupStatus,
} from "./stay-signed-in";
import type { TokenRead } from "../storage/token";

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

describe("opening the app (session loss is not a locked Keychain)", () => {
  const found: TokenRead = { kind: "found", token: "t" };
  it("stays signed in with a token", () => {
    expect(startupStatus(found, false)).toBe("signedIn");
  });
  it("is signed out only when the store clearly has no token", () => {
    expect(startupStatus({ kind: "absent" }, true)).toBe("signedOut");
    expect(startupStatus({ kind: "absent" }, false)).toBe("signedOut");
  });
  it("an unreadable store keeps a remembered cook signed in (never asks for the link)", () => {
    expect(startupStatus({ kind: "unreadable" }, true)).toBe("signedIn");
  });
  it("an unreadable store with nobody remembered is a fresh phone", () => {
    expect(startupStatus({ kind: "unreadable" }, false)).toBe("signedOut");
  });
  it("retries an unreadable store, then returns what it finally says", async () => {
    const answers: TokenRead[] = [
      { kind: "unreadable" },
      { kind: "unreadable" },
      found,
    ];
    const waits: number[] = [];
    const got = await readTokenPatiently(
      async () => answers.shift() as TokenRead,
      async (ms) => void waits.push(ms)
    );
    expect(got).toEqual(found);
    expect(waits).toHaveLength(2);
  });
  it("gives up after the attempts and does not loop forever", async () => {
    let calls = 0;
    const got = await readTokenPatiently(
      async () => (calls++, { kind: "unreadable" } as TokenRead),
      async () => {}
    );
    expect(got.kind).toBe("unreadable");
    expect(calls).toBe(3);
  });
  it("does not retry an «absent» answer", async () => {
    let calls = 0;
    await readTokenPatiently(
      async () => (calls++, { kind: "absent" } as TokenRead),
      async () => {}
    );
    expect(calls).toBe(1);
  });
});
