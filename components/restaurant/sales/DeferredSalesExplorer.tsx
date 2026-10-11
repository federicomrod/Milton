// components/restaurant/sales/DeferredSalesExplorer.tsx
//
// Detalle explorer — fetched from /api/restaurant/cockpit-sales so the
// first Sales paint never serializes explorer rows. Filtered to the same
// period as the header.

"use client";

import { useEffect, useState } from "react";
import { RestaurantSalesExplorer } from "@/components/restaurant/RestaurantSalesExplorer";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { inInclusiveRange } from "@/lib/restaurant/cockpit-period";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { ExplorerRow } from "@/lib/restaurant/supabase-sales";
import type { TargetMap } from "@/lib/restaurant/supabase-targets";

interface SalesPayload {
  rows: ExplorerRow[];
  targets: TargetMap;
  displayCurrency: string;
}

export function DeferredSalesExplorer({
  locationId,
  period,
  lang,
}: {
  locationId?: string | null;
  period: { from: string; to: string };
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
        if (cancelled) return;
        setData({
          ...payload,
          rows: payload.rows.filter((row) =>
            inInclusiveRange(row.sale_date, period)
          ),
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "sales load failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locationId, period.from, period.to]);

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
    return <PageSkeleton height="320px" width="100%" label="explorer" />;
  }
  return (
    <RestaurantSalesExplorer
      rows={data.rows}
      initialTargets={data.targets}
      displayCurrency={data.displayCurrency}
      lang={lang}
    />
  );
}
