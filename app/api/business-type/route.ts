import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** GET /api/business-type – return current company business type */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ businessType: null }, { status: 401 });
    }
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();
    if (!company) {
      return NextResponse.json({ businessType: null });
    }
    const { data: businessModel } = await supabase
      .from("business_models")
      .select("business_type")
      .eq("company_id", company.id)
      .single();
    const businessType = (businessModel?.business_type as string) ?? null;
    return NextResponse.json({ businessType });
  } catch (err) {
    console.error("[business-type] GET error", err);
    return NextResponse.json({ businessType: null }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { businessType } = await req.json();

    if (!businessType || typeof businessType !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid businessType" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Get company for user
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return NextResponse.json(
        { success: false, error: "Company not found" },
        { status: 404 }
      );
    }

    // First, try to update existing rows for this company
    const { data: updateData, error: updateError } = await supabase
      .from("business_models")
      .update({ business_type: businessType })
      .eq("company_id", company.id)
      .select("id");

    if (updateError) {
      console.error("[business-type] update error", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to update business_models" },
        { status: 500 }
      );
    }

    if (!updateData || updateData.length === 0) {
      // No existing model for this company – insert a minimal row
      const { error: insertError } = await supabase
        .from("business_models")
        .insert({
          company_id: company.id,
          business_type: businessType,
          // other fields like model_json can be left as defaults/null for now
        });

      if (insertError) {
        console.error("[business-type] insert error", insertError);
        return NextResponse.json(
          { success: false, error: "Failed to insert business_models" },
          { status: 500 }
        );
      }
    }

    console.log(
      `[business-type] Successfully persisted businessType="${businessType}" for company ${company.id}`
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[business-type] unexpected error", err);
    return NextResponse.json(
      { success: false, error: "Unexpected error" },
      { status: 500 }
    );
  }
}
