// components/restaurant/costs/MobileSetupBanner.tsx
//
// Mobile setup banner: a slim banner that only appears while setup is incomplete,
// showing «Paso 3 de 4 · Leer tu menú ›» (tappable, opening the steps in an
// expander or bottom sheet).

"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { READ_MENU_HREF } from "./CostsSetupSection";
import { READ_MENU_LABEL } from "@/lib/restaurant/ui-copy";

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

export function MobileSetupBanner({
  setup,
  onFileAction,
}: {
  setup: SetupData;
  onFileAction: () => void;
}) {
  const { d, fmt } = useT();
  const s = d.costs.setup;
  const [showSteps, setShowSteps] = useState(false);

  if (setup.complete) {
    return null;
  }

  const progressPct = (setup.done / setup.total) * 100;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowSteps(!showSteps)}
        className="w-full rounded-lg border border-[#dbe3f7] bg-[#f6f8fe] px-4 py-2.5 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-[#151c2c]">
            {fmt(s.readyCount, { done: setup.done, total: setup.total })}
          </span>
          {setup.next ? (
            <span className="text-[12px] text-[#4a5a85] truncate">
              {setup.next.label} ›
            </span>
          ) : null}
        </div>
        <div className="h-1 w-full rounded-full bg-[#dbe3f7] overflow-hidden mt-2">
          <div
            className="h-full bg-[#1B40C8] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </button>

      {showSteps ? (
        <div className="rounded-lg border border-[#dfe3ea] bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-[#151c2c]">
              {s.configureShort}
            </h3>
            <button
              type="button"
              onClick={() => setShowSteps(false)}
              className="text-[12px] font-semibold text-[#1B40C8]"
            >
              {s.close}
            </button>
          </div>

          <div className="space-y-2">
            {setup.steps.map((step, index) => (
              <div
                key={step.id}
                className="flex items-center gap-2.5 text-[13px]"
              >
                <span
                  className={
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold " +
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

          {setup.next ? (
            setup.next.href ? (
              <Link
                href={setup.next.href}
                className="block w-full rounded-lg bg-[#1B40C8] px-4 py-2.5 text-center text-[14px] font-semibold text-white"
              >
                {setup.next.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowSteps(false);
                  onFileAction();
                }}
                className="w-full rounded-lg bg-[#1B40C8] px-4 py-2.5 text-[14px] font-semibold text-white"
              >
                {setup.next.label}
              </button>
            )
          ) : null}

          <Link
            href={READ_MENU_HREF}
            className="block text-center text-[13px] font-semibold text-[#1B40C8] hover:underline"
          >
            {READ_MENU_LABEL}
          </Link>
        </div>
      ) : null}
    </>
  );
}
