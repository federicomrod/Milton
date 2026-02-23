"use client";

import { useState, useEffect } from "react";

export type DateRangePeriod = "month" | "year" | "ytd" | "custom";

export interface DateRange {
  period: DateRangePeriod;
  customDateRange: { from: string; to: string };
}

const STORAGE_KEY = "dashboard-date-range";

const getDefaultDateRange = (): DateRange => ({
  period: "custom",
  customDateRange: {
    from: new Date(new Date().setDate(new Date().getDate() - 90))
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  },
});

const readFromStorage = (): DateRange | null => {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (
        parsed?.period &&
        parsed?.customDateRange?.from &&
        parsed?.customDateRange?.to
      ) {
        return parsed as DateRange;
      }
    }
  } catch {
    // ignore
  }
  return null;
};

export function useDateRange() {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);

  // Hydrate from sessionStorage on mount (avoids SSR mismatch)
  useEffect(() => {
    const stored = readFromStorage();
    if (stored) setDateRange(stored);
  }, []);

  // Persist to sessionStorage whenever the range changes
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dateRange));
    } catch {
      // ignore storage errors
    }
  }, [dateRange]);

  const setPeriod = (period: DateRangePeriod) => {
    setDateRange((prev) => ({ ...prev, period }));
  };

  const setCustomDateRange = (customDateRange: {
    from: string;
    to: string;
  }) => {
    setDateRange({ period: "custom", customDateRange });
  };

  return {
    period: dateRange.period,
    customDateRange: dateRange.customDateRange,
    setPeriod,
    setCustomDateRange,
  };
}
