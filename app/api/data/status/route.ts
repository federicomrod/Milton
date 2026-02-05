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
          .select("required_table_ids")
          .eq("key", businessModel.business_type)
          .single();

        if (template) {
          // Fetch required tables from centralized data_tables
          let requiredTables: any[] = [];
          let dataTables: any[] = [];
          try {
            if (
              template.required_table_ids &&
              template.required_table_ids.length > 0
            ) {
              const { createClient } = await import("@/lib/supabase/server");
              const supabaseServer = await createClient();
              const { data: fetchedDataTables } = await supabaseServer
                .from("data_tables")
                .select("id, name")
                .in("id", template.required_table_ids);

              if (fetchedDataTables) {
                dataTables = fetchedDataTables;
                requiredTables = fetchedDataTables.map((table) => ({
                  id: table.id,
                  name: table.name,
                }));
              }
            }
          } catch (e) {
            console.error("[data/status] Failed to fetch required tables:", e);
          }

          // Fetch model_data to check what tables exist
          const { data: modelData, error: modelDataError } = await supabase
            .from("model_data")
            .select("model_table_id")
            .eq("company_id", companyId);

          if (!modelDataError && modelData) {
            modelDataCount = modelData.length;
            const tableIds = [
              ...new Set(modelData.map((d) => d.model_table_id)),
            ];

            // Check which sections should be enabled based on table categories
            if (
              template.required_table_ids &&
              template.required_table_ids.length > 0 &&
              dataTables
            ) {
              // Map table names to frontend sections
              const bankTableNames = [
                "transactions",
                "revenue",
                "income",
                "expense",
                "payments",
                "financial",
                "classes",
              ];
              const crmTableNames = [
                "customers",
                "clients",
                "crm",
                "deals",
                "leads",
                "contacts",
                "members",
              ];
              const budgetTableNames = [
                "budget",
                "forecast",
                "planning",
                "projections",
              ];

              // Check if tables with data match section categories
              hasModelTransactions = template.required_table_ids.some(
                (id: string) => {
                  const table = dataTables.find((dt: any) => dt.id === id);
                  return (
                    table &&
                    tableIds.includes(id) &&
                    bankTableNames.some((name) =>
                      table.name.toLowerCase().includes(name.toLowerCase())
                    )
                  );
                }
              );

              hasModelCrm = template.required_table_ids.some((id: string) => {
                const table = dataTables.find((dt: any) => dt.id === id);
                return (
                  table &&
                  tableIds.includes(id) &&
                  crmTableNames.some((name) =>
                    table.name.toLowerCase().includes(name.toLowerCase())
                  )
                );
              });

              hasModelBudget = template.required_table_ids.some(
                (id: string) => {
                  const table = dataTables.find((dt: any) => dt.id === id);
                  return (
                    table &&
                    tableIds.includes(id) &&
                    budgetTableNames.some((name) =>
                      table.name.toLowerCase().includes(name.toLowerCase())
                    )
                  );
                }
              );

              // If no specific categories matched but we have data, enable all sections
              const hasData = template.required_table_ids.some((id: string) =>
                tableIds.includes(id)
              );
              if (
                hasData &&
                !hasModelTransactions &&
                !hasModelCrm &&
                !hasModelBudget
              ) {
                hasModelTransactions = true;
                hasModelCrm = true;
                hasModelBudget = true;
              }
            }
          }
        } else {
          // No template, but check if model_data exists (fallback)
          const { data: modelData, error: modelDataError } = await supabase
            .from("model_data")
            .select("model_table_id", { count: "exact" })
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
