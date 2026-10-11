// lib/restaurant/last-synced.ts
//
// Relative "Last synced 8 min ago" line for the operating-page header.
// Returns null when the POS connection has no usable timestamp so the
// UI can show nothing (never a placeholder dash).

import type { PreferredLanguage } from "@/lib/restaurant/language";
import { t } from "@/lib/restaurant/language";

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
  lang: PreferredLanguage = "en"
): string | null {
  if (!syncedAt) return null;
  const when = new Date(syncedAt);
  if (Number.isNaN(when.getTime())) return null;

  const diffMs = Math.max(0, now.getTime() - when.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return t(lang, "Last synced just now", "Sincronizado ahora");
  }
  if (minutes < 60) {
    return t(
      lang,
      `Last synced ${minutes} min ago`,
      `Sincronizado hace ${minutes} min`
    );
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t(
      lang,
      `Last synced ${hours} hr ago`,
      `Sincronizado hace ${hours} h`
    );
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return t(
      lang,
      `Last synced ${days}d ago`,
      `Sincronizado hace ${days} d`
    );
  }
  const locale = lang === "es" ? "es" : "en-GB";
  const dateLabel = when.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return t(lang, `Last synced ${dateLabel}`, `Sincronizado ${dateLabel}`);
}
