"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast-context";
import {
  Trash2,
  RefreshCw,
  FileText,
  Database,
  DollarSign,
  Replace,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getIndividualUploadedFiles,
  deleteIndividualFile,
} from "@/lib/data-service";

interface FileData {
  id: string;
  fileName: string;
  type: "transactions" | "deals" | "budgets";
  label: string;
  count: number;
  icon: any;
  color: string;
  uploadedAt: string;
}

interface FileManagementProps {
  onReplaceClick?: (type: "transactions" | "deals" | "budgets") => void;
}

export function FileManagement({ onReplaceClick }: FileManagementProps = {}) {
  const [files, setFiles] = useState<FileData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    file: FileData | null;
    action: "delete" | "replace" | null;
  }>({ open: false, file: null, action: null });
  const { toast } = useToast();

  const fetchFiles = useCallback(async () => {
    // Prevent concurrent fetches
    if (isFetching) {
      console.log("[FileManagement] Fetch already in progress, skipping...");
      return;
    }

    setIsFetching(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        console.warn("⚠️ No authenticated user found");
        setFiles([]);
        setIsLoading(false);
        return;
      }

      // Fetch individual uploaded files
      const uploadedFiles = await getIndividualUploadedFiles(supabase, user.id);

      console.log(
        `[FileManagement] Fetched ${uploadedFiles.length} individual files`
      );

      // Map uploaded files to FileData with icons and colors
      const fileData: FileData[] = uploadedFiles.map((file) => {
        let type: "transactions" | "deals" | "budgets";
        let icon: any;
        let color: string;
        let label: string;

        switch (file.dataset_type) {
          case "bank":
            type = "transactions";
            icon = DollarSign;
            color =
              "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
            label = "Bank Transactions";
            break;
          case "crm":
            type = "deals";
            icon = FileText;
            color =
              "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
            label = "CRM Data";
            break;
          case "budget":
            type = "budgets";
            icon = Database;
            color =
              "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
            label = "Budget Data";
            break;
          default:
            type = "transactions";
            icon = FileText;
            color =
              "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
            label = "Unknown";
        }

        return {
          id: file.id,
          fileName: file.file_name,
          type,
          label,
          count: file.row_count,
          icon,
          color,
          uploadedAt: file.uploaded_at,
        };
      });

      // Update state with fetched data
      setFiles(fileData);
    } catch (error) {
      console.error("❌ Failed to fetch files:", error);
      setFiles([]);
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [isFetching]);

  const handleDeleteClick = (file: FileData) => {
    setConfirmDialog({ open: true, file, action: "delete" });
  };

  const handleReplaceClick = (file: FileData) => {
    setConfirmDialog({ open: true, file, action: "replace" });
  };

  const deleteFile = async () => {
    if (!confirmDialog.file || !confirmDialog.action) return;

    const file = confirmDialog.file;
    const action = confirmDialog.action;

    // For replace action, don't delete yet - just trigger upload and pass file ID
    if (action === "replace") {
      // Map file type to dataset type
      const datasetType =
        file.type === "deals"
          ? "crm"
          : file.type === "budgets"
            ? "budget"
            : "bank";

      // Close dialog first
      setConfirmDialog({ open: false, file: null, action: null });

      // Trigger file upload for this dataset type and pass the file ID to replace
      if (onReplaceClick) {
        onReplaceClick(file.type);
      } else {
        // Dispatch event with file ID so FileUpload can delete it after successful upload
        window.dispatchEvent(
          new CustomEvent("file-upload:replace", {
            detail: { datasetType, fileIdToReplace: file.id },
          })
        );
      }
      return;
    }

    // For delete action, proceed with deletion
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast({
          title: "Error",
          description: "No authenticated user found",
          variant: "destructive",
        });
        return;
      }

      // Delete individual file by upload_file_id
      const result = await deleteIndividualFile(supabase, user.id, file.id);

      if (result.success) {
        toast({
          title: "Success",
          description: `Successfully deleted ${file.fileName}`,
        });

        await fetchFiles(); // Refresh the list

        // Also clear localStorage cache if it exists
        const localKey = file.type === "deals" ? "crmDeals" : file.type;
        localStorage.removeItem(localKey);
      } else {
        toast({
          title: "Error",
          description: `Failed to delete ${file.fileName}: ${result.error}`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("❌ Delete operation failed:", error);
      toast({
        title: "Error",
        description: "Failed to delete file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setConfirmDialog({ open: false, file: null, action: null });
    }
  };

  const refreshFiles = async () => {
    setIsRefreshing(true);
    await fetchFiles();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  useEffect(() => {
    let isMounted = true;

    const fetchFilesSafely = async () => {
      if (!isMounted) return;
      await fetchFiles();
    };

    fetchFilesSafely();

    const handleRefresh = () => {
      if (isMounted) {
        fetchFilesSafely();
      }
    };

    window.addEventListener("data-status:refresh", handleRefresh);

    // Refresh every 30 seconds to pick up new uploads (reduced frequency)
    const interval = setInterval(() => {
      if (isMounted) {
        fetchFilesSafely();
      }
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener("data-status:refresh", handleRefresh);
    };
  }, [fetchFiles]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">File Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <RefreshCw className="h-12 w-12 mx-auto mb-4 text-gray-300 dark:text-gray-600 animate-spin" />
            <p className="text-sm">Loading file data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">File Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-gray-100">
              No Files Uploaded
            </h3>
            <p className="text-sm">
              Upload your financial data files to get started.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">File Management</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshFiles}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {files.map((file) => {
            const Icon = file.icon;
            const uploadedDate = new Date(file.uploadedAt);
            return (
              <div
                key={file.id}
                className="flex items-center justify-between p-4 border border-gray-200 dark:!border-gray-700 rounded-lg !bg-white dark:!bg-gray-900 hover:shadow-sm dark:hover:shadow-sm dark:hover:bg-gray-800 transition-shadow"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <Badge
                    variant="secondary"
                    className={`${file.color} flex items-center gap-1 flex-shrink-0`}
                  >
                    <Icon className="h-3 w-3" />
                    {file.label}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                      {file.fileName}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span
                        className={`text-xs ${file.count === 0 ? "text-gray-400 dark:text-gray-500 italic" : "text-gray-600 dark:text-gray-400"}`}
                      >
                        {file.count === 0
                          ? "No records"
                          : `${file.count.toLocaleString()} ${file.count === 1 ? "record" : "records"}`}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        • {uploadedDate.toLocaleDateString()}{" "}
                        {uploadedDate.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReplaceClick(file)}
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-950/20"
                  >
                    <Replace className="h-4 w-4 mr-1" />
                    Replace
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteClick(file)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/20"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 p-3 bg-blue-50 dark:!bg-blue-950/40 border border-blue-200 dark:!border-blue-900 rounded-lg">
          <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            File Management Tips:
          </h4>
          <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
            <li>• Delete files to remove them from the system</li>
            <li>• Upload new files to replace existing ones</li>
            <li>• Charts and metrics will update automatically</li>
            <li>• Use the refresh button to check for new uploads</li>
          </ul>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          setConfirmDialog({
            open,
            file: open ? confirmDialog.file : null,
            action: open ? confirmDialog.action : null,
          })
        }
        title={
          confirmDialog.action === "replace" ? "Replace File" : "Delete File"
        }
        description={
          confirmDialog.file
            ? confirmDialog.action === "replace"
              ? `This will replace "${confirmDialog.file.fileName}" (${confirmDialog.file.count.toLocaleString()} records) with a new file. The old file will only be deleted after a successful upload. Are you sure you want to continue?`
              : `Are you sure you want to delete "${confirmDialog.file.fileName}"? This will permanently remove ${confirmDialog.file.count.toLocaleString()} records. This action cannot be undone.`
            : ""
        }
        confirmText={confirmDialog.action === "replace" ? "Replace" : "Delete"}
        cancelText="Cancel"
        variant="destructive"
        onConfirm={deleteFile}
      />
    </Card>
  );
}
