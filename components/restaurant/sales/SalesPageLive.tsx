// components/restaurant/sales/SalesPageLive.tsx
//
// Client shell so mix summaries can open the matching Explore tab.

"use client";

import { useState, type ReactNode } from "react";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  DEFAULT_SALES_EXPLORE_TAB,
  type SalesExploreTab,
} from "@/lib/restaurant/sales-explore";
import type { SalesInsights } from "@/lib/restaurant/sales-insights";
import { SalesUnderstand } from "./SalesUnderstand";
import { SalesExplore } from "./SalesExplore";

export function SalesPageLive({
  insights,
  currency,
  timezone,
  lang,
  detailHref,
  children,
}: {
  insights: SalesInsights;
  currency: string;
  timezone: string;
  lang: PreferredLanguage;
  detailHref: string;
  children?: ReactNode;
}) {
  const [tab, setTab] = useState<SalesExploreTab>(DEFAULT_SALES_EXPLORE_TAB);

  const openExplore = (next: SalesExploreTab) => {
    setTab(next);
    const node = document.getElementById("explorar");
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <SalesUnderstand
        insights={insights}
        currency={currency}
        timezone={timezone}
        lang={lang}
        detailHref={detailHref}
        onOpenExplore={openExplore}
      />
      {children}
      <SalesExplore
        insights={insights}
        currency={currency}
        lang={lang}
        detailHref={detailHref}
        tab={tab}
        onTabChange={setTab}
      />
    </>
  );
}
