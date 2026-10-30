// components/restaurant/kitchen/KitchenSummaries.tsx
//
// Three compact cards. Waste money is always "Pendiente de recetas".
// The whole card is the hit target: Se agota/Merma open Historial y
// análisis; Recetas en borrador scrolls to Recetas.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { KitchenSummary } from "@/lib/restaurant/kitchen-insights";
import type { KitchenExploreTab } from "@/lib/restaurant/kitchen-explore";

const BAR: Record<KitchenSummary["id"], string> = {
  running_out: "bg-[#1B40C8]",
  waste: "bg-[#1B40C8]",
  drafts: "bg-[#D8D0F8]",
};

export function KitchenSummaries({
  summaries,
  pendingLabel,
  lang,
  onOpenExplore,
  layout = "row",
}: {
  summaries: KitchenSummary[];
  pendingLabel: string;
  lang: PreferredLanguage;
  onOpenExplore: (tab: KitchenExploreTab) => void;
  layout?: "row" | "scroll";
}) {
  return (
    <div
      data-testid="kitchen-summaries"
      data-layout={layout}
      className={
        layout === "scroll"
          ? "flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory"
          : "grid grid-cols-1 sm:grid-cols-3 gap-3"
      }
    >
      {summaries.map((row) => (
        <article
          key={row.id}
          data-testid={`kitchen-summary-${row.id}`}
          role="button"
          tabIndex={0}
          onClick={() => onOpenExplore(row.explore_tab)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenExplore(row.explore_tab);
            }
          }}
          className={
            "rounded-md border border-border bg-background px-3 py-2.5 text-left cursor-pointer hover:border-[#1B40C8] " +
            (layout === "scroll" ? "min-w-[220px] snap-start shrink-0" : "")
          }
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-muted-foreground">
              {row.label}
            </p>
            <span className="text-[12px] font-medium text-[#1B40C8]">
              {row.id === "drafts"
                ? t(lang, "Review →", "Revisar →", "Prüfen →")
                : row.id === "waste"
                  ? t(
                      lang,
                      "See details →",
                      "Ver detalles →",
                      "Details anzeigen →"
                    )
                  : t(lang, "See all →", "Ver todo →", "Alle anzeigen →")}
            </span>
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
                  className={BAR[row.id]}
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
                className="inline-flex items-center rounded border border-[#D8D0F8] bg-[#D8D0F8] px-1.5 py-0.5 text-[12px] font-semibold text-[#0D1117]"
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
