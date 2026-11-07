import { describe, expect, it } from "vitest";
import {
  outboxOnSignIn,
  pinGate,
  readTokenPatiently,
  startupStatus,
  upgradeTokenAccessibility,
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

describe("one-time accessibility move of an existing login", () => {
  function harness(
    over: {
      done?: boolean;
      reads?: TokenRead[];
      write?: () => Promise<void>;
    } = {}
  ) {
    const reads = [...(over.reads ?? [])];
    const calls = { write: 0, restore: 0, markDone: 0, read: 0 };
    return {
      calls,
      deps: {
        done: async () => over.done ?? false,
        markDone: async () => void calls.markDone++,
        read: async () => (
          calls.read++,
          reads.shift() ?? ({ kind: "absent" } as TokenRead)
        ),
        write: async () => {
          calls.write++;
          await over.write?.();
        },
        restore: async () => void calls.restore++,
      },
    };
  }
  const found: TokenRead = { kind: "found", token: "t" };

  it("moves a found login once and marks it done", async () => {
    const h = harness({ reads: [found, found] });
    expect(await upgradeTokenAccessibility(h.deps)).toBe("upgraded");
    expect(h.calls).toMatchObject({ write: 1, markDone: 1, restore: 0 });
  });
  it("does nothing once it is done (not on every launch)", async () => {
    const h = harness({ done: true, reads: [found] });
    expect(await upgradeTokenAccessibility(h.deps)).toBe("skipped");
    expect(h.calls).toMatchObject({ read: 0, write: 0 });
  });
  it("never touches an absent or unreadable login, and tries again later", async () => {
    for (const r of [
      { kind: "absent" },
      { kind: "unreadable" },
    ] as TokenRead[]) {
      const h = harness({ reads: [r] });
      expect(await upgradeTokenAccessibility(h.deps)).toBe("retry-later");
      expect(h.calls).toMatchObject({ write: 0, restore: 0, markDone: 0 });
    }
  });
  it("a failed write keeps the old login and is not marked done", async () => {
    const h = harness({
      reads: [found],
      write: async () => {
        throw new Error("errSecInteractionNotAllowed");
      },
    });
    expect(await upgradeTokenAccessibility(h.deps)).toBe("retry-later");
    expect(h.calls).toMatchObject({ write: 1, markDone: 0, restore: 0 });
  });
  it("if the read-back is not the same login, the original is saved again and it is not marked done", async () => {
    for (const back of [
      { kind: "unreadable" },
      { kind: "absent" },
      { kind: "found", token: "other" },
    ] as TokenRead[]) {
      const h = harness({ reads: [found, back] });
      expect(await upgradeTokenAccessibility(h.deps)).toBe("retry-later");
      expect(h.calls).toMatchObject({ restore: 1, markDone: 0 });
    }
  });
  it("a failing flag store never loses or blocks the login", async () => {
    const h = harness({ reads: [found, found] });
    h.deps.markDone = async () => {
      throw new Error("asyncstorage");
    };
    await expect(upgradeTokenAccessibility(h.deps)).resolves.toBe("upgraded");
    const g = harness({ reads: [found] });
    g.deps.done = async () => {
      throw new Error("asyncstorage");
    };
    await expect(upgradeTokenAccessibility(g.deps)).resolves.toBeTruthy();
  });
});
