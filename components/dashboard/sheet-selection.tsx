"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  CheckCircle2,
  X,
  Database,
  ArrowRight,
  Brain,
  AlertTriangle,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ColumnMapping } from "@/types/schema";
import { ModelTableField } from "./data-mapping-confirmation";

interface SheetInfo {
  name: string;
  headers: string[];
  sampleData: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  totalRows: number;
}

interface SheetSelectionProps {
  fileName: string;
  sheets: SheetInfo[];
  onConfirm: (
    sheetMappings: Array<{
      sheetName: string;
      datasetType: "bank" | "crm" | "budget" | string;
      columnMappings: ColumnMapping[];
      valueMappings?: Record<string, Record<string, string>>;
    }>
  ) => void;
  onCancel: () => void;
  /** When provided, the UI is optimized for mapping sheets to this specific model table */
  targetModelTable?: {
    name: string;
    fields: ModelTableField[];
  };
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

function calculateMatchConfidence(header: string, keyword: string): number {
  if (header === keyword) return 1.0;
  if (header.includes(keyword) || keyword.includes(header)) return 0.9;
  const headerWords = header.split(/\s+/);
  const keywordWords = keyword.split(/\s+/);
  let wordMatches = 0;
  keywordWords.forEach((kw) => {
    if (
      headerWords.some((hw) => hw === kw || hw.includes(kw) || kw.includes(hw))
    ) {
      wordMatches++;
    }
  });
  if (wordMatches > 0) {
    return (wordMatches / keywordWords.length) * 0.8;
  }
  return 0;
}

function generateAutoMappings(
  headers: string[],
  sampleData: any[],
  datasetType: "bank" | "crm" | "budget"
): { suggestedMappings: ColumnMapping[]; confidence: number } {
  const mappings: ColumnMapping[] = [];
  let totalConfidence = 0;
  let mappedCount = 0;

  const fieldKeywords: Record<string, Record<string, string[]>> = {
    transactions: {
      date: [
        "date",
        "datum",
        "transaction date",
        "booking date",
        "value date",
        "time",
      ],
      amount: ["amount", "value", "sum", "total", "betrag", "wert", "umsatz"],
      description: [
        "description",
        "text",
        "memo",
        "details",
        "narrative",
        "purpose",
        "verwendungszweck",
      ],
      category: [
        "category",
        "type",
        "classification",
        "account",
        "kategorie",
        "kursart",
      ],
      name: ["name", "vendor", "payee", "merchant", "counterparty", "lehrer"],
      type: [
        "type",
        "flow",
        "direction",
        "inflow",
        "outflow",
        "income",
        "expense",
      ],
      reference: ["reference", "ref", "transaction id", "id", "number"],
    },
    deals: {
      dealName: [
        "deal name",
        "name",
        "opportunity name",
        "deal",
        "title",
        "opportunity",
      ],
      clientName: [
        "client name",
        "customer",
        "account name",
        "company",
        "client",
        "account",
      ],
      amount: ["amount", "value", "deal value", "revenue", "price", "total"],
      phase: ["deal phase", "stage", "pipeline stage", "status", "phase"],
      product: [
        "product",
        "service",
        "offering",
        "category",
        "type",
        "solution",
      ],
      firstAppointment: [
        "first appointment",
        "meeting date",
        "initial contact",
        "appointment",
        "first meeting",
      ],
      closingDate: [
        "closing date",
        "close date",
        "expected close",
        "deal close",
        "close",
        "target date",
      ],
    },
    budget: {
      category: ["category", "cost center", "department", "division", "unit"],
      month: [
        "month",
        "period",
        "date",
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
        "january",
        "february",
        "march",
        "april",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
      ],
      value: [
        "value",
        "amount",
        "budgeted",
        "planned",
        "budget",
        "forecast",
        "actual",
        "spent",
      ],
    },
  };

  const keywords: Record<string, string[]> | undefined =
    fieldKeywords[datasetType];

  headers.forEach((header) => {
    const normalizedHeader = header.toLowerCase().trim();
    let bestMatch: { field: string; confidence: number } | null = null;

    if (keywords && typeof keywords === "object") {
      Object.entries(keywords).forEach(([field, fieldKeywordList]) => {
        if (Array.isArray(fieldKeywordList)) {
          fieldKeywordList.forEach((keyword: string) => {
            const confidence = calculateMatchConfidence(
              normalizedHeader,
              keyword
            );
            if (
              confidence > 0.6 &&
              (!bestMatch || confidence > bestMatch.confidence)
            ) {
              bestMatch = { field, confidence };
            }
          });
        }
      });
    }

    const sampleValue = sampleData[0]?.[header];
    let dataType: "string" | "number" | "date" | "currency" = "string";

    if (sampleValue !== null && sampleValue !== undefined) {
      if (typeof sampleValue === "number") {
        dataType = "number";
      } else if (typeof sampleValue === "string") {
        if (
          /^\d{4}-\d{2}-\d{2}/.test(sampleValue) ||
          /^\d{2}\/\d{2}\/\d{4}/.test(sampleValue) ||
          /^\d{2}\.\d{2}\.\d{2}/.test(sampleValue)
        ) {
          dataType = "date";
        } else if (
          /[€$£¥]/.test(sampleValue) ||
          /^\d+[.,]\d{2}$/.test(sampleValue)
        ) {
          dataType = "currency";
        }
      }
    }

    if (bestMatch !== null && bestMatch !== undefined) {
      const match = bestMatch as { field: string; confidence: number };
      mappings.push({
        originalColumn: header,
        standardField: match.field,
        confidence: match.confidence,
        dataType,
        transformation: "none" as const,
      });
      totalConfidence += match.confidence;
      mappedCount++;
    } else {
      mappings.push({
        originalColumn: header,
        standardField: "unmapped",
        confidence: 0,
        dataType,
        transformation: "none" as const,
      });
    }
  });

  const avgConfidence = mappedCount > 0 ? totalConfidence / mappedCount : 0;
  return { suggestedMappings: mappings, confidence: avgConfidence };
}

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

export default function SheetSelection({
  fileName,
  sheets,
  onConfirm,
  onCancel,
  targetModelTable,
  missingDependencies = [],
}: SheetSelectionProps) {
  const [sheetMappings, setSheetMappings] = useState<
    Record<string, "bank" | "crm" | "budget" | string | null>
  >(() => {
    const initial: Record<string, "bank" | "crm" | "budget" | string | null> =
      {};
    sheets.forEach((sheet) => {
      // If targetModelTable is provided, default first sheet to it, others to null
      if (targetModelTable) {
        initial[sheet.name] =
          sheets.indexOf(sheet) === 0 ? targetModelTable.name : null;
        return;
      }

      const name = sheet.name.toLowerCase();
      if (
        name.includes("transaction") ||
        name.includes("bank") ||
        name.includes("account")
      ) {
        initial[sheet.name] = "bank";
      } else if (
        name.includes("crm") ||
        name.includes("deal") ||
        name.includes("sales")
      ) {
        initial[sheet.name] = "crm";
      } else if (name.includes("budget")) {
        initial[sheet.name] = "budget";
      } else {
        initial[sheet.name] = null;
      }
    });
    return initial;
  });

  // Store column mappings for each sheet
  const [columnMappings, setColumnMappings] = useState<
    Record<string, ColumnMapping[]>
  >({});

  const [selectedSheet, setSelectedSheet] = useState<string | null>(
    sheets.length > 0 ? sheets[0].name : null
  );

  const [activeTab, setActiveTab] = useState<
    "mappings" | "preview" | "validation"
  >("mappings");

  const currentSheet = sheets.find((s) => s.name === selectedSheet);
  const currentSheetType = currentSheet
    ? sheetMappings[currentSheet.name]
    : null;

  // Generate auto-mappings when sheet type is selected
  const autoGeneratedMappings = React.useMemo(() => {
    if (
      currentSheet &&
      currentSheetType &&
      !columnMappings[currentSheet.name]
    ) {
      // Use model table mapping logic if in targetModelTable mode
      if (targetModelTable && currentSheetType === targetModelTable.name) {
        const mappings: ColumnMapping[] = currentSheet.headers.map((header) => {
          const normalizedHeader = header.toLowerCase().trim();
          const matchingField = targetModelTable.fields.find((field) => {
            const normalizedFieldName = field.name.toLowerCase().trim();
            return (
              normalizedHeader === normalizedFieldName ||
              normalizedHeader.includes(normalizedFieldName) ||
              normalizedFieldName.includes(normalizedHeader)
            );
          });

          if (matchingField) {
            return {
              originalColumn: header,
              standardField: matchingField.name,
              confidence: 0.9,
              dataType: "string",
              transformation: "none",
            };
          }
          return {
            originalColumn: header,
            standardField: "unmapped",
            confidence: 0,
            dataType: "string",
            transformation: "none",
          };
        });
        return { [currentSheet.name]: mappings };
      }

      const { suggestedMappings } = generateAutoMappings(
        currentSheet.headers,
        currentSheet.sampleData,
        currentSheetType as "bank" | "crm" | "budget"
      );
      return { [currentSheet.name]: suggestedMappings };
    }
    return null;
  }, [currentSheet, currentSheetType, columnMappings, targetModelTable]);

  useEffect(() => {
    if (autoGeneratedMappings) {
      setColumnMappings((prev) => ({
        ...prev,
        ...autoGeneratedMappings,
      }));
    }
  }, [autoGeneratedMappings]);

  const updateSheetMapping = (
    sheetName: string,
    datasetType: "bank" | "crm" | "budget" | string | "skip"
  ) => {
    setSheetMappings((prev) => ({
      ...prev,
      [sheetName]: datasetType === "skip" ? null : datasetType,
    }));

    // Clear column mappings if skipping
    if (datasetType === "skip") {
      setColumnMappings((prev) => {
        const newMappings = { ...prev };
        delete newMappings[sheetName];
        return newMappings;
      });
    } else {
      // Generate new mappings for the selected type
      const sheet = sheets.find((s) => s.name === sheetName);
      if (sheet) {
        // Use model table mapping logic if this is the target table
        if (targetModelTable && datasetType === targetModelTable.name) {
          const mappings: ColumnMapping[] = sheet.headers.map((header) => {
            const normalizedHeader = header.toLowerCase().trim();
            const matchingField = targetModelTable.fields.find((field) => {
              const normalizedFieldName = field.name.toLowerCase().trim();
              return (
                normalizedHeader === normalizedFieldName ||
                normalizedHeader.includes(normalizedFieldName) ||
                normalizedFieldName.includes(normalizedHeader)
              );
            });

            if (matchingField) {
              return {
                originalColumn: header,
                standardField: matchingField.name,
                confidence: 0.9,
                dataType: "string",
                transformation: "none",
              };
            }
            return {
              originalColumn: header,
              standardField: "unmapped",
              confidence: 0,
              dataType: "string",
              transformation: "none",
            };
          });
          setColumnMappings((prev) => ({
            ...prev,
            [sheetName]: mappings,
          }));
        } else {
          const { suggestedMappings } = generateAutoMappings(
            sheet.headers,
            sheet.sampleData,
            datasetType as "bank" | "crm" | "budget"
          );
          setColumnMappings((prev) => ({
            ...prev,
            [sheetName]: suggestedMappings,
          }));
        }
      }
    }
  };

  const updateColumnMapping = (
    sheetName: string,
    originalColumn: string,
    standardField: string
  ) => {
    setColumnMappings((prev) => ({
      ...prev,
      [sheetName]: (prev[sheetName] || []).map((mapping) =>
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
      ),
    }));
  };

  const updateFieldMapping = (
    sheetName: string,
    standardField: string,
    originalColumn: string | null
  ) => {
    setColumnMappings((prev) => {
      const currentMappings = prev[sheetName] || [];

      // 1. If another column was mapped to this field, unmap it
      let newMappings = currentMappings.map((m) =>
        m.standardField === standardField
          ? { ...m, standardField: "unmapped", confidence: 0 }
          : m
      );

      // 2. Map the new column to this field
      if (originalColumn && originalColumn !== "__none__") {
        newMappings = newMappings.map((m) =>
          m.originalColumn === originalColumn
            ? { ...m, standardField, confidence: 1.0 }
            : m
        );
      }

      return {
        ...prev,
        [sheetName]: newMappings,
      };
    });
  };

  const currentMappings = React.useMemo(() => {
    return currentSheet && currentSheetType
      ? columnMappings[currentSheet.name] || []
      : [];
  }, [currentSheet, currentSheetType, columnMappings]);

  const fileType = React.useMemo(() => {
    if (targetModelTable && currentSheetType === targetModelTable.name) {
      return "transactions"; // Fallback for some legacy UI logic
    }
    return currentSheetType === "bank"
      ? "transactions"
      : currentSheetType === "crm"
        ? "deals"
        : "budget";
  }, [currentSheetType, targetModelTable]);

  const standardFields = React.useMemo(() => {
    if (targetModelTable && currentSheetType === targetModelTable.name) {
      return buildStandardFieldsFromTable(targetModelTable.fields);
    }
    return (
      STANDARD_FIELDS[fileType as "transactions" | "deals" | "budget"] || []
    );
  }, [fileType, targetModelTable, currentSheetType]);

  // Validation
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Value normalization state
  const [valueMappings, setValueMappings] = useState<
    Record<string, Record<string, string>>
  >({});
  const [isNormalizing, setIsNormalizing] = useState(false);
  const lastNormKey = useRef("");
  const normVersion = useRef(0);

  const fieldsWithAllowedValues = useMemo(() => {
    if (!targetModelTable || currentSheetType !== targetModelTable.name)
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
        currentMappings.some(
          (m) => m.standardField === f.value && m.standardField !== "unmapped"
        )
    );
  }, [standardFields, currentMappings, targetModelTable, currentSheetType]);

