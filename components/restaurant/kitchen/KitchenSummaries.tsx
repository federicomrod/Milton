// components/restaurant/kitchen/KitchenSummaries.tsx
//
// Three compact cards. Waste money is always "Pendiente de recetas".

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { KitchenSummary } from "@/lib/restaurant/kitchen-insights";
import type { KitchenExploreTab } from "@/lib/restaurant/kitchen-explore";

const BAR: Record<KitchenSummary["id"], string> = {
  running_out: "bg-red-600",
  waste: "bg-amber-500",
  drafts: "bg-blue-500",
};

export function KitchenSummaries({
  summaries,
  pendingLabel,
  lang,
  onOpenExplore,
}: {
  summaries: KitchenSummary[];
  pendingLabel: string;
  lang: PreferredLanguage;
  onOpenExplore: (tab: KitchenExploreTab) => void;
}) {
  return (
    <div
      data-testid="kitchen-summaries"
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      {summaries.map((row) => (
        <article
          key={row.id}
          data-testid={`kitchen-summary-${row.id}`}
          className="rounded-md border border-border bg-background px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-muted-foreground">
              {row.label}
            </p>
            <button
              type="button"
              onClick={() => onOpenExplore(row.explore_tab)}
              className="text-[12px] font-medium text-blue-700 dark:text-blue-300"
            >
              {row.id === "drafts"
                ? t(lang, "Review →", "Revisar →")
                : row.id === "waste"
                  ? t(lang, "See details →", "Ver detalles →")
                  : t(lang, "See all →", "Ver todo →")}
            </button>
          </div>
          <p className="text-[17px] font-bold mt-1">{row.value}</p>
          {row.hint ? (
            <p className="text-xs text-muted-foreground">{row.hint}</p>
          ) : null}
          {row.segments.length > 0 ? (
            <div className="flex h-2 rounded-full overflow-hidden mt-2 bg-muted">
              {row.segments.map((pct, i) => (
                <div
                  key={`${row.id}-${i}`}
                  className={
                    row.id === "waste" && i === 1
                      ? "bg-amber-100 dark:bg-amber-900/40"
                      : BAR[row.id]
                  }
                  style={{ width: `${pct}%` }}
                />
              ))}
            </div>
          ) : (
            <div className="h-2 rounded-full bg-muted mt-2" />
          )}
          {row.extra ? (
            <p className="text-[12px] text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span>{row.extra}</span>
              <span
                data-testid="kitchen-pending-recipes"
                className="inline-flex items-center rounded border border-dashed border-muted-foreground/40 bg-muted px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground"
              >
                {pendingLabel}
              </span>
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
