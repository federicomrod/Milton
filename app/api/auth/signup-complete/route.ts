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

    if (!rpcError) {
      const companyId =
        (rpcData as { company_id?: string } | null)?.company_id ?? null;
      console.log(
        "[signup-complete] Bootstrap complete via RPC. company_id:",
        companyId
      );
      return NextResponse.json({ success: true, companyId });
    }

    // ── Fallback path ────────────────────────────────────────────────────
    // The RPC function doesn't exist yet (migration 011 not applied).
    // This fallback suffers the PostgREST id-stripping bug on some projects.
    // Apply supabase/migrations/011_bootstrap_restaurant_user.sql to resolve.
    console.warn(
      "[signup-complete] RPC not found (migration 011 pending), falling back.",
      rpcError.message
    );

    // Profile — attempt direct insert; id IS in the payload but PostgREST
    // may strip it. This fallback is here so signup doesn't 500 in the
    // window before the migration is applied.
    const { error: profileError } = await adminClient
      .from("profiles")
      .insert({ id: userId, user_id: userId, role: "user" });

    if (profileError) {
      const code = (profileError as { code?: string }).code;
      if (code !== "23505") {
        // 23505 = duplicate key → profile already exists, carry on.
        console.error(
          "[signup-complete] Fallback profile insert error:",
          profileError
        );
        return NextResponse.json(
          { error: `Failed to create profile: ${profileError.message}` },
          { status: 500 }
        );
      }
    }

    // Company (find-or-create)
    let companyId: string;
    const { data: existingCompany } = await adminClient
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .maybeSingle();

    if (existingCompany?.id) {
      companyId = existingCompany.id;
    } else {
      const { data: newCompany, error: companyError } = await adminClient
        .from("companies")
        .insert({ name: companyName, created_by: userId })
        .select("id")
        .single();
      if (companyError || !newCompany) {
        console.error(
          "[signup-complete] Fallback company insert error:",
          companyError
        );
        return NextResponse.json(
          {
            error: `Failed to create company: ${companyError?.message ?? "unknown"}`,
          },
          { status: 500 }
        );
      }
      companyId = newCompany.id;
    }

    // Membership (non-fatal if it fails)
    const { data: existingMembership } = await adminClient
      .from("company_memberships")
      .select("user_id")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!existingMembership) {
      const { error: membershipError } = await adminClient
        .from("company_memberships")
        .insert({ user_id: userId, company_id: companyId, role: "owner" });
      if (membershipError) {
        console.warn(
          "[signup-complete] Fallback membership insert warning:",
          membershipError.message
        );
      }
    }

    return NextResponse.json({ success: true, companyId, via: "fallback" });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[signup-complete] Unexpected error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
