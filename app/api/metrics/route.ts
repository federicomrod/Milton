import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/metrics - Fetch metrics for the current user's company
 * Returns the metrics that are selected for display on the dashboard
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
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

    // Get user's company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json(
        { success: false, error: "Company not found" },
        { status: 404 }
      );
    }

    // Get the business model for this company
    const { data: businessModel, error: businessModelError } = await supabase
      .from("business_models")
      .select("metrics")
      .eq("company_id", company.id)
      .single();

    if (businessModelError || !businessModel) {
      console.log(
        "[GET /api/metrics] No business model found, returning empty array"
      );
      return NextResponse.json([]);
    }

    const metricIds = businessModel.metrics as string[];
    if (!metricIds || metricIds.length === 0) {
      return NextResponse.json([]);
    }

    // Get the metrics
    const { data, error } = await supabase
      .from("metrics")
      .select("*")
      .in("id", metricIds);

    if (error) {
      console.error("[GET /api/metrics] error:", error);
      return NextResponse.json([]);
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error("[GET /api/metrics] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/metrics - Save selected metrics for the current user's company
 * Updates the business_models.metrics field with selected metric UUIDs
 */
export async function PUT(req: NextRequest) {
  try {
    const { metricIds } = await req.json();

    if (!Array.isArray(metricIds)) {
      return NextResponse.json(
        { success: false, error: "metricIds must be an array" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get authenticated user
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

    // Get user's company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json(
        { success: false, error: "Company not found" },
        { status: 404 }
      );
    }

    // Update company's selected metrics
    const { error: updateError } = await supabase
      .from("business_models")
      .update({ metrics: metricIds })
      .eq("company_id", company.id);

    if (updateError) {
      console.error("[PUT /api/metrics] error:", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to update metrics" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PUT /api/metrics] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
