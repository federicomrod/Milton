"use client";

import { useState, useRef } from "react";
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
} from "lucide-react";
import { TableDef } from "@/lib/model/transform";
import EnhancedDataMappingUI from "./data-mapping-confirmation";
import SheetSelection from "./sheet-selection";
import { ColumnMapping } from "@/types/schema";
import DataPreview from "./DataPreview";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ModelTableDetailViewProps {
  table: TableDef;
  dataCount: number;
  onClose: () => void;
  onUploadComplete?: () => void;
}

export default function ModelTableDetailView({
  table,
  dataCount,
  onClose,
  onUploadComplete,
}: ModelTableDetailViewProps) {
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
      totalRows: number;
    }>;
  } | null>(null);
  const [mappingData, setMappingData] = useState<{
    headers: string[];
    sampleData: any[];
    mappings: ColumnMapping[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiredFields = table.fields.filter(
    (f) => !f.nullable && !f.primaryKey
  );
  const optionalFields = table.fields.filter((f) => f.nullable);
  const primaryKeyFields = table.fields.filter((f) => f.primaryKey);

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
        table.fields
      );

      setMappingData({
        headers: parseResult.headers || [],
        sampleData: parseResult.sampleData || parseResult.sampleRows || [],
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

  const handleMappingConfirm = async (mappings: ColumnMapping[]) => {
    if (!mappingData || !uploadedFile) return;

    setIsUploading(true);

    try {
      // Parse the full file to get all rows (not just sample)
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

      // Transform all rows using mappings
      const transformedRows = allRows.map((row: any) => {
        const transformed: Record<string, any> = {};
        mappings.forEach((mapping) => {
          if (mapping.standardField !== "unmapped") {
            const originalValue = row[mapping.originalColumn];
            if (originalValue !== undefined && originalValue !== null) {
              transformed[mapping.standardField] = originalValue;
            }
          }
        });
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

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const result = await response.json();
      console.log("Upload successful:", result);

      onUploadComplete?.();
      // Refresh data preview if it's currently shown
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
    }>
  ) => {
    if (!sheetData) return;

    setIsUploading(true);
    setUploadStep("processing");

    try {
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

        // Transform rows using the confirmed mappings
        const transformedRows = allRows.map((row: any) => {
          const transformed: Record<string, any> = {};
          mapping.columnMappings.forEach((colMapping) => {
            if (colMapping.standardField !== "unmapped") {
              const originalValue = row[colMapping.originalColumn];
              if (originalValue !== undefined && originalValue !== null) {
                transformed[colMapping.standardField] = originalValue;
              }
            }
          });
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

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Upload failed for sheet "${mapping.sheetName}": ${errorText}`
          );
        }
      }

      console.log("All sheets uploaded successfully");
      onUploadComplete?.();
      // Refresh data preview if it's currently shown
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
          name: table.name,
          fields: table.fields.map((f) => ({
            name: f.name,
            nullable: f.nullable,
            type: f.type,
          })),
        }}
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
          suggestedMappings={mappingData.mappings}
          confidence={0.8}
          issues={[]}
          onConfirm={handleMappingConfirm}
          onCancel={() => {
            setUploadStep("detail");
            setMappingData(null);
          }}
          modelTableFields={table.fields.map((f) => ({
            name: f.name,
            nullable: f.nullable,
            type: f.type,
          }))}
          modelTableName={table.name}
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

          {table.fields.length === 0 && (
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
