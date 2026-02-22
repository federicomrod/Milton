import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  AlertTriangle,
  FileText,
  ArrowRight,
  Eye,
  Brain,
  RefreshCw,
  Download,
  Settings,
  Sparkles,
  Loader2,
} from "lucide-react";

import { ColumnMapping } from "@/types/schema";

/** When provided, mapping targets are the table's fields instead of fileType standards */
export type ModelTableField = {
  name: string;
  required?: boolean;
  type?: string;
  primaryKey?: boolean;
  references?: { table: string; field?: string } | null;
  allowedValues?: string[];
};

interface DataMappingUIProps {
  fileName: string;
  fileType: "transactions" | "deals" | "budget";
  headers: string[];
  sampleData: any[];
  /** All parsed rows from the file – used for extracting every unique value for normalization. Falls back to sampleData when omitted. */
  allRows?: any[];
  suggestedMappings: ColumnMapping[];
  confidence: number;
  issues: string[];
  onConfirm: (
    mappings: ColumnMapping[],
    valueMappings?: Record<string, Record<string, string>>
  ) => void;
  onCancel: () => void;
  onReanalyze?: () => void;
  /** Table fields for model-table uploads. When set, dropdown and validation use these instead of fileType. */
  modelTableFields?: ModelTableField[];
  /** When using modelTableFields, label for the badge (e.g. table name). */
  modelTableName?: string;
  /** Tables that this table depends on but have no data yet. Blocks upload when non-empty. */
  missingDependencies?: string[];
}

const STANDARD_FIELDS = {
  transactions: [
    {
      value: "date",
      label: "Date",
      description: "Transaction date",
      required: true,
    },
    {
      value: "amount",
      label: "Amount",
      description: "Transaction amount",
      required: true,
    },
    {
      value: "description",
      label: "Description",
      description: "Transaction description",
      required: false,
    },
    {
      value: "category",
      label: "Category",
      description: "Transaction category",
      required: false,
    },
    {
      value: "name",
      label: "Name",
      description: "Vendor/payee name",
      required: false,
    },
    {
      value: "type",
      label: "Type",
      description:
        "Transaction type: inflow/income (positive) or outflow/expense (negative). If your amounts are already signed (+/-), you can skip this field.",
      required: false,
    },
    {
      value: "reference",
      label: "Reference",
      description: "Reference number",
      required: false,
    },
    {
      value: "unmapped",
      label: "Ignore",
      description: "Skip this column",
      required: false,
    },
  ],
  deals: [
    {
      value: "dealName",
      label: "Deal Name",
      description: "Name of the deal",
      required: true,
    },
    {
      value: "clientName",
      label: "Client Name",
      description: "Client or company name",
      required: true,
    },
    {
      value: "amount",
      label: "Amount",
      description: "Deal value",
      required: false,
    },
    {
      value: "phase",
      label: "Phase/Stage",
      description: "Current deal stage",
      required: false,
    },
    {
      value: "product",
      label: "Product",
      description: "Product or service",
      required: false,
    },
    {
      value: "firstAppointment",
      label: "First Contact",
      description: "Date of first contact",
      required: false,
    },
    {
      value: "closingDate",
      label: "Closing Date",
      description: "Expected closing date",
      required: false,
    },
    {
      value: "unmapped",
      label: "Ignore",
      description: "Skip this column",
      required: false,
    },
  ],
  budget: [
    {
      value: "category",
      label: "Category",
      description: "Budget category",
      required: true,
    },
    {
      value: "month",
      label: "Month",
      description:
        "Month/period column (can map multiple month columns for wide-format budgets)",
      required: false,
    },
    {
      value: "value",
      label: "Value",
      description: "Budget amount",
      required: false,
    },
    {
      value: "unmapped",
      label: "Ignore",
      description: "Skip this column",
      required: false,
    },
  ],
};

function buildStandardFieldsFromTable(
  modelTableFields: ModelTableField[]
): Array<{
  value: string;
  label: string;
  description: string;
  required: boolean;
  autoGenerable: boolean;
  isPrimaryKey: boolean;
  isReference: boolean;
  referencesTable?: string;
  allowedValues?: string[];
}> {
  return modelTableFields.map((f) => ({
    value: f.name,
    label: f.name,
    description:
      f.allowedValues && f.allowedValues.length > 0
        ? `Values: ${f.allowedValues.join(", ")}`
        : f.type || "—",
    required: f.required ?? false,
    autoGenerable: f.primaryKey === true || !!f.references,
    isPrimaryKey: f.primaryKey === true,
    isReference: !!f.references,
    referencesTable: f.references?.table,
    allowedValues: f.allowedValues,
  }));
}

