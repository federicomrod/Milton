"use client";

import { DeleteConfirmationDialog } from "@/components/management/delete-confirmation-dialog";

interface DeleteScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemCount: number;
  onConfirm: () => void;
}

export function DeleteScenarioDialog({
  open,
  onOpenChange,
  itemCount,
  onConfirm,
}: DeleteScenarioDialogProps) {
  return (
    <DeleteConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      title={
        itemCount === 1 ? "Delete scenario?" : `Delete ${itemCount} scenarios?`
      }
      description={
        itemCount === 1
          ? "This scenario will be permanently deleted. This action cannot be undone."
          : `These ${itemCount} scenarios will be permanently deleted. This action cannot be undone.`
      }
    />
  );
}
