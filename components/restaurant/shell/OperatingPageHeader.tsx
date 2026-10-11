// components/restaurant/shell/OperatingPageHeader.tsx
//
// Compact chrome for Cockpit / Sales / Menu / Costs / Kitchen:
// title + optional shown period on the left; last-synced + Sync on the right.
// The period chip is the span of loaded data, not a working filter.

"use client";

import { Suspense, useSyncExternalStore, type ReactNode } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { formatLastSyncedAgo } from "@/lib/restaurant/last-synced";
import type { PageDateRange } from "@/lib/restaurant/page-date-range";
import { DateRangeControl } from "@/components/restaurant/shell/DateRangeControl";
import { SyncNowButton } from "@/components/restaurant/shell/SyncNowButton";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { useRestaurantShellChrome } from "@/components/restaurant/shell/shell-chrome-context";

export function OperatingPageHeader({
  title,
  lang,
  showDateRange = true,
  shownRange = null,
  lastSyncedAt,
  isAdmin,
  trailing,
}: {
  title: string;
  lang?: PreferredLanguage;
  showDateRange?: boolean;
  shownRange?: PageDateRange | null;
  lastSyncedAt?: string | null;
  isAdmin?: boolean;
  trailing?: ReactNode;
}) {
  const chrome = useRestaurantShellChrome();
  const resolvedLang = lang ?? chrome.lang;
  const resolvedAdmin = isAdmin ?? chrome.isAdmin;
  const resolvedSync = lastSyncedAt ?? chrome.lastSyncedAt;

  return (
    <header
      data-testid="operating-page-header"
      className="flex items-center justify-between gap-3 flex-wrap min-h-10"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <h1 className="text-lg font-semibold tracking-tight truncate">
          {title}
        </h1>
        {showDateRange ? (
          <DateRangeControl lang={resolvedLang} range={shownRange} />
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <LastSyncedLabel syncedAt={resolvedSync} lang={resolvedLang} />
        <Suspense fallback={<PageSkeleton width="4.5rem" height="2rem" />}>
          <SyncNowButton lang={resolvedLang} isAdmin={resolvedAdmin} />
        </Suspense>
        {trailing}
      </div>
    </header>
  );
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function LastSyncedLabel({
  syncedAt,
  lang,
}: {
  syncedAt: string | null;
  lang: PreferredLanguage;
}) {
  const isClient = useIsClient();
  if (!isClient) return null;
  const label = formatLastSyncedAgo(syncedAt, new Date(), lang);
  if (!label) return null;
  return (
    <p
      data-testid="header-last-synced"
      className="text-xs text-muted-foreground whitespace-nowrap"
    >
      {label}
    </p>
  );
}

export function operatingPageTitle(
  page: "cockpit" | "sales" | "menu" | "costs" | "kitchen",
  lang: PreferredLanguage
): string {
  switch (page) {
    case "cockpit":
      return t(lang, "Cockpit", "Cockpit");
    case "sales":
      return t(lang, "Sales", "Ventas");
    case "menu":
      return t(lang, "Menu", "Menú");
    case "costs":
      return t(lang, "Costs", "Costos");
    case "kitchen":
      return t(lang, "Kitchen", "Cocina");
  }
}
