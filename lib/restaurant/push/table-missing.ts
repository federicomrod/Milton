// lib/restaurant/push/table-missing.ts
//
// Detect when a Supabase operation fails because the push_devices table is
// missing (migration 081 not applied). Supabase-js wraps Postgres errors in
// PostgREST responses, so a missing table usually comes back as PGRST205, not
// the raw Postgres 42P01.

interface SupabaseError {
  code?: string;
  message?: string;
}

/**
 * Is this error "table not found"? Catches both:
 * - PGRST205: PostgREST wrapping a missing table (most common)
 * - 42P01: raw Postgres error (less common)
 */
export function isTableMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as SupabaseError;
  return err.code === "PGRST205" || err.code === "42P01";
}
