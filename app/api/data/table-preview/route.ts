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

    // Get table ID and field definitions from data_tables
    const { data: tableDef } = await supabase
      .from("data_tables")
      .select("id, fields")
      .eq("name", tableName)
      .single();

    if (!tableDef) {
      return NextResponse.json(
        { error: `Table "${tableName}" not found` },
        { status: 404 }
      );
    }

    const tableId = tableDef.id;

    // Fetch all rows so we can sort by the PK field before paginating
    const { data: allRows, error: dataError } = await supabase
      .from("model_data")
      .select("data, created_at")
      .eq("company_id", company.id)
      .eq("model_table_id", tableId);

    if (dataError) {
      console.error("Error fetching data:", dataError);
      return NextResponse.json(
        { error: "Failed to fetch data" },
        { status: 500 }
      );
    }

    const rows = allRows || [];

    // Extract column names from the first few rows to determine schema
    const sampleRows = rows.slice(0, 5);
    const columnNames = new Set<string>();

    sampleRows.forEach((row) => {
      if (row.data && typeof row.data === "object") {
        Object.keys(row.data).forEach((key) => columnNames.add(key));
      }
    });

    // Order columns: PKs first, then required fields, then rest alphabetically
    const fields: Array<{
      name: string;
      primaryKey?: boolean;
      required?: boolean;
    }> = tableDef.fields || [];
    const pkNames = new Set(
      fields.filter((f) => f.primaryKey).map((f) => f.name)
    );
    const requiredNames = new Set(
      fields.filter((f) => f.required && !f.primaryKey).map((f) => f.name)
    );

    const allCols = Array.from(columnNames);
    const pkCols = allCols.filter((c) => pkNames.has(c)).sort();
    const reqCols = allCols
      .filter((c) => requiredNames.has(c) && !pkNames.has(c))
      .sort();
    const restCols = allCols
      .filter((c) => !pkNames.has(c) && !requiredNames.has(c))
      .sort();
    const sortedColumns = [...pkCols, ...reqCols, ...restCols];

    // Sort all rows by the first column (PK field) using natural/alphanumeric sort
    const sortKey = sortedColumns[0];
    if (sortKey) {
      rows.sort((a, b) => {
        const aVal = String(
          (a.data as Record<string, unknown>)?.[sortKey] ?? ""
        );
        const bVal = String(
          (b.data as Record<string, unknown>)?.[sortKey] ?? ""
        );
        return aVal.localeCompare(bVal, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
    }

    // Paginate after sorting
    const totalCount = rows.length;
    const from = (page - 1) * pageSize;
    const pageRows = rows.slice(from, from + pageSize);

    // Transform data for frontend consumption
    const transformedRows = pageRows.map((row, index) => ({
      id: from + index + 1,
      ...row.data,
      _created_at: row.created_at,
    }));

    const totalPages = Math.ceil(totalCount / pageSize);

    return NextResponse.json({
      rows: transformedRows,
      columns: sortedColumns,
      pkColumns: Array.from(pkNames),
      pagination: {
        page,
        pageSize,
        totalCount,
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
