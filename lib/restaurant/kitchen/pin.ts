// lib/restaurant/kitchen/pin.ts
//
// The cook's PIN (4–6 digits). Pure helpers, no database. The PIN is hashed
// with scrypt and a per-PIN random salt; the raw PIN is never stored, logged or
// returned. Verification is constant-time.

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";

export const PIN_MIN = 4;
export const PIN_MAX = 6;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

/** True for 4–6 ASCII digits. */
export function isValidPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4,6}$/.test(value);
}

/** PINs that are too easy to guess are refused when a cook chooses one. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 0000, 1111, 999999
  const asc = "0123456789";
  const desc = "9876543210";
  return asc.includes(pin) || desc.includes(pin); // 1234, 4321, 123456
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "base64");
    const actual = scryptSync(
      pin,
      Buffer.from(salt, "base64"),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      }
    );
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

/** Work done on an unknown cook so a wrong name takes as long as a wrong PIN. */
export function burnPinTime(pin: string): void {
  verifyPin(pin, DUMMY_HASH);
}
const DUMMY_HASH = hashPin("000000");

/** A temporary PIN for a manager's reset: 6 digits, not weak. */
export function generateTemporaryPin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (!isWeakPin(pin)) return pin;
  }
}

/** Case, accents and extra spaces do not matter when a cook types their name. */
export function normalizeStaffName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
export const KITCHEN_CODE_LENGTH = 6;

export function generateKitchenCode(): string {
  let out = "";
  for (let i = 0; i < KITCHEN_CODE_LENGTH; i++)
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return out;
}

export function normalizeKitchenCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
