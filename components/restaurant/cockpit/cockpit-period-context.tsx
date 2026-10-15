// components/restaurant/cockpit/cockpit-period-context.tsx
//
// Shared period selection for the cockpit client island. The toggle and
// the cost cells read this so a click does not wait on a server render.

"use client";

import { createContext, useContext } from "react";
import type { CockpitPeriodPreset } from "@/lib/restaurant/cockpit-period";
import type { CockpitExecutivesByPeriod } from "@/lib/restaurant/cockpit-page-data";

export type CockpitPeriodContextValue = {
  preset: CockpitPeriodPreset;
  pending: boolean;
  executives: CockpitExecutivesByPeriod;
  selectPeriod: (preset: CockpitPeriodPreset) => void;
};

export const CockpitPeriodContext =
  createContext<CockpitPeriodContextValue | null>(null);

export function useCockpitPeriodOptional(): CockpitPeriodContextValue | null {
  return useContext(CockpitPeriodContext);
}
