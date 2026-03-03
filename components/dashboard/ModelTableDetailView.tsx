"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  Upload,
  CheckCircle2,
  AlertCircle,
  Eye,
  Trash2,
  Sparkles,
  X,
} from "lucide-react";
import { TableDef } from "@/lib/model/transform";
import EnhancedDataMappingUI from "./data-mapping-confirmation";
import SheetSelection from "./sheet-selection";
import { ColumnMapping } from "@/types/schema";
import DataPreview from "./DataPreview";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { getDataTableBySlug } from "@/lib/data-table-service";
import type { DataTable } from "@/lib/types/data";
import { normalizeDateValue } from "@/lib/utils";

interface ModelTableDetailViewProps {
  table: TableDef;
  dataCount: number;
  allTableDataCounts: Record<string, number>;
  onClose: () => void;
  onUploadComplete?: () => void;
}

export default function ModelTableDetailView({
  table,
  dataCount,
  allTableDataCounts,
  onClose,
  onUploadComplete,
}: ModelTableDetailViewProps) {
  const [dataTable, setDataTable] = useState<DataTable | null>(null);

  // Fetch the latest table definition from data_tables
  useEffect(() => {
    const fetchDataTable = async () => {
      try {
        // Convert table name to slug (lowercase, replace spaces with underscores)
        const slug = table.name.toLowerCase().replace(/\s+/g, "_");
        const fetchedTable = await getDataTableBySlug(slug);
        if (fetchedTable) {
          setDataTable(fetchedTable);
        }
      } catch (error) {
        console.error(
          "[ModelTableDetailView] Error fetching data table:",
          error
        );
      }
    };
    fetchDataTable();
  }, [table.name]);

  // Use data_tables definition if available, otherwise fall back to canonical_model
  const effectiveTable: TableDef = dataTable
    ? {
        name: dataTable.name,
        fields: dataTable.fields.map((f) => ({
          name: f.name,
          type: f.type as any,
          required: f.required,
          primaryKey: f.primaryKey || false,
          references: f.references || null,
          allowedValues: f.allowedValues,
        })),
      }
    : table;
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<
    "detail" | "sheets" | "mapping" | "processing"
  >("detail");
  const [sheetData, setSheetData] = useState<{
    file: File;
    sheets: Array<{
      name: string;
      headers: string[];
      sampleData: any[];
      rows: any[];
      totalRows: number;
    }>;
  } | null>(null);
  const [mappingData, setMappingData] = useState<{
    headers: string[];
    sampleData: any[];
    allRows: any[];
    mappings: ColumnMapping[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiredFields = effectiveTable.fields.filter(
    (f) => f.required && !f.primaryKey
  );
  const optionalFields = effectiveTable.fields.filter((f) => !f.required);
  const primaryKeyFields = effectiveTable.fields.filter((f) => f.primaryKey);

  // Determine which referenced tables have no data yet.
  // Normalize names so that "membership_plans" matches "Membership Plans".
  const missingDependencies = (() => {
    const normalize = (n: string) => n.toLowerCase().replace(/[\s_-]+/g, "_");
    const countsByNorm = new Map<string, { original: string; count: number }>();
    for (const [name, count] of Object.entries(allTableDataCounts)) {
      countsByNorm.set(normalize(name), { original: name, count });
    }

    return effectiveTable.fields
      .filter((f) => f.references?.table)
      .map((f) => f.references!.table)
      .filter((refTable, i, arr) => arr.indexOf(refTable) === i)
      .filter((refTable) => {
        const entry = countsByNorm.get(normalize(refTable));
        return !entry || entry.count === 0;
      })
      .map((refTable) => {
        const entry = countsByNorm.get(normalize(refTable));
        return entry ? entry.original : refTable;
      });
  })();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setIsUploading(true);
    setUploadStep("processing");

    try {
      // Parse file to get headers and sample data
      const parseFormData = new FormData();
      parseFormData.append("file", file);

      const parseRes = await fetch("/api/data/parse", {
        method: "POST",
        body: parseFormData,
      });

      if (!parseRes.ok) {
        const errorText = await parseRes.text();
        throw new Error(`Parse failed: ${errorText}`);
      }

      const parseResult = await parseRes.json();

      // If the file has sheets (Excel), go to sheet selection first
      if (parseResult.sheets && parseResult.sheets.length > 0) {
        setSheetData({
          file,
          sheets: parseResult.sheets,
        });
        setUploadStep("sheets");
        return;
      }

      // Generate auto-mappings based on model table fields
      const suggestedMappings = generateModelBasedMappings(
        parseResult.headers || [],
        effectiveTable.fields
      );

      setMappingData({
        headers: parseResult.headers || [],
        sampleData: parseResult.sampleData || parseResult.sampleRows || [],
        allRows: parseResult.rows || parseResult.sampleData || [],
        mappings: suggestedMappings,
      });

      setUploadStep("mapping");
    } catch (error) {
      console.error("Error parsing file:", error);
      alert("Failed to parse file: " + (error as Error).message);
      setUploadStep("detail");
      setUploadedFile(null);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    insertedCount: number;
    generatedIdsCount: number;
    resolvedRefsCount: number;
  } | null>(null);

  const handleMappingConfirm = async (
    mappings: ColumnMapping[],
    valueMappings?: Record<string, Record<string, string>>
  ) => {
    if (!mappingData || !uploadedFile) return;

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const parseRes = await fetch("/api/data/parse", {
        method: "POST",
        body: formData,
      });

      if (!parseRes.ok) {
        throw new Error("Failed to parse file");
      }

      const parseResult = await parseRes.json();
      const allRows =
        parseResult.rows ||
        parseResult.sampleData ||
        parseResult.sampleRows ||
        [];

      const transformedRows = allRows.map((row: any) => {
        const transformed: Record<string, any> = {};
        mappings.forEach((mapping) => {
          if (mapping.standardField !== "unmapped") {
            const originalValue = row[mapping.originalColumn];
            if (originalValue !== undefined && originalValue !== null) {
              const fieldDef = effectiveTable.fields.find(
                (f) => f.name === mapping.standardField
              );
              if (
                fieldDef &&
                (fieldDef.type === "date" || fieldDef.type === "datetime")
              ) {
                transformed[mapping.standardField] =
                  normalizeDateValue(originalValue) ?? originalValue;
              } else {
                transformed[mapping.standardField] = originalValue;
              }
            }
          }
        });
        if (valueMappings) {
          for (const [fieldName, fieldMap] of Object.entries(valueMappings)) {
            if (transformed[fieldName] !== undefined) {
              const orig = String(transformed[fieldName]);
              if (fieldMap[orig] !== undefined) {
                transformed[fieldName] = fieldMap[orig];
              }
            }
          }
        }
        return transformed;
      });

      // Upload to model table
      const response = await fetch("/api/data/upload-model-table", {
        method: "POST",
        body: JSON.stringify({
          tableName: table.name,
          rows: transformedRows,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Upload failed");
      }

      console.log("Upload successful:", result);

      if (result.generatedIdsCount > 0 || result.resolvedRefsCount > 0) {
        setUploadResult({
          insertedCount: result.insertedCount,
          generatedIdsCount: result.generatedIdsCount || 0,
          resolvedRefsCount: result.resolvedRefsCount || 0,
        });
      }

      onUploadComplete?.();
      if (showDataPreview) {
        setShowDataPreview(false);
        setTimeout(() => setShowDataPreview(true), 100);
      }
      setUploadStep("detail");
      setMappingData(null);
      setUploadedFile(null);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed: " + (error as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSheetSelectionConfirm = async (
    sheetMappings: Array<{
      sheetName: string;
      datasetType: string;
      columnMappings: ColumnMapping[];
      valueMappings?: Record<string, Record<string, string>>;
    }>
  ) => {
    if (!sheetData) return;

    setIsUploading(true);
    setUploadStep("processing");

    try {
      let totalGenerated = 0;
      let totalResolved = 0;
      let totalInserted = 0;

      // Process each selected sheet
      for (const mapping of sheetMappings) {
        // Parse the specific sheet
        const formData = new FormData();
        formData.append("file", sheetData.file);
        formData.append("sheetName", mapping.sheetName);

        const parseRes = await fetch("/api/data/parse", {
          method: "POST",
          body: formData,
        });

        if (!parseRes.ok) {
          throw new Error(`Failed to parse sheet "${mapping.sheetName}"`);
        }

        const parseResult = await parseRes.json();
        const allRows = parseResult.rows || parseResult.sampleData || [];

        const transformedRows = allRows.map((row: any) => {
          const transformed: Record<string, any> = {};
          mapping.columnMappings.forEach((colMapping) => {
            if (colMapping.standardField !== "unmapped") {
              const originalValue = row[colMapping.originalColumn];
              if (originalValue !== undefined && originalValue !== null) {
                const fieldDef = effectiveTable.fields.find(
                  (f) => f.name === colMapping.standardField
                );
                if (
                  fieldDef &&
                  (fieldDef.type === "date" || fieldDef.type === "datetime")
                ) {
                  transformed[colMapping.standardField] =
                    normalizeDateValue(originalValue) ?? originalValue;
                } else {
                  transformed[colMapping.standardField] = originalValue;
                }
              }
            }
          });
          if (mapping.valueMappings) {
            for (const [fieldName, fieldMap] of Object.entries(
              mapping.valueMappings
            )) {
              if (transformed[fieldName] !== undefined) {
                const orig = String(transformed[fieldName]);
                if (fieldMap[orig] !== undefined) {
                  transformed[fieldName] = fieldMap[orig];
                }
              }
            }
          }
          return transformed;
        });

        // Upload to model table
        const response = await fetch("/api/data/upload-model-table", {
          method: "POST",
          body: JSON.stringify({
            tableName: table.name,
            rows: transformedRows,
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });

        const sheetResult = await response.json();

        if (!response.ok) {
          throw new Error(
            sheetResult.error ||
              `Upload failed for sheet "${mapping.sheetName}"`
          );
        }
        totalGenerated += sheetResult.generatedIdsCount || 0;
        totalResolved += sheetResult.resolvedRefsCount || 0;
        totalInserted += sheetResult.insertedCount || 0;
      }

      if (totalGenerated > 0 || totalResolved > 0) {
        setUploadResult({
          insertedCount: totalInserted,
          generatedIdsCount: totalGenerated,
          resolvedRefsCount: totalResolved,
        });
      }

      console.log("All sheets uploaded successfully");
      onUploadComplete?.();
      if (showDataPreview) {
        setShowDataPreview(false);
        setTimeout(() => setShowDataPreview(true), 100);
      }
      setUploadStep("detail");
      setSheetData(null);
      setUploadedFile(null);
    } catch (error) {
      console.error("Sheet upload error:", error);
      alert("Upload failed: " + (error as Error).message);
      setUploadStep("detail");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteData = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch("/api/data/delete-model-table", {
        method: "DELETE",
        body: JSON.stringify({
          tableName: table.name,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const result = await response.json();
      console.log("Delete successful:", result);

      // Close data preview if it's open
      setShowDataPreview(false);

      // Refresh the UI
      console.log("Calling onUploadComplete to refresh counts");
      await onUploadComplete?.();

      // Reset upload step to detail
      setUploadStep("detail");

      console.log("Delete process completed");
    } catch (error) {
      console.error("Delete error:", error);
      alert("Delete failed: " + (error as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  if (uploadStep === "sheets" && sheetData) {
    return (
      <SheetSelection
        fileName={sheetData.file.name}
        sheets={sheetData.sheets}
        onConfirm={handleSheetSelectionConfirm}
        onCancel={() => {
          setUploadStep("detail");
          setSheetData(null);
        }}
        targetModelTable={{
          name: effectiveTable.name,
          fields: effectiveTable.fields.map((f) => ({
            name: f.name,
            required: f.required,
            type: f.type,
            primaryKey: f.primaryKey,
            references: f.references,
            allowedValues: f.allowedValues,
          })),
        }}
        missingDependencies={missingDependencies}
      />
    );
  }

  if (uploadStep === "mapping" && mappingData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Tables
          </Button>
        </div>
        <EnhancedDataMappingUI
          fileName={`Upload to ${table.name}`}
          fileType="transactions"
          headers={mappingData.headers}
          sampleData={mappingData.sampleData}
          allRows={mappingData.allRows}
          suggestedMappings={mappingData.mappings}
          confidence={0.8}
          issues={[]}
          onConfirm={handleMappingConfirm}
          onCancel={() => {
            setUploadStep("detail");
            setMappingData(null);
          }}
          modelTableFields={effectiveTable.fields.map((f) => ({
            name: f.name,
            required: f.required,
            type: f.type,
            primaryKey: f.primaryKey,
            references: f.references,
            allowedValues: f.allowedValues,
          }))}
          modelTableName={effectiveTable.name}
          missingDependencies={missingDependencies}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Tables
          </Button>
          <h2 className="text-xl font-semibold">{table.name}</h2>
          {dataCount > 0 && (
            <Badge className="bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 border-transparent">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {dataCount} rows uploaded
            </Badge>
          )}
        </div>
      </div>

      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileSelect}
      />

      {uploadResult && (
        <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              Successfully uploaded {uploadResult.insertedCount} rows.
              {uploadResult.generatedIdsCount > 0 && (
                <>
                  {" "}
                  <strong>
                    {uploadResult.generatedIdsCount} unique IDs
                  </strong>{" "}
                  auto-generated.
                </>
              )}
              {uploadResult.resolvedRefsCount > 0 && (
                <>
                  {" "}
                  <strong>
                    {uploadResult.resolvedRefsCount} references
                  </strong>{" "}
                  linked from related tables.
                </>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 ml-2"
              onClick={() => setUploadResult(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Data Preview Section */}
      {dataCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Data Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              View and explore the data that has been uploaded to this table.
            </p>
            {showDataPreview ? (
              <DataPreview
                tableName={table.name}
                onClose={() => setShowDataPreview(false)}
              />
            ) : (
              <Button
                onClick={() => setShowDataPreview(true)}
                variant="outline"
                className="w-full"
              >
                <Eye className="h-4 w-4 mr-2" />
                Show Data Preview ({dataCount} entries)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Field Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Table Fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {primaryKeyFields.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                Primary Keys
                <Badge variant="outline" className="text-xs">
                  Required
                </Badge>
              </h4>
              <div className="space-y-1">
                {primaryKeyFields.map((field, index) => (
                  <div
                    key={`primary-${field.name}-${index}`}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                  >
                    <span className="font-mono">{field.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {field.type || "string"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {requiredFields.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                Required Fields
                <Badge variant="default" className="text-xs">
                  Must be mapped
                </Badge>
              </h4>
              <div className="space-y-1">
                {requiredFields.map((field, index) => (
                  <div
                    key={`required-${field.name}-${index}`}
                    className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-950/20 rounded text-sm border border-red-200 dark:border-red-900/50"
                  >
                    <span className="font-mono">{field.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {field.type || "string"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {optionalFields.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                Optional Fields
                <Badge variant="secondary" className="text-xs">
                  Can be mapped
                </Badge>
              </h4>
              <div className="space-y-1">
                {optionalFields.map((field, index) => (
                  <div
                    key={`optional-${field.name}-${index}`}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                  >
                    <span className="font-mono">{field.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {field.type || "string"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {effectiveTable.fields.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This table has no fields defined yet.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a CSV or Excel file that matches this table structure.
            We&apos;ll help you map the columns to the required and optional
            fields.
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            {isUploading ? "Processing..." : "Choose File to Upload"}
          </Button>
        </CardContent>
      </Card>

      {/* Delete Data Section */}
      {dataCount > 0 && (
        <Card className="border-red-200 dark:border-red-900">
          <CardHeader>
            <CardTitle className="text-base text-red-900 dark:text-red-100">
              Delete All Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently delete all data from this table. This action cannot be
              undone.
            </p>
            <Button
              onClick={() => setDeleteDialogOpen(true)}
              disabled={isDeleting}
              variant="destructive"
              className="w-full"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? "Deleting..." : "Delete All Data"}
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete All Data"
        description={`Are you sure you want to delete all ${dataCount} rows from the "${table.name}" table? This action cannot be undone.`}
        confirmText="Delete All Data"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleDeleteData}
      />
    </div>
  );
}

/**
 * Generate column mappings based on model table fields
 */
function generateModelBasedMappings(
  headers: string[],
  modelFields: TableDef["fields"]
): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];

  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().trim();

    // Try to find matching model field
    const matchingField = modelFields.find((field) => {
      const normalizedFieldName = field.name.toLowerCase().trim();
      return (
        normalizedHeader === normalizedFieldName ||
        normalizedHeader.includes(normalizedFieldName) ||
        normalizedFieldName.includes(normalizedHeader)
      );
    });

    if (matchingField) {
      mappings.push({
        originalColumn: header,
        standardField: matchingField.name,
        confidence: 0.9,
        dataType: inferDataTypeFromFieldType(matchingField.type),
        transformation: "none",
      });
    } else {
      mappings.push({
        originalColumn: header,
        standardField: "unmapped",
        confidence: 0,
        dataType: "string",
        transformation: "none",
      });
    }
  }

  return mappings;
}

function inferDataTypeFromFieldType(
  fieldType?: string
): "string" | "number" | "date" | "currency" {
  if (!fieldType) return "string";

  const normalized = fieldType.toLowerCase();
  if (normalized.includes("number") || normalized.includes("integer")) {
    return "number";
  }
  if (normalized.includes("date")) {
    return "date";
  }
  if (
    normalized.includes("currency") ||
    normalized.includes("money") ||
    normalized.includes("price")
  ) {
    return "currency";
  }
  return "string";
}
