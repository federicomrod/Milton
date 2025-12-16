import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

    // Use admin client to bypass RLS and create profile and company
    // We trust the userId since it comes from a successful signup
    // Database foreign key constraints will protect against invalid userIds
    const adminClient = createAdminClient();

    // Create profile (upsert to handle if it already exists)
    // Note: company_name is not stored in profiles - it's in companies table
    const { error: profileError } = await adminClient.from("profiles").upsert(
      {
        user_id: userId,
      },
      {
        onConflict: "user_id",
      }
    );

    if (profileError) {
      console.error("Profile creation error:", profileError);
      return NextResponse.json(
        { error: `Failed to create profile: ${profileError.message}` },
        { status: 500 }
      );
    }

    // Create company
    const { data: company, error: companyError } = await adminClient
      .from("companies")
      .insert({
        name: companyName,
        created_by: userId,
      })
      .select("id")
      .single();

    if (companyError) {
      console.error("Company creation error:", companyError);
      return NextResponse.json(
        { error: `Failed to create company: ${companyError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      companyId: company.id,
    });
  } catch (error: any) {
    console.error("Signup complete API error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
