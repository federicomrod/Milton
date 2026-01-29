import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") ?? undefined;
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "");

    // createClient expects cookies, not a token. Provide no argument, use global auth.
    const supabase = await createClient();

    // Set the access token manually if present, before accessing user session
    if (accessToken) {
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: "",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      if (process.env.NODE_ENV === "development") {
        return NextResponse.json({
          ok: true,
          bank: true,
          crm: true,
          budget: true,
        });
      }
      return NextResponse.json({
        ok: true,
        bank: false,
        crm: false,
        budget: false,
      });
    }

    const userId = user.id;

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .single();
    const companyId = company?.id ?? null;

    // Check flexible model data only (legacy tables removed)
    let hasModelTransactions = false;
    let hasModelCrm = false;
    let hasModelBudget = false;
    let modelDataCount = 0;

    if (companyId) {
      // Get business model template to understand data structure
      const { data: businessModel } = await supabase
        .from("business_models")
        .select("business_type")
        .eq("company_id", companyId)
        .single();

      if (businessModel?.business_type) {
        const { data: template } = await supabase
          .from("business_model_templates")
          .select("required_tables_data, data_categories")
          .eq("key", businessModel.business_type)
          .single();

        if (template) {
          // Parse required_tables_data and data_categories
          let requiredTables: any[] = [];
          let dataCategories: any[] = [];
          try {
            if (typeof template.required_tables_data === "string") {
              requiredTables = JSON.parse(template.required_tables_data);
            } else if (Array.isArray(template.required_tables_data)) {
              requiredTables = template.required_tables_data;
            }
            if (typeof template.data_categories === "string") {
              dataCategories = JSON.parse(template.data_categories);
            } else if (Array.isArray(template.data_categories)) {
              dataCategories = template.data_categories;
            }
          } catch (e) {
            console.error("[data/status] Failed to parse template:", e);
          }

          // Fetch model_data to check what tables exist
          const { data: modelData, error: modelDataError } = await supabase
            .from("model_data")
            .select("model_table_name")
            .eq("company_id", companyId);

          if (!modelDataError && modelData) {
            modelDataCount = modelData.length;
            const tableNames = [
              ...new Set(modelData.map((d) => d.model_table_name)),
            ];

            // Map tables to categories based on table names and data categories
            // Check for transaction-like tables (cash flow)
            const transactionLikeTables = tableNames.filter(
              (name) =>
                name.toLowerCase().includes("transaction") ||
                name.toLowerCase().includes("payment") ||
                name.toLowerCase().includes("revenue") ||
                name.toLowerCase().includes("expense") ||
                name.toLowerCase().includes("cash")
            );
            hasModelTransactions = transactionLikeTables.length > 0;

            // Check for CRM-like tables (sales pipeline)
            const crmLikeTables = tableNames.filter(
              (name) =>
                name.toLowerCase().includes("deal") ||
                name.toLowerCase().includes("crm") ||
                name.toLowerCase().includes("opportunity") ||
                name.toLowerCase().includes("lead") ||
                name.toLowerCase().includes("pipeline")
            );
            hasModelCrm = crmLikeTables.length > 0;

            // Check for budget-like tables (financial analysis)
            const budgetLikeTables = tableNames.filter(
              (name) =>
                name.toLowerCase().includes("budget") ||
                name.toLowerCase().includes("plan") ||
                name.toLowerCase().includes("forecast")
            );
            hasModelBudget = budgetLikeTables.length > 0;

            // Also check data categories if available
            const categoryIds = dataCategories.map(
              (c) => c.id?.toLowerCase() || ""
            );
            if (
              categoryIds.includes("revenue") ||
              categoryIds.includes("expenses") ||
              categoryIds.includes("cash_flows")
            ) {
              hasModelTransactions = true;
            }
            if (
              categoryIds.includes("deals") ||
              categoryIds.includes("pipeline")
            ) {
              hasModelCrm = true;
            }
            if (
              categoryIds.includes("budget") ||
              categoryIds.includes("planning")
            ) {
              hasModelBudget = true;
            }
          }
        } else {
          // No template, but check if model_data exists (fallback)
          const { data: modelData, error: modelDataError } = await supabase
            .from("model_data")
            .select("model_table_name", { count: "exact" })
            .eq("company_id", companyId)
            .limit(1);

          if (!modelDataError && modelData) {
            modelDataCount = 1; // At least one record exists
            // Default to showing all sections if model data exists but no template
            hasModelTransactions = true;
            hasModelCrm = true;
            hasModelBudget = true;
          }
        }
      } else {
        // No business model, check if model_data exists (fallback)
        const { data: modelData, error: modelDataError } = await supabase
          .from("model_data")
          .select("*", { count: "exact" })
          .eq("company_id", companyId);

        if (!modelDataError) {
          modelDataCount = modelData?.length ?? 0;
        }
      }
    }

    // DEV fallback: detect orphaned model_data
    if (process.env.NODE_ENV === "development") {
      const { count: globalModelDataCount } = await supabase
        .from("model_data")
        .select("*", { count: "exact" });
      if ((modelDataCount ?? 0) === 0 && (globalModelDataCount ?? 0) > 0) {
        console.warn(
          "⚠️ DEV fallback: found global model data rows without company attribution"
        );
      }
    }

    return NextResponse.json({
      ok: true,
      bank: hasModelTransactions,
      crm: hasModelCrm,
      budget: hasModelBudget,
      hasModelData: modelDataCount > 0,
    });
  } catch (err: any) {
    console.error("❌ /api/data/status failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || "Unexpected server error",
        bank: false,
        crm: false,
        budget: false,
      },
      { status: 500 }
    );
  }
}
