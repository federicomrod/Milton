"use client";

import { useState, useEffect, startTransition } from "react";

export type DateRangePeriod = "month" | "year" | "ytd" | "custom";

export interface DateRange {
  period: DateRangePeriod;
  customDateRange: { from: string; to: string };
}

const STORAGE_KEY = "dashboard-date-range";

function getDefaultDateRange(): DateRange {
  return {
    period: "custom",
    customDateRange: {
      from: new Date(new Date().setDate(new Date().getDate() - 90))
        .toISOString()
        .split("T")[0],
      to: new Date().toISOString().split("T")[0],
    },
  };
}

function readFromStorage(): DateRange | null {
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
    // sessionStorage is unavailable (SSR or private mode)
  }
  return null;
}

export function useDateRange() {
  // Initialize with the same default the server renders — avoids SSR/client
  // hydration mismatch because sessionStorage is not available on the server.
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);
  const [hydrated, setHydrated] = useState(false);

  // After mount, restore any previously saved range from sessionStorage.
  // Wrapped in startTransition so the setState call is inside a callback,
  // satisfying react-hooks/set-state-in-effect (eslint-plugin-react-hooks v7+).
  useEffect(() => {
    const stored = readFromStorage();
    startTransition(() => {
      if (stored) setDateRange(stored);
      setHydrated(true);
    });
  }, []);

  // Persist changes to sessionStorage (only after hydration to avoid SSR noise).
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dateRange));
    } catch {
      // ignore storage errors
    }
  }, [dateRange, hydrated]);

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
