import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface UploadModelTableRequest {
  tableName: string;
  rows: Record<string, any>[]; // Pre-transformed rows ready for insertion
}

/**
 * Upload data to a model table using the unified model_data table
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { tableName, rows } = body as UploadModelTableRequest;

    if (!tableName) {
      return NextResponse.json(
        { error: "tableName is required" },
        { status: 400 }
      );
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "rows array is required and must not be empty" },
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

    // Insert data into model_data table (company-scoped; no user_id)
    // Rows are already transformed by the client
    const insertData = rows.map((row) => ({
      company_id: company.id,
      model_table_name: tableName,
      data: row,
      indexed_fields: extractIndexedFields(row, tableName),
    }));

    const { error: insertError } = await supabase
      .from("model_data")
      .insert(insertData)
      .select("id");

    if (insertError) {
      console.error("[Upload Model Table] Insert error:", insertError);
      return NextResponse.json(
        { error: `Failed to insert data: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      insertedCount: insertData.length,
      tableName,
    });
  } catch (error: unknown) {
    console.error("[Upload Model Table] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * Extract commonly indexed fields from data for performance optimization
 */
function extractIndexedFields(
  data: Record<string, any>,
  tableName: string
): Record<string, any> {
  const indexed: Record<string, any> = {};

  // Common date fields
  const dateFields = ["date", "created_date", "updated_date", "payment_date"];
  for (const field of dateFields) {
    if (data[field] !== undefined) {
      indexed[field] = data[field];
    }
  }

  // Common amount fields
  const amountFields = ["amount", "price", "value", "total"];
  for (const field of amountFields) {
    if (data[field] !== undefined) {
      indexed[field] = data[field];
    }
  }

  // Common status fields
  if (data.status !== undefined) {
    indexed.status = data.status;
  }

  return indexed;
}
