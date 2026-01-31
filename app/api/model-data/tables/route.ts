// GET /api/model-data/tables
// Returns list of available model table names for the current user

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Get company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }

    // Get distinct model_table_name values for this company
    const { data: tables, error: tablesError } = await supabase
      .from("model_data")
      .select("model_table_name")
      .eq("company_id", company.id);

    if (tablesError) {
      return NextResponse.json({ tables: [] });
    }

    // Extract unique table names
    const uniqueTables = Array.from(
      new Set(tables?.map((row) => row.model_table_name) || [])
    );

    return NextResponse.json({ tables: uniqueTables });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", tables: [] },
      { status: 500 }
    );
  }
}
