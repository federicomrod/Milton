// GET /api/data/table-preview?tableName=...&page=1&pageSize=50
// Returns paginated data preview for a model table
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const tableName = req.nextUrl.searchParams.get("tableName");
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
    const pageSize = parseInt(req.nextUrl.searchParams.get("pageSize") || "50");

    if (!tableName) {
      return NextResponse.json(
        { error: "tableName is required" },
        { status: 400 }
      );
    }

    // Get table ID from table name by querying data_tables
    const { data: tableDef } = await supabase
      .from("data_tables")
      .select("id")
      .eq("name", tableName)
      .single();

    if (!tableDef) {
      return NextResponse.json(
        { error: `Table "${tableName}" not found` },
        { status: 404 }
      );
    }

    const tableId = tableDef.id;

    // Get total count
    const { count: totalCount, error: countError } = await supabase
      .from("model_data")
      .select("*", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("model_table_id", tableId);

    if (countError) {
      console.error("Error counting rows:", countError);
      return NextResponse.json(
        { error: "Failed to count rows" },
        { status: 500 }
      );
    }

    // Get paginated data
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: rows, error: dataError } = await supabase
      .from("model_data")
      .select("data, created_at")
      .eq("company_id", company.id)
      .eq("model_table_id", tableId)
      .range(from, to)
      .order("created_at", { ascending: false });

    if (dataError) {
      console.error("Error fetching data:", dataError);
      return NextResponse.json(
        { error: "Failed to fetch data" },
        { status: 500 }
      );
    }

    // Extract column names from the first few rows to determine schema
    const sampleRows = rows?.slice(0, 5) || [];
    const columnNames = new Set<string>();

    sampleRows.forEach((row) => {
      if (row.data && typeof row.data === "object") {
        Object.keys(row.data).forEach((key) => columnNames.add(key));
      }
    });

    // Transform data for frontend consumption
    const transformedRows =
      rows?.map((row, index) => ({
        id: from + index + 1, // Row number for display
        ...row.data,
        _created_at: row.created_at,
      })) || [];

    const totalPages = Math.ceil((totalCount || 0) / pageSize);

    return NextResponse.json({
      rows: transformedRows,
      columns: Array.from(columnNames).sort(),
      pagination: {
        page,
        pageSize,
        totalCount: totalCount || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error("[api/data/table-preview] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
