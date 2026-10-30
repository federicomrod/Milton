// lib/restaurant/odoo/sync-control.ts
//
// Date presets and the in-flight guard for the admin Sync now control.
// Kept separate from the summary helpers so the double-submit tests stay
// focused on one module.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";

export type SyncDatePreset =
  | "yesterday"
  | "last_7_days"
  | "this_month"
  | "last_month";

export const SYNC_DATE_PRESETS: Array<{
  id: SyncDatePreset;
  label: string;
}> = [
  { id: "yesterday", label: "Ayer" },
  { id: "last_7_days", label: "Últimos 7 días" },
  { id: "this_month", label: "Este mes" },
  { id: "last_month", label: "Mes pasado" },
];

/** The preset's label in the person's language (Spanish by default). */
export function syncPresetLabel(
  id: SyncDatePreset,
  lang: PreferredLanguage = "es"
): string {
  switch (id) {
    case "yesterday":
      return t(lang, "Yesterday", "Ayer", "Gestern");
    case "last_7_days":
      return t(lang, "Last 7 days", "Últimos 7 días", "Letzte 7 Tage");
    case "this_month":
      return t(lang, "This month", "Este mes", "Dieser Monat");
    default:
      return t(lang, "Last month", "Mes pasado", "Letzter Monat");
  }
}

export const DEFAULT_SYNC_PRESET: SyncDatePreset = "last_7_days";

/** Inclusive last 31 days ending today — header Sync's own default. */
export function defaultSyncWindow(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const today = startOfLocalDay(now);
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  return { start: formatYmd(start), end: formatYmd(today) };
}

export function formatYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function rangeForPreset(
  preset: SyncDatePreset,
  now: Date = new Date()
): { start: string; end: string } {
  const today = startOfLocalDay(now);
  if (preset === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: formatYmd(yesterday), end: formatYmd(yesterday) };
  }
  if (preset === "last_7_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: formatYmd(start), end: formatYmd(today) };
  }
  if (preset === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: formatYmd(start), end: formatYmd(today) };
  }
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0);
  return { start: formatYmd(start), end: formatYmd(end) };
}

export interface InFlightGuard {
  isInFlight(): boolean;
  run<T>(
    fn: () => Promise<T>
  ): Promise<{ started: false } | { started: true; value: T }>;
}

/** Drops overlapping calls so a double-click cannot start two syncs. */
export function createInFlightGuard(): InFlightGuard {
  let inFlight = false;
  return {
    isInFlight() {
      return inFlight;
    },
    async run<T>(fn: () => Promise<T>) {
      if (inFlight) return { started: false as const };
      inFlight = true;
      try {
        return { started: true as const, value: await fn() };
      } finally {
        inFlight = false;
      }
    },
  };
}
