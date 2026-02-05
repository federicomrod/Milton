import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface DeleteModelTableRequest {
  tableName: string;
}

/**
 * Delete all data from a model table for the authenticated user's company
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { tableName } = body as DeleteModelTableRequest;

    if (!tableName) {
      return NextResponse.json(
        { error: "tableName is required" },
        { status: 400 }
      );
    }

    // Get company
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Get table ID from table name by querying data_tables
    const { data: dataTableDef } = await supabase
      .from("data_tables")
      .select("id")
      .eq("name", tableName)
      .single();

    if (!dataTableDef) {
      return NextResponse.json(
        { error: `Table "${tableName}" not found` },
        { status: 404 }
      );
    }

    const tableId = dataTableDef.id;

    // Verify the table exists in the model
    const { data: businessModel } = await supabase
      .from("business_models")
      .select("canonical_model")
      .eq("company_id", company.id)
      .single();

    if (!businessModel?.canonical_model) {
      return NextResponse.json(
        { error: "Data model not found" },
        { status: 404 }
      );
    }

    const model = businessModel.canonical_model as any;
    const tableDef = model.recommendedTables?.find(
      (t: any) => t.name === tableName
    );

    if (!tableDef) {
      return NextResponse.json(
        { error: `Table "${tableName}" not found in model` },
        { status: 404 }
      );
    }

    // Delete all data for this table and company
    const { data, error: deleteError } = await supabase
      .from("model_data")
      .delete()
      .eq("company_id", company.id)
      .eq("model_table_id", tableId)
      .select("id");

    if (deleteError) {
      console.error("[Delete Model Table] Delete error:", deleteError);
      return NextResponse.json(
        { error: `Failed to delete data: ${deleteError.message}` },
        { status: 500 }
      );
    }

    const deletedCount = data?.length || 0;

    return NextResponse.json({
      success: true,
      deletedCount,
      tableName,
    });
  } catch (error: unknown) {
    console.error("[Delete Model Table] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
