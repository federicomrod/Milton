"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, AlertTriangle } from "lucide-react";

interface FileNameConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  existingFile: {
    uploadedAt: string;
    rowCount: number;
    datasetType: string;
  } | null;
  onContinue: () => void;
  onCancel: () => void;
}

export function FileNameConfirmationDialog({
  open,
  onOpenChange,
  fileName,
  existingFile,
  onContinue,
  onCancel,
}: FileNameConfirmationDialogProps) {
  if (!existingFile) return null;

  const uploadedDate = new Date(existingFile.uploadedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent className="!bg-white dark:!bg-gray-950">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            File Already Exists
          </DialogTitle>
          <DialogDescription>
            A file with the name &quot;{fileName}&quot; has been uploaded
            before.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert className="bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800">
            <FileText className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            <AlertDescription className="text-orange-800 dark:text-orange-300">
              <strong>Previous upload:</strong>{" "}
              {uploadedDate.toLocaleDateString()} at{" "}
              {uploadedDate.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              <br />
              <strong>
                Records:
              </strong> {existingFile.rowCount.toLocaleString()}{" "}
              {existingFile.rowCount === 1 ? "record" : "records"}
              <br />
              <strong>Type:</strong>{" "}
              {existingFile.datasetType === "bank"
                ? "Transactions"
                : existingFile.datasetType === "crm"
                  ? "CRM Deals"
                  : "Budget"}
            </AlertDescription>
          </Alert>

          <p className="text-sm text-gray-600 dark:text-gray-400">
            If you continue, the new file will replace the existing one. This
            action cannot be undone.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={onContinue}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Continue & Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
