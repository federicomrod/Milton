"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Upload } from "lucide-react";
import { useDataStatus } from "@/lib/context/DataStatusContext";
import EnhancedDataMappingUI from "./data-mapping-confirmation";
import SheetSelection from "./sheet-selection";
import { FileNameConfirmationDialog } from "./file-name-confirmation-dialog";
import { ColumnMapping } from "@/types/schema";
import { createClient } from "@/lib/supabase/client";
import {
  deleteIndividualFile,
  checkExistingFileByName,
} from "@/lib/data-service";
import { UploadedFile } from "@/lib/data-service";

/**
 * Generate auto-mapping suggestions based on column name matching
 */
function generateAutoMappings(
  headers: string[],
  sampleData: any[],
  datasetType: "bank" | "crm" | "budget"
): { suggestedMappings: ColumnMapping[]; confidence: number } {
  const mappings: ColumnMapping[] = [];
  let totalConfidence = 0;
  let mappedCount = 0;

  // Define standard field keywords for each dataset type
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

    // Check each standard field for matches
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

    // Infer data type from sample data
    const sampleValue = sampleData[0]?.[header];
    let dataType: "string" | "number" | "date" | "currency" = "string";

    if (sampleValue !== null && sampleValue !== undefined) {
      if (typeof sampleValue === "number") {
        dataType = "number";
      } else if (typeof sampleValue === "string") {
        // Check if it looks like a date
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
      // No match found - mark as unmapped
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

/**
 * Calculate confidence score for header-to-keyword matching
 */
function calculateMatchConfidence(header: string, keyword: string): number {
  // Exact match
  if (header === keyword) return 1.0;

  // Contains match
  if (header.includes(keyword) || keyword.includes(header)) return 0.9;

  // Word boundary match
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

interface QueuedFile {
  id: string;
  file: File;
  status:
    | "pending"
    | "parsing"
    | "mapping"
    | "uploading"
    | "completed"
    | "error"
    | "skipped";
  parseResult?: any;
  datasetType?: "bank" | "crm" | "budget";
  error?: string;
  rowCount?: number;
}

interface FileUploadProps {
  selectedUseCase?: string | null;
  onFileSelected?: (
    file: File,
    datasetType: "bank" | "crm" | "budget"
  ) => Promise<void>;
}

export default function FileUpload({
  selectedUseCase,
  onFileSelected,
}: FileUploadProps) {
  const { refreshDataStatus } = useDataStatus();
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [showMappingUI, setShowMappingUI] = useState(false);
  const [showSheetSelection, setShowSheetSelection] = useState(false);
  const [replaceMode, setReplaceMode] = useState<{
    enabled: boolean;
    datasetType?: "bank" | "crm" | "budget";
    fileIdToReplace?: string;
  }>({ enabled: false });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCardRef = useRef<HTMLDivElement>(null);
  const [sheetData, setSheetData] = useState<{
    file: File;
    sheets: Array<{
      name: string;
      headers: string[];
      sampleData: any[];
      totalRows: number;
    }>;
    queueIndex?: number;
  } | null>(null);
  const [pendingSheets, setPendingSheets] = useState<
    Array<{ sheetName: string; datasetType: "bank" | "crm" | "budget" }>
  >([]);
  const [mappingData, setMappingData] = useState<{
    file: File;
    datasetType: "bank" | "crm" | "budget";
    headers: string[];
    sampleData: any[];
    suggestedMappings: ColumnMapping[];
    confidence: number;
    sheetName?: string;
    queueIndex?: number;
  } | null>(null);
  const [existingFile, setExistingFile] = useState<UploadedFile | null>(null);
  const [showFileNameDialog, setShowFileNameDialog] = useState(false);
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    parseResult: any;
    datasetType: "bank" | "crm" | "budget";
    queueIndex?: number;
  } | null>(null);
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState({
    completed: 0,
    total: 0,
  });

  // Listen for replace events
  useEffect(() => {
    const handleReplaceEvent = (e: CustomEvent) => {
      const { datasetType, fileIdToReplace } = e.detail || {};
      setReplaceMode({ enabled: true, datasetType, fileIdToReplace });

      // Scroll to file upload section
      if (uploadCardRef.current) {
        uploadCardRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        // Highlight the upload area briefly
        uploadCardRef.current.classList.add(
          "ring-2",
          "ring-blue-500",
          "ring-offset-2"
        );
        setTimeout(() => {
          uploadCardRef.current?.classList.remove(
            "ring-2",
            "ring-blue-500",
            "ring-offset-2"
          );
        }, 2000);
      }

      // Focus the file input
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 300);
    };

    window.addEventListener(
      "file-upload:replace",
      handleReplaceEvent as EventListener
    );
    return () => {
      window.removeEventListener(
        "file-upload:replace",
        handleReplaceEvent as EventListener
      );
    };
  }, []);

  const inferDatasetType = (fileName: string): "bank" | "crm" | "budget" => {
    const lowerName = fileName.toLowerCase();
    if (
      lowerName.includes("crm") ||
      lowerName.includes("deal") ||
      lowerName.includes("sales")
    ) {
      return "crm";
    } else if (lowerName.includes("budget")) {
      return "budget";
    } else if (
      lowerName.includes("transaction") ||
      lowerName.includes("bank")
    ) {
      return "bank";
    }
    return "bank";
  };

  const updateFileStatus = (
    index: number,
    status: QueuedFile["status"],
    error?: string,
    rowCount?: number
  ) => {
    setFileQueue((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], status, error, rowCount };
      }
      return updated;
    });
  };

  const processNextFile = async (index: number, queue: QueuedFile[]) => {
    if (index >= queue.length) {
      // All files processed
      setCurrentFileIndex(null);
      setIsProcessing(false);
      setUploadMessage(
        `✅ Successfully processed ${batchProgress.completed} of ${batchProgress.total} files`
      );
      await refreshDataStatus();
      document.dispatchEvent(new CustomEvent("data-status:refresh"));
      return;
    }

    const queuedFile = queue[index];
    setCurrentFileIndex(index);
    updateFileStatus(index, "parsing");

    try {
      // Use dataset type from replace mode if available, otherwise infer from filename
      const datasetType: "bank" | "crm" | "budget" =
        replaceMode.datasetType || inferDatasetType(queuedFile.file.name);

      // If onFileSelected handler is provided, delegate to it (skip mapping)
      if (onFileSelected) {
        await onFileSelected(queuedFile.file, datasetType);
        updateFileStatus(index, "completed", undefined, 0);
        setBatchProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
        }));
        await processNextFile(index + 1, queue);
        return;
      }

      // Parse file to get headers and sample data
      const parseFormData = new FormData();
      parseFormData.append("file", queuedFile.file);

      const parseRes = await fetch("/api/data/parse", {
        method: "POST",
        body: parseFormData,
      });

      if (!parseRes.ok) {
        const errorText = await parseRes.text();
        throw new Error(`Parse failed: ${errorText}`);
      }

      const parseResult = await parseRes.json();

      console.log("[FileUpload] Parse result:", {
        hasSheets: !!parseResult.sheets,
        sheetsLength: parseResult.sheets?.length,
        isMultiSheet: parseResult.isMultiSheet,
        fileName: queuedFile.file.name,
      });

      // Check if a file with the same name has been uploaded before
      let existing: UploadedFile | null = null;
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          existing = await checkExistingFileByName(
            supabase,
            user.id,
            queuedFile.file.name
          );

          if (existing) {
            console.log(
              `[FileUpload] Found existing file with name "${queuedFile.file.name}"`
            );
            setExistingFile(existing);
            setPendingFile({
              file: queuedFile.file,
              parseResult,
              datasetType,
              queueIndex: index,
            });
            setShowFileNameDialog(true);
            // Wait for user's confirmation - processNextFile will be called from handleFileNameConfirm
            return;
          }
        }
      } catch (err) {
        console.warn("[FileUpload] Failed to check for existing file:", err);
        // Continue with upload if check fails
      }

      // No existing file found or check failed - proceed with upload
      proceedWithUploadForQueue(
        queuedFile.file,
        parseResult,
        datasetType,
        index
      );
    } catch (err) {
      console.error("[FileUpload] Error:", err);
      updateFileStatus(index, "error", (err as Error).message);
      // Continue with next file
      await processNextFile(index + 1, queue);
    }
  };

  const skipFile = async (index: number) => {
    updateFileStatus(index, "skipped");
    const queue = [...fileQueue];
    await processNextFile(index + 1, queue);
  };

  const clearQueue = () => {
    setFileQueue([]);
    setCurrentFileIndex(null);
    setBatchProgress({ completed: 0, total: 0 });
    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Single file mode (backward compatibility)
    if (files.length === 1 && !replaceMode.enabled) {
      const file = files[0];
      setIsProcessing(true);
      setUploadMessage(null);

      try {
        const datasetType: "bank" | "crm" | "budget" =
          replaceMode.datasetType || inferDatasetType(file.name);

        // If onFileSelected handler is provided, delegate to it (skip mapping)
        if (onFileSelected) {
          await onFileSelected(file, datasetType);
          setUploadMessage(`✅ Successfully uploaded ${file.name}`);
          await refreshDataStatus();
          setIsProcessing(false);
          return;
        }

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

        // Check if a file with the same name has been uploaded before
        try {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            const existing = await checkExistingFileByName(
              supabase,
              user.id,
              file.name
            );

            if (existing) {
              console.log(
                `[FileUpload] Found existing file with name "${file.name}"`
              );
              setExistingFile(existing);
              setPendingFile({ file, parseResult, datasetType });
              setShowFileNameDialog(true);
              setIsProcessing(false);
              return; // Wait for user's confirmation
            }
          }
        } catch (err) {
          console.warn("[FileUpload] Failed to check for existing file:", err);
          // Continue with upload if check fails
        }

        // No existing file found or check failed - proceed with upload
        proceedWithUpload(file, parseResult, datasetType);
      } catch (err) {
        console.error("[FileUpload] Error:", err);
        setUploadMessage(`❌ Upload failed: ${(err as Error).message}`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Multiple file mode - create queue
    const queue: QueuedFile[] = files.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      file,
      status: "pending",
    }));

    setFileQueue(queue);
    setBatchProgress({ completed: 0, total: files.length });
    setCurrentFileIndex(0);
    setIsProcessing(true);
    setUploadMessage(null);

    // Start processing the first file
    await processNextFile(0, queue);
  };

  const proceedWithUpload = (
    file: File,
    parseResult: any,
    datasetType: "bank" | "crm" | "budget"
  ) => {
    // Check if this is a multi-sheet Excel file
    if (parseResult.sheets && parseResult.sheets.length > 0) {
      // Show sheet selection UI for all Excel files (single or multi-sheet)
      console.log("[FileUpload] Showing sheet selection UI");
      setSheetData({
        file,
        sheets: parseResult.sheets,
      });
      setShowSheetSelection(true);
    } else {
      console.log("[FileUpload] Using legacy single-sheet flow");
      // Single sheet or CSV - use legacy flow
      // Generate auto-mapping suggestions
      const { suggestedMappings, confidence } = generateAutoMappings(
        parseResult.headers,
        parseResult.sampleData,
        datasetType
      );

      console.log("[FileUpload] Auto-mapping results:", {
        headers: parseResult.headers,
        suggestedMappings,
        confidence,
      });

      // Show mapping UI
      setMappingData({
        file,
        datasetType,
        headers: parseResult.headers,
        sampleData: parseResult.sampleData,
        suggestedMappings,
        confidence,
      });
      setShowMappingUI(true);
    }
  };

  const proceedWithUploadForQueue = (
    file: File,
    parseResult: any,
    datasetType: "bank" | "crm" | "budget",
    queueIndex: number
  ) => {
    // Check if this is a multi-sheet Excel file
    if (parseResult.sheets && parseResult.sheets.length > 0) {
      // Show sheet selection UI for all Excel files (single or multi-sheet)
      console.log("[FileUpload] Showing sheet selection UI");
      updateFileStatus(queueIndex, "mapping");
      setSheetData({
        file,
        sheets: parseResult.sheets,
        queueIndex,
      });
      setShowSheetSelection(true);
    } else {
      console.log("[FileUpload] Using legacy single-sheet flow");
      // Single sheet or CSV - use legacy flow
      // Generate auto-mapping suggestions
      const { suggestedMappings, confidence } = generateAutoMappings(
        parseResult.headers,
        parseResult.sampleData,
        datasetType
      );

      // Show mapping UI
      updateFileStatus(queueIndex, "mapping");
      setMappingData({
        file,
        datasetType,
        headers: parseResult.headers,
        sampleData: parseResult.sampleData,
        suggestedMappings,
        confidence,
        queueIndex,
      });
      setShowMappingUI(true);
    }
  };

  const handleFileNameConfirm = async () => {
    setShowFileNameDialog(false);
    if (pendingFile) {
      const { file, parseResult, datasetType, queueIndex } = pendingFile;
      setPendingFile(null);
      // Set replace mode with the existing file's ID
      if (existingFile) {
        setReplaceMode({
          enabled: true,
          datasetType: existingFile.dataset_type,
          fileIdToReplace: existingFile.id,
        });
      }
      // If queueIndex is defined, we're in batch mode
      if (queueIndex !== undefined && currentFileIndex !== null) {
        proceedWithUploadForQueue(file, parseResult, datasetType, queueIndex);
      } else {
        // Single file mode
        proceedWithUpload(file, parseResult, datasetType);
      }
    }
    setExistingFile(null);
  };

  const handleFileNameCancel = async () => {
    setShowFileNameDialog(false);
    if (pendingFile?.queueIndex !== undefined && currentFileIndex !== null) {
      // In batch mode, skip this file and continue with next
      await skipFile(pendingFile.queueIndex);
    }
    setPendingFile(null);
    setExistingFile(null);
    // Clear file input only if not in batch mode
    if (currentFileIndex === null && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleMappingConfirm = async (mappings: ColumnMapping[]) => {
    if (!mappingData) return;

    // Check if this is part of a multi-sheet upload
    if (pendingSheets.length > 0) {
      const currentSheetIndex = pendingSheets.findIndex(
        (s) => s.sheetName === mappingData.sheetName
      );
      if (currentSheetIndex >= 0) {
        handleMappingConfirmForMultiSheet(mappings, currentSheetIndex);
        return;
      }
    }

    const queueIndex = mappingData.queueIndex;
    const isBatchMode = queueIndex !== undefined && currentFileIndex !== null;

    if (isBatchMode) {
      updateFileStatus(queueIndex, "uploading");
    } else {
      setIsProcessing(true);
    }
    setShowMappingUI(false);
    if (!isBatchMode) {
      setUploadMessage(null);
    }

    // Upload file with mappings - use overwrite mode if replacing
    const uploadMode = replaceMode.enabled ? "overwrite" : "append";
    const formData = new FormData();
    formData.append("file", mappingData.file);
    formData.append("datasetType", mappingData.datasetType);
    formData.append("mode", uploadMode);
    formData.append("mappings", JSON.stringify(mappings));
    if (mappingData.sheetName) {
      formData.append("sheetName", mappingData.sheetName);
    }

    try {
      const res = await fetch("/api/data/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Upload failed: ${errorText}`);
      }

      const result = await res.json();
      console.log(
        `[FileUpload] Successfully uploaded ${result.insertedCount} rows`
      );

      // If we're replacing a file, delete the old one after successful upload
      if (replaceMode.enabled && replaceMode.fileIdToReplace) {
        try {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            const deleteResult = await deleteIndividualFile(
              supabase,
              user.id,
              replaceMode.fileIdToReplace
            );
            if (deleteResult.success) {
              console.log(
                `[FileUpload] Successfully deleted old file ${replaceMode.fileIdToReplace}`
              );
            } else {
              console.warn(
                `[FileUpload] Failed to delete old file: ${deleteResult.error}`
              );
            }
          }
        } catch (err) {
          console.error("[FileUpload] Error deleting old file:", err);
          // Don't fail the upload if deletion fails
        }
      }

      if (isBatchMode) {
        updateFileStatus(
          queueIndex,
          "completed",
          undefined,
          result.insertedCount
        );
        setBatchProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
        }));
        setMappingData(null);
        // Process next file
        await processNextFile(queueIndex + 1, fileQueue);
      } else {
        setUploadMessage(
          `✅ Successfully uploaded ${mappingData.file.name} (${result.insertedCount} rows)`
        );
        await refreshDataStatus();
        document.dispatchEvent(new CustomEvent("data-status:refresh"));
        setMappingData(null);
        setReplaceMode({ enabled: false, fileIdToReplace: undefined });

        // Clear file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        setIsProcessing(false);
      }
    } catch (err) {
      console.error("[FileUpload] Error:", err);
      if (isBatchMode) {
        updateFileStatus(queueIndex, "error", (err as Error).message);
        await processNextFile(queueIndex + 1, fileQueue);
      } else {
        setUploadMessage(`❌ Upload failed: ${(err as Error).message}`);
        setIsProcessing(false);
      }
    }
  };

  const handleMappingCancel = async () => {
    setShowMappingUI(false);

    setMappingData(null);
    setReplaceMode({ enabled: false, fileIdToReplace: undefined });

    // Clear the entire queue when canceling
    clearQueue();
  };

  const handleSheetSelectionConfirm = async (
    sheetMappings: Array<{
      sheetName: string;
      datasetType: "bank" | "crm" | "budget";
      columnMappings: ColumnMapping[];
    }>
  ) => {
    if (!sheetData) return;

    const queueIndex = sheetData.queueIndex;
    const isBatchMode = queueIndex !== undefined && currentFileIndex !== null;

    setShowSheetSelection(false);
    if (isBatchMode) {
      updateFileStatus(queueIndex, "uploading");
    } else {
      setIsProcessing(true);
      setUploadMessage(null);
    }

    let totalRows = 0;

    // Upload all sheets directly with their confirmed mappings
    for (let i = 0; i < sheetMappings.length; i++) {
      const mapping = sheetMappings[i];

      const uploadMode = replaceMode.enabled ? "overwrite" : "append";
      const formData = new FormData();
      formData.append("file", sheetData.file);
      formData.append("datasetType", mapping.datasetType);
      formData.append("mode", uploadMode);
      formData.append("mappings", JSON.stringify(mapping.columnMappings));
      formData.append("sheetName", mapping.sheetName);

      try {
        const res = await fetch("/api/data/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(
            `Upload failed for sheet "${mapping.sheetName}": ${errorText}`
          );
        }

        const result = await res.json();
        totalRows += result.insertedCount || 0;
        console.log(
          `[FileUpload] Successfully uploaded sheet "${mapping.sheetName}" (${result.insertedCount} rows)`
        );
      } catch (err) {
        console.error("[FileUpload] Error:", err);
        if (isBatchMode) {
          updateFileStatus(queueIndex, "error", (err as Error).message);
          await processNextFile(queueIndex + 1, fileQueue);
        } else {
          setUploadMessage(
            `❌ Upload failed for sheet "${mapping.sheetName}": ${(err as Error).message}`
          );
          setIsProcessing(false);
        }
        return;
      }
    }

    // If we're replacing a file, delete the old one after successful upload
    if (replaceMode.enabled && replaceMode.fileIdToReplace) {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const deleteResult = await deleteIndividualFile(
            supabase,
            user.id,
            replaceMode.fileIdToReplace
          );
          if (deleteResult.success) {
            console.log(
              `[FileUpload] Successfully deleted old file ${replaceMode.fileIdToReplace}`
            );
          } else {
            console.warn(
              `[FileUpload] Failed to delete old file: ${deleteResult.error}`
            );
          }
        }
      } catch (err) {
        console.error("[FileUpload] Error deleting old file:", err);
        // Don't fail the upload if deletion fails
      }
    }

    // All sheets processed successfully
    if (isBatchMode) {
      updateFileStatus(queueIndex, "completed", undefined, totalRows);
      setBatchProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      setSheetData(null);
      // Process next file
      await processNextFile(queueIndex + 1, fileQueue);
    } else {
      setUploadMessage(
        `✅ Successfully uploaded ${sheetData.file.name} (${sheetMappings.length} sheet${sheetMappings.length !== 1 ? "s" : ""})`
      );
      await refreshDataStatus();
      document.dispatchEvent(new CustomEvent("data-status:refresh"));
      setSheetData(null);
      setReplaceMode({ enabled: false, fileIdToReplace: undefined });
      setIsProcessing(false);

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleMappingConfirmForMultiSheet = async (
    mappings: ColumnMapping[],
    _currentSheetIndex: number
  ) => {
    // Note: _currentSheetIndex is kept for backward compatibility but not used
    // since we now directly upload all sheets after sheet selection
    void _currentSheetIndex;
    if (!mappingData || !sheetData) return;

    setIsProcessing(true);
    setShowMappingUI(false);

    // Upload this sheet with its mappings - use overwrite mode if replacing
    const uploadMode = replaceMode.enabled ? "overwrite" : "append";
    const formData = new FormData();
    formData.append("file", mappingData.file);
    formData.append("datasetType", mappingData.datasetType);
    formData.append("mode", uploadMode);
    formData.append("mappings", JSON.stringify(mappings));
    if (mappingData.sheetName) {
      formData.append("sheetName", mappingData.sheetName);
    }

    try {
      const res = await fetch("/api/data/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Upload failed: ${errorText}`);
      }

      const result = await res.json();
      console.log(
        `[FileUpload] Successfully uploaded sheet "${mappingData.sheetName}" (${result.insertedCount} rows)`
      );

      // If we're replacing a file, delete the old one after successful upload
      if (replaceMode.enabled && replaceMode.fileIdToReplace) {
        try {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            const deleteResult = await deleteIndividualFile(
              supabase,
              user.id,
              replaceMode.fileIdToReplace
            );
            if (deleteResult.success) {
              console.log(
                `[FileUpload] Successfully deleted old file ${replaceMode.fileIdToReplace}`
              );
            } else {
              console.warn(
                `[FileUpload] Failed to delete old file: ${deleteResult.error}`
              );
            }
          }
        } catch (err) {
          console.error("[FileUpload] Error deleting old file:", err);
          // Don't fail the upload if deletion fails
        }
      }

      // All sheets processed (this function should only be called for single-sheet legacy flow)
      setUploadMessage(`✅ Successfully uploaded ${mappingData.file.name}`);
      await refreshDataStatus();
      document.dispatchEvent(new CustomEvent("data-status:refresh"));
      setMappingData(null);
      setSheetData(null);
      setPendingSheets([]);
      setReplaceMode({ enabled: false, fileIdToReplace: undefined });
      setIsProcessing(false);

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      console.error("[FileUpload] Error:", err);
      setUploadMessage(`❌ Upload failed: ${(err as Error).message}`);
      setIsProcessing(false);
    }
  };

  return (
    <Card ref={uploadCardRef}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Upload Financial Data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Upload your bank transactions, CRM data, or budget files (CSV or
              Excel).
              {selectedUseCase && (
                <span className="block mt-1 text-blue-600 dark:text-blue-400 font-medium">
                  Use case: {selectedUseCase}
                </span>
              )}
              {replaceMode.enabled && (
                <span className="block mt-2 text-orange-600 dark:text-orange-400 font-medium bg-orange-50 dark:bg-orange-950/30 p-2 rounded">
                  Replace mode: This will overwrite existing{" "}
                  {replaceMode.datasetType === "bank"
                    ? "transactions"
                    : replaceMode.datasetType === "crm"
                      ? "CRM deals"
                      : "budget"}{" "}
                  data.
                </span>
              )}
            </p>

            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                onChange={handleFileUpload}
                disabled={isProcessing}
                className="hidden"
                id="file-upload-input"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="w-full"
              >
                <Upload className="h-4 w-4 mr-2" />
                {fileQueue.length > 0 ? "Add More Files" : "Select Files"}
              </Button>
            </div>
          </div>

          {isProcessing && fileQueue.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 dark:border-blue-400"></div>
              Processing...
            </div>
          )}

          {fileQueue.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400 font-medium">
                  Processing {batchProgress.completed} of {batchProgress.total}{" "}
                  files
                </span>
                <span className="text-gray-500 dark:text-gray-500">
                  {batchProgress.total > 0
                    ? Math.round(
                        (batchProgress.completed / batchProgress.total) * 100
                      )
                    : 0}
                  %
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${batchProgress.total > 0 ? (batchProgress.completed / batchProgress.total) * 100 : 0}%`,
                  }}
                />
              </div>

              <div className="space-y-1 max-h-64 overflow-y-auto border rounded-md p-2 bg-gray-50 dark:bg-gray-900/50">
                {fileQueue.map((queuedFile, idx) => (
                  <div
                    key={queuedFile.id}
                    className={`flex items-center justify-between p-2 rounded text-sm transition-colors ${
                      idx === currentFileIndex
                        ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800"
                        : "hover:bg-gray-100 dark:hover:bg-gray-800/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <FileText className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {queuedFile.file.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {queuedFile.status === "parsing" ||
                      queuedFile.status === "mapping" ||
                      queuedFile.status === "uploading" ? (
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 dark:border-blue-400" />
                      ) : queuedFile.status === "completed" ? (
                        <span className="text-green-600 dark:text-green-400">
                          ✓
                        </span>
                      ) : queuedFile.status === "error" ? (
                        <span className="text-red-600 dark:text-red-400">
                          ✗
                        </span>
                      ) : queuedFile.status === "skipped" ? (
                        <span className="text-gray-400 dark:text-gray-600">
                          −
                        </span>
                      ) : null}
                      <span
                        className={`text-xs ${
                          queuedFile.status === "completed"
                            ? "text-green-600 dark:text-green-400"
                            : queuedFile.status === "error"
                              ? "text-red-600 dark:text-red-400"
                              : queuedFile.status === "skipped"
                                ? "text-gray-500 dark:text-gray-500"
                                : "text-gray-600 dark:text-gray-400"
                        }`}
                      >
                        {queuedFile.status === "completed" &&
                        queuedFile.rowCount
                          ? `${queuedFile.rowCount.toLocaleString()} rows`
                          : queuedFile.status === "error"
                            ? queuedFile.error || "Error"
                            : queuedFile.status}
                      </span>
                      {idx === currentFileIndex &&
                        queuedFile.status !== "completed" &&
                        queuedFile.status !== "error" &&
                        queuedFile.status !== "skipped" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => skipFile(idx)}
                            className="h-6 px-2 text-xs"
                          >
                            Skip
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {uploadMessage && fileQueue.length === 0 && (
            <div
              className={`text-sm p-3 rounded-md ${
                uploadMessage.startsWith("✅")
                  ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
              }`}
            >
              {uploadMessage}
            </div>
          )}

          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>
              <strong>Supported formats:</strong> CSV, XLSX, XLS
            </p>
            <p>
              <strong>File naming tips:</strong>
            </p>
            <ul className="list-disc list-inside ml-2 space-y-0.5">
              <li>
                Include &quot;bank&quot; or &quot;transactions&quot; for bank
                data
              </li>
              <li>
                Include &quot;crm&quot;, &quot;deals&quot;, or &quot;sales&quot;
                for CRM data
              </li>
              <li>Include &quot;budget&quot; for budget data</li>
            </ul>
          </div>
        </div>
      </CardContent>

      {showSheetSelection && sheetData && (
        <SheetSelection
          fileName={sheetData.file.name}
          sheets={sheetData.sheets}
          onConfirm={handleSheetSelectionConfirm}
          onCancel={async () => {
            setShowSheetSelection(false);
            setSheetData(null);
            setReplaceMode({ enabled: false, fileIdToReplace: undefined });
            // Clear the entire queue when canceling
            clearQueue();
          }}
        />
      )}

      {showMappingUI && mappingData && (
        <EnhancedDataMappingUI
          fileName={
            mappingData.sheetName
              ? `${mappingData.file.name} - ${mappingData.sheetName}`
              : mappingData.file.name
          }
          fileType={
            mappingData.datasetType === "bank"
              ? "transactions"
              : mappingData.datasetType === "crm"
                ? "deals"
                : "budget"
          }
          headers={mappingData.headers}
          sampleData={mappingData.sampleData}
          suggestedMappings={mappingData.suggestedMappings}
          confidence={mappingData.confidence}
          issues={[]}
          onConfirm={handleMappingConfirm}
          onCancel={handleMappingCancel}
        />
      )}

      <FileNameConfirmationDialog
        open={showFileNameDialog}
        onOpenChange={setShowFileNameDialog}
        fileName={pendingFile?.file.name || ""}
        existingFile={
          existingFile
            ? {
                uploadedAt: existingFile.uploaded_at,
                rowCount: existingFile.row_count,
                datasetType: existingFile.dataset_type,
              }
            : null
        }
        onContinue={handleFileNameConfirm}
        onCancel={handleFileNameCancel}
      />
    </Card>
  );
}
