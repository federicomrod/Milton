// lib/ingestion/ingestion-service.ts
// Unified ingestion service for all file uploads (dashboard + data model builder)

import { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { DEFAULT_CRM_MAPPING, CrmMapping } from "@/lib/crm-mapping";
import { normalizeCrmRow } from "@/lib/crm-normalizer";
import { normalizeDateValue } from "@/lib/utils";
import { ColumnMapping } from "@/types/schema";

interface ProcessedBankRow {
  date?: string | number | Date;
  amount?: number | string;
  description?: string;
  category?: string;
  name?: string;
  user_id?: string;
  [key: string]: unknown;
}

interface ProcessedCrmRow {
  created_date?: string | number | Date;
  close_date?: string | number | Date;
  closing_date?: string | number | Date;
  [key: string]: unknown;
}

interface ProcessedBudgetRow {
  month?: string | number | Date;
  category?: string;
  value?: number | string;
  [key: string]: unknown;
}

interface RawFileRow {
  [key: string]: unknown;
}

export interface IngestFileParams {
  supabase: SupabaseClient;
  userId: string;
  file: File;
  datasetType: "bank" | "crm" | "budget";
  mode: "overwrite" | "append";
  columnMappings?: ColumnMapping[];
  sheetName?: string;
}

export interface IngestFileResult {
  success: boolean;
  insertedCount: number;
  datasetType: string;
  mode: string;
  error?: string;
  uploadFileId?: string;
}

/**
 * Insert pre-processed data directly into normalized tables
 * Used when data has already been parsed and mapped (e.g., by AI processing)
 */
export async function insertProcessedData({
  supabase,
  userId,
  datasetType,
  data,
  mode = "append",
}: {
  supabase: SupabaseClient;
  userId: string;
  datasetType: "bank" | "crm" | "budget";
  data: ProcessedBankRow[] | ProcessedCrmRow[] | ProcessedBudgetRow[];
  mode?: "overwrite" | "append";
}): Promise<IngestFileResult> {
  try {
    console.log(
      `[Ingestion] Inserting ${data.length} pre-processed ${datasetType} rows (mode: ${mode})`
    );

    // Handle overwrite mode
    if (mode === "overwrite") {
      if (datasetType === "bank") {
        const { error } = await supabase
          .from("transactions")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      } else if (datasetType === "crm") {
        const { error } = await supabase
          .from("crm_deals")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      } else if (datasetType === "budget") {
        const { error } = await supabase
          .from("budgets")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      }
    }

    // Insert data - normalize dates in pre-processed data too
    let insertedCount = 0;
    if (datasetType === "bank") {
      // Normalize dates in pre-processed data
      const normalizedData = (data as ProcessedBankRow[]).map((row) => ({
        ...row,
        date:
          normalizeDateValue(row.date) || row.date || new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("transactions")
        .insert(normalizedData);
      if (error) throw error;
      insertedCount = normalizedData.length;
    } else if (datasetType === "crm") {
      // Normalize dates in pre-processed data
      const normalizedData = (data as ProcessedCrmRow[]).map((row) => ({
        ...row,
        created_date: row.created_date
          ? normalizeDateValue(row.created_date)
          : row.created_date,
        close_date: row.close_date
          ? normalizeDateValue(row.close_date)
          : row.close_date,
        closing_date: row.closing_date
          ? normalizeDateValue(row.closing_date)
          : row.closing_date,
      }));
      const { error } = await supabase.from("crm_deals").insert(normalizedData);
      if (error) throw error;
      insertedCount = normalizedData.length;
    } else if (datasetType === "budget") {
      // Normalize month field in pre-processed data
      const normalizedData = (data as ProcessedBudgetRow[]).map((row) => {
        let month = row.month;
        if (month) {
          const normalizedDate = normalizeDateValue(month);
          if (normalizedDate) {
            month = normalizedDate.slice(0, 7);
          }
        }
        return { ...row, month: month || new Date().toISOString().slice(0, 7) };
      });
      const { error } = await supabase.from("budgets").insert(normalizedData);
      if (error) throw error;
      insertedCount = normalizedData.length;
    }

    console.log(`[Ingestion] Successfully inserted ${insertedCount} rows`);
    return { success: true, insertedCount, datasetType, mode };
  } catch (error: unknown) {
    console.error("[Ingestion] Insert error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Insert failed";
    return {
      success: false,
      insertedCount: 0,
      datasetType,
      mode,
      error: errorMessage,
    };
  }
}

/**
 * Apply column mappings to transform raw data rows
 */
/**
 * Normalize month from column name (e.g., "Jan-2025" -> "2025-01", "Feb-2025" -> "2025-02")
 */
function normalizeMonthFromColumnName(columnName: string): string {
  const monthMap: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };

  const lower = columnName.toLowerCase().trim();

  // Try to extract year and month
  // Pattern: "Jan-2025", "2025-01", "01/2025", etc.
  const yearMatch = lower.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  // Try month name first
  for (const [monthName, monthNum] of Object.entries(monthMap)) {
    if (lower.includes(monthName)) {
      return `${year}-${monthNum}`;
    }
  }

  // Try numeric format: "2025-01" or "01-2025"
  const numericMatch =
    lower.match(/(\d{4})[-.\/](\d{2})/) || lower.match(/(\d{2})[-.\/](\d{4})/);
  if (numericMatch) {
    if (numericMatch[1].length === 4) {
      // YYYY-MM format
      return `${numericMatch[1]}-${numericMatch[2]}`;
    } else {
      // MM-YYYY format
      return `${numericMatch[2]}-${numericMatch[1]}`;
    }
  }

  // Fallback to current month
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function applyColumnMappings(
  row: RawFileRow,
  mappings: ColumnMapping[]
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  mappings.forEach((mapping) => {
    if (mapping.standardField !== "unmapped") {
      const originalValue = row[mapping.originalColumn];

      // Apply transformations based on data type
      let transformedValue = originalValue;

      if (mapping.dataType === "number" || mapping.dataType === "currency") {
        if (originalValue !== null && originalValue !== undefined) {
          // Clean currency values
          const cleaned = String(originalValue)
            .replace(/[€$£¥\s]/g, "")
            .replace(/\./g, "")
            .replace(",", ".");
          transformedValue = parseFloat(cleaned) || 0;
        } else {
          transformedValue = 0;
        }
      } else if (mapping.dataType === "date") {
        transformedValue = normalizeDateValue(originalValue) || originalValue;
      } else {
        transformedValue = originalValue || "";
      }

      mapped[mapping.standardField] = transformedValue;
    }
  });

  return mapped;
}

/**
 * Unified ingestion service that handles:
 * 1. File parsing (CSV/XLSX)
 * 2. Mode handling (overwrite/append)
 * 3. Data normalization by type
 * 4. Supabase insertion
 *
 * If columnMappings are provided, uses them to transform data.
 * Otherwise, falls back to hardcoded column name variations.
 */
export async function ingestUploadedFile({
  supabase,
  userId,
  file,
  datasetType,
  mode,
  columnMappings,
  sheetName,
}: IngestFileParams): Promise<IngestFileResult> {
  let uploadFileId: string | null = null;

  try {
    console.log(
      `[Ingestion] Processing ${datasetType} file: ${file.name} (mode: ${mode})`
    );

    // Map dataset type to table name
    const tableName =
      datasetType === "bank"
        ? "transactions"
        : datasetType === "crm"
          ? "crm_deals"
          : "budgets";

    // Step 0: Create uploaded_files record to track this upload
    const { data: uploadedFile, error: uploadFileError } = await supabase
      .from("uploaded_files")
      .insert({
        user_id: userId,
        file_name: file.name,
        dataset_type: datasetType,
        table_name: tableName,
        row_count: 0, // Will be updated after insertion
      })
      .select("id")
      .single();

    if (uploadFileError) {
      console.warn(
        `[Ingestion] Failed to create uploaded_files record: ${uploadFileError.message}. Continuing without tracking.`
      );
    } else {
      uploadFileId = uploadedFile.id;
      console.log(`[Ingestion] Created uploaded_files record: ${uploadFileId}`);
    }

    // Step 1: Parse the file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("Empty file uploaded");
    }

    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("File too large (max 10MB)");
    }

    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: false, // Don't auto-convert dates to Date objects
      raw: false, // Convert numbers but preserve date strings
    });

    // Use specified sheet name if it exists, otherwise default to first sheet
    // This handles CSV files (which always have "Sheet1") and single-sheet Excel files
    let targetSheetName: string;
    if (sheetName && workbook.SheetNames.includes(sheetName)) {
      targetSheetName = sheetName;
    } else {
      // Fall back to first sheet if specified sheet doesn't exist
      targetSheetName = workbook.SheetNames[0];
      if (sheetName && sheetName !== targetSheetName) {
        console.warn(
          `[Ingestion] Sheet "${sheetName}" not found, using "${targetSheetName}" instead`
        );
      }
    }

    if (!targetSheetName || !workbook.SheetNames.includes(targetSheetName)) {
      throw new Error(
        `No valid sheet found in file. Available sheets: ${workbook.SheetNames.join(", ")}`
      );
    }

    const worksheet = workbook.Sheets[targetSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      raw: false, // Convert values but preserve date strings
      defval: "", // Default value for empty cells
    });

    if (jsonData.length === 0) {
      throw new Error("File contains no data");
    }

    // Debug: log column names to help with mapping
    if (jsonData.length > 0 && jsonData[0] && typeof jsonData[0] === "object") {
      const firstRow = jsonData[0] as Record<string, unknown>;
      const columnNames = Object.keys(firstRow);
      console.log("[Ingestion] CSV columns:", columnNames);
      console.log(
        "[Ingestion] Sample row:",
        Object.fromEntries(Object.entries(firstRow).slice(0, 3))
      );
    }

    console.log(`[Ingestion] Parsed ${jsonData.length} rows from ${file.name}`);

    // Step 2: Handle overwrite mode - delete existing data
    if (mode === "overwrite") {
      console.log(
        `[Ingestion] Overwriting existing ${datasetType} data for user ${userId}`
      );

      if (datasetType === "bank") {
        const { error } = await supabase
          .from("transactions")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      } else if (datasetType === "crm") {
        const { error } = await supabase
          .from("crm_deals")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      } else if (datasetType === "budget") {
        const { error } = await supabase
          .from("budgets")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      }
    }

    // Step 3: Normalize and insert data based on type
    let insertedCount = 0;

    // If column mappings are provided, use them
    if (columnMappings && columnMappings.length > 0) {
      if (datasetType === "bank") {
        // Find the original amount column name from mappings
        const amountMapping = columnMappings.find(
          (m) => m.standardField === "amount"
        );
        const amountColumnName = amountMapping?.originalColumn;

        // Analyze raw amount values (before mapping) to detect if they're already signed
        let hasMixedSigns = false;
        let hasNegativeValues = false;
        let hasPositiveValues = false;

        if (amountColumnName && jsonData.length > 0) {
          const amountSamples = (jsonData as RawFileRow[])
            .slice(0, Math.min(20, jsonData.length))
            .map((row) => {
              const rawValue = row[amountColumnName];
              if (rawValue === null || rawValue === undefined) return 0;

              // Parse the raw value
              let amount = 0;
              if (typeof rawValue === "number") {
                amount = rawValue;
              } else {
                // Clean currency values
                const cleaned = String(rawValue)
                  .replace(/[€$£¥\s]/g, "")
                  .replace(/\./g, "")
                  .replace(",", ".");
                amount = parseFloat(cleaned) || 0;
              }
              return amount;
            });

          hasNegativeValues = amountSamples.some((amt) => amt < 0);
          hasPositiveValues = amountSamples.some((amt) => amt > 0);
          hasMixedSigns = hasNegativeValues && hasPositiveValues;
        }

        // Check if type column is mapped
        const typeMapping = columnMappings.find(
          (m) => m.standardField === "type"
        );
        const hasTypeColumn = !!typeMapping;
        const typeColumnName = typeMapping?.originalColumn;

        const transactions = (jsonData as RawFileRow[]).map((row) => {
          const mapped = applyColumnMappings(row, columnMappings);

          let amount =
            typeof mapped.amount === "number"
              ? mapped.amount
              : parseFloat(String(mapped.amount || "0")) || 0;

          // Smart amount normalization:
          // 1. If type column exists, use it to determine sign (takes precedence)
          // 2. If amounts already have mixed signs, keep as-is (user's file is correct)
          // 3. If all amounts are positive and type column exists, use type to determine sign
          // 4. Otherwise, keep amounts as-is
          if (hasTypeColumn && typeColumnName && row[typeColumnName]) {
            const typeValue = String(row[typeColumnName]).toLowerCase().trim();
            const isOutflow =
              typeValue === "outflow" ||
              typeValue === "expense" ||
              typeValue === "expenses" ||
              typeValue === "debit" ||
              typeValue === "spending" ||
              typeValue === "cost";

            const isInflow =
              typeValue === "inflow" ||
              typeValue === "income" ||
              typeValue === "revenue" ||
              typeValue === "credit" ||
              typeValue === "earning" ||
              typeValue === "receipt";

            if (isOutflow) {
              // Outflow/expense -> negative amount
              amount = -Math.abs(amount);
            } else if (isInflow) {
              // Inflow/income -> positive amount
              amount = Math.abs(amount);
            }
            // If type is unknown, keep amount as-is
          } else if (hasMixedSigns) {
            // File already has correct signs (both positive and negative values detected)
            // Keep amounts as-is - no transformation needed
          }
          // If no type column and no mixed signs, keep amounts as-is

          return {
            user_id: userId,
            upload_file_id: uploadFileId,
            date: normalizeDateValue(mapped.date) || new Date().toISOString(),
            amount: amount,
            description: String(mapped.description || ""),
            category: String(mapped.category || "Uncategorized"),
            name: String(mapped.name || ""),
          };
        });

        const { error } = await supabase
          .from("transactions")
          .insert(transactions);
        if (error) throw error;
        insertedCount = transactions.length;
      } else if (datasetType === "crm") {
        const deals = (jsonData as RawFileRow[]).map((row, index) => {
          const mapped = applyColumnMappings(row, columnMappings);

          // Normalize stage value to standard display name
          const rawStage = String(mapped.phase || mapped.stage || "").trim();
          let normalizedStage = "Lead Generation"; // Default

          if (rawStage) {
            const lower = rawStage.toLowerCase().trim();

            // Try exact match first (case-insensitive)
            const exactMatches: { [key: string]: string } = {
              "lead generation": "Lead Generation",
              lead_gen: "Lead Generation",
              "lead-gen": "Lead Generation",
              leadgen: "Lead Generation",
              "lead gen": "Lead Generation",
              "first contact": "First Contact",
              first_contact: "First Contact",
              "first-contact": "First Contact",
              "need qualification": "Need Qualification",
              need_qualification: "Need Qualification",
              "need-qualification": "Need Qualification",
              qualification: "Need Qualification",
              negotiation: "Negotiation",
              negotiate: "Negotiation",
              deal: "Deal",
              "closed won": "Deal",
              won: "Deal",
              closed: "Deal",
              "no deal": "No Deal",
              no_deal: "No Deal",
              "no-deal": "No Deal",
              lost: "No Deal",
              "closed lost": "No Deal",
            };

            if (exactMatches[lower]) {
              normalizedStage = exactMatches[lower];
            } else {
              // Try partial matching
              if (lower.includes("lead") || lower.includes("generation")) {
                normalizedStage = "Lead Generation";
              } else if (lower.includes("first") && lower.includes("contact")) {
                normalizedStage = "First Contact";
              } else if (
                lower.includes("qualification") ||
                lower.includes("qualify")
              ) {
                normalizedStage = "Need Qualification";
              } else if (
                lower.includes("negotiation") ||
                lower.includes("negotiate")
              ) {
                normalizedStage = "Negotiation";
              } else if (
                lower.includes("deal") &&
                !lower.includes("no") &&
                !lower.includes("lost")
              ) {
                normalizedStage = "Deal";
              } else if (
                lower.includes("no deal") ||
                lower.includes("lost") ||
                lower.includes("closed lost")
              ) {
                normalizedStage = "No Deal";
              } else {
                // Default fallback
                normalizedStage = "Lead Generation";
              }
            }
          }

          // Log normalization for debugging (first few only)
          if (index < 5) {
            console.log(
              `[Ingestion] Stage normalization: "${rawStage}" -> "${normalizedStage}"`
            );
          }

          return {
            user_id: userId,
            upload_file_id: uploadFileId,
            deal_name: String(mapped.dealName || mapped.deal_name || ""),
            amount:
              typeof mapped.amount === "number"
                ? mapped.amount
                : parseFloat(String(mapped.amount || "0")) || 0,
            stage: normalizedStage,
            phase: normalizedStage, // Required NOT NULL column
            company: String(mapped.clientName || mapped.company || ""),
            owner: mapped.owner ? String(mapped.owner) : undefined,
            product: mapped.product ? String(mapped.product) : undefined,
            created_date:
              mapped.firstAppointment || mapped.created_date
                ? normalizeDateValue(
                    mapped.firstAppointment || mapped.created_date
                  )
                : undefined,
            close_date:
              mapped.closingDate || mapped.close_date
                ? normalizeDateValue(mapped.closingDate || mapped.close_date)
                : undefined,
          };
        });

        // Log stage distribution after normalization
        const stageCounts = deals.reduce(
          (acc, deal) => {
            acc[deal.stage] = (acc[deal.stage] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );
        console.log(`[Ingestion] CRM deals stage distribution:`, stageCounts);

        const { error } = await supabase.from("crm_deals").insert(deals);
        if (error) throw error;
        insertedCount = deals.length;
      } else if (datasetType === "budget") {
        // Check if multiple month columns are mapped (wide-format budget)
        const monthMappings = columnMappings.filter(
          (m) => m.standardField === "month"
        );
        const categoryMapping = columnMappings.find(
          (m) => m.standardField === "category"
        );

        console.log("[Ingestion] Budget processing:", {
          monthMappingsCount: monthMappings.length,
          hasCategoryMapping: !!categoryMapping,
          categoryColumn: categoryMapping?.originalColumn,
          categoryMappingFull: categoryMapping,
          monthColumns: monthMappings.map((m) => m.originalColumn),
          firstRowKeys:
            jsonData.length > 0
              ? Object.keys(jsonData[0] as Record<string, unknown>)
              : [],
          firstRowSample:
            jsonData.length > 0
              ? Object.fromEntries(
                  Object.entries(jsonData[0] as Record<string, unknown>).slice(
                    0,
                    3
                  )
                )
              : {},
        });

        if (monthMappings.length > 1 && categoryMapping) {
          // Wide-format: transform to long-format
          // Each row is a category, each month column contains values for that month
          const budgets: Array<{
            user_id: string;
            month: string;
            category: string;
            value: number;
          }> = [];

          (jsonData as RawFileRow[]).forEach((row, rowIndex) => {
            // Try to get category from the mapped column
            let category = "";
            const categoryColumnName = categoryMapping.originalColumn;

            if (categoryColumnName && categoryColumnName.trim() !== "") {
              // Use the mapped column name
              category = String(row[categoryColumnName] || "").trim();
            } else {
              // Fallback: try to find the category column by checking which column has non-numeric values
              // This handles cases where the column name might be __EMPTY or similar
              const rowKeys = Object.keys(row);
              for (const key of rowKeys) {
                const value = row[key];
                if (value && typeof value === "string" && value.trim() !== "") {
                  // Check if it's not a number and not a month column
                  const isMonthColumn = monthMappings.some(
                    (m) => m.originalColumn === key
                  );
                  if (
                    !isMonthColumn &&
                    isNaN(Number(value.replace(/[€$£¥\s,.]/g, "")))
                  ) {
                    category = String(value).trim();
                    console.log(
                      `[Ingestion] Found category in column ${key}: ${category}`
                    );
                    break;
                  }
                }
              }
            }

            if (!category || category === "") {
              console.log(
                `[Ingestion] Skipping row ${rowIndex}: empty category. Category column: "${categoryColumnName}", Row keys: ${Object.keys(row).join(", ")}, Sample values: ${Object.values(row).slice(0, 3).join(", ")}`
              );
              return; // Skip empty categories
            }

            // Process each month column
            monthMappings.forEach((monthMapping) => {
              const rawValue = row[monthMapping.originalColumn];

              // Parse value (handle German format with comma as decimal)
              // Allow 0 values, only skip if truly null/undefined/empty string
              let value = 0;
              if (
                rawValue !== null &&
                rawValue !== undefined &&
                rawValue !== ""
              ) {
                if (typeof rawValue === "number") {
                  value = rawValue;
                } else {
                  const cleaned = String(rawValue)
                    .replace(/[€$£¥\s]/g, "")
                    .replace(/\./g, "")
                    .replace(",", ".");
                  value = parseFloat(cleaned) || 0;
                }
              } else {
                // Skip empty values (but log for debugging)
                console.log(
                  `[Ingestion] Skipping ${monthMapping.originalColumn} for ${category}: empty value`
                );
                return;
              }

              // Normalize month from column name (e.g., "Jan-2025" -> "2025-01")
              const month = normalizeMonthFromColumnName(
                monthMapping.originalColumn
              );

              if (!month || month.length < 7) {
                console.log(
                  `[Ingestion] Failed to normalize month from column: ${monthMapping.originalColumn}, got: ${month}`
                );
                return;
              }

              budgets.push({
                user_id: userId,
                upload_file_id: uploadFileId,
                month,
                category,
                value,
              } as any); // Type assertion needed because upload_file_id may not be in all type definitions
            });
          });

          console.log(
            `[Ingestion] Prepared ${budgets.length} budget rows for insertion`
          );
          if (budgets.length > 0) {
            const { error } = await supabase.from("budgets").insert(budgets);
            if (error) {
              console.error("[Ingestion] Budget insert error:", error);
              throw error;
            }
            insertedCount = budgets.length;
          } else {
            console.warn(
              "[Ingestion] No budget rows to insert after processing"
            );
          }
        } else {
          // Long-format: standard mapping (single month column)
          const budgets = (jsonData as RawFileRow[]).map((row) => {
            const mapped = applyColumnMappings(row, columnMappings);
            let month = mapped.month;
            if (month) {
              const normalizedDate = normalizeDateValue(month);
              if (normalizedDate) {
                month = normalizedDate.slice(0, 7);
              } else if (typeof month === "string") {
                const dateMatch = month.match(/(\d{4})-(\d{2})/);
                if (dateMatch) {
                  month = `${dateMatch[1]}-${dateMatch[2]}`;
                } else {
                  // Try to parse month name format from the column name if available
                  const monthMapping = columnMappings.find(
                    (m) => m.standardField === "month"
                  );
                  if (monthMapping) {
                    month = normalizeMonthFromColumnName(
                      monthMapping.originalColumn
                    );
                  }
                }
              }
            }
            return {
              user_id: userId,
              upload_file_id: uploadFileId,
              month: (month as string) || new Date().toISOString().slice(0, 7),
              category: String(mapped.category || "General"),
              value:
                typeof mapped.value === "number"
                  ? mapped.value
                  : parseFloat(String(mapped.value || mapped.amount || "0")) ||
                    0,
            };
          });

          const { error } = await supabase.from("budgets").insert(budgets);
          if (error) throw error;
          insertedCount = budgets.length;
        }
      }
    } else if (datasetType === "bank") {
      // Map CSV columns to transactions table (fallback to hardcoded variations)
      const transactions = (jsonData as RawFileRow[]).map((row) => {
        // Normalize date field - handles multiple date column variations
        const dateValue =
          row.date ||
          row.Date ||
          row.DATE ||
          row.Datum ||
          row["Transaction Date"] ||
          row["Booking Date"] ||
          row["Vollständiges Datum"] ||
          row["Datum"] ||
          row["Datum und Zeit der Buchung"] ||
          row["Ende des Kurses"];
        const normalizedDate =
          normalizeDateValue(dateValue) || new Date().toISOString();

        // Find amount field - try multiple variations including German column names
        const amountValue =
          row.amount ||
          row.Amount ||
          row.AMOUNT ||
          row["Marginaler Wert (inkl. Mehrwertsteuer / Verkaufsteuer)"] ||
          row["Marginaler Wert (exkl. Mehrwertsteuer / Verkaufsteuer)"] ||
          row["Marginaler Wert"] ||
          row.wert ||
          row.Wert ||
          row.WERT ||
          row.value ||
          row.Value ||
          row.VALUE ||
          row.betrag ||
          row.Betrag ||
          row.BETRAG ||
          row.umsatz ||
          row.Umsatz ||
          row.UMSATZ ||
          row.total ||
          row.Total ||
          row.TOTAL ||
          row.sum ||
          row.Sum ||
          row.SUM ||
          "0";

        // Parse amount, handling German format (comma as decimal, € symbol)
        let amount = 0;
        if (
          amountValue &&
          amountValue !== "0" &&
          amountValue !== null &&
          amountValue !== undefined
        ) {
          // Convert to string and clean: remove currency symbols, spaces, handle comma as decimal
          const cleaned = String(amountValue)
            .replace(/[€$£¥\s]/g, "") // Remove currency symbols and spaces
            .replace(/\./g, "") // Remove thousands separator (dots)
            .replace(",", "."); // Replace comma with dot for decimal
          amount = parseFloat(cleaned) || 0;
        }

        // Build description from available fields
        const description =
          (row.description as string) ||
          (row.Description as string) ||
          (row.DESCRIPTION as string) ||
          (row.termin as string) ||
          (row.Termin as string) ||
          (row["Termin"] as string) ||
          (row.kursart as string) ||
          (row.Kursart as string) ||
          (row["Kursart"] as string) ||
          (row.verwendungszweck as string) ||
          (row.Verwendungszweck as string) ||
          "";

        // Build name from available fields
        const name =
          (row.name as string) ||
          (row.Name as string) ||
          (row.NAME as string) ||
          (row.lehrer as string) ||
          (row.Lehrer as string) ||
          (row["Lehrer"] as string) ||
          (row.vorname && row.name ? `${row.vorname} ${row.name}` : null) ||
          (row.Vorname && row.Name ? `${row.Vorname} ${row.Name}` : null) ||
          description ||
          "";

        return {
          user_id: userId,
          upload_file_id: uploadFileId,
          date: normalizedDate,
          amount: amount,
          description: description,
          category:
            (row.category as string) ||
            (row.Category as string) ||
            (row.CATEGORY as string) ||
            (row.kategorie as string) ||
            (row.Kategorie as string) ||
            (row["Kursart"] as string) ||
            "Uncategorized",
          name: name,
        };
      });

      const { error } = await supabase
        .from("transactions")
        .insert(transactions);
      if (error) throw error;
      insertedCount = transactions.length;
    } else if (datasetType === "crm") {
      // Normalize CRM data using the CRM normalizer
      const mapping: CrmMapping = DEFAULT_CRM_MAPPING; // later: load from DB per user

      const deals = (jsonData as RawFileRow[]).map((row) => {
        const normalized = normalizeCrmRow(row, mapping);
        return {
          user_id: userId,
          upload_file_id: uploadFileId,
          id: normalized.id,
          deal_name: normalized.deal_name,
          amount: normalized.amount,
          stage: normalized.stage,
          phase: normalized.stage, // Required NOT NULL column (legacy field)
          company: normalized.company,
          owner: normalized.owner,
          product: normalized.product,
          created_date: normalized.created_date,
          close_date: normalized.close_date,
        };
      });

      const { error } = await supabase.from("crm_deals").insert(deals);
      if (error) throw error;
      insertedCount = deals.length;
    } else if (datasetType === "budget") {
      // Map CSV columns to budgets table
      const budgets = (jsonData as RawFileRow[]).map((row) => {
        // Normalize month field - can be a date or a string like "2025-01" or "Jan 2025"
        let monthValue =
          row.month ||
          row.Month ||
          row.period ||
          row.Period ||
          row.date ||
          row.Date;

        // If it's a date value, normalize it and extract YYYY-MM format
        if (monthValue) {
          const normalizedDate = normalizeDateValue(monthValue);
          if (normalizedDate) {
            // Extract YYYY-MM from ISO string
            monthValue = normalizedDate.slice(0, 7);
          } else if (typeof monthValue === "string") {
            // Try to parse string formats like "Jan 2025" or "2025-01"
            const dateMatch = monthValue.match(/(\d{4})-(\d{2})/);
            if (dateMatch) {
              monthValue = `${dateMatch[1]}-${dateMatch[2]}`;
            } else {
              // Try parsing as a date string
              const parsed = new Date(monthValue);
              if (!isNaN(parsed.getTime())) {
                monthValue = parsed.toISOString().slice(0, 7);
              }
            }
          }
        }

        // Fallback to current month if still no valid value
        if (
          !monthValue ||
          (typeof monthValue === "string" && monthValue.length < 7)
        ) {
          monthValue = new Date().toISOString().slice(0, 7);
        }

        return {
          user_id: userId,
          upload_file_id: uploadFileId,
          month: monthValue as string,
          category:
            (row.category as string) || (row.Category as string) || "General",
          value: parseFloat(
            String(row.value || row.Value || row.amount || row.Amount || "0")
          ),
        };
      });

      const { error } = await supabase.from("budgets").insert(budgets);
      if (error) throw error;
      insertedCount = budgets.length;
    }

    console.log(
      `[Ingestion] Successfully inserted ${insertedCount} rows for ${datasetType}`
    );

    // Update uploaded_files record with actual row count
    if (uploadFileId) {
      const { error: updateError } = await supabase
        .from("uploaded_files")
        .update({ row_count: insertedCount })
        .eq("id", uploadFileId);

      if (updateError) {
        console.error(
          `[Ingestion] Failed to update row_count for uploaded file:`,
          updateError.message
        );
      } else {
        console.log(
          `[Ingestion] Updated row_count to ${insertedCount} for file ${uploadFileId}`
        );
      }
    } else {
      console.warn(
        `[Ingestion] No upload_file_id to update row_count. File was inserted but not tracked.`
      );
    }

    return {
      success: true,
      insertedCount,
      datasetType,
      mode,
      uploadFileId: uploadFileId || undefined,
    };
  } catch (error: unknown) {
    console.error("[Ingestion] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Ingestion failed";
    return {
      success: false,
      insertedCount: 0,
      datasetType,
      mode,
      error: errorMessage,
    };
  }
}
