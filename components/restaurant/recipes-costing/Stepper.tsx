"use client";

import type {
  RecipeCostingView,
  StepperStep,
} from "@/lib/restaurant/recipe-costing/workspace";

const STEP_VIEW: Record<StepperStep["id"], RecipeCostingView> = {
  1: "resumen",
  2: "vincular",
  3: "validar",
  4: "menu-costeado",
};

export function Stepper({
  steps,
  onOpen,
}: {
  steps: StepperStep[];
  onOpen: (view: RecipeCostingView) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          onClick={() => onOpen(STEP_VIEW[step.id])}
          className={
            "flex gap-2.5 rounded-[10px] border p-2.5 text-left " +
            (step.state === "cur"
              ? "border-[#f5c98b] bg-[#fffaf3]"
              : "border-[#eef0f4]")
          }
        >
          <div
            className={
              "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-bold " +
              (step.state === "done"
                ? "bg-[#1f9d55] text-white"
                : step.state === "cur"
                  ? "bg-[#f28c28] text-white"
                  : "bg-[#eef0f4] text-[#6b7385]")
            }
          >
            {step.state === "done" ? "✓" : step.id}
          </div>
          <div>
            <div className="text-[12.5px] font-semibold">{step.title}</div>
            <div className="mt-0.5 text-[11px] text-[#5b6476]">
              {step.detail}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
