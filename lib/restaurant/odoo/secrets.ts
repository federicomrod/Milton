// lib/restaurant/odoo/secrets.ts
//
// Odoo Production Hardening v1 — per-company Odoo credential storage.
//
// Replaces the old sandbox-only ODOO_SANDBOX_API_KEY (one secret, shared
// by every company) with one AES-256-GCM-encrypted secret per
// restaurant_pos_connections row, stored in the service-role-only
// restaurant_pos_secrets table (migration 013).
//
// SECURITY MODEL (read this before touching this file):
//   - The encryption key lives ONLY in the server-only env var
//     ODOO_CREDENTIALS_ENCRYPTION_KEY (Vercel). It is never sent to the
//     browser, never logged, and this module never exposes it.
//   - restaurant_pos_secrets has RLS enabled with ZERO policies — the
//     ONLY way to read or write it is the Supabase service-role client
//     (createAdminClient()), which is why every function below that
//     touches that table uses it instead of the normal RLS-backed client.
//   - Every read is additionally scoped by BOTH connection_id AND
//     company_id at the query level, then re-checked by the pure
//     secretBelongsToCompany() guard below — defense in depth, mirroring
//     the "never trust a single layer" pattern used for restaurant
//     location scoping (lib/restaurant/restaurant-context-server.ts).
//   - This module NEVER logs a plaintext credential, an encryption key,
//     or a decrypted value. Errors thrown here carry only generic,
//     actionable messages — never the secret material itself.
//   - This file is server-only (Node's `crypto` module + the service-role
//     client). It must only ever be imported from route handlers under
//     app/api/**, never from a "use client" component.
//
// This is deliberately the SMALLEST safe design: one active encryption
// key, one secret per connection, no key rotation/versioning machinery.
// If ODOO_CREDENTIALS_ENCRYPTION_KEY is ever rotated, every existing row
// must be re-encrypted with the new key before the old one is removed
// (there is exactly one client/one row today, so this is a manual,
// low-risk operation — not worth automating yet).

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // Standard GCM nonce length
const AUTH_TAG_LENGTH_BYTES = 16; // Standard GCM tag length

export class OdooSecretConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdooSecretConfigError";
  }
}

export class OdooSecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdooSecretDecryptionError";
  }
}

// ---------------------------------------------------------------------------
// Pure encryption primitives — no I/O. Directly unit-testable.
// ---------------------------------------------------------------------------

export interface EncryptedPayload {
  /** base64 AES-256-GCM ciphertext. */
  ciphertext: string;
  /** base64 12-byte nonce, unique per encryption call. */
  iv: string;
  /** base64 16-byte GCM authentication tag. */
  authTag: string;
}

/**
 * Reads and validates the encryption key from ODOO_CREDENTIALS_ENCRYPTION_KEY.
 * Expected format: base64, decoding to exactly 32 bytes (generate with
 * `openssl rand -base64 32`). Never logs the key or its value on failure.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.ODOO_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new OdooSecretConfigError(
      "ODOO_CREDENTIALS_ENCRYPTION_KEY is not set. Odoo credentials cannot be encrypted or decrypted until it is configured."
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new OdooSecretConfigError(
      "ODOO_CREDENTIALS_ENCRYPTION_KEY is not valid base64."
    );
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new OdooSecretConfigError(
      `ODOO_CREDENTIALS_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`
    );
  }
  return key;
}

/**
 * Encrypts a plaintext credential with AES-256-GCM. A fresh random IV is
 * generated on every call, so encrypting the same plaintext twice never
 * produces the same ciphertext.
 */
