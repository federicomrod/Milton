// components/restaurant/cockpit/DeferredSalesTab.tsx
//
// Sales tab body fetched on first open so the cockpit RSC payload does
// not include every explorer row. Same layout as RevenueAndChannelsTab.

"use client";

import { useEffect, useState } from "react";
import { RevenueAndChannelsTab } from "@/components/restaurant/cockpit/RevenueAndChannelsTab";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { CockpitSalesAggregate } from "@/lib/restaurant/cockpit-aggregates";
import type { ExplorerRow } from "@/lib/restaurant/supabase-sales";
import type { TargetMap } from "@/lib/restaurant/supabase-targets";

interface SalesPayload {
  rows: ExplorerRow[];
  targets: TargetMap;
  displayCurrency: string;
  cockpit: CockpitSalesAggregate;
}

export function DeferredSalesTab({
  locationId,
  lang,
}: {
  locationId?: string | null;
  lang: PreferredLanguage;
}) {
  const [data, setData] = useState<SalesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (locationId) params.set("location", locationId);
    const href = `/api/restaurant/cockpit-sales${
      params.size > 0 ? `?${params.toString()}` : ""
    }`;
    fetch(href)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`sales ${res.status}`);
        }
        return (await res.json()) as SalesPayload;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "sales load failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          lang,
          "Could not load the sales explorer. Try again.",
          "No se pudo cargar el explorador de ventas. Inténtalo de nuevo."
        )}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3">
        <PageSkeleton height="220px" width="100%" label="heatmap" />
        <PageSkeleton height="320px" width="100%" label="explorer" />
      </div>
    );
  }
  return (
    <RevenueAndChannelsTab
      rows={data.rows}
      targets={data.targets}
      displayCurrency={data.displayCurrency}
      cockpit={data.cockpit}
      lang={lang}
    />
  );
}
