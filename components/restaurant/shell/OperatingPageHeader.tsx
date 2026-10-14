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
import { useAskMiltonController } from "@/components/restaurant/shell/ask-milton-controller";

export function OperatingPageHeader({
  title,
  lang,
  showDateRange = true,
  shownRange = null,
  dateRange,
  lastSyncedAt,
  isAdmin,
  trailing,
}: {
  title: string;
  lang?: PreferredLanguage;
  showDateRange?: boolean;
  shownRange?: PageDateRange | null;
  /** Replaces the read-only period chip (Cockpit period toggle). */
  dateRange?: ReactNode;
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
        {showDateRange
          ? (dateRange ?? (
              <DateRangeControl lang={resolvedLang} range={shownRange} />
            ))
          : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <LastSyncedLabel syncedAt={resolvedSync} lang={resolvedLang} />
        <Suspense fallback={<PageSkeleton width="4.5rem" height="2rem" />}>
          <SyncNowButton lang={resolvedLang} isAdmin={resolvedAdmin} />
        </Suspense>
        {trailing}
        <AskMiltonHeaderButton lang={resolvedLang} />
      </div>
    </header>
  );
}

/** The one "✦ Preguntar a Milton" (R1-09b, A2): top right, every page. */
function AskMiltonHeaderButton({ lang }: { lang: PreferredLanguage }) {
  const { openAskMilton } = useAskMiltonController();
  return (
    <button
      type="button"
      onClick={() => openAskMilton()}
      className="hidden lg:inline-flex h-8 items-center rounded-lg bg-[#151c2c] px-3 text-xs font-semibold text-white hover:bg-[#26314a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      ✦ {t(lang, "Ask Milton", "Preguntar a Milton")}
    </button>
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
