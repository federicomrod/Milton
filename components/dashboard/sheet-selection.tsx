"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ColumnMapping } from "@/types/schema";

interface SheetInfo {
  name: string;
  headers: string[];
  sampleData: Record<string, unknown>[];
  totalRows: number;
}

interface SheetSelectionProps {
  fileName: string;
  sheets: SheetInfo[];
  onConfirm: (
    sheetMappings: Array<{
      sheetName: string;
      datasetType: "bank" | "crm" | "budget";
      columnMappings: ColumnMapping[];
    }>
  ) => void;
  onCancel: () => void;
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

export default function SheetSelection({
  fileName,
  sheets,
  onConfirm,
  onCancel,
}: SheetSelectionProps) {
  const [sheetMappings, setSheetMappings] = useState<
    Record<string, "bank" | "crm" | "budget" | null>
  >(() => {
    const initial: Record<string, "bank" | "crm" | "budget" | null> = {};
    sheets.forEach((sheet) => {
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
      const { suggestedMappings } = generateAutoMappings(
        currentSheet.headers,
        currentSheet.sampleData,
        currentSheetType
      );
      return { [currentSheet.name]: suggestedMappings };
    }
    return null;
  }, [currentSheet, currentSheetType, columnMappings]);

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
    datasetType: "bank" | "crm" | "budget" | "skip"
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
        const { suggestedMappings } = generateAutoMappings(
          sheet.headers,
          sheet.sampleData,
          datasetType
        );
        setColumnMappings((prev) => ({
          ...prev,
          [sheetName]: suggestedMappings,
        }));
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

  const currentMappings = React.useMemo(() => {
    return currentSheet && currentSheetType
      ? columnMappings[currentSheet.name] || []
      : [];
  }, [currentSheet, currentSheetType, columnMappings]);

  const fileType = React.useMemo(() => {
    return currentSheetType === "bank"
      ? "transactions"
      : currentSheetType === "crm"
        ? "deals"
        : "budget";
  }, [currentSheetType]);

  const standardFields = React.useMemo(() => {
    return STANDARD_FIELDS[fileType] || [];
  }, [fileType]);

  // Validation
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const validationErrorsComputed = React.useMemo(() => {
    if (!currentSheet || !currentSheetType || currentMappings.length === 0) {
      return [];
    }

    const errors: string[] = [];
    const mappedFields = currentMappings
      .map((m) => m.standardField)
      .filter((f) => f !== "unmapped");
    const requiredFields = standardFields.filter((f) => f.required);

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

  const currentConfidence =
    currentMappings.length > 0
      ? currentMappings.reduce((sum, m) => {
          if (m.standardField === "unmapped") return sum;
          return sum + m.confidence;
        }, 0) / currentMappings.length
      : 0;

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
        datasetType: datasetType as "bank" | "crm" | "budget",
        columnMappings: columnMappings[sheetName] || [],
      }));

    if (mappings.length === 0) {
      alert("Please select at least one sheet to process.");
      return;
    }

    // Validate all sheets have valid mappings
    for (const mapping of mappings) {
      const sheet = sheets.find((s) => s.name === mapping.sheetName);
      if (!sheet) continue;

      const mappingFileType =
        mapping.datasetType === "bank"
          ? "transactions"
          : mapping.datasetType === "crm"
            ? "deals"
            : "budget";
      const mappingStandardFields = STANDARD_FIELDS[mappingFileType] || [];
      const requiredFields = mappingStandardFields.filter((f) => f.required);
      const mappedFields = mapping.columnMappings
        .map((m) => m.standardField)
        .filter((f) => f !== "unmapped");

      for (const required of requiredFields) {
        if (!mappedFields.includes(required.value)) {
          alert(
            `Sheet "${mapping.sheetName}" is missing required field "${required.label}". Please complete the mapping.`
          );
          // Switch to that sheet
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

      const fileType =
        datasetType === "bank"
          ? "transactions"
          : datasetType === "crm"
            ? "deals"
            : "budget";
      const standardFields = STANDARD_FIELDS[fileType] || [];
      const requiredFields = standardFields.filter((f) => f.required);
      const mappings = columnMappings[sheetName] || [];
      const mappedFields = mappings
        .map((m) => m.standardField)
        .filter((f) => f !== "unmapped");

      // Check if all required fields are mapped
      for (const required of requiredFields) {
        if (!mappedFields.includes(required.value)) {
          return false;
        }
      }
    }

    return true;
  }, [sheetMappings, columnMappings, selectedCount]);

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
                    const fileType =
                      selectedType === "bank"
                        ? "transactions"
                        : selectedType === "crm"
                          ? "deals"
                          : "budget";
                    const standardFields = STANDARD_FIELDS[fileType] || [];
                    const requiredFields = standardFields.filter(
                      (f) => f.required
                    );
                    const mappedFields = (columnMappings[sheet.name] || [])
                      .map((m) => m.standardField)
                      .filter((f) => f !== "unmapped");
                    return requiredFields.every((rf) =>
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
                        ? selectedType === "bank"
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
                        currentSheetType === "bank"
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                          : currentSheetType === "crm"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                            : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      }
                    >
                      {currentSheetType === "bank"
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
                                        row[mapping.originalColumn] || "(empty)"
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
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
                              Mapped Columns:
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
                              return (
                                <div
                                  key={field.value}
                                  className="flex items-center gap-2"
                                >
                                  {isMapped ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <AlertTriangle className="h-4 w-4 text-red-500" />
                                  )}
                                  <span
                                    className={
                                      isMapped
                                        ? "text-green-700 dark:text-green-400"
                                        : "text-red-700 dark:text-red-400"
                                    }
                                  >
                                    {field.label}
                                  </span>
                                  <span className="text-gray-500 dark:text-gray-400 text-sm">
                                    - {field.description}
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
                    Select a target table
                  </p>
                  <p className="text-sm">
                    Choose a target table (Transactions, CRM Deals, or Budget)
                    from the dropdown above to start mapping columns.
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
              disabled={!allMappingsValid || selectedCount === 0}
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
