"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import FileUpload from "@/components/dashboard/file-upload";
import { FileManagement } from "@/components/dashboard/file-management";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Upload } from "lucide-react";

export default function UploadPage() {
  const router = useRouter();
  const [pendingUpload, setPendingUpload] = useState<{
    file: File | null;
    datasetType: "bank" | "crm" | "budget" | null;
  } | null>(null);
  const [showUploadModeDialog, setShowUploadModeDialog] = useState(false);
  const [dataStatus, setDataStatus] = useState<{
    ok?: boolean;
    bank?: boolean;
    crm?: boolean;
    budget?: boolean;
  } | null>(null);

  // Check data status
  const checkUploadedData = async () => {
    try {
      const res = await fetch("/api/data/status");
      if (res.ok) {
        const json = await res.json();
        setDataStatus(json);
      }
    } catch (err) {
      console.error("Error checking data status:", err);
    }
  };

  // Upload file with specified mode
  const uploadFileWithMode = async (
    file: File,
    datasetType: "bank" | "crm" | "budget",
    mode: "overwrite" | "append"
  ) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("datasetType", datasetType);
      formData.append("mode", mode);

      const res = await fetch("/api/data/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        alert("Upload failed: " + errorText);
        return;
      }

      await res.json();
      await checkUploadedData();
      document.dispatchEvent(new CustomEvent("data-status:refresh"));
    } catch (err) {
      alert("Upload error: " + (err as Error).message);
    }
  };

  // Handle file selected from uploader
  const handleDashboardFileSelected = async (
    file: File,
    datasetType: "bank" | "crm" | "budget"
  ) => {
    const alreadyHasData =
      (datasetType === "bank" && dataStatus?.bank) ||
      (datasetType === "crm" && dataStatus?.crm) ||
      (datasetType === "budget" && dataStatus?.budget);

    if (alreadyHasData) {
      setPendingUpload({ file, datasetType });
      setShowUploadModeDialog(true);
    } else {
      await uploadFileWithMode(file, datasetType, "append");
    }
  };

  // Load data status on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkUploadedData();
  }, []);

  return (
    <div className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => router.push("/dashboard")}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-2xl font-bold">Upload Financial Data</h1>
          <p className="text-gray-600 mt-2">
            Upload your bank transactions, CRM data, and budget files to
            generate comprehensive insights
          </p>
        </div>

        <div className="space-y-6">
          <FileUpload onFileSelected={handleDashboardFileSelected} />
          <FileManagement />
        </div>
      </div>

      {/* Upload Mode Dialog */}
      {showUploadModeDialog && pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-md bg-white p-6 shadow-lg max-w-md w-full space-y-4">
            <h2 className="text-lg font-semibold">
              How should I use this file?
            </h2>
            <p className="text-sm text-gray-600">
              We detected existing data for this dataset type. Do you want to{" "}
              <strong>overwrite the existing data</strong> or treat this as a{" "}
              <strong>new dataset</strong> and review it in the Data Model
              Builder?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowUploadModeDialog(false);
                  setPendingUpload(null);
                }}
                className="rounded bg-gray-200 px-3 py-1.5 text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!pendingUpload) return;
                  await uploadFileWithMode(
                    pendingUpload.file!,
                    pendingUpload.datasetType!,
                    "overwrite"
                  );
                  setShowUploadModeDialog(false);
                  setPendingUpload(null);
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Overwrite existing data
              </button>
              <button
                onClick={async () => {
                  if (!pendingUpload) return;
                  await uploadFileWithMode(
                    pendingUpload.file!,
                    pendingUpload.datasetType!,
                    "append"
                  );
                  setShowUploadModeDialog(false);
                  setPendingUpload(null);
                  router.push("/dashboard/model");
                }}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                Treat as new dataset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
