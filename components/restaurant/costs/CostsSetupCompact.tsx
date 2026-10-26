// components/restaurant/costs/CostsSetupCompact.tsx
//
// Compact version of «Configura tus costos» for the right column: one line
// «Paso 3 de 4» with a thin progress bar and ONE next action as the button.
// The full checklist goes behind a «Ver pasos» expander. When all 4 steps are
// done, it collapses to one line «Costos configurados ✓».

"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { READ_MENU_HREF } from "./CostsSetupSection";

type SetupStep = {
  id: string;
  label: string;
  done: boolean;
  href: string | null;
  action: string;
};

type SetupData = {
  steps: SetupStep[];
  done: number;
  total: number;
  next: SetupStep | null;
  complete: boolean;
};

export function CostsSetupCompact({
  setup,
  onFileAction,
}: {
  setup: SetupData;
  onFileAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (setup.complete) {
    return (
      <section className="rounded-lg border border-[#dfe3ea] bg-white p-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#e7f6ee] text-[12px] font-bold text-[#1f7a45]">
            ✓
          </span>
          <span className="font-semibold text-[#151c2c]">
            Costos configurados
          </span>
        </div>
      </section>
    );
  }

  const progressPct = (setup.done / setup.total) * 100;

  return (
    <section className="rounded-lg border border-[#dfe3ea] bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold text-[#151c2c]">
          Paso {setup.done + 1} de {setup.total}
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] font-semibold text-[#1B40C8] hover:underline flex items-center gap-0.5"
          aria-expanded={expanded}
        >
          Ver pasos
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>

      <div className="h-1 w-full rounded-full bg-[#eef0f4] overflow-hidden">
        <div
          className="h-full bg-[#1B40C8] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {expanded ? (
        <div className="space-y-1 pt-1">
          {setup.steps.map((step, index) => (
            <div
              key={step.id}
              className="flex items-center gap-2 text-[12px] py-1"
            >
              <span
                className={
                  "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold " +
                  (step.done
                    ? "bg-[#e7f6ee] text-[#1f9d55]"
                    : "bg-[#eef0f4] text-[#4b5466]")
                }
              >
                {step.done ? "✓" : index + 1}
              </span>
              <span className="text-[#151c2c]">{step.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {setup.next ? (
        setup.next.href ? (
          <Link
            href={setup.next.href}
            className="block w-full rounded-lg bg-[#1B40C8] px-3 py-2 text-center text-[13px] font-semibold text-white hover:bg-[#1533A3]"
          >
            {setup.next.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onFileAction}
            className="w-full rounded-lg bg-[#1B40C8] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#1533A3]"
          >
            {setup.next.label}
          </button>
        )
      ) : null}

      <Link
        href={READ_MENU_HREF}
        className="block text-center text-[12px] font-semibold text-[#1B40C8] hover:underline"
      >
        Leer tu menú →
      </Link>
    </section>
  );
}
