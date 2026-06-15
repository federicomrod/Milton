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

    // All writes use the admin client (service role key) so RLS never blocks
    // bootstrap. The service role key is server-only — never sent to the client.
    const adminClient = createAdminClient();

    // ── 1. Profile ─────────────────────────────────────────────────────────
    // profiles.id IS the primary key and MUST equal the Supabase auth user id.
    // We intentionally avoid upsert + onConflict here: if user_id lacks a unique
    // constraint in Postgres, PostgREST may generate an INSERT that omits the id
    // field from the actual SQL, causing the NOT NULL violation we are fixing.
    //
    // Pattern: check by real PK (id) → insert only when absent.
    // If a duplicate-key error is returned (concurrent signup), treat as success.

    const profilePayload = {
      id: userId, // PK — profiles.id must equal auth.users.id
      user_id: userId, // secondary lookup column
      role: "user", // safe default; keeps role NOT NULL if column requires it
    };
    console.log(
      "[signup-complete] signup user id:",
      userId,
      "profile payload keys:",
      Object.keys(profilePayload)
    );

    // Check by actual PK so we never rely on user_id having a unique index.
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (!existingProfile) {
      const { error: profileError } = await adminClient
        .from("profiles")
        .insert(profilePayload);

      if (profileError) {
        // 23505 = unique_violation — another request already created the row.
        // Treat as success; the profile exists.
        if ((profileError as { code?: string }).code === "23505") {
          console.log(
            "[signup-complete] Profile already exists (race), continuing."
          );
        } else {
          console.error(
            "[signup-complete] Profile insert error:",
            profileError
          );
          return NextResponse.json(
            { error: `Failed to create profile: ${profileError.message}` },
            { status: 500 }
          );
        }
      }
    } else {
      console.log("[signup-complete] Profile already exists for user:", userId);
    }

    // ── 2. Company (find-or-create) ────────────────────────────────────────
    // Check for an existing company first so retries are idempotent.
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
        console.error("[signup-complete] Company insert error:", companyError);
        return NextResponse.json(
          {
            error: `Failed to create company: ${companyError?.message ?? "unknown"}`,
          },
          { status: 500 }
        );
      }
      companyId = newCompany.id;
    }

    // ── 3. Company membership ──────────────────────────────────────────────
    // RLS policies on restaurant tables use is_company_member(company_id),
    // which checks company_memberships. Insert if not already present.
    // Non-fatal: company resolution via companies.created_by still works
    // even without a membership row, but the membership is needed for RLS.
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
        // Log but don't fail — the user can still access the restaurant dashboard
        // via the companies.created_by fallback. A missing membership only blocks
        // certain RLS-gated writes (targets, cost entries, etc.).
        console.warn(
          "[signup-complete] company_memberships insert warning:",
          membershipError.message
        );
      }
    }

    return NextResponse.json({ success: true, companyId });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("[signup-complete] Unexpected error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
