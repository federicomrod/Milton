// components/restaurant/shell/OperatingPageHeader.tsx
//
// Compact chrome for Cockpit / Sales / Menu / Costs / Kitchen:
// title + optional date range on the left; last-synced + Sync on the right.
// Restaurant selector stays in the sidebar. Header stays short so the
// existing cockpit KPI strip still fits above the fold at 1280×800.

"use client";

import { Suspense, type ReactNode } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { formatLastSyncedAgo } from "@/lib/restaurant/last-synced";
import { DateRangeControl } from "@/components/restaurant/shell/DateRangeControl";
import { SyncNowButton } from "@/components/restaurant/shell/SyncNowButton";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { useRestaurantShellChrome } from "@/components/restaurant/shell/shell-chrome-context";

export function OperatingPageHeader({
  title,
  lang,
  showDateRange = true,
  lastSyncedAt,
  isAdmin,
  trailing,
}: {
  title: string;
  lang?: PreferredLanguage;
  showDateRange?: boolean;
  lastSyncedAt?: string | null;
  isAdmin?: boolean;
  trailing?: ReactNode;
}) {
  const chrome = useRestaurantShellChrome();
  const resolvedLang = lang ?? chrome.lang;
  const resolvedAdmin = isAdmin ?? chrome.isAdmin;
  const resolvedSync = lastSyncedAt ?? chrome.lastSyncedAt;
  const lastSynced = formatLastSyncedAgo(resolvedSync, new Date(), resolvedLang);

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
          <Suspense
            fallback={
              <PageSkeleton width="10rem" height="2rem" label="Date range" />
            }
          >
            <DateRangeControl lang={resolvedLang} />
          </Suspense>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {lastSynced ? (
          <p
            data-testid="header-last-synced"
            className="text-xs text-muted-foreground whitespace-nowrap"
          >
            {lastSynced}
          </p>
        ) : null}
        <Suspense fallback={<PageSkeleton width="4.5rem" height="2rem" />}>
          <SyncNowButton lang={resolvedLang} isAdmin={resolvedAdmin} />
        </Suspense>
        {trailing}
      </div>
    </header>
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
