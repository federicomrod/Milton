import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateUniqueIds, resolveReferences } from "@/lib/ai/generate-ids";
import { normalizeFieldValues } from "@/lib/ai/normalize-values";
import type { DataTableField } from "@/lib/types/data";

export const dynamic = "force-dynamic";

interface UploadModelTableRequest {
  tableName: string;
  rows: Record<string, any>[]; // Pre-transformed rows ready for insertion
}

/**
 * Upload data to a model table using the unified model_data table.
 *
 * When rows are missing values for primary-key fields the server will
 * auto-generate unique, human-readable IDs using AI (with fallbacks).
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

    // Get table definition (case-insensitive name match so "Crm" / "CRM" both work)
    const { data: dataTablesMatch } = await supabase
      .from("data_tables")
      .select("id, fields, name")
      .ilike("name", tableName);

    const dataTableDef =
      Array.isArray(dataTablesMatch) && dataTablesMatch.length > 0
        ? (dataTablesMatch.find(
            (t: { name: string }) =>
              t.name.toLowerCase() === (tableName || "").toLowerCase()
          ) ?? dataTablesMatch[0])
        : null;

    if (!dataTableDef) {
      return NextResponse.json(
        { error: `Table "${tableName}" not found in data tables` },
        { status: 404 }
      );
    }

    const tableId = dataTableDef.id;
    const tableFields: DataTableField[] = Array.isArray(dataTableDef.fields)
      ? dataTableDef.fields
      : [];

    // --- Auto-generate missing primary keys ---
    const pkFields = tableFields.filter((f) => f.primaryKey);
    let generatedIdsCount = 0;

    if (pkFields.length > 0) {
      for (const pkField of pkFields) {
        const rowsMissingPk = rows.filter(
          (r) =>
            r[pkField.name] === undefined ||
            r[pkField.name] === null ||
            String(r[pkField.name]).trim() === ""
        );

        if (rowsMissingPk.length === 0) continue;

        console.log(
          `[Upload Model Table] ${rowsMissingPk.length}/${rows.length} rows missing PK "${pkField.name}" – generating IDs`
        );

        // Collect existing IDs for this PK field from already-uploaded data
        const { data: existingRows } = await supabase
          .from("model_data")
          .select("data")
          .eq("company_id", company.id)
          .eq("model_table_id", tableId)
          .limit(500);

        const existingIds = (existingRows ?? [])
          .map((r: { data: Record<string, unknown> }) =>
            r.data?.[pkField.name] != null ? String(r.data[pkField.name]) : null
          )
          .filter(Boolean) as string[];

        // Also collect IDs from rows in this batch that already have a value
        const batchExistingIds = rows
          .filter(
            (r) =>
              r[pkField.name] !== undefined &&
              r[pkField.name] !== null &&
              String(r[pkField.name]).trim() !== ""
          )
          .map((r) => String(r[pkField.name]));

        const allExistingIds = [...existingIds, ...batchExistingIds];

        const { ids, method } = await generateUniqueIds({
          tableName,
          primaryKeyField: pkField.name,
          rowCount: rowsMissingPk.length,
          sampleData: rows.slice(0, 5),
          existingIds: allExistingIds,
        });

        console.log(
          `[Upload Model Table] Generated ${ids.length} IDs via "${method}" for "${pkField.name}"`
        );

        // Assign generated IDs to the rows that are missing them
        let idIndex = 0;
        for (const row of rows) {
          if (
            row[pkField.name] === undefined ||
            row[pkField.name] === null ||
            String(row[pkField.name]).trim() === ""
          ) {
            row[pkField.name] = ids[idIndex++];
            generatedIdsCount++;
          }
        }
      }
    }

    // --- Resolve missing foreign-key references ---
    const fkFields = tableFields.filter(
      (f) => !f.primaryKey && f.references?.table
    );
    let resolvedRefsCount = 0;

    for (const fkField of fkFields) {
      const hasMissing = rows.some(
        (r) =>
          r[fkField.name] === undefined ||
          r[fkField.name] === null ||
          String(r[fkField.name]).trim() === ""
      );
      if (!hasMissing) continue;

      console.log(
        `[Upload Model Table] Resolving FK "${fkField.name}" → "${fkField.references!.table}"`
      );

      const { resolvedCount, method, missingDependency } =
        await resolveReferences({
          supabase,
          companyId: company.id,
          fieldName: fkField.name,
          referencedTableName: fkField.references!.table,
          referencedField: fkField.references!.field,
          rows,
        });

      if (missingDependency) {
        console.log(
          `[Upload Model Table] Referenced table "${missingDependency}" has no data — FK "${fkField.name}" will keep original values; upload proceeding`
        );
        continue;
      }

      if (resolvedCount > 0) {
        console.log(
          `[Upload Model Table] Resolved ${resolvedCount} FK values via "${method}" for "${fkField.name}"`
        );
        resolvedRefsCount += resolvedCount;
      }
    }

    // --- Normalize categorical field values (case-correction + AI fallback) ---
    const fieldsNeedingAINorm: Array<{
      field: DataTableField;
      unmatchedValues: string[];
    }> = [];

    for (const field of tableFields) {
      if (!field.allowedValues || field.allowedValues.length === 0) continue;
      const allowedLower = new Map(
        field.allowedValues.map((v) => [v.toLowerCase(), v])
      );
      const unmatched = new Set<string>();
      for (const row of rows) {
        if (row[field.name] !== undefined && row[field.name] !== null) {
          const val = String(row[field.name]);
          const match = allowedLower.get(val.toLowerCase());
          if (match) {
            if (match !== val) row[field.name] = match;
          } else {
            unmatched.add(val);
          }
        }
      }
      if (unmatched.size > 0) {
        fieldsNeedingAINorm.push({
          field,
          unmatchedValues: Array.from(unmatched),
        });
      }
    }

    if (fieldsNeedingAINorm.length > 0) {
      try {
        console.log(
          `[Upload Model Table] AI-normalizing ${fieldsNeedingAINorm.length} field(s) with unmatched values`
        );
        const aiResult = await normalizeFieldValues(
          fieldsNeedingAINorm.map((f) => ({
            fieldName: f.field.name,
            tableName,
            allowedValues: f.field.allowedValues!,
            uniqueValues: f.unmatchedValues,
          }))
        );
        for (const { field } of fieldsNeedingAINorm) {
          const fieldMap = aiResult.mappings[field.name];
          if (!fieldMap) continue;
          for (const row of rows) {
            if (row[field.name] !== undefined && row[field.name] !== null) {
              const val = String(row[field.name]);
              if (fieldMap[val]) {
                row[field.name] = fieldMap[val];
              }
            }
          }
        }
      } catch (err) {
        console.error(
          "[Upload Model Table] Server-side AI normalization failed:",
          err
        );
      }
    }

    // Insert data into model_data table (company-scoped; no user_id)
    const insertData = rows.map((row) => ({
      company_id: company.id,
      model_table_id: tableId,
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
      generatedIdsCount,
      resolvedRefsCount,
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
