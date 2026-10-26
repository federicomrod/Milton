// components/restaurant/kitchen/KitchenExplore.tsx
//
// «Historial y análisis»: Se agota / Merma / Historial. Recetas and Equipo
// live outside this switcher.

"use client";

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  kitchenExploreCaption,
  type KitchenInsights,
} from "@/lib/restaurant/kitchen-insights";
import {
  parseKitchenExploreTab,
  type KitchenAnalysisTab,
  type KitchenExploreTab,
} from "@/lib/restaurant/kitchen-explore";
import { KitchenReportsCard } from "./KitchenReportsCard";

export function KitchenExplore({
  insights,
  tab,
  onTabChange,
  lang,
  canManage,
  locations,
}: {
  insights: KitchenInsights;
  tab: KitchenExploreTab;
  onTabChange: (tab: KitchenExploreTab) => void;
  lang: PreferredLanguage;
  canManage: boolean;
  locations: { id: string; name: string }[];
}) {
  const chips: { id: KitchenAnalysisTab; label: string }[] = [
    { id: "running_out", label: t(lang, "Running low", "Se agota") },
    { id: "waste", label: t(lang, "Waste", "Merma") },
    { id: "history", label: t(lang, "History", "Historial") },
  ];
  const active: KitchenAnalysisTab =
    tab === "running_out" || tab === "waste" || tab === "history"
      ? tab
      : "waste";

  return (
    <section
      id="historial"
      data-testid="kitchen-explore"
      data-explore-tab={active}
      className="rounded-md border border-border bg-background px-3 py-3 space-y-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-[#0D1117]">
          {t(lang, "History and analysis", "Historial y análisis")}
        </h2>
      </div>
      <div
        className="flex gap-4 overflow-x-auto"
        role="tablist"
        aria-label={t(lang, "History and analysis", "Historial y análisis")}
        data-testid="kitchen-explore-switcher"
      >
        {chips.map((chip) => {
          const on = active === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={on}
              data-testid={`kitchen-explore-${chip.id}`}
              onClick={() => onTabChange(parseKitchenExploreTab(chip.id))}
              className={
                "shrink-0 border-b-2 px-0.5 pb-1.5 text-sm " +
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

      {active === "running_out" ? (
        insights.explore.running_out.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {t(lang, "Nothing is running low.", "Nada se está agotando.")}
          </p>
        ) : (
          <KitchenReportsCard
            canManage={canManage}
            locations={locations}
            initialType="running_out"
          />
        )
      ) : null}

      {active === "waste" ? (
        insights.explore.waste.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {t(
              lang,
              "No waste reports in this period.",
              "No hay reportes de merma en este periodo."
            )}
          </p>
        ) : (
          <KitchenReportsCard
            canManage={canManage}
            locations={locations}
            initialType="waste"
          />
        )
      ) : null}

      {active === "history" ? (
        insights.explore.history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {t(
              lang,
              "No reports in this period.",
              "No hay reportes en este periodo."
            )}
          </p>
        ) : (
          <KitchenReportsCard canManage={canManage} locations={locations} />
        )
      ) : null}

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {kitchenExploreCaption(active, insights, lang)}
        </span>
      </div>
    </section>
  );
}