export function encryptSecret(plaintext: string): EncryptedPayload {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypts a payload produced by encryptSecret(). Throws
 * OdooSecretDecryptionError — never the underlying Node crypto error,
 * and never anything derived from the plaintext or the key — on a wrong
 * key, tampered ciphertext/tag, or malformed base64/lengths.
 */
export function decryptSecret(payload: EncryptedPayload): string {
  const key = getEncryptionKey();

  let iv: Buffer;
  let ciphertext: Buffer;
  let authTag: Buffer;
  try {
    iv = Buffer.from(payload.iv, "base64");
    ciphertext = Buffer.from(payload.ciphertext, "base64");
    authTag = Buffer.from(payload.authTag, "base64");
  } catch {
    throw new OdooSecretDecryptionError(
      "Malformed encrypted credential payload."
    );
  }
  if (
    iv.length !== IV_LENGTH_BYTES ||
    authTag.length !== AUTH_TAG_LENGTH_BYTES
  ) {
    throw new OdooSecretDecryptionError(
      "Malformed encrypted credential payload."
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // GCM authentication failure (wrong key or tampered data) throws here.
    // Never surface the underlying crypto error — it can differ in a way
    // that leaks information about *why* it failed.
    throw new OdooSecretDecryptionError(
      "Could not decrypt credential — wrong key or corrupted data."
    );
  }
}

/**
 * Pure security guard — no I/O, directly unit-testable. Defense in depth
 * on top of the query-level `.eq("company_id", companyId)` filter in
 * loadDecryptedOdooSecret(): even if that filter were ever weakened, a
 * fetched secret row is only trusted when its own company_id matches the
 * requesting company.
 */
export function secretBelongsToCompany<T extends { company_id: string }>(
  row: T | null | undefined,
  companyId: string
): row is T {
  return !!row && row.company_id === companyId;
}

// ---------------------------------------------------------------------------
// I/O — service-role client only. See the security model note at the top
// of this file for why.
// ---------------------------------------------------------------------------

interface SecretRow {
  company_id: string;
  encrypted_secret: string;
  iv: string;
  auth_tag: string;
}

/**
 * Encrypts `plaintextApiKey` and writes it for `connectionId`, scoped to
 * `companyId`. Retry-safe: looks the row up first (keyed by connection_id,
 * which is UNIQUE) and UPDATEs rather than risking a duplicate row on a
 * retried submission — the same idiom used by
 * app/api/restaurant/onboarding/complete/route.ts.
 */
export async function storeOdooSecret(
  connectionId: string,
  companyId: string,
  plaintextApiKey: string
): Promise<void> {
  const payload = encryptSecret(plaintextApiKey);
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("restaurant_pos_secrets")
    .select("id")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(
      `Could not check existing Odoo secret: ${lookupError.message}`
    );
  }

  if (existing?.id) {
    const { error: updateError } = await admin
      .from("restaurant_pos_secrets")
      .update({
        company_id: companyId,
        encrypted_secret: payload.ciphertext,
        iv: payload.iv,
        auth_tag: payload.authTag,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(`Could not update Odoo secret: ${updateError.message}`);
    }
    return;
  }

  const { error: insertError } = await admin
    .from("restaurant_pos_secrets")
    .insert({
      connection_id: connectionId,
      company_id: companyId,
      encrypted_secret: payload.ciphertext,
      iv: payload.iv,
      auth_tag: payload.authTag,
    });
  if (insertError) {
    throw new Error(`Could not store Odoo secret: ${insertError.message}`);
  }
}

/**
 * Loads and decrypts the Odoo credential for `connectionId`, scoped to
 * `companyId`. Returns null when no secret is configured for that
 * connection — callers must treat that as "not connected yet", not an
 * error.
 */
export async function loadDecryptedOdooSecret(
  connectionId: string,
  companyId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("restaurant_pos_secrets")
    .select("company_id, encrypted_secret, iv, auth_tag")
    .eq("connection_id", connectionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not look up Odoo secret: ${error.message}`);
  }
  const row = data as SecretRow | null;
  if (!secretBelongsToCompany(row, companyId)) {
    return null;
  }
  return decryptSecret({
    ciphertext: row.encrypted_secret,
    iv: row.iv,
    authTag: row.auth_tag,
  });
}
