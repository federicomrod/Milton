import React, { useState, useEffect } from "react";
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
} from "lucide-react";

import { ColumnMapping } from "@/types/schema";

interface DataMappingUIProps {
  fileName: string;
  fileType: "transactions" | "deals" | "budget";
  headers: string[];
  sampleData: any[];
  suggestedMappings: ColumnMapping[];
  confidence: number;
  issues: string[];
  onConfirm: (mappings: ColumnMapping[]) => void;
  onCancel: () => void;
  onReanalyze?: () => void;
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

export default function EnhancedDataMappingUI({
  fileName,
  fileType,
  headers,
  sampleData,
  suggestedMappings,
  confidence,
  issues,
  onConfirm,
  onCancel,
  onReanalyze,
}: DataMappingUIProps) {
  // Initialize mappings from suggestedMappings or create from headers
  const initialMappings: ColumnMapping[] =
    suggestedMappings.length > 0
      ? suggestedMappings
      : headers.map((header) => {
          // Try to infer data type from sample data
          const sampleValue = sampleData[0]?.[header];
          let dataType: "string" | "number" | "date" | "currency" = "string";

          if (sampleValue !== null && sampleValue !== undefined) {
            if (typeof sampleValue === "number") {
              dataType = "number";
            } else if (typeof sampleValue === "string") {
              // Check if it looks like a date
              if (
                /^\d{4}-\d{2}-\d{2}/.test(sampleValue) ||
                /^\d{2}\/\d{2}\/\d{4}/.test(sampleValue)
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

          return {
            originalColumn: header,
            standardField: "unmapped",
            confidence: 0,
            dataType,
            transformation: "none" as const,
          };
        });

  const [mappings, setMappings] = useState<ColumnMapping[]>(initialMappings);
  const [activeTab, setActiveTab] = useState("mappings");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const standardFields = STANDARD_FIELDS[fileType] || [];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    validateMappings();
  }, [mappings]);

  const validateMappings = () => {
    const errors = [];
    const mappedFields = mappings
      .map((m) => m.standardField)
      .filter((f) => f !== "unmapped");
    const requiredFields = standardFields.filter((f) => f.required);

    // Check for required fields
    for (const required of requiredFields) {
      if (!mappedFields.includes(required.value)) {
        errors.push(`Required field "${required.label}" is not mapped`);
      }
    }

    // Check for duplicate mappings (allow multiple "month" mappings for budget files)
    const duplicates = mappedFields.filter(
      (field, index, arr) =>
        arr.indexOf(field) !== index &&
        field !== "unmapped" &&
        !(fileType === "budget" && field === "month") // Allow multiple month mappings for budgets
    );
    if (duplicates.length > 0) {
      errors.push(`Duplicate mappings found: ${duplicates.join(", ")}`);
    }

    setValidationErrors(errors);
  };

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
    return sampleData.slice(0, 15).map((row, index) => {
      const mapped: any = { _index: index + 1 };
      mappings.forEach((mapping) => {
        if (mapping.standardField !== "unmapped") {
          // For multiple month columns, use original column name as key to avoid overwriting
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

  // Calculate current confidence from all mappings
  // For manually mapped fields, use their confidence (1.0 if manually set)
  // For unmapped fields, use 0
  // This gives an overall confidence score
  const currentConfidence =
    mappings.length > 0
      ? mappings.reduce((sum, m) => {
          // If unmapped, contribute 0 to the average
          if (m.standardField === "unmapped") return sum;
          // Otherwise use the mapping's confidence
          return sum + m.confidence;
        }, 0) / mappings.length
      : 0;

  return (
    <Dialog open={true} onOpenChange={() => onCancel()}>
      <DialogContent className="!max-w-[1400px] w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Data Mapping - {fileName}
            <Badge variant={currentConfidence > 0.8 ? "default" : "secondary"}>
              {fileType.toUpperCase()}
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
                                {standardFields.map((field) => (
                                  <SelectItem
                                    key={field.value}
                                    value={field.value}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={
                                          field.required ? "font-medium" : ""
                                        }
                                      >
                                        {field.label}
                                      </span>
                                      {field.required && (
                                        <span className="text-red-500">*</span>
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
                          {getConfidenceBadge(mapping.confidence)}
                        </div>
                      </div>

                      {/* Sample Data Preview */}
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
            </TabsContent>

            <TabsContent value="preview" className="flex-1 overflow-hidden">
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
                        <th className="p-2 text-left font-medium w-12">#</th>
                        {mappings
                          .filter((m) => m.standardField !== "unmapped")
                          .map((mapping) => {
                            // For multiple month columns, use original column as key
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
                          {mappings
                            .filter((m) => m.standardField !== "unmapped")
                            .map((mapping) => {
                              // For multiple month columns, use original column to get value
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
                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
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
                        Mapped Columns:
                      </span>
                      <span className="ml-2 font-medium">
                        {
                          mappings.filter((m) => m.standardField !== "unmapped")
                            .length
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
                        const isMapped = mappings.some(
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
                onClick={() => onConfirm(mappings)}
                disabled={!isValid}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Apply Mapping (
                {
                  mappings.filter((m) => m.standardField !== "unmapped").length
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
