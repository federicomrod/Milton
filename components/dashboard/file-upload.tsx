"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { useDataStatus } from "@/lib/context/DataStatusContext";

interface FileUploadProps {
  selectedUseCase?: string | null;
  onFileSelected?: (
    file: File,
    datasetType: "bank" | "crm" | "budget",
  ) => Promise<void>;
}

export default function FileUpload({
  selectedUseCase,
  onFileSelected,
}: FileUploadProps) {
  const { refreshDataStatus } = useDataStatus();
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // If onFileSelected handler is provided, delegate to it
    if (onFileSelected && files[0]) {
      const file = files[0];
      // Determine dataset type from file name or selected use case
      let datasetType: "bank" | "crm" | "budget" = "bank";
      const fileName = file.name.toLowerCase();
      if (
        fileName.includes("crm") ||
        fileName.includes("deal") ||
        fileName.includes("sales")
      ) {
        datasetType = "crm";
      } else if (fileName.includes("budget")) {
        datasetType = "budget";
      } else if (
        fileName.includes("transaction") ||
        fileName.includes("bank")
      ) {
        datasetType = "bank";
      }

      setIsProcessing(true);
      try {
        await onFileSelected(file, datasetType);
        setUploadMessage(`✅ Successfully uploaded ${file.name}`);
        await refreshDataStatus();
      } catch (err) {
        setUploadMessage(`❌ Upload failed: ${(err as Error).message}`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Default flow: call unified API directly
    const file = files[0];
    setIsProcessing(true);
    setUploadMessage(null);

    try {
      console.log("[FileUpload] Processing file:", file.name);

      // Infer dataset type from file name
      let datasetType: "bank" | "crm" | "budget" = "bank";
      const fileName = file.name.toLowerCase();

      if (
        fileName.includes("crm") ||
        fileName.includes("deal") ||
        fileName.includes("sales")
      ) {
        datasetType = "crm";
      } else if (fileName.includes("budget")) {
        datasetType = "budget";
      } else if (
        fileName.includes("transaction") ||
        fileName.includes("bank")
      ) {
        datasetType = "bank";
      }

      console.log(`[FileUpload] Detected type: ${datasetType}`);

      // Call unified ingestion API
      const formData = new FormData();
      formData.append("file", file);
      formData.append("datasetType", datasetType);
      formData.append("mode", "append");

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
        `[FileUpload] Successfully uploaded ${result.insertedCount} rows`,
      );

      setUploadMessage(
        `✅ Successfully uploaded ${file.name} (${result.insertedCount} rows)`,
      );

      // Refresh data status
      await refreshDataStatus();
      document.dispatchEvent(new CustomEvent("data-status:refresh"));
    } catch (err) {
      console.error("[FileUpload] Error:", err);
      setUploadMessage(`❌ Upload failed: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Upload Financial Data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Upload your bank transactions, CRM data, or budget files (CSV or
              Excel).
              {selectedUseCase && (
                <span className="block mt-1 text-blue-600 font-medium">
                  Use case: {selectedUseCase}
                </span>
              )}
            </p>

            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              disabled={isProcessing}
              className="block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100
                disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              Processing...
            </div>
          )}

          {uploadMessage && (
            <div
              className={`text-sm p-3 rounded-md ${
                uploadMessage.startsWith("✅")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {uploadMessage}
            </div>
          )}

          <div className="text-xs text-gray-500 space-y-1">
            <p>
              <strong>Supported formats:</strong> CSV, XLSX, XLS
            </p>
            <p>
              <strong>File naming tips:</strong>
            </p>
            <ul className="list-disc list-inside ml-2 space-y-0.5">
              <li>Include "bank" or "transactions" for bank data</li>
              <li>Include "crm", "deals", or "sales" for CRM data</li>
              <li>Include "budget" for budget data</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
