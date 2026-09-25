import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  secretBelongsToCompany,
  OdooSecretConfigError,
  OdooSecretDecryptionError,
  type EncryptedPayload,
} from "@/lib/restaurant/odoo/secrets";

// Odoo Production Hardening v1 — proves the AES-256-GCM credential
// encryption is correct and fails safely, and that the company-scoping
// guard genuinely rejects a foreign company's secret row.

const KEY_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes, base64
const KEY_B = "//////////////////////////////////////////8="; // 32 0xFF bytes, base64

const ORIGINAL_ENV = process.env.ODOO_CREDENTIALS_ENCRYPTION_KEY;

function setKey(key: string | undefined) {
  if (key === undefined) {
    delete process.env.ODOO_CREDENTIALS_ENCRYPTION_KEY;
  } else {
    process.env.ODOO_CREDENTIALS_ENCRYPTION_KEY = key;
  }
}

beforeEach(() => {
  setKey(KEY_A);
});

afterEach(() => {
  setKey(ORIGINAL_ENV);
});

describe("encryptSecret / decryptSecret — round trip (scenario 1)", () => {
  it("decrypts back to the exact original plaintext", () => {
    const plaintext = "super-secret-odoo-api-key-12345";
    const payload = encryptSecret(plaintext);
    expect(decryptSecret(payload)).toBe(plaintext);
  });

  it("round-trips unicode/special characters cleanly", () => {
    const plaintext = "clé-señor-émoji-🔒-tab\tnewline\n";
    const payload = encryptSecret(plaintext);
    expect(decryptSecret(payload)).toBe(plaintext);
  });

  it("round-trips an empty-adjacent but realistic long key", () => {
    const plaintext = "a".repeat(200);
    const payload = encryptSecret(plaintext);
    expect(decryptSecret(payload)).toBe(plaintext);
  });
});

describe("encryptSecret — distinct IVs (scenario 2)", () => {
  it("encrypting the same plaintext twice produces different ciphertext and different IVs", () => {
    const plaintext = "same-secret-every-time";
    const first = encryptSecret(plaintext);
    const second = encryptSecret(plaintext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    // Both still decrypt correctly despite differing.
    expect(decryptSecret(first)).toBe(plaintext);
    expect(decryptSecret(second)).toBe(plaintext);
  });
});

describe("decryptSecret — wrong key fails safely (scenario 3)", () => {
  it("throws OdooSecretDecryptionError (never the raw crypto error) when decrypting with a different key", () => {
    const plaintext = "secret-encrypted-with-key-a";
    const payload = encryptSecret(plaintext);

    setKey(KEY_B);
    let thrown: unknown;
    try {
      decryptSecret(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OdooSecretDecryptionError);
  });

  it("the thrown error never contains the plaintext or either key", () => {
    const plaintext = "highly-specific-plaintext-marker-xyz";
    const payload = encryptSecret(plaintext);
    setKey(KEY_B);
    try {
      decryptSecret(payload);
      throw new Error("expected decryptSecret to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(plaintext);
      expect(message).not.toContain(KEY_A);
      expect(message).not.toContain(KEY_B);
    }
  });
});

describe("decryptSecret — malformed payload fails safely (scenario 4)", () => {
  it("rejects a corrupted ciphertext (auth tag mismatch)", () => {
    const payload = encryptSecret("some-secret");
    const corrupted: EncryptedPayload = {
      ...payload,
      ciphertext: Buffer.from("not the real ciphertext bytes!!").toString(
        "base64"
      ),
    };
    expect(() => decryptSecret(corrupted)).toThrow(OdooSecretDecryptionError);
  });

  it("rejects a corrupted auth tag", () => {
    const payload = encryptSecret("some-secret");
    const corrupted: EncryptedPayload = {
      ...payload,
      authTag: Buffer.from("0123456789abcdef").toString("base64"),
    };
    expect(() => decryptSecret(corrupted)).toThrow(OdooSecretDecryptionError);
  });

  it("rejects a wrong-length IV", () => {
    const payload = encryptSecret("some-secret");
    const corrupted: EncryptedPayload = {
      ...payload,
      iv: Buffer.from("too-short").toString("base64"),
    };
    expect(() => decryptSecret(corrupted)).toThrow(OdooSecretDecryptionError);
  });

  it("rejects non-base64 garbage without throwing an unrelated error type", () => {
    const corrupted: EncryptedPayload = {
      ciphertext: "!!!not-base64!!!",
      iv: "!!!not-base64!!!",
      authTag: "!!!not-base64!!!",
    };
    expect(() => decryptSecret(corrupted)).toThrow(OdooSecretDecryptionError);
  });
});

describe("encryption key configuration", () => {
  it("throws OdooSecretConfigError when ODOO_CREDENTIALS_ENCRYPTION_KEY is unset", () => {
    setKey(undefined);
    expect(() => encryptSecret("x")).toThrow(OdooSecretConfigError);
  });

  it("throws OdooSecretConfigError for a key that doesn't decode to 32 bytes", () => {
    setKey(Buffer.from("too short").toString("base64"));
    expect(() => encryptSecret("x")).toThrow(OdooSecretConfigError);
  });
});

describe("secretBelongsToCompany — pure security guard (scenario 6)", () => {
  it("returns true when the row's company_id matches the requesting company", () => {
    expect(
      secretBelongsToCompany({ company_id: "company-a" }, "company-a")
    ).toBe(true);
  });

  it("returns false for a different company's row — company A can never use company B's secret", () => {
    expect(
      secretBelongsToCompany({ company_id: "company-b" }, "company-a")
    ).toBe(false);
  });

  it("returns false for a null/undefined row (not found)", () => {
    expect(secretBelongsToCompany(null, "company-a")).toBe(false);
    expect(secretBelongsToCompany(undefined, "company-a")).toBe(false);
  });
});
