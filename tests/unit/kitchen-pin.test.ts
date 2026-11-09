// The PIN helpers: 4–6 digits, weak ones refused, scrypt hash with a salt,
// constant-time verify, names matched without case/accents. Demo data only.
import { describe, expect, it } from "vitest";
import {
  generateKitchenCode,
  generateTemporaryPin,
  hashPin,
  isValidPin,
  isWeakPin,
  normalizeKitchenCode,
  normalizeStaffName,
  verifyPin,
} from "@/lib/restaurant/kitchen/pin";

describe("PIN rules", () => {
  it("accepts only 4–6 digits", () => {
    for (const ok of ["2468", "13579", "864209"])
      expect(isValidPin(ok)).toBe(true);
    for (const bad of ["123", "1234567", "12a4", "", " 2468", 2468, null])
      expect(isValidPin(bad)).toBe(false);
  });
  it("refuses PINs that are easy to guess", () => {
    for (const weak of ["0000", "1111", "999999", "1234", "4321", "123456"])
      expect(isWeakPin(weak), weak).toBe(true);
    for (const fine of ["2468", "1357", "802416"])
      expect(isWeakPin(fine), fine).toBe(false);
  });
  it("a temporary PIN is 6 digits and never weak", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPin();
      expect(isValidPin(p) && p.length === 6).toBe(true);
      expect(isWeakPin(p)).toBe(false);
    }
  });
});

describe("hashing", () => {
  it("is salted scrypt: the PIN is not in the hash and two hashes differ", () => {
    const a = hashPin("2468");
    const b = hashPin("2468");
    expect(a).toMatch(/^scrypt\$/);
    expect(a).not.toContain("2468");
    expect(a).not.toBe(b);
    expect(verifyPin("2468", a)).toBe(true);
    expect(verifyPin("2469", a)).toBe(false);
    expect(verifyPin("2468", "garbage")).toBe(false);
  });
});

describe("names and codes", () => {
  it("names ignore case, accents and extra spaces", () => {
    expect(normalizeStaffName("  JOSÉ   Pérez ")).toBe("jose perez");
  });
  it("the kitchen code is 6 letters/digits without look-alikes and is typed forgivingly", () => {
    expect(generateKitchenCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(normalizeKitchenCode(" k7m-2qx ")).toBe("K7M2QX");
  });
});
