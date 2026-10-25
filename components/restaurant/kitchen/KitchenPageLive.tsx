// components/restaurant/kitchen/KitchenPageLive.tsx
//
// Client shell so summaries can open Explore and feed actions can resolve.

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  filterFeed,
  type KitchenFeedItem,
  type KitchenInsights,
} from "@/lib/restaurant/kitchen-insights";
import {
  DEFAULT_KITCHEN_EXPLORE_TAB,
  DEFAULT_KITCHEN_FEED_FILTER,
  KITCHEN_FEED_PREVIEW,
  type KitchenExploreTab,
  type KitchenFeedFilter,
} from "@/lib/restaurant/kitchen-explore";
import { KitchenAttentionFeed } from "./KitchenAttentionFeed";
import { KitchenSummaries } from "./KitchenSummaries";
import { KitchenExplore } from "./KitchenExplore";

export function KitchenPageLive({
  insights,
  lang,
  canManage,
  canManageDrafts,
  locations,
  initialTab,
  children,
}: {
  insights: KitchenInsights;
  lang: PreferredLanguage;
  canManage: boolean;
  canManageDrafts?: boolean;
  locations: { id: string; name: string }[];
  /** From ?tab=… (for example Menú › Subir recetas opens «Recetas en borrador»). */
  initialTab?: KitchenExploreTab;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<KitchenFeedFilter>(
    DEFAULT_KITCHEN_FEED_FILTER
  );
  const [tab, setTab] = useState<KitchenExploreTab>(
    initialTab ?? DEFAULT_KITCHEN_EXPLORE_TAB
  );
  const [expanded, setExpanded] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [focusDraftId, setFocusDraftId] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterFeed(insights.feed, filter),
    [insights.feed, filter]
  );
  const shown = expanded ? filtered : filtered.slice(0, KITCHEN_FEED_PREVIEW);

  const openExplore = (next: KitchenExploreTab) => {
    setTab(next);
    document
      .getElementById("explorar")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onAction = async (item: KitchenFeedItem) => {
    if (item.action === "view_reports") {
      openExplore("waste");
      return;
    }
    if (item.action === "review") {
      // Reset first so asking for the same draft again re-opens it.
      setFocusDraftId(null);
      setTimeout(() => setFocusDraftId(item.draft_id), 0);
      openExplore("drafts");
      return;
    }
    if (item.action === "resolve" && item.report_ids.length > 0) {
      setResolvingId(item.id);
      try {
        const res = await fetch("/api/restaurant/kitchen/reports/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: item.report_ids }),
        });
        if (res.ok) router.refresh();
      } finally {
        setResolvingId(null);
      }
    }
  };

  return (
    <>
      <p
        className="text-sm text-muted-foreground -mt-1"
        data-testid="kitchen-headline"
      >
        {insights.headline}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        <div className="lg:col-span-7">
          <KitchenAttentionFeed
            insights={insights}
            filter={filter}
            onFilter={(next) => {
              setFilter(next);
              setExpanded(false);
            }}
            shown={shown}
            expanded={expanded}
            onExpand={() => setExpanded(true)}
            onAction={onAction}
            resolvingId={resolvingId}
            lang={lang}
          />
        </div>
        <div className="lg:col-span-5">{children}</div>
      </div>
      <KitchenSummaries
        summaries={insights.summaries}
        pendingLabel={insights.pending_recipes_label}
        lang={lang}
        onOpenExplore={openExplore}
      />
      <KitchenExplore
        insights={insights}
        tab={tab}
        onTabChange={setTab}
        lang={lang}
        canManage={canManage}
        canManageDrafts={canManageDrafts}
        locations={locations}
        focusDraftId={focusDraftId}
      />
      <div
        data-testid="kitchen-legend"
        className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground rounded-md border border-border bg-background px-3 py-2"
      >
        <span className="font-semibold text-foreground">
          {t(lang, "Legend", "Leyenda")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-2.5 h-2.5 rounded-sm bg-[#1B40C8]" />
          {t(
            lang,
            "Kitchen reports already captured: alerts, waste, drafts",
            "Con reportes de cocina ya capturados: avisos, merma, borradores"
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-muted-foreground bg-muted" />
          {t(
            lang,
            "Depends on recipes/costs: waste value",
            "Depende de recetas/costos: valor de la merma"
          )}
        </span>
      </div>
    </>
  );
}
