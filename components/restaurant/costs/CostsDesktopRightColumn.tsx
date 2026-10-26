// components/restaurant/costs/CostsDesktopRightColumn.tsx
//
// Desktop right column (≥1024px): sticky cards for Últimas facturas, Configura
// tus costos, and Último archivo. This is a client component that loads its own
// setup data, similar to CostsSetupSection.

"use client";

import { useCallback, useEffect, useState } from "react";
import type { LatestInvoices } from "@/lib/restaurant/costs-page-data";
import { LatestInvoicesCompact } from "./LatestInvoicesCompact";
import { CostsSetupCompact } from "./CostsSetupCompact";
import { LastFileCompact } from "./LastFileCompact";
import {
  COSTS_FILE_ANCHOR,
  OPEN_COSTS_PICKER_EVENT,
} from "@/lib/restaurant/costs-picker";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import {
  getCachedTab,
  loadTab,
  menuTabKey,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";

async function fetchSetup(
  locationId: string | null
): Promise<RecipeCostingWorkspace | null> {
  const q = new URLSearchParams({ vista: "resumen" });
  if (locationId) q.set("location_id", locationId);
  const res = await fetch(`/api/restaurant/recipes/costing?${q.toString()}`);
  return res.ok ? ((await res.json()) as RecipeCostingWorkspace) : null;
}

export function CostsDesktopRightColumn({
  latestInvoices,
  locationId,
  shellParams,
  isTablet = false,
}: {
  latestInvoices: LatestInvoices | null;
  locationId: string | null;
  shellParams: Record<string, string | string[] | undefined>;
  isTablet?: boolean;
}) {
  const key = menuTabKey("resumen", { location: locationId });
  const [data, setData] = useState<RecipeCostingWorkspace | null>(
    () => getCachedTab(key)?.data ?? null
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadTab(key, () => fetchSetup(locationId)).then((json) => {
      if (cancelled) return;
      if (json) {
        setData(json);
        setFailed(false);
      } else setFailed((was) => was || getCachedTab(key) === null);
    });
    return () => {
      cancelled = true;
    };
  }, [key, locationId]);

  const handleFileAction = useCallback(() => {
    // Dispatch the custom event that CostsSetupSection listens to
    window.dispatchEvent(
      new CustomEvent(OPEN_COSTS_PICKER_EVENT, { detail: { handled: true } })
    );
    // Also scroll to the file section in case the listener isn't ready
    setTimeout(() => {
      document
        .getElementById(COSTS_FILE_ANCHOR)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, []);

  const setupData = data?.menu_summary?.setup ?? null;
  const latestUpload = data?.latest_upload ?? null;
  const containerClass = isTablet ? "contents" : "";

  return (
    <div className={containerClass}>
      {/* Always show invoices if we have them (independent of setup fetch) */}
      {latestInvoices && latestInvoices.rows.length > 0 ? (
        <LatestInvoicesCompact
          latest={latestInvoices}
          shellParams={shellParams}
        />
      ) : null}

      {/* Show setup card always (even when complete), skip only on fetch failure */}
      {!failed && setupData ? (
        <CostsSetupCompact setup={setupData} onFileAction={handleFileAction} />
      ) : null}

      {/* Last file card: skip only on fetch failure */}
      {!failed ? (
        <LastFileCompact upload={latestUpload} onView={handleFileAction} />
      ) : null}
    </div>
  );
}
