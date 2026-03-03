// app/api/data/parse/route.ts
// API endpoint to parse file and return headers/sample data for mapping
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import { normalizeDateValue } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const requestedSheetName = formData.get("sheetName") as string | null;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No valid file uploaded" },
        { status: 400 }
      );
    }

    // Parse the file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 }
      );
    }

    // Check if it's a CSV file (by extension or content)
    const isCSV = file.name.toLowerCase().endsWith(".csv");

    let jsonData: Record<string, unknown>[] = [];
    let headers: string[] = [];
    let sheets: Array<{
      name: string;
      headers: string[];
      sampleData: Record<string, unknown>[];
      rows: Record<string, unknown>[];
      totalRows: number;
    }> = [];

    if (isCSV) {
      // For CSV files, read as text to preserve exact format
      const text = buffer.toString("utf-8");
      // Detect delimiter (semicolon, comma, or tab)
      const firstLine = text.split("\n")[0];
      const delimiter = firstLine.includes(";")
        ? ";"
        : firstLine.includes("\t")
          ? "\t"
          : ",";

      const lines = text.split("\n").filter((line) => line.trim());
      if (lines.length === 0) {
        return NextResponse.json(
          { error: "File contains no data" },
          { status: 400 }
        );
      }

      // Parse CSV manually to preserve exact values
      headers = lines[0]
        .split(delimiter)
        .map((h) => h.trim().replace(/^"|"$/g, ""));
      jsonData = lines.slice(1).map((line) => {
        const values = line
          .split(delimiter)
          .map((v) => v.trim().replace(/^"|"$/g, ""));
        const row: Record<string, unknown> = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] ?? "";
        });
        return row;
      });

      // For CSV, create a single "sheet" entry (CSV files are treated as single-sheet)
      const sampleData = jsonData.slice(0, 10);
      sheets = [
        {
          name: "Sheet1",
          headers,
          sampleData,
          rows: jsonData,
          totalRows: jsonData.length,
        },
      ];
    } else {
      // For Excel files, parse all sheets
      const workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: false, // Don't auto-convert dates to Date objects
        raw: true, // Get raw values to preserve date strings
      });

      // Process all sheets
      sheets = workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];

        // Get data with raw values to preserve date formats
        const sheetData = XLSX.utils.sheet_to_json(worksheet, {
          raw: true, // Get raw values
          defval: "", // Default value for empty cells
        }) as Record<string, unknown>[];

        let sheetHeaders: string[] = [];
        if (sheetData.length > 0) {
          sheetHeaders = Object.keys(sheetData[0]);
        }

        // For Excel files, try to get formatted text for date cells
        const processedData = sheetData.map((row, rowIdx) => {
          const newRow = { ...row };
          sheetHeaders.forEach((header, colIdx) => {
            const cellAddress = XLSX.utils.encode_cell({
              r: rowIdx + 1,
              c: colIdx,
            });
            const cell = worksheet[cellAddress];
            // If cell has formatted text that looks like a date, use it
            if (
              cell &&
              cell.w &&
              /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(cell.w)
            ) {
              newRow[header] = cell.w;
            }
          });
          return newRow;
        });

        return {
          name: sheetName,
          headers: sheetHeaders,
          sampleData: processedData.slice(0, 10),
          rows: processedData,
          totalRows: processedData.length,
        };
      });

      // Use the requested sheet (by name) or fall back to the first sheet
      const targetSheet = requestedSheetName
        ? (sheets.find((s) => s.name === requestedSheetName) ?? sheets[0])
        : sheets[0];

      if (targetSheet) {
        const targetWorksheet = workbook.Sheets[targetSheet.name];
        const targetSheetData = XLSX.utils.sheet_to_json(targetWorksheet, {
          raw: true,
          defval: "",
        }) as Record<string, unknown>[];

        // Apply date formatting to the target sheet data
        jsonData = targetSheetData.map((row, rowIdx) => {
          const newRow = { ...row };
          targetSheet.headers.forEach((header, colIdx) => {
            const cellAddress = XLSX.utils.encode_cell({
              r: rowIdx + 1,
              c: colIdx,
            });
            const cell = targetWorksheet[cellAddress];
            if (
              cell &&
              cell.w &&
              /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(cell.w)
            ) {
              newRow[header] = cell.w;
            }
          });
          return newRow;
        });
        headers = targetSheet.headers;
      } else {
        return NextResponse.json(
          { error: "File contains no sheets" },
          { status: 400 }
        );
      }
    }

    if (jsonData.length === 0) {
      return NextResponse.json(
        { error: "File contains no data" },
        { status: 400 }
      );
    }

    // Detect potential date columns by checking if values look like dates
    // Check multiple rows to be more confident
    const potentialDateColumns = new Set<string>();
    const sampleRows = jsonData.slice(0, Math.min(5, jsonData.length));

    headers.forEach((header) => {
      let dateLikeCount = 0;
      let totalCount = 0;

      sampleRows.forEach((row) => {
        const value = row[header as keyof typeof row];
        if (value !== null && value !== undefined && value !== "") {
          totalCount++;
          const strValue = String(value);
          // Check if it looks like a date (DD.MM.YY, DD/MM/YY, MM/DD/YY, or Excel serial date)
          if (
            /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(strValue) || // Date string formats
            (typeof value === "number" && value > 1 && value < 100000) // Excel serial date
          ) {
            dateLikeCount++;
          }
        }
      });

      // If most values in this column look like dates, treat it as a date column
      if (totalCount > 0 && dateLikeCount / totalCount >= 0.5) {
        potentialDateColumns.add(header);
      }
    });

    // Get sample data (first 10 rows) - show raw values as they appear in the file
    // Don't normalize dates in preview - just show what's in the file
    const sampleData = jsonData.slice(0, 10).map((row) => {
      const sample: Record<string, unknown> = {};
      headers.forEach((header) => {
        sample[header] = row[header] ?? "";
      });
      return sample;
    });

    return NextResponse.json({
      headers,
      sampleData,
      rows: jsonData,
      totalRows: jsonData.length,
      fileName: file.name,
      sheets, // Include sheets array for Excel files
      isMultiSheet: sheets.length > 1, // Flag for multi-sheet files
    });
  } catch (error: any) {
    console.error("[Parse API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Parse failed" },
      { status: 500 }
    );
  }
}
