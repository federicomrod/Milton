// components/restaurant/kitchen/KitchenPageLive.tsx
//
// Client shell: summaries open Historial y análisis or Recetas; feed
// actions resolve or review.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { type PreferredLanguage } from "@/lib/restaurant/language";
import {
  filterFeed,
  type KitchenFeedItem,
  type KitchenInsights,
} from "@/lib/restaurant/kitchen-insights";
import {
  DEFAULT_KITCHEN_ANALYSIS_TAB,
  DEFAULT_KITCHEN_FEED_FILTER,
  KITCHEN_FEED_PREVIEW,
  parseKitchenExploreTab,
  type KitchenExploreTab,
  type KitchenFeedFilter,
} from "@/lib/restaurant/kitchen-explore";
import { KitchenAttentionFeed } from "./KitchenAttentionFeed";
import { KitchenConnectCard } from "./KitchenConnectCard";
import { KitchenExplore } from "./KitchenExplore";
import {
  KitchenMainColumn,
  KitchenPageLayout,
  KitchenRightColumn,
} from "./KitchenPageLayout";
import { KitchenRecipesSection } from "./KitchenRecipesSection";
import { KitchenSummaries } from "./KitchenSummaries";

function linkedCooksOf(insights: KitchenInsights) {
  return insights.explore.staff
    .filter((row) => row.is_active)
    .map((row) => ({ id: row.id, name: row.name }));
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

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
  /** From ?tab=… (Menú › Subir recetas still sends tab=drafts). */
  initialTab?: KitchenExploreTab;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<KitchenFeedFilter>(
    DEFAULT_KITCHEN_FEED_FILTER
  );
  const [tab, setTab] = useState<KitchenExploreTab>(() => {
    if (
      initialTab === "running_out" ||
      initialTab === "waste" ||
      initialTab === "history"
    ) {
      return initialTab;
    }
    return DEFAULT_KITCHEN_ANALYSIS_TAB;
  });
  const [expanded, setExpanded] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [focusDraftId, setFocusDraftId] = useState<string | null>(null);

  const clearFocus = useCallback(() => setFocusDraftId(null), []);
  const linkedCooks = linkedCooksOf(insights);
  const linked = linkedCooks.length > 0;
  const draftsAllowed = canManageDrafts ?? canManage;

  useEffect(() => {
    if (initialTab === "drafts") scrollToId("recetas");
    if (initialTab === "staff") scrollToId("equipo");
  }, [initialTab]);

  const filtered = useMemo(
    () => filterFeed(insights.feed, filter),
    [insights.feed, filter]
  );
  const shown = expanded ? filtered : filtered.slice(0, KITCHEN_FEED_PREVIEW);

  const openExplore = (next: KitchenExploreTab) => {
    const parsed = parseKitchenExploreTab(next);
    if (parsed === "drafts") {
      scrollToId("recetas");
      return;
    }
    if (parsed === "staff") {
      scrollToId("equipo");
      return;
    }
    setTab(parsed);
    scrollToId("historial");
  };

  const onAction = async (item: KitchenFeedItem) => {
    if (item.action === "view_reports") {
      openExplore("waste");
      return;
    }
    if (item.action === "review") {
      setFocusDraftId(null);
      setTimeout(() => setFocusDraftId(item.draft_id), 0);
      scrollToId("recetas");
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

  const connectProps = {
    canManage,
    locations,
    linkedCooks,
    variant: (linked ? "compact" : "full") as "compact" | "full",
  };

  const summaries = (pending: "row" | "scroll", testSuffix?: string) => (
    <div
      data-testid={
        testSuffix ? `kitchen-summaries-slot-${testSuffix}` : undefined
      }
    >
      <KitchenSummaries
        summaries={insights.summaries}
        pendingLabel={insights.pending_recipes_label}
        lang={lang}
        onOpenExplore={openExplore}
        layout={pending}
      />
    </div>
  );

  return (
    <>
      <KitchenPageLayout>
        <KitchenMainColumn>
          <p
            className="text-sm text-muted-foreground -mt-1"
            data-testid="kitchen-headline"
          >
            {insights.headline}
          </p>
          {!linked ? (
            <div className="lg:hidden">
              <KitchenConnectCard {...connectProps} />
            </div>
          ) : null}
          <div className="hidden md:block">{summaries("row", "md")}</div>
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
            afterList={children}
          />
          <KitchenRecipesSection
            canManage={draftsAllowed}
            locations={locations}
            focusDraftId={focusDraftId}
            onFocusConsumed={clearFocus}
          />
          <div className="md:hidden">{summaries("scroll", "mobile")}</div>
          <KitchenExplore
            insights={insights}
            tab={tab}
            onTabChange={setTab}
            lang={lang}
            canManage={canManage}
            locations={locations}
          />
          {linked ? (
            <div className="lg:hidden">
              <KitchenConnectCard {...connectProps} />
            </div>
          ) : null}
        </KitchenMainColumn>
        <KitchenRightColumn>
          <KitchenConnectCard {...connectProps} />
        </KitchenRightColumn>
      </KitchenPageLayout>
    </>
  );
}
