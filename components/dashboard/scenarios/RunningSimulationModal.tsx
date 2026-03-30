"use client";

import { useState, useEffect } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type SimulationStepStatus = "pending" | "active" | "completed";

interface Step {
  id: number;
  label: string;
  status: SimulationStepStatus;
}

const INITIAL_STEPS: Step[] = [
  { id: 1, label: "Preparing data", status: "active" },
  { id: 2, label: "Applying scenario assumptions", status: "pending" },
  { id: 3, label: "Calculating projections", status: "pending" },
  { id: 4, label: "Finalizing results", status: "pending" },
];

interface RunningSimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when simulation completes successfully */
  onComplete?: () => void;
  /** Called when user confirms cancel */
  onCancel?: () => void;
}

const STEP_DELAYS_MS = [1500, 3000, 4500, 6000];

export function RunningSimulationModal({
  open,
  onOpenChange,
  onComplete,
  onCancel,
}: RunningSimulationModalProps) {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // Run step progression when modal opens
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setSteps(INITIAL_STEPS);
        setShowCancelDialog(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    timeouts.push(
      setTimeout(() => {
        setSteps((prev) =>
          prev.map((step) =>
            step.id === 1
              ? { ...step, status: "completed" as const }
              : step.id === 2
                ? { ...step, status: "active" as const }
                : step
          )
        );
      }, STEP_DELAYS_MS[0])
    );

    timeouts.push(
      setTimeout(() => {
        setSteps((prev) =>
          prev.map((step) =>
            step.id === 2
              ? { ...step, status: "completed" as const }
              : step.id === 3
                ? { ...step, status: "active" as const }
                : step
          )
        );
      }, STEP_DELAYS_MS[1])
    );

    timeouts.push(
      setTimeout(() => {
        setSteps((prev) =>
          prev.map((step) =>
            step.id === 3
              ? { ...step, status: "completed" as const }
              : step.id === 4
                ? { ...step, status: "active" as const }
                : step
          )
        );
      }, STEP_DELAYS_MS[2])
    );

    timeouts.push(
      setTimeout(() => {
        setSteps((prev) =>
          prev.map((step) =>
            step.id === 4 ? { ...step, status: "completed" as const } : step
          )
        );
        onComplete?.();
        onOpenChange(false);
      }, STEP_DELAYS_MS[3])
    );

    return () => timeouts.forEach((t) => clearTimeout(t));
  }, [open, onComplete, onOpenChange]);

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const totalSteps = steps.length;
  const progressPercentage =
    totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  const handleCancelClick = () => {
    setShowCancelDialog(true);
  };

  const handleConfirmCancel = () => {
    setShowCancelDialog(false);
    onOpenChange(false);
    onCancel?.();
  };

  const handleRequestClose = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setShowCancelDialog(true);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (o) onOpenChange(o);
          else setShowCancelDialog(true);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-md w-full p-8 animate-in fade-in-0 zoom-in-95 duration-200"
          onInteractOutside={handleRequestClose}
          onEscapeKeyDown={handleRequestClose}
        >
          <DialogHeader className="text-center mb-8">
            <DialogTitle className="text-xl text-foreground">
              Running simulation
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2">
              We're calculating projections based on your assumptions.
            </DialogDescription>
          </DialogHeader>

          {/* Progress bar */}
          <div className="mb-8">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-4 mb-8">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-3">
                <div className="shrink-0">
                  {step.status === "completed" ? (
                    <div className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center">
                      <Check className="h-4 w-4 text-white" />
                    </div>
                  ) : step.status === "active" ? (
                    <div
                      className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full border-2 border-border bg-muted/30" />
                  )}
                </div>
                <span
                  className={
                    step.status === "completed"
                      ? "text-foreground font-medium"
                      : step.status === "active"
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                  }
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>

          <p className="text-center text-muted-foreground text-sm mb-8">
            This usually takes a few seconds.
          </p>

          <div className="flex flex-col items-center gap-3">
            <Button
              disabled
              className="w-full opacity-60 cursor-not-allowed gap-2"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Running…
            </Button>
            <button
              type="button"
              onClick={handleCancelClick}
              className="text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel simulation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel? Your progress will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-destructive hover:bg-destructive/90"
            >
              Yes, cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
