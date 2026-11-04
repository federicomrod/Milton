// lib/restaurant/kitchen/pin-limit.ts
//
// The lock on PIN login. Counted in the database (kitchen_pin_attempts), so it
// holds across server instances. Two buckets: per cook (the company + the typed
// name, so an unknown name is locked the same as a real one and the lock never
// reveals who exists) and per IP. Subjects are SHA-256 hashes, never a name or
// an IP in the clear.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const STAFF_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 20;
export const LOCK_MS = 15 * 60 * 1000;
/** Failures older than this start a new count. */
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export type AttemptKind = "staff" | "ip";

export const subjectOf = (kind: AttemptKind, value: string) =>
  createHash("sha256").update(`${kind}:${value}`).digest("hex");

interface AttemptRow {
  id: string;
  failures: number;
  first_failed_at: string;
  locked_until: string | null;
}

async function read(
  admin: SupabaseClient,
  kind: AttemptKind,
  subject: string
): Promise<AttemptRow | null> {
  const { data } = await admin
    .from("kitchen_pin_attempts")
    .select("id, failures, first_failed_at, locked_until")
    .eq("kind", kind)
    .eq("subject", subject)
    .maybeSingle();
  return (data as AttemptRow | null) ?? null;
}

/** Seconds left on a lock, or 0. Fails open on a database error (the PIN itself still protects). */
export async function lockedSeconds(
  admin: SupabaseClient,
  buckets: Array<{ kind: AttemptKind; subject: string }>,
  now = Date.now()
): Promise<number> {
  let left = 0;
  for (const b of buckets) {
    try {
      const row = await read(admin, b.kind, b.subject);
      if (row?.locked_until) {
        const ms = new Date(row.locked_until).getTime() - now;
        if (ms > 0) left = Math.max(left, Math.ceil(ms / 1000));
      }
    } catch {
      // keep going
    }
  }
  return left;
}

export async function recordFailure(
  admin: SupabaseClient,
  bucket: { kind: AttemptKind; subject: string; companyId: string | null },
  now = Date.now()
): Promise<void> {
  try {
    const max = bucket.kind === "staff" ? STAFF_MAX_FAILURES : IP_MAX_FAILURES;
    const row = await read(admin, bucket.kind, bucket.subject);
    const fresh =
      !row || now - new Date(row.first_failed_at).getTime() > FAILURE_WINDOW_MS;
    const failures = fresh ? 1 : row.failures + 1;
    const patch = {
      failures,
      first_failed_at: fresh
        ? new Date(now).toISOString()
        : row.first_failed_at,
      locked_until:
        failures >= max ? new Date(now + LOCK_MS).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    };
    if (row) {
      await admin.from("kitchen_pin_attempts").update(patch).eq("id", row.id);
    } else {
      await admin.from("kitchen_pin_attempts").insert({
        company_id: bucket.companyId,
        kind: bucket.kind,
        subject: bucket.subject,
        ...patch,
      });
    }
  } catch (err) {
    console.error(
      "[kitchen-pin-limit] record:",
      err instanceof Error ? err.name : "Unknown error"
    );
  }
}

/** A right PIN clears that cook's count (the IP count stays). */
export async function clearFailures(
  admin: SupabaseClient,
  kind: AttemptKind,
  subject: string
): Promise<void> {
  try {
    await admin
      .from("kitchen_pin_attempts")
      .delete()
      .eq("kind", kind)
      .eq("subject", subject);
  } catch {
    // nothing to clear
  }
}
