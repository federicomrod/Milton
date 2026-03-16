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
          hasModelData: true,
          tablesWithData: [
            { id: "dev-sample-1", name: "Sample Table 1", recordCount: 100 },
            { id: "dev-sample-2", name: "Sample Table 2", recordCount: 50 },
          ],
          totalRecords: 150,
          bank: true,
          crm: true,
          budget: true,
        });
      }
      return NextResponse.json({
        ok: true,
        hasModelData: false,
        tablesWithData: [],
        totalRecords: 0,
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
    let modelDataCount = 0;
    let tablesWithData: any[] = [];

    if (companyId) {
      // Get table stats using the custom RPC function
      const { data: tableStats, error: statsError } = await supabase.rpc(
        "get_table_stats_for_company",
        { company_id_param: companyId }
      );

      if (!statsError && tableStats) {
        const tableIds = tableStats.map((stat: any) => stat.model_table_id);
        console.log(
          `[api/data/status] Found ${tableIds.length} unique table IDs via RPC:`,
          tableIds
        );

        // Get table names from data_tables (if available)
        const { data: dataTables } = await supabase
          .from("data_tables")
          .select("id, name")
          .in("id", tableIds);

        // Use the counts from the RPC function
        tablesWithData = tableIds.map((tableId: string) => {
          const stat = tableStats.find(
            (s: any) => s.model_table_id === tableId
          );
          const table = dataTables?.find((dt: any) => dt.id === tableId);
          return {
            id: tableId,
            name: table?.name || `Table ${tableId}`,
            recordCount: stat ? parseInt(stat.record_count) : 0,
          };
        });

        modelDataCount = tableStats.reduce(
          (sum: number, stat: any) => sum + parseInt(stat.record_count),
          0
        );
      }
    }

    // Derive bank/crm/budget from table names for analytics UI (tables must have records)
    const bankNames = [
      "transactions",
      "revenue",
      "income",
      "expense",
      "payments",
      "financial",
      "classes",
    ];
    const crmNames = [
      "customers",
      "clients",
      "crm",
      "deal",
      "deals",
      "leads",
      "contacts",
      "members",
    ];
    const budgetNames = ["budget", "forecast", "planning", "projections"];
    const match = (name: string, list: string[]) =>
      list.some((n) => (name || "").toLowerCase().includes(n.toLowerCase()));
    let bank = false;
    let crm = false;
    let budget = false;
    for (const t of tablesWithData) {
      if ((t.recordCount ?? 0) <= 0) continue;
      const name = (t.name || "").toLowerCase();
      if (match(name, bankNames)) bank = true;
      if (match(name, crmNames)) crm = true;
      if (match(name, budgetNames)) budget = true;
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

    const responseData = {
      ok: true,
      hasModelData: modelDataCount > 0,
      tablesWithData,
      totalRecords: modelDataCount,
      bank,
      crm,
      budget,
    };

    console.log("[BROWSER LOG] /api/data/status response:", responseData);

    return NextResponse.json(responseData);
  } catch (err: any) {
    console.error("❌ /api/data/status failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || "Unexpected server error",
        hasModelData: false,
        tablesWithData: [],
        totalRecords: 0,
        bank: false,
        crm: false,
        budget: false,
      },
      { status: 500 }
    );
  }
}