  const sheetDataForNormalization =
    currentSheet?.rows && currentSheet.rows.length > 0
      ? currentSheet.rows
      : (currentSheet?.sampleData ?? []);

  const uniqueValuesPerField = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (!currentSheet) return out;
    for (const field of fieldsWithAllowedValues) {
      const mapping = currentMappings.find(
        (m) => m.standardField === field.value
      );
      if (!mapping) continue;
      const vals = [
        ...new Set(
          sheetDataForNormalization
            .map((row) => row[mapping.originalColumn])
            .filter(
              (v) => v !== undefined && v !== null && String(v).trim() !== ""
            )
            .map((v) => String(v))
        ),
      ];
      out[field.value] = vals;
    }
    return out;
  }, [fieldsWithAllowedValues, currentMappings, sheetDataForNormalization]);

  useEffect(() => {
    const key = fieldsWithAllowedValues
      .map((f) => {
        const m = currentMappings.find((cm) => cm.standardField === f.value);
        return `${f.value}:${m?.originalColumn || ""}`;
      })
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
              tableName: targetModelTable?.name || "",
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
        console.error("[sheet-selection] Normalization error:", err);
      } finally {
        if (normVersion.current === version) setIsNormalizing(false);
      }
    };
    normalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fieldsWithAllowedValues,
    uniqueValuesPerField,
    currentMappings,
    targetModelTable,
  ]);

  const validationErrorsComputed = React.useMemo(() => {
    if (!currentSheet || !currentSheetType || currentMappings.length === 0) {
      return [];
    }

    const errors: string[] = [];
    const mappedFields = currentMappings
      .map((m) => m.standardField)
      .filter((f) => f !== "unmapped");
    const requiredFields = standardFields.filter(
      (f) => f.required && !("autoGenerable" in f && f.autoGenerable)
    );

    for (const required of requiredFields) {
      if (!mappedFields.includes(required.value)) {
        errors.push(`Required field "${required.label}" is not mapped`);
      }
    }

    const duplicates = mappedFields.filter(
      (field, index, arr) =>
        arr.indexOf(field) !== index &&
        field !== "unmapped" &&
        !(fileType === "budget" && field === "month")
    );
    if (duplicates.length > 0) {
      errors.push(`Duplicate mappings found: ${duplicates.join(", ")}`);
    }

    return errors;
  }, [
    currentSheet,
    currentSheetType,
    currentMappings,
    standardFields,
    fileType,
  ]);

  useEffect(() => {
    setValidationErrors(validationErrorsComputed);
  }, [validationErrorsComputed]);

  const isValid = validationErrors.length === 0;

  const getMappingStatusIcon = (standardField: string) => {
    if (standardField === "unmapped") {
      return <X className="h-5 w-5 text-red-600 dark:text-red-400" />;
    }
    return (
      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
    );
  };

  const getConfidenceColor = (mapping: ColumnMapping) => {
    if (mapping.standardField === "unmapped") {
      return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-l-red-500";
    }
    if (mapping.confidence >= 0.8) {
      return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-l-green-500";
    }
    if (mapping.confidence >= 0.6) {
      return "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 border-l-yellow-500";
    }
    return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-l-red-500";
  };

  const previewMappedData = () => {
    if (!currentSheet) return [];
    return currentSheet.sampleData.slice(0, 15).map((row, index) => {
      const mapped: any = { _index: index + 1 };
      currentMappings.forEach((mapping) => {
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

  const currentConfidence = React.useMemo(() => {
    if (currentMappings.length === 0) return 0;

    if (targetModelTable && currentSheetType === targetModelTable.name) {
      const requiredFields = standardFields.filter(
        (f: { required: boolean; autoGenerable?: boolean }) =>
          f.required && !f.autoGenerable
      );
      if (requiredFields.length === 0) return 1.0;

      const mappedRequired = requiredFields.filter((f: { value: string }) =>
        currentMappings.some(
          (m) => m.standardField === f.value && f.value !== "unmapped"
        )
      );
      return mappedRequired.length / requiredFields.length;
    }

    return (
      currentMappings.reduce((sum, m) => {
        if (m.standardField === "unmapped") return sum;
        return sum + m.confidence;
      }, 0) / currentMappings.length
    );
  }, [currentMappings, targetModelTable, currentSheetType, standardFields]);

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

  const handleConfirm = () => {
    const mappings = Object.entries(sheetMappings)
      .filter(([, type]) => type !== null)
      .map(([sheetName, datasetType]) => ({
        sheetName,
        datasetType: datasetType as "bank" | "crm" | "budget" | string,
        columnMappings: columnMappings[sheetName] || [],
        valueMappings:
          Object.keys(valueMappings).length > 0 ? valueMappings : undefined,
      }));

    if (mappings.length === 0) {
      alert("Please select at least one sheet to process.");
      return;
    }

    // Validate all sheets have valid mappings
    for (const mapping of mappings) {
      const sheet = sheets.find((s) => s.name === mapping.sheetName);
      if (!sheet) continue;

      const isModelTable =
        targetModelTable && mapping.datasetType === targetModelTable.name;

      const mappingStandardFields = isModelTable
        ? buildStandardFieldsFromTable(targetModelTable.fields)
        : STANDARD_FIELDS[
            (mapping.datasetType === "bank"
              ? "transactions"
              : mapping.datasetType === "crm"
                ? "deals"
                : "budget") as "transactions" | "deals" | "budget"
          ] || [];

      const requiredFields = mappingStandardFields.filter(
        (f) => f.required && !("autoGenerable" in f && f.autoGenerable)
      );
      const mappedFields = mapping.columnMappings
        .map((m) => m.standardField)
        .filter((f) => f !== "unmapped");

      for (const required of requiredFields) {
        if (!mappedFields.includes(required.value)) {
          alert(
            `Sheet "${mapping.sheetName}" is missing required field "${required.label}". Please complete the mapping.`
          );
          setSelectedSheet(mapping.sheetName);
          setActiveTab("mappings");
          return;
        }
      }
    }

    onConfirm(mappings);
  };

  const selectedCount = Object.values(sheetMappings).filter(
    (type) => type !== null
  ).length;

  // Check if all selected sheets have valid mappings (all required fields mapped)
  const allMappingsValid = React.useMemo(() => {
    if (selectedCount === 0) return false;

    const selectedSheetNames = Object.entries(sheetMappings)
      .filter(([, type]) => type !== null)
      .map(([sheetName]) => sheetName);

    for (const sheetName of selectedSheetNames) {
      const datasetType = sheetMappings[sheetName];
      if (!datasetType) continue;

      const isModelTable =
        targetModelTable && datasetType === targetModelTable.name;

      const standardFields = isModelTable
        ? buildStandardFieldsFromTable(targetModelTable.fields)
        : STANDARD_FIELDS[
            (datasetType === "bank"
              ? "transactions"
              : datasetType === "crm"
                ? "deals"
                : "budget") as "transactions" | "deals" | "budget"
          ] || [];

      const requiredFields = standardFields.filter(
        (f: { required: boolean; autoGenerable?: boolean }) =>
          f.required && !f.autoGenerable
      );
      const mappings = columnMappings[sheetName] || [];
      const mappedFields = mappings
        .map((m) => m.standardField)
        .filter((f) => f !== "unmapped");

      for (const required of requiredFields) {
        if (!mappedFields.includes(required.value)) {
          return false;
        }
      }
    }

    return true;
  }, [sheetMappings, columnMappings, selectedCount, targetModelTable]);

  if (!sheets || sheets.length === 0) {
    return null;
  }

  return (
    <Dialog open={true} onOpenChange={() => onCancel()} modal={true}>
      <DialogContent
        className="!max-w-[95vw] sm:!max-w-7xl w-[95vw] !h-[90vh] !flex !flex-col !p-0 gap-0 !bg-white dark:!bg-gray-950"
        style={{ display: "flex", zIndex: 9999 }}
      >
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Sheet Selection & Mapping - {fileName}
            <Badge variant="secondary">
              {sheets.length} sheet{sheets.length !== 1 ? "s" : ""}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div
          className="flex flex-1 overflow-hidden min-h-0"
          style={{ minHeight: "400px" }}
        >
          {/* Left Sidebar - Sheet List */}
          <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-900/50">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                Select a sheet and assign its target table:
              </p>
            </div>
            <div className="p-2 space-y-2 overflow-y-auto flex-1 overflow-x-visible">
              {sheets.map((sheet) => {
                const selectedType = sheetMappings[sheet.name];
                const isSelected = selectedType !== null;
                const isActive = selectedSheet === sheet.name;
                const hasMappings = !!columnMappings[sheet.name];
                const mappingValid =
                  hasMappings &&
                  (() => {
                    const isModelTable =
                      targetModelTable &&
                      selectedType === targetModelTable.name;
                    const standardFields = isModelTable
                      ? buildStandardFieldsFromTable(targetModelTable.fields)
                      : STANDARD_FIELDS[
                          (selectedType === "bank"
                            ? "transactions"
                            : selectedType === "crm"
                              ? "deals"
                              : "budget") as "transactions" | "deals" | "budget"
                        ] || [];

                    const requiredFields = standardFields.filter(
                      (f: { required: boolean; autoGenerable?: boolean }) =>
                        f.required && !f.autoGenerable
                    );
                    const mappedFields = (columnMappings[sheet.name] || [])
                      .map((m) => m.standardField)
                      .filter((f) => f !== "unmapped");
                    return requiredFields.every((rf: { value: string }) =>
                      mappedFields.includes(rf.value)
                    );
                  })();

                return (
                  <Card
                    key={sheet.name}
                    className={`cursor-pointer transition-all ${
                      isActive
                        ? "ring-2 ring-blue-500 dark:ring-blue-400 shadow-md"
                        : "hover:shadow-sm"
                    } ${
                      isSelected
                        ? targetModelTable &&
                          selectedType === targetModelTable.name
                          ? "border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
                          : selectedType === "bank"
                            ? "border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
                            : selectedType === "crm"
                              ? "border-l-4 border-l-purple-500 bg-purple-50/50 dark:bg-purple-950/20"
                              : "border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-950/20"
                        : ""
                    }`}
                    onClick={() => setSelectedSheet(sheet.name)}
                  >
                    <CardContent className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                              <span className="font-medium text-sm truncate">
                                {sheet.name}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 ml-6">
                              {sheet.totalRows.toLocaleString()} rows •{" "}
                              {sheet.headers.length} columns
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {isSelected &&
                              hasMappings &&
                              (mappingValid ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                              ))}
                          </div>
                        </div>

                        <div onClick={(e) => e.stopPropagation()}>
                          {targetModelTable ? (
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`include-${sheet.name}`}
                                checked={selectedType === targetModelTable.name}
                                onCheckedChange={(checked) => {
                                  updateSheetMapping(
                                    sheet.name,
                                    checked ? targetModelTable.name : "skip"
                                  );
                                }}
                              />
                              <Label
                                htmlFor={`include-${sheet.name}`}
                                className="text-xs cursor-pointer"
                              >
                                Include in {targetModelTable.name}
                              </Label>
                            </div>
                          ) : (
                            <Select
                              value={selectedType || "skip"}
                              onValueChange={(value) => {
                                updateSheetMapping(
                                  sheet.name,
                                  value as "bank" | "crm" | "budget" | "skip"
                                );
                              }}
                            >
                              <SelectTrigger className="w-full h-8 text-xs">
                                <SelectValue placeholder="Select table..." />
                              </SelectTrigger>
                              <SelectContent
                                className="!z-[10000]"
                                position="popper"
                              >
                                <SelectItem value="bank">
                                  <div className="flex items-center gap-2">
                                    <Database className="h-3 w-3" />
                                    Transactions
                                  </div>
                                </SelectItem>
                                <SelectItem value="crm">
                                  <div className="flex items-center gap-2">
                                    <Database className="h-3 w-3" />
                                    CRM Deals
                                  </div>
                                </SelectItem>
                                <SelectItem value="budget">
                                  <div className="flex items-center gap-2">
                                    <Database className="h-3 w-3" />
                                    Budget
                                  </div>
                                </SelectItem>
                                <SelectItem value="skip">
                                  <div className="flex items-center gap-2">
                                    <X className="h-3 w-3" />
                                    Skip
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Right Side - Column Mapping UI */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white dark:bg-gray-950">
            {currentSheet && currentSheetType ? (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Header */}
                <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        {currentSheet.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {currentSheet.totalRows.toLocaleString()} rows •{" "}
                        {currentSheet.headers.length} columns
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        targetModelTable &&
                        currentSheetType === targetModelTable.name
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                          : currentSheetType === "bank"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            : currentSheetType === "crm"
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                              : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      }
                    >
                      {targetModelTable &&
                      currentSheetType === targetModelTable.name
                        ? targetModelTable.name
                        : currentSheetType === "bank"
                          ? "Transactions"
                          : currentSheetType === "crm"
                            ? "CRM Deals"
                            : "Budget"}
                    </Badge>
                  </div>

                  {/* Status Bar */}
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:!bg-gray-800 rounded-lg mt-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4" />
                        <span className="text-sm">AI Confidence:</span>
                        {getConfidenceBadge(currentConfidence)}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {currentSheet.headers.length} columns •{" "}
                        {currentSheet.sampleData.length} sample rows
                      </div>
                    </div>
                  </div>

                  {/* Wide-format Budget Info */}
                  {fileType === "budget" &&
                    (() => {
                      const monthMappings = currentMappings.filter(
                        (m) => m.standardField === "month"
                      );
                      const categoryMapped = currentMappings.some(
                        (m) => m.standardField === "category"
                      );

                      if (monthMappings.length > 1 && categoryMapped) {
                        return (
                          <Alert className="mt-4 mx-4 flex-shrink-0 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                            <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            <AlertDescription className="text-blue-800 dark:text-blue-300">
                              <div className="text-sm font-medium mb-1">
                                Wide-format budget detected
                              </div>
                              <div className="text-sm">
                                You&apos;ve mapped {monthMappings.length} month
                                columns. The system will automatically transform
                                your data from wide-format (months as columns)
                                to long-format (one row per category-month
                                combination).
                              </div>
                            </AlertDescription>
                          </Alert>
                        );
                      }
                      return null;
                    })()}

                  {/* Missing Dependencies Info */}
                  {missingDependencies.length > 0 && (
                    <Alert className="mt-4 mx-4 flex-shrink-0 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertDescription>
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                          {missingDependencies.map((t) => `"${t}"`).join(", ")}{" "}
                          {missingDependencies.length === 1 ? "has" : "have"} no
                          data yet
                        </p>
                        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                          Foreign key references to{" "}
                          {missingDependencies.length === 1
                            ? "this table"
                            : "these tables"}{" "}
                          won&apos;t be linked automatically. You can still
                          upload now and the references will be resolved when
                          the dependent data is available.
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Validation Errors */}
                  {validationErrors.length > 0 && (
                    <Alert className="mt-4 mx-4 flex-shrink-0">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="space-y-1">
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
                </div>

                {/* Tabs */}
                <Tabs
                  value={activeTab}
                  onValueChange={(value) =>
                    setActiveTab(value as "mappings" | "preview" | "validation")
                  }
                  className="flex-1 flex flex-col min-h-0"
                >
                  <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mx-4 mt-4">
                    <TabsTrigger value="mappings">Column Mappings</TabsTrigger>
                    <TabsTrigger value="preview">Data Preview</TabsTrigger>
                    <TabsTrigger value="validation">Validation</TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="mappings"
                    className="flex-1 overflow-y-auto space-y-3 min-h-0 px-4 py-4"
                  >
                    {targetModelTable &&
                    currentSheetType === targetModelTable.name ? (
                      <div className="space-y-4">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          For each target field, choose which file column to
                          use. Required fields must have a column. Fields marked
                          &quot;Auto-generated&quot; will receive unique IDs
                          automatically if not mapped. You have{" "}
                          <strong>{currentSheet.headers.length}</strong>{" "}
                          column(s) available.
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
                                return (
                                  (b.required ? 1 : 0) - (a.required ? 1 : 0)
                                );
                              return 0;
                            })
                            .map((field) => {
                              const mapping = currentMappings.find(
                                (m) => m.standardField === field.value
                              );
                              const selectedCol = mapping?.originalColumn || "";
                              const isMapped = !!mapping;
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
                                            updateFieldMapping(
                                              currentSheet.name,
                                              field.value,
                                              v
                                            )
                                          }
                                        >
                                          <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Select column…" />
                                          </SelectTrigger>
                                          <SelectContent className="!z-[10000]">
                                            <SelectItem value="__none__">
                                              — None
                                            </SelectItem>
                                            {currentSheet.headers.map((h) => (
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
                                            currentSheet.sampleData[0]?.[
                                              selectedCol
                                            ] ?? ""
                                          ).slice(0, 24)}
                                          {String(
                                            currentSheet.sampleData[0]?.[
                                              selectedCol
                                            ] ?? ""
                                          ).length > 24
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
                              Some fields expect specific values. Your data will
                              be automatically normalized to match. You can
                              adjust below.
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
                                const changedEntries = Object.entries(
                                  mapping
                                ).filter(
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
                                                <SelectContent className="!z-[10000]">
                                                  {(
                                                    field as any
                                                  ).allowedValues?.map(
                                                    (av: string) => (
                                                      <SelectItem
                                                        key={av}
                                                        value={av}
                                                      >
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
                        {currentMappings.map((mapping, index) => (
                          <Card
                            key={index}
                            className={`${getConfidenceColor(mapping)} border-l-4`}
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
                                        updateColumnMapping(
                                          currentSheet.name,
                                          mapping.originalColumn,
                                          value
                                        )
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent
                                        className="!z-[10000]"
                                        position="popper"
                                      >
                                        {standardFields.map((field) => (
                                          <SelectItem
                                            key={field.value}
                                            value={field.value}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span
                                                className={
                                                  field.required
                                                    ? "font-medium"
                                                    : ""
                                                }
                                              >
                                                {field.label}
                                              </span>
                                              {field.required && (
                                                <span className="text-red-500">
                                                  *
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                              {field.description}
                                            </div>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {getMappingStatusIcon(mapping.standardField)}
                                </div>
                              </div>

                              {/* Sample Data Preview */}
                              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                  Sample values:
                                </div>
                                <div className="text-sm font-mono bg-white dark:!bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 max-h-16 overflow-y-auto">
                                  {currentSheet.sampleData
                                    .slice(0, 3)
                                    .map((row, idx) => (
                                      <div key={idx} className="truncate">
                                        {String(
                                          row[mapping.originalColumn] ||
                                            "(empty)"
                                        )}
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
                    className="flex-1 overflow-hidden px-4 py-4"
                  >
                    <div className="h-full flex flex-col">
                      <div className="mb-4">
                        <h3 className="font-medium">Mapped Data Preview</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Preview of how your data will look after applying the
                          mappings
                        </p>
                      </div>

                      <div
                        className={`${
                          previewMappedData().length < 15
                            ? "h-fit max-h-full"
                            : "flex-1"
                        } overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg`}
                      >
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:!bg-gray-800 sticky top-0">
                            <tr>
                              <th className="p-2 text-left font-medium w-12">
                                #
                              </th>
                              {currentMappings
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
                                {currentMappings
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
                                          {String(row[key] || "(empty)")}
                                        </div>
                                      </td>
                                    );
                                  })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        Preview showing {previewMappedData().length} of{" "}
                        {currentSheet.totalRows.toLocaleString()} rows
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="validation"
                    className="flex-1 overflow-y-auto px-4 py-4"
                  >
                    <div className="space-y-4">
                      <div>
                        <h3 className="font-medium mb-2">Mapping Summary</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600 dark:text-gray-400">
                              Total Columns:
                            </span>
                            <span className="ml-2 font-medium">
                              {currentSheet.headers.length}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600 dark:text-gray-400">
                              {targetModelTable &&
                              currentSheetType === targetModelTable.name
                                ? "Mapped fields:"
                                : "Mapped Columns:"}
                            </span>
                            <span className="ml-2 font-medium">
                              {
                                currentMappings.filter(
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
                        <h3 className="font-medium mb-2">
                          Required Fields Status
                        </h3>
                        <div className="space-y-2">
                          {standardFields
                            .filter((f) => f.required)
                            .map((field) => {
                              const isMapped = currentMappings.some(
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
                                      ? "isReference" in field &&
                                        field.isReference
                                        ? `Will be matched from ${(field as any).referencesTable}`
                                        : "Will be auto-generated"
                                      : field.description}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            ) : currentSheet ? (
              <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400 p-6">
                <div className="text-center">
                  <Database className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p className="text-lg font-medium mb-2">
                    {targetModelTable
                      ? `Include in ${targetModelTable.name}`
                      : "Select a target table"}
                  </p>
                  <p className="text-sm">
                    {targetModelTable
                      ? `Select the checkbox for this sheet in the sidebar to include it in the ${targetModelTable.name} table.`
                      : "Choose a target table (Transactions, CRM Deals, or Budget) from the dropdown above to start mapping columns."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                Select a sheet to view details
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {selectedCount} sheet{selectedCount !== 1 ? "s" : ""} selected
            </span>
            <Button
              onClick={handleConfirm}
              disabled={
                !allMappingsValid || selectedCount === 0 || isNormalizing
              }
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Continue ({selectedCount})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
