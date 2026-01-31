import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/metrics/available - Fetch available metrics for customization
 * Returns metrics from the business model template's suggested_metrics
 * Falls back to all metrics if no business model exists
 * Used by MetricSelector to show which metrics can be selected
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

    let metrics;

    // Try to get business model and its business_type
    const { data: businessModel, error: businessModelError } = await supabase
      .from("business_models")
      .select("business_type")
      .eq("company_id", company.id)
      .single();

    if (businessModelError || !businessModel || !businessModel.business_type) {
      console.log(
        "[GET /api/metrics/available] No business model found, returning all metrics"
      );
      // Fall back to all metrics if no business model exists
      const { data, error } = await supabase
        .from("metrics")
        .select("*")
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        console.error(
          "[GET /api/metrics/available] error fetching all metrics:",
          error
        );
        return NextResponse.json([]);
      }

      metrics = data || [];
    } else {
      // Get suggested metrics for this business type
      const { data: template, error: templateError } = await supabase
        .from("business_model_templates")
        .select("suggested_metrics")
        .eq("key", businessModel.business_type)
        .single();

      if (templateError || !template) {
        console.log(
          "[GET /api/metrics/available] Template not found, returning all metrics"
        );
        // Fall back to all metrics
        const { data, error } = await supabase
          .from("metrics")
          .select("*")
          .order("category", { ascending: true })
          .order("name", { ascending: true });

        if (error) {
          console.error(
            "[GET /api/metrics/available] error fetching all metrics:",
            error
          );
          return NextResponse.json([]);
        }

        metrics = data || [];
      } else {
        const metricIds = template.suggested_metrics as string[];
        if (!metricIds || metricIds.length === 0) {
          // No suggested metrics, return all metrics
          const { data, error } = await supabase
            .from("metrics")
            .select("*")
            .order("category", { ascending: true })
            .order("name", { ascending: true });

          if (error) {
            console.error(
              "[GET /api/metrics/available] error fetching all metrics:",
              error
            );
            return NextResponse.json([]);
          }

          metrics = data || [];
        } else {
          // Get the specific suggested metrics
          const { data, error } = await supabase
            .from("metrics")
            .select("*")
            .in("id", metricIds);

          if (error) {
            console.error(
              "[GET /api/metrics/available] error fetching suggested metrics:",
              error
            );
            return NextResponse.json([]);
          }

          metrics = data || [];
        }
      }
    }

    return NextResponse.json(metrics);
  } catch (error) {
    console.error("[GET /api/metrics/available] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
