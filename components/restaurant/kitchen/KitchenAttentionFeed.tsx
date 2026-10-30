// components/restaurant/kitchen/KitchenAttentionFeed.tsx
//
// "Necesita atención hoy" — already-grouped rows from the backend.

"use client";

import type { ReactNode } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type {
  KitchenFeedItem,
  KitchenInsights,
} from "@/lib/restaurant/kitchen-insights";
import {
  parseKitchenFeedFilter,
  type KitchenFeedFilter,
} from "@/lib/restaurant/kitchen-explore";

const ICON: Record<
  KitchenFeedItem["kind"],
  { bg: string; fg: string; mark: string }
> = {
  running_out: {
    bg: "bg-red-50 dark:bg-red-950/40",
    fg: "text-red-600",
    mark: "!",
  },
  waste: {
    bg: "bg-red-50 dark:bg-red-950/40",
    fg: "text-red-600",
    mark: "♻",
  },
  drafts: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    fg: "text-blue-700 dark:text-blue-300",
    mark: "✎",
  },
};

export function KitchenAttentionFeed({
  insights,
  filter,
  onFilter,
  shown,
  expanded,
  onExpand,
  onAction,
  resolvingId,
  lang,
  afterList,
}: {
  insights: KitchenInsights;
  filter: KitchenFeedFilter;
  onFilter: (next: KitchenFeedFilter) => void;
  shown: KitchenFeedItem[];
  expanded: boolean;
  onExpand: () => void;
  onAction: (item: KitchenFeedItem) => void;
  resolvingId: string | null;
  lang: PreferredLanguage;
  afterList?: ReactNode;
}) {
  const chips: { id: KitchenFeedFilter; label: string; count: number }[] = [
    {
      id: "all",
      label: t(
        lang,
        `All (${insights.counts.all})`,
        `Todo (${insights.counts.all})`,
        `Alle (${insights.counts.all})`
      ),
      count: insights.counts.all,
    },
    {
      id: "running_out",
      label: t(lang, "Running low", "Se agota", "Wird knapp"),
      count: insights.counts.running_out,
    },
    {
      id: "waste",
      label: t(lang, "Waste", "Merma", "Ausschuss"),
      count: insights.counts.waste,
    },
    {
      id: "drafts",
      label: t(lang, "Recipes", "Recetas", "Rezepte"),
      count: insights.counts.drafts,
    },
  ];

  if (insights.feed.length === 0 && insights.highlights.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="kitchen-attention"
      className="rounded-md border border-border bg-background px-3 py-3"
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <h2 className="text-sm font-semibold">
          {t(
            lang,
            "Needs attention today",
            "Necesita atención hoy",
            "Heute zu beachten"
          )}
        </h2>
        <span className="text-[12px] text-muted-foreground">
          {t(
            lang,
            "Reports from your team",
            "Reportes de tu equipo",
            "Meldungen Ihres Teams"
          )}
        </span>
        <div
          className="ml-auto flex gap-3"
          role="tablist"
          aria-label={t(
            lang,
            "Attention filter",
            "Filtro de atención",
            "Filter"
          )}
        >
          {chips.map((chip) => {
            const on = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`kitchen-feed-filter-${chip.id}`}
                onClick={() => onFilter(parseKitchenFeedFilter(chip.id))}
                className={
                  "border-b-2 px-0.5 py-1 text-xs " +
                  (on
                    ? "border-[#1B40C8] font-semibold text-[#1B40C8]"
                    : "border-transparent text-[#0D1117] hover:text-[#1B40C8]")
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        insights.feed.length === 0 ? null : (
          <p
            className="text-sm text-muted-foreground py-6"
            data-testid="kitchen-attention-empty"
          >
            {insights.empty_feed}
          </p>
        )
      ) : (
        <ul>
          {shown.map((item) => {
            const icon = ICON[item.kind];
            const busy = resolvingId === item.id;
            return (
              <li
                key={item.id}
                data-testid={`kitchen-feed-${item.kind}`}
                className="flex items-center gap-3 py-2.5 border-t border-border"
              >
                <span
                  className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${icon.bg} ${icon.fg}`}
                >
                  {icon.mark}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[13px] truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.detail}
                  </p>
                </div>
                <span className="text-[12px] text-muted-foreground whitespace-nowrap">
                  {item.time_label}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction(item)}
                  className="text-xs rounded-md border border-[#1B40C8] bg-white px-2.5 py-1 text-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-60 whitespace-nowrap"
                >
                  {busy
                    ? t(lang, "Saving…", "Guardando…", "Wird gespeichert …")
                    : item.action_label}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {insights.feed_total > shown.length || expanded ? (
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className="text-muted-foreground">
            {t(
              lang,
              `Showing ${shown.length} of ${insights.counts[filter === "all" ? "all" : filter]}`,
              `Mostrando ${shown.length} de ${insights.counts[filter === "all" ? "all" : filter]}`,
              `${shown.length} von ${insights.counts[filter === "all" ? "all" : filter]} angezeigt`
            )}
          </span>
          {!expanded &&
          insights.counts[filter === "all" ? "all" : filter] > shown.length ? (
            <button
              type="button"
              data-testid="kitchen-feed-see-all"
              onClick={onExpand}
              className="font-semibold text-blue-700 dark:text-blue-300"
            >
              {t(lang, "See all →", "Ver todo →", "Alle anzeigen →")}
            </button>
          ) : null}
        </div>
      ) : null}

      {afterList}
    </section>
  );
}
