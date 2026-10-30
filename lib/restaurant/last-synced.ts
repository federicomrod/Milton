// lib/restaurant/last-synced.ts
//
// Relative "Last synced 8 min ago" line for the operating-page header.
// Returns null when the POS connection has no usable timestamp so the
// UI can show nothing (never a placeholder dash).

import type { PreferredLanguage } from "@/lib/restaurant/language";
import { localeFor } from "@/lib/restaurant/language";
import { fmt, getDictionary } from "@/lib/i18n";

export function lastSyncTimestamp(lastSync: unknown): string | null {
  if (!lastSync || typeof lastSync !== "object") return null;
  const syncedAt = (lastSync as { synced_at?: unknown }).synced_at;
  if (typeof syncedAt !== "string" || syncedAt.trim() === "") return null;
  const when = new Date(syncedAt);
  if (Number.isNaN(when.getTime())) return null;
  return syncedAt;
}

export function formatLastSyncedAgo(
  syncedAt: string | null | undefined,
  now: Date = new Date(),
  lang: PreferredLanguage = "es"
): string | null {
  if (!syncedAt) return null;
  const when = new Date(syncedAt);
  if (Number.isNaN(when.getTime())) return null;

  const d = getDictionary(lang).shell.lastSynced;
  const diffMs = Math.max(0, now.getTime() - when.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return d.now;
  if (minutes < 60) return fmt(d.minutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fmt(d.hours, { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return fmt(d.days, { n: days });
  const dateLabel = when.toLocaleDateString(localeFor(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return fmt(d.date, { date: dateLabel });
}
