"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export interface DashboardKpiEntry {
  name: string;
  value: number | null;
  unit?: string;
}

interface DashboardKpisContextValue {
  kpis: DashboardKpiEntry[];
  setDashboardKpis: (kpis: DashboardKpiEntry[]) => void;
}

const DashboardKpisContext = createContext<DashboardKpisContextValue>({
  kpis: [],
  setDashboardKpis: () => {},
});

export function DashboardKpisProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [kpis, setKpis] = useState<DashboardKpiEntry[]>([]);
  const setDashboardKpis = useCallback((k: DashboardKpiEntry[]) => {
    setKpis(k);
  }, []);
  return (
    <DashboardKpisContext.Provider value={{ kpis, setDashboardKpis }}>
      {children}
    </DashboardKpisContext.Provider>
  );
}

export function useDashboardKpis() {
  return useContext(DashboardKpisContext);
}
