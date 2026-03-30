"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type ComparisonMode =
  | "none"
  | "prev_period"
  | "prev_year"
  | "trailing_12m"
  | "target";

interface ComparisonContextValue {
  comparisonMode: ComparisonMode;
  setComparisonMode: (mode: ComparisonMode) => void;
}

const ComparisonContext = createContext<ComparisonContextValue>({
  comparisonMode: "none",
  setComparisonMode: () => {},
});

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("none");
  return (
    <ComparisonContext.Provider value={{ comparisonMode, setComparisonMode }}>
      {children}
    </ComparisonContext.Provider>
  );
}

export function useComparison() {
  return useContext(ComparisonContext);
}
