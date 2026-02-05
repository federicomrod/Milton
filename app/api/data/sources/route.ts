import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface DataSourceInfo {
  name: string;
  label: string;
  count: number;
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Get business model template to find required tables
    const { data: businessModel } = await supabase
      .from("business_models")
      .select("business_type")
      .eq("company_id", company.id)
      .single();

    let requiredTableIds: string[] = [];

    if (businessModel?.business_type) {
      const { data: template } = await supabase
        .from("business_model_templates")
        .select("required_table_ids")
        .eq("key", businessModel.business_type)
        .single();

      if (template?.required_table_ids) {
        requiredTableIds = template.required_table_ids;
      }
    }

    // If no template or no required tables, return empty
    if (requiredTableIds.length === 0) {
      return NextResponse.json({ dataSources: [] });
    }

    // Get table definitions for the required table IDs
    const { data: tableDefinitions } = await supabase
      .from("data_tables")
      .select("id, name")
      .in("id", requiredTableIds);

    if (!tableDefinitions || tableDefinitions.length === 0) {
      return NextResponse.json({ dataSources: [] });
    }

    const dataSources: DataSourceInfo[] = [];

    // Query data counts for each required table
    const countPromises = tableDefinitions.map(async (tableDef) => {
      try {
        const { count, error } = await supabase
          .from("model_data")
          .select("*", { count: "exact", head: true })
          .eq("company_id", company.id)
          .eq("model_table_id", tableDef.id);

        if (!error) {
          return {
            name: tableDef.name,
            label: getTableDisplayName(tableDef.name),
            count: count || 0,
          };
        }
        return null;
      } catch (err) {
        console.warn(`⚠️ Error counting ${tableDef.name}:`, err);
        return null;
      }
    });

    // Wait for all queries to complete
    const results = await Promise.all(countPromises);

    // Filter out null results and sort by count descending
    dataSources.push(
      ...results.filter((result): result is DataSourceInfo => result !== null)
    );
    dataSources.sort((a, b) => b.count - a.count);

    console.log(
      "📊 Data sources fetched:",
      dataSources.map((ds) => `${ds.name}=${ds.count}`).join(", ")
    );

    return NextResponse.json({ dataSources });
  } catch (error) {
    console.error("Error fetching data sources:", error);
    return NextResponse.json(
      { error: "Failed to fetch data sources" },
      { status: 500 }
    );
  }
}

// Get human-readable display name for model table names
function getTableDisplayName(tableName: string): string {
  const displayNames: Record<string, string> = {
    members: "Members",
    customers: "Customers",
    transactions: "Transactions",
    payments: "Payments",
    bank: "Bank Data",
    deals: "Deals",
    crm: "CRM Data",
    opportunities: "Opportunities",
    leads: "Leads",
    bookings: "Bookings",
    classes: "Classes",
    instructors: "Instructors",
    budgets: "Budgets",
    forecast: "Forecast",
    budget: "Budget Data",
    sales: "Sales Data",
    revenue: "Revenue Data",
    expenses: "Expenses",
    payroll: "Payroll",
    inventory: "Inventory",
    products: "Products",
    suppliers: "Suppliers",
  };

  return (
    displayNames[tableName] ||
    tableName.charAt(0).toUpperCase() + tableName.slice(1)
  );
}
