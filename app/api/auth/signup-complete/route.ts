// app/api/auth/signup-complete/route.ts
//
// POST /api/auth/signup-complete
//   Body: { userId: string, companyName: string }
//
// Creates the profile, company, and company_membership rows for a new user.
//
// ROOT CAUSE OF RECURRING BUG — why we now use adminClient.rpc():
//
//   Supabase exposes its database through PostgREST. PostgREST builds a schema
//   cache at startup that classifies primary-key columns as "read-only" when
//   it considers them server-generated. When PostgREST receives a payload like
//   { id, user_id, role } it silently strips "id" before building the INSERT,
//   producing: INSERT INTO profiles (user_id, role) VALUES (...)
//   That leaves id as NULL → NOT NULL constraint violation →
//   "null value in column 'id' of relation 'profiles'"
//
//   Confirmed by inspecting the compiled .next bundle: the JS payload was
//   correct (id was present), but the error persisted — meaning PostgREST
//   was stripping it on the way to Postgres.
//
//   Fix: call a SECURITY DEFINER function via rpc(). The function body runs
//   inside Postgres directly — PostgREST cannot filter its column list.
//
// REQUIRED SQL — run once in Supabase SQL Editor:
//   See supabase/migrations/011_bootstrap_restaurant_user.sql

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const { userId, companyName } = await req.json();

    if (!userId || !companyName) {
      return NextResponse.json(
        { error: "Missing userId or companyName" },
        { status: 400 }
      );
    }

    // Validate userId format (UUID)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return NextResponse.json(
        { error: "Invalid userId format" },
        { status: 400 }
      );
    }

    console.log(
      "[signup-complete] signup user id:",
      userId,
      "| profile payload id: yes (sent via RPC, not REST insert)"
    );

    const adminClient = createAdminClient();

    // ── Primary path: RPC ─────────────────────────────────────────────────
    // bootstrap_restaurant_user() executes raw SQL inside Postgres.
    // PostgREST cannot strip the `id` column from a function body.
    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      "bootstrap_restaurant_user",
      { p_user_id: userId, p_company_name: companyName }
    );

    if (rpcError) {
      // Surface the real Postgres error (code + message + hint) so it is
      // visible in Vercel logs and can be diagnosed without guessing.
      // Common cause: migration 011 not yet applied in Supabase.
      console.error("[signup-complete] RPC error:", {
        message: rpcError.message,
        code: (rpcError as { code?: string }).code,
        details: (rpcError as { details?: string }).details,
        hint: (rpcError as { hint?: string }).hint,
      });
      return NextResponse.json(
        {
          error: `Bootstrap failed: ${rpcError.message}`,
          hint: "Apply supabase/migrations/011_bootstrap_restaurant_user.sql in the Supabase SQL Editor.",
        },
        { status: 500 }
      );
    }

    const companyId =
      (rpcData as { company_id?: string } | null)?.company_id ?? null;
    console.log(
      "[signup-complete] Bootstrap complete via RPC. company_id:",
      companyId
    );
    return NextResponse.json({ success: true, companyId });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[signup-complete] Unexpected error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
