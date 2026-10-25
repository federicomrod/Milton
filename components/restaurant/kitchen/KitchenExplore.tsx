// components/restaurant/kitchen/KitchenExplore.tsx
//
// One switcher: Se agota / Merma / Recetas / Equipo / Historial.

"use client";

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  kitchenExploreCaption,
  type KitchenExploreRow,
  type KitchenInsights,
} from "@/lib/restaurant/kitchen-insights";
import {
  parseKitchenExploreTab,
  type KitchenExploreTab,
} from "@/lib/restaurant/kitchen-explore";
import { KitchenQrCard } from "./KitchenQrCard";
import { KitchenStaffCard } from "./KitchenStaffCard";
import { useState } from "react";
import { KitchenRecipeDraftsCard } from "./KitchenRecipeDraftsCard";
import { RecipeUploadCard } from "./RecipeUploadCard";
import { KitchenReportsCard } from "./KitchenReportsCard";

export function KitchenExplore({
  insights,
  tab,
  onTabChange,
  lang,
  canManage,
  canManageDrafts,
  locations,
  focusDraftId,
  onFocusConsumed,
}: {
  insights: KitchenInsights;
  tab: KitchenExploreTab;
  onTabChange: (tab: KitchenExploreTab) => void;
  lang: PreferredLanguage;
  canManage: boolean;
  canManageDrafts?: boolean;
  locations: { id: string; name: string }[];
  focusDraftId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [uploadTick, setUploadTick] = useState(0);
  const chips: { id: KitchenExploreTab; label: string }[] = [
    { id: "running_out", label: t(lang, "Running low", "Se agota") },
    { id: "waste", label: t(lang, "Waste", "Merma") },
    { id: "drafts", label: t(lang, "Recipe drafts", "Recetas en borrador") },
    { id: "staff", label: t(lang, "Kitchen team", "Equipo de cocina") },
    { id: "history", label: t(lang, "History", "Historial") },
  ];

  return (
    <section
      id="explorar"
      data-testid="kitchen-explore"
      data-explore-tab={tab}
      className="rounded-md border border-border bg-background px-3 py-3 space-y-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold">
          {t(lang, "Explore", "Explorar")}
        </h2>
        <span className="text-[12px] text-muted-foreground">
          {t(lang, "One analysis at a time", "Un análisis a la vez")}
        </span>
      </div>
      <div
        className="flex gap-1.5 flex-wrap"
        role="tablist"
        aria-label={t(lang, "Explore", "Explorar")}
        data-testid="kitchen-explore-switcher"
      >
        {chips.map((chip) => {
          const on = tab === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={on}
              data-testid={`kitchen-explore-${chip.id}`}
              onClick={() => onTabChange(parseKitchenExploreTab(chip.id))}
              className={
                "rounded-full border px-3 py-1.5 text-xs " +
                (on
                  ? "bg-foreground text-background border-foreground font-semibold"
                  : "bg-background text-muted-foreground border-border")
              }
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {tab === "waste" || tab === "running_out" ? (
        <RankTable
          lang={lang}
          rows={
            tab === "waste"
              ? insights.explore.waste.slice(0, 3)
              : insights.explore.running_out
          }
          pendingLabel={insights.pending_recipes_label}
          showValue={tab === "waste"}
          barClass={tab === "waste" ? "bg-gray-400" : "bg-[#1B40C8]"}
          empty={
            tab === "waste"
              ? t(
                  lang,
                  "No waste reports in this period.",
                  "No hay reportes de merma en este periodo."
                )
              : t(lang, "Nothing is running low.", "Nada se está agotando.")
          }
        />
      ) : null}

      {tab === "drafts" ? (
        <div className="space-y-3">
          <RecipeUploadCard
            canManage={canManageDrafts ?? canManage}
            locations={locations}
            onDone={() => setUploadTick((n) => n + 1)}
          />
          <RankTable
            lang={lang}
            rows={insights.explore.drafts}
            pendingLabel={insights.pending_recipes_label}
            showValue={false}
            barClass="bg-blue-500"
            empty={t(
              lang,
              "No recipe drafts waiting.",
              "No hay borradores de receta por revisar."
            )}
          />
          <KitchenRecipeDraftsCard
            canManage={canManageDrafts ?? canManage}
            locations={locations}
            focusDraftId={focusDraftId}
            onFocusConsumed={onFocusConsumed}
            reloadSignal={uploadTick}
          />
        </div>
      ) : null}

      {tab === "staff" ? (
        <div className="space-y-3">
          {insights.explore.staff.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              {t(lang, "No kitchen team yet.", "Aún no hay equipo de cocina.")}
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {insights.explore.staff.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {row.is_active
                        ? t(lang, "Active", "Activo")
                        : t(lang, "Removed", "Inactivo")}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>
                      {t(
                        lang,
                        `${row.reports} reports`,
                        `${row.reports} reportes`
                      )}
                    </p>
                    {row.last_label ? <p>{row.last_label}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <KitchenQrCard canManage={canManage} />
          <KitchenStaffCard canManage={canManage} locations={locations} />
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="space-y-3">
          <RankTable
            lang={lang}
            rows={insights.explore.history.slice(0, 12)}
            pendingLabel={insights.pending_recipes_label}
            showValue
            barClass="bg-muted-foreground/40"
            empty={t(
              lang,
              "No reports in this period.",
              "No hay reportes en este periodo."
            )}
          />
          <KitchenReportsCard canManage={canManage} locations={locations} />
        </div>
      ) : null}

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {kitchenExploreCaption(tab, insights, lang)}
        </span>
      </div>
    </section>
  );
}

function RankTable({
  rows,
  lang,
  pendingLabel,
  showValue,
  barClass,
  empty,
}: {
  rows: KitchenExploreRow[];
  lang: PreferredLanguage;
  pendingLabel: string;
  showValue: boolean;
  barClass: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">{empty}</p>;
  }
  return (
    <div className="space-y-1" data-testid="kitchen-ranked">
      <div className="grid grid-cols-[22px_minmax(0,150px)_1fr_72px_110px_130px] gap-2 text-[12px] text-muted-foreground px-0.5">
        <span>#</span>
        <span>{t(lang, "Item", "Producto")}</span>
        <span>{t(lang, "Reports", "Reportes")}</span>
        <span className="text-right">{t(lang, "Count", "Reportes")}</span>
        <span className="text-right">
          {t(lang, "Last report", "Último reporte")}
        </span>
        <span className="text-right">
          {t(lang, "Estimated value", "Valor estimado")}
        </span>
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[22px_minmax(0,150px)_1fr_72px_110px_130px] gap-2 items-center text-[13px] py-1.5 border-t border-border"
        >
          <span className="text-muted-foreground">{row.rank}</span>
          <span className="font-semibold truncate">{row.label}</span>
          <div className="h-3">
            {row.bar_pct > 0 ? (
              <div
                className={`h-3 rounded-full ${barClass}`}
                style={{ width: `${Math.max(8, row.bar_pct)}%` }}
              />
            ) : null}
          </div>
          <span className="text-right tabular-nums">{row.count}</span>
          <span className="text-right text-xs text-muted-foreground">
            {row.last_label}
          </span>
          <span className="text-right">
            {showValue && row.pending_value ? (
              <span className="inline-flex items-center rounded border border-dashed border-muted-foreground/40 bg-muted px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground">
                {pendingLabel}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
