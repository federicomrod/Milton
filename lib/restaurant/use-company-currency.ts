"use client";

import { useEffect, useState } from "react";
import {
  FALLBACK_CURRENCY,
  normalizeCurrency,
} from "@/lib/restaurant/currency";

/**
 * Loads the company currency for client forms (cost/POS upload dropdowns).
 * Server create paths still resolve currency themselves — this is display
 * and the form default only.
 */
export function useCompanyCurrency(initial?: string): string {
  const [currency, setCurrency] = useState(
    normalizeCurrency(initial) ?? FALLBACK_CURRENCY
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/restaurant/currency", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { currency?: unknown } | null) => {
        if (cancelled) return;
        const next = normalizeCurrency(body?.currency);
        if (next) setCurrency(next);
      })
      .catch(() => {
        // Keep the last known / fallback currency.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return currency;
}
