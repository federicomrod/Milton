// components/restaurant/cockpit/CockpitTabs.tsx
//
// Sticky tab shell for the restaurant cockpit. Each tab receives a
// pre-rendered ReactNode as its `content` — server components can be
// passed in directly from the page, which keeps the heavy lifting on
// the server while only the tab-switching state lives client-side.
//
// State is kept in-memory only (no hash/query-param sync) for the MVP
// per the task brief.

"use client";

import { useState } from "react";

export interface CockpitTab {
  id: string;
  label: string;
  /** Optional tag rendered after the label (e.g. issue count). */
  badge?: string;
  content: React.ReactNode;
}

export function CockpitTabs({
  tabs,
  defaultTab,
  value,
  onChange,
}: {
  tabs: CockpitTab[];
  defaultTab?: string;
  /** Optional controlled value. When provided the component becomes a
   *  controlled tab strip and the parent owns the active state. */
  value?: string;
  onChange?: (id: string) => void;
}) {
  const [internalActive, setInternalActive] = useState<string>(
    defaultTab ?? tabs[0]?.id ?? ""
  );
  const active = value ?? internalActive;
  const setActive = (id: string) => {
    if (value === undefined) setInternalActive(id);
    onChange?.(id);
  };

  const activeContent = tabs.find((t) => t.id === active)?.content;

  return (
    <div>
      {/* Sticky sub-navigation. We bleed it edge-to-edge of the page
          padding with negative margins so the bottom border feels like
          a real navigation bar, not a centered chip row. */}
      <div className="sticky top-0 z-20 -mx-6 lg:-mx-10 px-6 lg:px-10 mb-6 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <nav
          className="flex gap-1 overflow-x-auto"
          aria-label="Cockpit sections"
          role="tablist"
        >
          {tabs.map((t) => {
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(t.id)}
                className={
                  "flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-t-sm " +
                  (isActive
                    ? "border-orange-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30")
                }
              >
                <span>{t.label}</span>
                {t.badge && (
                  <span
                    className={
                      "text-[10px] tabular-nums rounded-full px-1.5 py-0.5 font-semibold " +
                      (isActive
                        ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200"
                        : "bg-muted text-muted-foreground")
                    }
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
      <div role="tabpanel">{activeContent}</div>
    </div>
  );
}
