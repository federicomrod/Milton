// components/restaurant/cockpit/CockpitCostKpiCells.tsx
//
// Presentational food-cost / margin cells. Shared by the streamed loader
// and the client period picker.

import Link from "next/link";
import { menuResumenHref } from "@/lib/restaurant/menu-links";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { buildCockpitKpiStripModel } from "@/lib/restaurant/cockpit-executive";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export function CockpitCostKpisSkeleton() {
  return (
    <>
      <PageSkeleton height="4.5rem" width="100%" label="gross margin" />
      <PageSkeleton height="4.5rem" width="100%" label="food cost" />
    </>
  );
}

export function CockpitCostKpiCells({
  model,
  lang,
}: {
  lang: PreferredLanguage;
  model: ReturnType<typeof buildCockpitKpiStripModel>;
}) {
  return (
    <>
      {model.gross_margin_pct.available ? (
        <div className="rounded-md border border-border bg-background px-2.5 py-1.5 min-h-[4.5rem]">
          <p className="text-[12px] font-medium text-muted-foreground truncate">
            {t(lang, "Gross margin %", "Margen bruto %")}
          </p>
          <p className="text-lg font-semibold tabular-nums leading-tight">
            {model.gross_margin_pct.value.toFixed(1)}%
          </p>
          <p
            className={
              "text-[12px] tabular-nums " +
              (model.gross_margin_pct.delta_pct == null
                ? "text-muted-foreground"
                : model.gross_margin_pct.delta_pct > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : model.gross_margin_pct.delta_pct < 0
                    ? "text-amber-800 dark:text-amber-300"
                    : "text-muted-foreground")
            }
          >
            {model.gross_margin_pct.delta_pct == null
              ? t(lang, "no previous period", "sin periodo anterior")
              : `${model.gross_margin_pct.delta_pct > 0 ? "+" : ""}${model.gross_margin_pct.delta_pct.toFixed(1)}%`}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
            {t(lang, "on covered net sales", "sobre ventas netas cubiertas")}
          </p>
        </div>
      ) : (
        <NotAvailableYet
          lang={lang}
          compact
          reason={model.gross_margin_pct.reason}
          href={model.gross_margin_pct.href}
          linkLabel={model.gross_margin_pct.link_label}
        />
      )}
      {model.food_cost_pct.available ? (
        <Link
          href={menuResumenHref()}
          className="block rounded-md border border-border bg-background px-2.5 py-1.5 min-h-[4.5rem] hover:border-[#f28c28]"
        >
          <p className="text-[12px] font-medium text-muted-foreground truncate">
            {t(lang, "Food cost %", "% costo de comida")}
          </p>
          <p className="text-lg font-semibold tabular-nums leading-tight">
            {model.food_cost_pct.value.toFixed(1)}%
          </p>
          <p
            className={
              "text-[12px] tabular-nums " +
              (model.food_cost_pct.delta_pct == null
                ? "text-muted-foreground"
                : model.food_cost_pct.delta_pct > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : model.food_cost_pct.delta_pct < 0
                    ? "text-amber-800 dark:text-amber-300"
                    : "text-muted-foreground")
            }
          >
            {model.food_cost_pct.delta_pct == null
              ? t(lang, "no previous period", "sin periodo anterior")
              : `${model.food_cost_pct.delta_pct > 0 ? "+" : ""}${model.food_cost_pct.delta_pct.toFixed(1)}%`}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
            {t(lang, "on covered net sales", "sobre ventas netas cubiertas")}
          </p>
        </Link>
      ) : (
        <NotAvailableYet
          lang={lang}
          compact
          reason={model.food_cost_pct.reason}
          href={model.food_cost_pct.href}
          linkLabel={model.food_cost_pct.link_label}
        />
      )}
    </>
  );
}