const EMPTY_COLUMN = "";

function fieldToColumnToMappings(
  fieldToColumn: Record<string, string>
): ColumnMapping[] {
  return Object.entries(fieldToColumn)
    .filter(([, col]) => col !== EMPTY_COLUMN)
    .map(([field, col]) => ({
      originalColumn: col,
      standardField: field,
      confidence: 1,
      dataType: "string" as const,
      transformation: "none" as const,
    }));
}

export default function EnhancedDataMappingUI({
  fileName,
  fileType,
  headers,
  sampleData,
  allRows,
  suggestedMappings,
  confidence,
  issues,
  onConfirm,
  onCancel,
  onReanalyze,
  modelTableFields,
  modelTableName,
  missingDependencies = [],
}: DataMappingUIProps) {
  const isModelTableMode = Boolean(
    modelTableFields && modelTableFields.length > 0
  );
  const standardFields = isModelTableMode
    ? buildStandardFieldsFromTable(modelTableFields!)
    : STANDARD_FIELDS[fileType] || [];

  // Model-table mode: one row per target field, user picks which file column → field
  const initialFieldToColumn = React.useMemo(() => {
    if (!isModelTableMode || !modelTableFields) return {};
    const out: Record<string, string> = {};
    for (const f of modelTableFields) {
      const found = suggestedMappings.find((m) => m.standardField === f.name);
      out[f.name] = found?.originalColumn ?? EMPTY_COLUMN;
    }
    return out;
  }, [isModelTableMode, modelTableFields, suggestedMappings]);

  // Legacy mode: one row per file column, user picks target field
  const initialMappings: ColumnMapping[] = React.useMemo(
    () =>
      suggestedMappings.length > 0
        ? suggestedMappings
        : headers.map((header) => {
            const sampleValue = sampleData[0]?.[header];
            let dataType: "string" | "number" | "date" | "currency" = "string";
            if (sampleValue !== null && sampleValue !== undefined) {
              if (typeof sampleValue === "number") dataType = "number";
              else if (typeof sampleValue === "string") {
                if (
                  /^\d{4}-\d{2}-\d{2}/.test(sampleValue) ||
                  /^\d{2}\/\d{2}\/\d{4}/.test(sampleValue)
                )
                  dataType = "date";
                else if (
                  /[€$£¥]/.test(sampleValue) ||
                  /^\d+[.,]\d{2}$/.test(sampleValue)
                )
                  dataType = "currency";
              }
            }
            return {
              originalColumn: header,
              standardField: "unmapped",
              confidence: 0,
              dataType,
              transformation: "none" as const,
            };
          }),
    [suggestedMappings, headers, sampleData]
  );

  const [fieldToColumn, setFieldToColumn] =
    useState<Record<string, string>>(initialFieldToColumn);
  const [mappings, setMappings] = useState<ColumnMapping[]>(initialMappings);
  const [activeTab, setActiveTab] = useState("mappings");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Value normalization state
  const [valueMappings, setValueMappings] = useState<
    Record<string, Record<string, string>>
  >({});
  const [isNormalizing, setIsNormalizing] = useState(false);
  const lastNormKey = useRef("");
  const normVersion = useRef(0);

  const fieldsWithAllowedValues = useMemo(() => {
    if (!isModelTableMode)
      return [] as Array<{
        value: string;
        label: string;
        allowedValues: string[];
      }>;
    return standardFields.filter(
      (f): f is typeof f & { allowedValues: string[] } =>
        "allowedValues" in f &&
        Array.isArray((f as any).allowedValues) &&
        (f as any).allowedValues.length > 0 &&
        !!fieldToColumn[f.value] &&
        fieldToColumn[f.value] !== EMPTY_COLUMN
    );
  }, [standardFields, fieldToColumn, isModelTableMode]);

  const dataForNormalization =
    allRows && allRows.length > 0 ? allRows : sampleData;

  const uniqueValuesPerField = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const field of fieldsWithAllowedValues) {
      const col = fieldToColumn[field.value];
      const vals = [
        ...new Set(
          dataForNormalization
            .map((row) => row[col])
            .filter(
              (v) => v !== undefined && v !== null && String(v).trim() !== ""
            )
            .map((v) => String(v))
        ),
      ];
      out[field.value] = vals;
    }
    return out;
  }, [fieldsWithAllowedValues, fieldToColumn, dataForNormalization]);

  useEffect(() => {
    const key = fieldsWithAllowedValues
      .map((f) => `${f.value}:${fieldToColumn[f.value]}`)
      .sort()
      .join("|");

    if (key === lastNormKey.current) return;
    lastNormKey.current = key;

    if (fieldsWithAllowedValues.length === 0) {
      setValueMappings({});
      return;
    }

    const fieldsToNormalize = fieldsWithAllowedValues.filter((f) => {
      const vals = uniqueValuesPerField[f.value] || [];
      if (vals.length === 0) return false;
      const allowed = new Set(f.allowedValues!.map((v) => v.toLowerCase()));
      return vals.some((v) => !allowed.has(v.toLowerCase()));
    });

    if (fieldsToNormalize.length === 0) {
      const identity: Record<string, Record<string, string>> = {};
      for (const f of fieldsWithAllowedValues) {
        const vals = uniqueValuesPerField[f.value] || [];
        const map: Record<string, string> = {};
        for (const v of vals) {
          const match = f.allowedValues!.find(
            (a) => a.toLowerCase() === v.toLowerCase()
          );
          if (match) map[v] = match;
        }
        if (Object.keys(map).length > 0) identity[f.value] = map;
      }
      setValueMappings(identity);
      return;
    }

    const version = ++normVersion.current;
    const normalize = async () => {
      setIsNormalizing(true);
      try {
        const res = await fetch("/api/data/normalize-values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: fieldsToNormalize.map((f) => ({
              fieldName: f.value,
              tableName: modelTableName || "",
              allowedValues: f.allowedValues,
              uniqueValues: uniqueValuesPerField[f.value],
            })),
          }),
        });
        if (normVersion.current === version && res.ok) {
          const data = await res.json();
          if (data.mappings) {
            setValueMappings((prev) => ({ ...prev, ...data.mappings }));
          }
        }
      } catch (err) {
        console.error("[data-mapping] Normalization error:", err);
      } finally {
        if (normVersion.current === version) setIsNormalizing(false);
      }
    };
    normalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fieldsWithAllowedValues,
    uniqueValuesPerField,
    fieldToColumn,
    modelTableName,
  ]);

  const effectiveMappings: ColumnMapping[] = isModelTableMode
    ? fieldToColumnToMappings(fieldToColumn)
    : mappings;

  const updateFieldColumn = (field: string, column: string) => {
    setFieldToColumn((prev) => ({ ...prev, [field]: column }));
  };

  const validateMappings = useCallback(() => {
    const errors: string[] = [];
    if (isModelTableMode) {
      const requiredFields = standardFields.filter(
        (f) => f.required && !("autoGenerable" in f && f.autoGenerable)
      );
      for (const r of requiredFields) {
        if (!(fieldToColumn[r.value] ?? EMPTY_COLUMN).trim()) {
          errors.push(`Required field "${r.label}" needs a source column`);
        }
      }
      const usedColumns = Object.values(fieldToColumn).filter(
        (c) => c !== EMPTY_COLUMN
      );
      const duplicates = usedColumns.filter(
        (c, i, arr) => arr.indexOf(c) !== i
      );
      if (duplicates.length > 0) {
        errors.push(
          `Column(s) used more than once: ${[...new Set(duplicates)].join(", ")}`
        );
      }
    } else {
      const mappedFields = mappings
        .map((m) => m.standardField)
        .filter((f) => f !== "unmapped");
      const requiredFields = standardFields.filter((f) => f.required);
      for (const required of requiredFields) {
        if (!mappedFields.includes(required.value)) {
          errors.push(`Required field "${required.label}" is not mapped`);
        }
      }
      const allowMultiple = (f: string) =>
        fileType === "budget" && f === "month";
      const dups = mappedFields.filter(
        (f, i, arr) =>
          arr.indexOf(f) !== i && f !== "unmapped" && !allowMultiple(f)
      );
      if (dups.length > 0)
        errors.push(`Duplicate mappings found: ${dups.join(", ")}`);
    }
    setValidationErrors(errors);
  }, [mappings, fieldToColumn, isModelTableMode, standardFields, fileType]);

  useEffect(() => {
    // Use setTimeout to avoid synchronous setState in effect
    const timer = setTimeout(() => {
      validateMappings();
    }, 0);
    return () => clearTimeout(timer);
  }, [validateMappings]);

  const updateMapping = (originalColumn: string, standardField: string) => {
    setMappings((prev) =>
      prev.map((mapping) =>
        mapping.originalColumn === originalColumn
          ? {
              ...mapping,
              standardField,
              confidence: standardField === "unmapped" ? 0 : 1.0,
              transformation: (mapping.transformation || "none") as
                | "none"
                | "date_conversion"
                | "currency_conversion"
                | "text_cleanup",
            }
          : mapping
      )
    );
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8)
      return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30";
    if (confidence >= 0.6)
      return "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30";
    return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30";
  };

  const getConfidenceBadge = (confidence: number) => {
    const percentage = Math.round(confidence * 100);
    if (confidence >= 0.8)
      return (
        <Badge className="bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300">
          {percentage}%
        </Badge>
      );
    if (confidence >= 0.6)
      return (
        <Badge className="bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300">
          {percentage}%
        </Badge>
      );
    return (
      <Badge className="bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300">
        {percentage}%
      </Badge>
    );
  };

  const previewMappedData = () => {
    const m = effectiveMappings;
    return sampleData.slice(0, 15).map((row, index) => {
      const mapped: any = { _index: index + 1 };
      m.forEach((mapping) => {
        if (mapping.standardField !== "unmapped") {
          if (fileType === "budget" && mapping.standardField === "month") {
            mapped[mapping.originalColumn] = row[mapping.originalColumn] || "";
          } else {
            mapped[mapping.standardField] = row[mapping.originalColumn] || "";
          }
        }
      });
      return mapped;
    });
  };

  const isValid = validationErrors.length === 0;

  const requiredCount = standardFields.filter(
    (f) => f.required && !("autoGenerable" in f && f.autoGenerable)
  ).length;
  const requiredMappedCount = isModelTableMode
    ? standardFields.filter(
        (f) =>
          f.required &&
          !("autoGenerable" in f && f.autoGenerable) &&
          (fieldToColumn[f.value] ?? "").trim()
      ).length
    : mappings.filter(
        (m) =>
          m.standardField !== "unmapped" &&
          standardFields.find((s) => s.value === m.standardField)?.required
      ).length;
  const currentConfidence = isModelTableMode
    ? requiredCount === 0
      ? 1
      : requiredMappedCount / requiredCount
    : mappings.length > 0
      ? mappings.reduce(
          (sum, m) =>
            m.standardField === "unmapped" ? sum : sum + m.confidence,
          0
        ) / mappings.length
      : 0;

  return (
    <Dialog open={true} onOpenChange={() => onCancel()}>
      <DialogContent className="!max-w-[1400px] w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Data Mapping - {fileName}
            <Badge variant={currentConfidence > 0.8 ? "default" : "secondary"}>
              {isModelTableMode && modelTableName
                ? `Table: ${modelTableName}`
                : fileType.toUpperCase()}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0">
          {/* Status Bar */}
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:!bg-gray-800 rounded-lg mb-4 flex-shrink-0">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                <span className="text-sm">AI Confidence:</span>
                {getConfidenceBadge(currentConfidence)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {headers.length} columns • {sampleData.length} sample rows
              </div>
            </div>
            <div className="flex gap-2">
              {onReanalyze && (
                <Button variant="outline" size="sm" onClick={onReanalyze}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Re-analyze
                </Button>
              )}
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-1" />
                Export Template
              </Button>
            </div>
          </div>

          {/* Wide-format Budget Info */}
          {fileType === "budget" &&
            (() => {
              const monthMappings = mappings.filter(
                (m) => m.standardField === "month"
              );
              const categoryMapped = mappings.some(
                (m) => m.standardField === "category"
              );

              if (monthMappings.length > 1 && categoryMapped) {
                return (
                  <Alert className="mb-4 flex-shrink-0 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                    <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <AlertDescription className="text-blue-800 dark:text-blue-300">
                      <div className="text-sm font-medium mb-1">
                        Wide-format budget detected
                      </div>
                      <div className="text-sm">
                        You've mapped {monthMappings.length} month columns. The
                        system will automatically transform your data from
                        wide-format (months as columns) to long-format (one row
                        per category-month combination).
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              }
              return null;
            })()}

          {/* Missing Dependencies Info */}
          {missingDependencies.length > 0 && (
            <Alert className="mb-4 flex-shrink-0 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {missingDependencies.map((t) => `"${t}"`).join(", ")}{" "}
                  {missingDependencies.length === 1 ? "has" : "have"} no data
                  yet
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  Foreign key references to{" "}
                  {missingDependencies.length === 1
                    ? "this table"
                    : "these tables"}{" "}
                  won&apos;t be linked automatically. You can still upload now
                  and the references will be resolved when the dependent data is
                  available.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Issues Alert */}
          {(issues.length > 0 || validationErrors.length > 0) && (
            <Alert className="mb-4 flex-shrink-0">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  {issues.map((issue, idx) => (
                    <div key={idx} className="text-sm">
                      • {issue}
                    </div>
                  ))}
                  {validationErrors.map((error, idx) => (
                    <div
                      key={idx}
                      className="text-sm text-red-600 dark:text-red-400"
                    >
                      • {error}
                    </div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Main Content Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
              <TabsTrigger value="mappings">Column Mappings</TabsTrigger>
              <TabsTrigger value="preview">Data Preview</TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
            </TabsList>

            <TabsContent
              value="mappings"
              className="flex-1 overflow-y-auto space-y-3 min-h-0"
            >
              {isModelTableMode ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    For each target field, choose which file column to use.
                    Required fields must have a column. Fields marked
                    &quot;Auto-generated&quot; will receive unique IDs
                    automatically if not mapped. You have{" "}
                    <strong>{headers.length}</strong> column(s) available.
                  </p>
                  <div className="grid gap-3">
                    {[...standardFields]
                      .sort((a, b) => {
                        const aPk =
                          "isPrimaryKey" in a && a.isPrimaryKey ? 1 : 0;
                        const bPk =
                          "isPrimaryKey" in b && b.isPrimaryKey ? 1 : 0;
                        if (aPk !== bPk) return bPk - aPk;
                        if (a.required !== b.required)
                          return (b.required ? 1 : 0) - (a.required ? 1 : 0);
                        return 0;
                      })
                      .map((field) => {
                        const selectedCol =
                          fieldToColumn[field.value] ?? EMPTY_COLUMN;
                        const isMapped = selectedCol !== EMPTY_COLUMN;
                        const isAutoGen =
                          "autoGenerable" in field && field.autoGenerable;
                        const showAutoGen = isAutoGen && !isMapped;
                        return (
                          <Card
                            key={field.value}
                            className={`border-l-4 ${
                              showAutoGen
                                ? "border-l-blue-400 bg-blue-50/30 dark:bg-blue-950/10"
                                : field.required && !isMapped
                                  ? "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
                                  : "border-l-green-500 bg-green-50/30 dark:bg-green-950/10"
                            }`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm font-medium">
                                      {field.label}
                                    </span>
                                    {showAutoGen ? (
                                      <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 text-xs">
                                        <Sparkles className="h-3 w-3" />
                                        {"isReference" in field &&
                                        field.isReference
                                          ? `Linked from ${(field as any).referencesTable}`
                                          : "Auto-generated"}
                                      </span>
                                    ) : field.required && !isMapped ? (
                                      <span className="text-red-500 text-xs">
                                        Required
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    {showAutoGen
                                      ? "isReference" in field &&
                                        field.isReference
                                        ? `Will be matched from existing ${(field as any).referencesTable} data`
                                        : "A unique ID will be generated automatically if no column is mapped"
                                      : field.description}
                                  </div>
                                </div>
                                <div className="min-w-[200px] flex-1 max-w-md">
                                  <Select
                                    value={selectedCol || "__none__"}
                                    onValueChange={(v) =>
                                      updateFieldColumn(
                                        field.value,
                                        v === "__none__" ? EMPTY_COLUMN : v
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select column…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">
                                        — None
                                      </SelectItem>
                                      {headers.map((h) => (
                                        <SelectItem key={h} value={h}>
                                          {h}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {isMapped && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 self-center">
                                    Sample:{" "}
                                    {String(
                                      sampleData[0]?.[selectedCol] ?? ""
                                    ).slice(0, 24)}
                                    {String(sampleData[0]?.[selectedCol] ?? "")
                                      .length > 24
                                      ? "…"
                                      : ""}
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                  </div>

                  {/* Value Normalization Section */}
                  {(Object.keys(valueMappings).some(
                    (k) =>
                      Object.keys(valueMappings[k]).length > 0 &&
                      Object.entries(valueMappings[k]).some(
                        ([orig, canonical]) => orig !== canonical
                      )
                  ) ||
                    isNormalizing) && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="h-4 w-4 text-purple-500" />
                        <h3 className="text-sm font-medium">
                          Value Normalization
                        </h3>
                        {isNormalizing && (
                          <Loader2 className="h-3 w-3 animate-spin text-purple-500" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Some fields expect specific values. Your data will be
                        automatically normalized to match. You can adjust below.
                      </p>
                      {Object.entries(valueMappings).map(
                        ([fieldName, mapping]) => {
                          const field = standardFields.find(
                            (f) =>
                              f.value === fieldName &&
                              "allowedValues" in f &&
                              f.allowedValues
                          );
                          if (!field || !("allowedValues" in field))
                            return null;
                          const changedEntries = Object.entries(mapping).filter(
                            ([orig, canonical]) => orig !== canonical
                          );
                          if (changedEntries.length === 0) return null;
                          return (
                            <Card
                              key={fieldName}
                              className="mb-3 border-purple-200 dark:border-purple-800 bg-purple-50/20 dark:bg-purple-950/10"
                            >
                              <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="font-mono text-sm font-medium">
                                    {field.label}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-xs text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700"
                                  >
                                    {changedEntries.length} value
                                    {changedEntries.length !== 1
                                      ? "s"
                                      : ""}{" "}
                                    normalized
                                  </Badge>
                                </div>
                                <div className="space-y-2">
                                  {changedEntries.map(
                                    ([original, canonical]) => (
                                      <div
                                        key={original}
                                        className="flex items-center gap-3"
                                      >
                                        <span className="font-mono text-sm text-gray-600 dark:text-gray-400 w-36 truncate flex-shrink-0">
                                          {original}
                                        </span>
                                        <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                        <Select
                                          value={canonical}
                                          onValueChange={(v) =>
                                            setValueMappings((prev) => ({
                                              ...prev,
                                              [fieldName]: {
                                                ...prev[fieldName],
                                                [original]: v,
                                              },
                                            }))
                                          }
                                        >
                                          <SelectTrigger className="w-36 h-8 text-sm">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {(field as any).allowedValues?.map(
                                              (av: string) => (
                                                <SelectItem key={av} value={av}>
                                                  {av}
                                                </SelectItem>
                                              )
                                            )}
                                          </SelectContent>
                                        </Select>
                                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                                      </div>
                                    )
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          );
                        }
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-3">
                  {mappings.map((mapping, index) => (
                    <Card
                      key={index}
                      className={`${getConfidenceColor(mapping.confidence)} border-l-4`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 flex-1">
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-sm font-medium truncate">
                                {mapping.originalColumn}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                Data Type: {mapping.dataType}
                              </div>
                            </div>

                            <ArrowRight className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />

                            <div className="min-w-0 flex-1">
                              <Select
                                value={mapping.standardField}
                                onValueChange={(value) =>
                                  updateMapping(mapping.originalColumn, value)
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {standardFields.map((f) => (
                                    <SelectItem key={f.value} value={f.value}>
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={
                                            f.required ? "font-medium" : ""
                                          }
                                        >
                                          {f.label}
                                        </span>
                                        {f.required && (
                                          <span className="text-red-500">
                                            *
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {f.description}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {getConfidenceBadge(mapping.confidence)}
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Sample values:
                          </div>
                          <div className="text-sm font-mono bg-white dark:!bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 max-h-16 overflow-y-auto">
                            {sampleData.slice(0, 3).map((row, idx) => (
                              <div key={idx} className="truncate">
                                {row[mapping.originalColumn] || "(empty)"}
                              </div>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent
              value="preview"
              className="flex-1 flex flex-col min-h-0 overflow-hidden"
            >
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="mb-4 flex-shrink-0">
                  <h3 className="font-medium">Mapped Data Preview</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Preview of how your data will look after applying the
                    mappings
                  </p>
                </div>

                <div className="flex-1 min-h-0 overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:!bg-gray-800 sticky top-0">
                      <tr>
                        <th className="p-2 text-left font-medium w-12">#</th>
                        {effectiveMappings
                          .filter((m) => m.standardField !== "unmapped")
                          .map((mapping) => {
                            const key =
                              fileType === "budget" &&
                              mapping.standardField === "month"
                                ? mapping.originalColumn
                                : mapping.standardField;
                            return (
                              <th
                                key={key}
                                className="p-2 text-left font-medium min-w-32"
                              >
                                {mapping.standardField}
                                <div className="text-xs font-normal text-gray-500 dark:text-gray-400">
                                  ← {mapping.originalColumn}
                                </div>
                              </th>
                            );
                          })}
                      </tr>
                    </thead>
                    <tbody>
                      {previewMappedData().map((row, idx) => (
                        <tr
                          key={idx}
                          className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                        >
                          <td className="p-2 text-gray-500 dark:text-gray-400">
                            {row._index}
                          </td>
                          {effectiveMappings
                            .filter((m) => m.standardField !== "unmapped")
                            .map((mapping) => {
                              const key =
                                fileType === "budget" &&
                                mapping.standardField === "month"
                                  ? mapping.originalColumn
                                  : mapping.standardField;
                              return (
                                <td key={key} className="p-2">
                                  <div
                                    className="truncate max-w-48"
                                    title={String(row[key] || "")}
                                  >
                                    {row[key] || "(empty)"}
                                  </div>
                                </td>
                              );
                            })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                  Preview showing {previewMappedData().length} of{" "}
                  {sampleData.length} sample rows
                </div>
              </div>
            </TabsContent>

            <TabsContent value="validation" className="flex-1 overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Mapping Summary</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">
                        Total Columns:
                      </span>
                      <span className="ml-2 font-medium">{headers.length}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">
                        {isModelTableMode
                          ? "Mapped fields:"
                          : "Mapped Columns:"}
                      </span>
                      <span className="ml-2 font-medium">
                        {
                          effectiveMappings.filter(
                            (m) => m.standardField !== "unmapped"
                          ).length
                        }
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">
                        Required Fields:
                      </span>
                      <span className="ml-2 font-medium">
                        {standardFields.filter((f) => f.required).length}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">
                        Validation Status:
                      </span>
                      <span
                        className={`ml-2 font-medium ${isValid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                      >
                        {isValid ? "Valid" : "Invalid"}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Required Fields Status</h3>
                  <div className="space-y-2">
                    {standardFields
                      .filter((f) => f.required)
                      .map((field) => {
                        const isMapped = isModelTableMode
                          ? Boolean((fieldToColumn[field.value] ?? "").trim())
                          : effectiveMappings.some(
                              (m) => m.standardField === field.value
                            );
                        const isAutoGen =
                          "autoGenerable" in field && field.autoGenerable;
                        return (
                          <div
                            key={field.value}
                            className="flex items-center gap-2"
                          >
                            {isMapped ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : isAutoGen ? (
                              <Sparkles className="h-4 w-4 text-blue-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-red-500" />
                            )}
                            <span
                              className={
                                isMapped
                                  ? "text-green-700 dark:text-green-400"
                                  : isAutoGen
                                    ? "text-blue-700 dark:text-blue-400"
                                    : "text-red-700 dark:text-red-400"
                              }
                            >
                              {field.label}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400 text-sm">
                              -{" "}
                              {isAutoGen && !isMapped
                                ? "isReference" in field && field.isReference
                                  ? `Will be matched from ${(field as any).referencesTable}`
                                  : "Will be auto-generated"
                                : field.description}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {validationErrors.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2 text-red-600 dark:text-red-400">
                      Validation Errors
                    </h3>
                    <div className="space-y-1">
                      {validationErrors.map((error, idx) => (
                        <div
                          key={idx}
                          className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 mt-4">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>

            <div className="flex gap-2">
              <Button variant="outline">
                <Settings className="h-4 w-4 mr-1" />
                Save Template
              </Button>
              <Button
                onClick={() =>
                  onConfirm(
                    effectiveMappings,
                    Object.keys(valueMappings).length > 0
                      ? valueMappings
                      : undefined
                  )
                }
                disabled={!isValid || isNormalizing}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Apply Mapping (
                {
                  effectiveMappings.filter(
                    (m) => m.standardField !== "unmapped"
                  ).length
                }{" "}
                fields)
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
