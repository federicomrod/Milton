import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/data/table-names?ids=id1,id2,... or ids=all
// Returns a map of { [tableId]: tableName } for the given IDs
// If ids=all, returns all table names that any KPI might require
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idsParam = searchParams.get("ids");

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let ids: string[] = [];

  if (idsParam === "all") {
    // Get all unique table IDs that any KPI requires
    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("required_data")
      .not("required_data", "is", null);

    if (!kpisError && kpis) {
      const allTableIds = kpis.flatMap((kpi) => kpi.required_data ?? []);
      ids = [...new Set(allTableIds)];
    }
  } else {
    ids =
      idsParam
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
  }

  if (ids.length === 0) {
    return NextResponse.json({ names: {} });
  }

  const { data, error } = await supabase
    .from("data_tables")
    .select("id, name")
    .in("id", ids);

  if (error || !data) {
    return NextResponse.json({ names: {} });
  }

  const names = Object.fromEntries(data.map((t) => [t.id, t.name]));
  return NextResponse.json({ names });
}
