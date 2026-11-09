import { describe, expect, it, vi } from "vitest";
import {
  LOCK_AFTER_MS,
  biometricAvailable,
  confirmAndStorePin,
  disableBiometric,
  enableBiometric,
  localPinMatches,
  shouldLock,
  shouldOffer,
  unlockStoredPin,
  type BiometricNative,
  type PinVault,
} from "./biometric";

const prompt = { promptMessage: "m", cancelLabel: "c" };

function native(over: Partial<BiometricNative> = {}): BiometricNative {
  return {
    hasHardware: async () => true,
    isEnrolled: async () => true,
    authenticate: async () => ({ success: true }),
    ...over,
  };
}
function vault(initial: string | null = "4821") {
  let value = initial;
  const v: PinVault = {
    get: vi.fn(async () => value),
    set: vi.fn(async (p: string) => {
      value = p;
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
  };
  return v;
}

describe("biometrics: availability and offer", () => {
  it("needs hardware AND an enrolled face / finger; errors mean no", async () => {
    expect(await biometricAvailable(native())).toBe(true);
    expect(
      await biometricAvailable(native({ hasHardware: async () => false }))
    ).toBe(false);
    expect(
      await biometricAvailable(native({ isEnrolled: async () => false }))
    ).toBe(false);
    expect(
      await biometricAvailable(
        native({
          hasHardware: async () => {
            throw new Error("module missing");
          },
        })
      )
    ).toBe(false);
  });
  it("is offered only when it works and is not on yet", () => {
    expect(shouldOffer({ available: true, enabled: false })).toBe(true);
    expect(shouldOffer({ available: true, enabled: true })).toBe(false);
    expect(shouldOffer({ available: false, enabled: false })).toBe(false);
  });
});

describe("biometrics: unlocking the stored PIN, always with a fallback", () => {
  it("hands over the PIN after a successful scan", async () => {
    expect(await unlockStoredPin(native(), vault(), prompt)).toEqual({
      kind: "pin",
      pin: "4821",
    });
  });
  it("no hardware / nothing enrolled falls back to typing the PIN", async () => {
    const v = vault();
    expect(
      await unlockStoredPin(
        native({ hasHardware: async () => false }),
        v,
        prompt
      )
    ).toEqual({ kind: "fallback", reason: "unavailable" });
    expect(v.get).not.toHaveBeenCalled();
  });
  it("a cancel, a failed scan or a thrown error falls back and never reads the PIN", async () => {
    for (const authenticate of [
      async () => ({ success: false }),
      async () => {
        throw new Error("user cancelled");
      },
    ]) {
      const v = vault();
      expect(
        await unlockStoredPin(native({ authenticate }), v, prompt)
      ).toEqual({
        kind: "fallback",
        reason: "cancelled",
      });
      expect(v.get).not.toHaveBeenCalled();
    }
  });
  it("a missing or unreadable stored PIN falls back too", async () => {
    expect(await unlockStoredPin(native(), vault(null), prompt)).toEqual({
      kind: "fallback",
      reason: "no_pin",
    });
    const broken: PinVault = {
      get: async () => {
        throw new Error("keychain");
      },
      set: async () => undefined,
      clear: async () => undefined,
    };
    expect(await unlockStoredPin(native(), broken, prompt)).toEqual({
      kind: "fallback",
      reason: "no_pin",
    });
  });
});

describe("biometrics: turning on and off", () => {
  it("keeps the PIN only after the scan works", async () => {
    const v = vault(null);
    expect(await confirmAndStorePin(native(), v, "4821", prompt)).toBe(true);
    expect(v.set).toHaveBeenCalledWith("4821");

    const v2 = vault(null);
    expect(
      await confirmAndStorePin(
        native({ authenticate: async () => ({ success: false }) }),
        v2,
        "4821",
        prompt
      )
    ).toBe(false);
    expect(v2.set).not.toHaveBeenCalled();

    const v3 = vault(null);
    expect(
      await confirmAndStorePin(
        native({ isEnrolled: async () => false }),
        v3,
        "4821",
        prompt
      )
    ).toBe(false);
    expect(v3.set).not.toHaveBeenCalled();
  });
  it("a store that fails is reported, not thrown", async () => {
    const v: PinVault = {
      get: async () => null,
      set: async () => {
        throw new Error("full");
      },
      clear: async () => undefined,
    };
    expect(await enableBiometric(v, "4821")).toBe(false);
  });
  it("turning it off deletes the stored PIN (and never throws)", async () => {
    const v = vault();
    await disableBiometric(v);
    expect(v.clear).toHaveBeenCalled();
    expect(await v.get()).toBeNull();
    await expect(
      disableBiometric({
        get: async () => null,
        set: async () => undefined,
        clear: async () => {
          throw new Error("x");
        },
      })
    ).resolves.toBeUndefined();
  });
});

describe("app lock", () => {
  const base = { enabled: true, unlockedOnce: true, now: 1_000_000 };
  it("asks on a cold open, not when it is off", () => {
    expect(
      shouldLock({ ...base, unlockedOnce: false, backgroundedAt: null })
    ).toBe(true);
    expect(
      shouldLock({
        ...base,
        enabled: false,
        unlockedOnce: false,
        backgroundedAt: null,
      })
    ).toBe(false);
  });
  it("asks after 60 s or more in the background, not before", () => {
    const now = base.now;
    expect(
      shouldLock({ ...base, backgroundedAt: now - (LOCK_AFTER_MS - 1) })
    ).toBe(false);
    expect(shouldLock({ ...base, backgroundedAt: now - LOCK_AFTER_MS })).toBe(
      true
    );
    expect(shouldLock({ ...base, backgroundedAt: null })).toBe(false);
  });
  it("the typed PIN is checked locally against the stored one", () => {
    expect(localPinMatches("4821", "4821")).toBe(true);
    expect(localPinMatches("4822", "4821")).toBe(false);
    expect(localPinMatches("", "")).toBe(false);
    expect(localPinMatches("4821", null)).toBe(false);
  });
});
