// lib/ingestion/ingestion-service.ts
// Unified ingestion service for all file uploads (dashboard + data model builder)

import { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { DEFAULT_CRM_MAPPING, CrmMapping } from "@/lib/crm-mapping";
import { normalizeCrmRow } from "@/lib/crm-normalizer";
import { normalizeDateValue } from "@/lib/utils";

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
}

export interface IngestFileResult {
  success: boolean;
  insertedCount: number;
  datasetType: string;
  mode: string;
  error?: string;
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
 * Unified ingestion service that handles:
 * 1. File parsing (CSV/XLSX)
 * 2. Mode handling (overwrite/append)
 * 3. Data normalization by type
 * 4. Supabase insertion
 */
export async function ingestUploadedFile({
  supabase,
  userId,
  file,
  datasetType,
  mode,
}: IngestFileParams): Promise<IngestFileResult> {
  try {
    console.log(
      `[Ingestion] Processing ${datasetType} file: ${file.name} (mode: ${mode})`
    );

    // Step 1: Parse the file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("Empty file uploaded");
    }

    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("File too large (max 10MB)");
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

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

    if (datasetType === "bank") {
      // Map CSV columns to transactions table
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

    return {
      success: true,
      insertedCount,
      datasetType,
      mode,
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
