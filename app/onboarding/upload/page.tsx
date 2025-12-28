"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import FileUpload from "@/components/dashboard/file-upload";
import { FileManagement } from "@/components/dashboard/file-management";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { updateOnboardingStatus } from "@/lib/onboarding-status";

export default function OnboardingUploadPage() {
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
  const [hasUploaded, setHasUploaded] = useState(false);

  // Check data status
  const checkUploadedData = async () => {
    try {
      const res = await fetch("/api/data/status");
      if (res.ok) {
        const json = await res.json();
        setDataStatus(json);
        // Check if user has uploaded any data
        const hasData = !!(json?.bank || json?.crm || json?.budget);
        setHasUploaded(hasData);
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
      setHasUploaded(true);
    } catch (err) {
      alert("Upload error: " + (err as Error).message);
    }
  };

  // Handle file selected from uploader
  const handleFileSelected = async (
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

  const handleContinue = async () => {
    // Update onboarding status to model
    await updateOnboardingStatus("model");
    router.push("/onboarding/model");
  };

  // Load data status on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkUploadedData();
  }, []);

  // Listen for data status refresh events
  useEffect(() => {
    const handleRefresh = () => {
      checkUploadedData();
    };
    document.addEventListener("data-status:refresh", handleRefresh);
    return () => {
      document.removeEventListener("data-status:refresh", handleRefresh);
    };
  }, []);

  // Check if user has uploaded at least one file
  const hasUploadedAnyFile = !!(
    dataStatus?.bank ||
    dataStatus?.crm ||
    dataStatus?.budget
  );

  return (
    <div className="min-h-screen bg-background max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">
            Upload Your Data
          </h1>
          <p className="text-muted-foreground mt-2">
            Upload your bank transactions, CRM data, and budget files. You can
            skip this step and upload later if you prefer.
          </p>
        </div>

        <div className="space-y-6">
          <FileUpload onFileSelected={handleFileSelected} />
          <FileManagement />
        </div>

        <div className="flex justify-between items-center mt-8 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => router.push("/onboarding/kpi-selection")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={handleContinue} disabled={!hasUploadedAnyFile}>
              Continue to Model Customization
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            {!hasUploadedAnyFile && (
              <p className="text-xs text-muted-foreground">
                Upload at least one file to continue
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Upload Mode Dialog */}
      {showUploadModeDialog && pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-md bg-card border border-border p-6 shadow-lg max-w-md w-full space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              How should I use this file?
            </h2>
            <p className="text-sm text-muted-foreground">
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
                className="rounded bg-muted px-3 py-1.5 text-sm hover:bg-muted/80 text-foreground"
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
