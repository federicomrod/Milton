// components/restaurant/sales/SalesExplore.tsx
//
// One switcher: Canales / Categorías / Pagos. One visual at a time.

"use client";

import { useState } from "react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  DEFAULT_SALES_EXPLORE_TAB,
  parseSalesExploreTab,
  type SalesExploreTab,
} from "@/lib/restaurant/sales-explore";
import type { SalesInsights } from "@/lib/restaurant/sales-insights";
import {
  salesCategoryLabel,
  salesChannelLabel,
  salesPaymentLabel,
} from "@/lib/restaurant/sales-channel-labels";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SalesRankedBars } from "./SalesRankedBars";
import { SalesDetailLink } from "./SalesDetailLink";

export function SalesExplore({
  insights,
  currency,
  lang,
  detailHref,
}: {
  insights: SalesInsights;
  currency: string;
  lang: PreferredLanguage;
  detailHref: string;
}) {
  const [tab, setTab] = useState<SalesExploreTab>(DEFAULT_SALES_EXPLORE_TAB);
  const hash =
    tab === "categories"
      ? "categorias"
      : tab === "payments"
        ? "pagos"
        : "canales";

  return (
    <section
      data-testid="sales-explore"
      data-explore-tab={tab}
      className="rounded-md border border-border bg-background px-3 py-3 space-y-3"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">
          {t(lang, "Explore the mix", "Explora el mix")}
        </h2>
        <ToggleGroup
          type="single"
          value={tab}
          onValueChange={(value) => setTab(parseSalesExploreTab(value))}
          variant="outline"
          size="sm"
          aria-label={t(lang, "Explore", "Explorar")}
          data-testid="sales-explore-switcher"
        >
          <ToggleGroupItem value="channels" className="px-2.5 text-xs">
            {t(lang, "Channels", "Canales")}
          </ToggleGroupItem>
          <ToggleGroupItem value="categories" className="px-2.5 text-xs">
            {t(lang, "Categories", "Categorías")}
          </ToggleGroupItem>
          <ToggleGroupItem value="payments" className="px-2.5 text-xs">
            {t(lang, "Payments", "Pagos")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {tab === "channels" ? (
        <SalesRankedBars
          currency={currency}
          lang={lang}
          rows={insights.channel_mix.map((row) => ({
            key: row.key,
            label: salesChannelLabel(row.key, lang),
            net_sales: row.net_sales,
          }))}
        />
      ) : null}

      {tab === "payments" ? (
        <SalesRankedBars
          currency={currency}
          lang={lang}
          rows={insights.payment_mix.map((row) => ({
            key: row.key,
            label: salesPaymentLabel(row.key, lang),
            net_sales: row.net_sales,
          }))}
        />
      ) : null}

      {tab === "categories" ? (
        <div className="space-y-2">
          <SalesRankedBars
            currency={currency}
            lang={lang}
            rows={insights.ranked_categories.top.map((row) => ({
              key: row.category ?? "__none__",
              label: salesCategoryLabel(row.category, lang),
              net_sales: row.net_sales,
            }))}
          />
          {insights.ranked_categories.other ? (
            <p className="text-xs text-muted-foreground">
              {t(
                lang,
                `${insights.ranked_categories.other.count} more categories`,
                `${insights.ranked_categories.other.count} categorías más`
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {tab === "categories" && insights.ranked_categories.other ? (
          <SalesDetailLink
            href={`${detailHref}#categorias`}
            lang={lang}
            label={t(lang, "See all", "Ver todas")}
          />
        ) : (
          <span />
        )}
        <SalesDetailLink href={`${detailHref}#${hash}`} lang={lang} />
      </div>
    </section>
  );
}
