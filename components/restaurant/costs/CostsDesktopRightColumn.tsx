// components/restaurant/costs/CostsDesktopRightColumn.tsx
//
// Compact cards for Últimas facturas, Configura tus costos, and Último archivo.
// Desktop stacks them in the sticky aside; tablet lays them out as a row of 3.

"use client";

import { useCallback, useEffect, useState } from "react";
import type { LatestInvoices } from "@/lib/restaurant/costs-page-data";
import { LatestInvoicesCompact } from "./LatestInvoicesCompact";
import { CostsSetupCompact } from "./CostsSetupCompact";
import { LastFileCompact } from "./LastFileCompact";
import { MobileSetupBanner } from "./MobileSetupBanner";
import {
  COSTS_FILE_ANCHOR,
  COSTS_SETUP_REFRESH_EVENT,
  OPEN_COSTS_PICKER_EVENT,
} from "@/lib/restaurant/costs-picker";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import {
  getCachedTab,
  loadTab,
  menuTabKey,
  putTab,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";

async function fetchSetup(
  locationId: string | null
): Promise<RecipeCostingWorkspace | null> {
  const q = new URLSearchParams({ vista: "resumen" });
  if (locationId) q.set("location_id", locationId);
  const res = await fetch(`/api/restaurant/recipes/costing?${q.toString()}`);
  return res.ok ? ((await res.json()) as RecipeCostingWorkspace) : null;
}

function useCostsSetup(locationId: string | null) {
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

    const handleRefresh = () => {
      void fetchSetup(locationId).then((json) => {
        if (cancelled || !json) return;
        setData(json);
        putTab(key, json);
      });
    };
    window.addEventListener(COSTS_SETUP_REFRESH_EVENT, handleRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener(COSTS_SETUP_REFRESH_EVENT, handleRefresh);
    };
  }, [key, locationId]);

  const handleFileAction = useCallback(() => {
    const url = new URL(window.location.href);
    url.hash = COSTS_FILE_ANCHOR;
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
    window.dispatchEvent(
      new CustomEvent(OPEN_COSTS_PICKER_EVENT, { detail: { handled: true } })
    );
  }, []);

  return {
    setupData: data?.menu_summary?.setup ?? null,
    latestUpload: data?.latest_upload ?? null,
    failed,
    handleFileAction,
  };
}

function CompactCards({
  latestInvoices,
  locationId,
  shellParams,
  testId,
}: {
  latestInvoices: LatestInvoices | null;
  locationId: string | null;
  shellParams: Record<string, string | string[] | undefined>;
  testId?: string;
}) {
  const { setupData, latestUpload, failed, handleFileAction } =
    useCostsSetup(locationId);

  return (
    <>
      {latestInvoices && latestInvoices.rows.length > 0 ? (
        <LatestInvoicesCompact
          latest={latestInvoices}
          shellParams={shellParams}
          testId={testId}
        />
      ) : null}
      {!failed && setupData ? (
        <CostsSetupCompact setup={setupData} onFileAction={handleFileAction} />
      ) : null}
      {!failed ? (
        <LastFileCompact upload={latestUpload} onView={handleFileAction} />
      ) : null}
    </>
  );
}

export function CostsDesktopRightColumn({
  latestInvoices,
  locationId,
  shellParams,
}: {
  latestInvoices: LatestInvoices | null;
  locationId: string | null;
  shellParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <CompactCards
      latestInvoices={latestInvoices}
      locationId={locationId}
      shellParams={shellParams}
      testId="latest-invoices-compact"
    />
  );
}

export function CostsTabletCardsRow({
  latestInvoices,
  locationId,
  shellParams,
}: {
  latestInvoices: LatestInvoices | null;
  locationId: string | null;
  shellParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <div className="hidden md:grid lg:hidden grid-cols-3 gap-3 mt-5">
      <CompactCards
        latestInvoices={latestInvoices}
        locationId={locationId}
        shellParams={shellParams}
      />
    </div>
  );
}

export function CostsMobileBelow({
  latestInvoices,
  locationId,
  shellParams,
}: {
  latestInvoices: LatestInvoices | null;
  locationId: string | null;
  shellParams: Record<string, string | string[] | undefined>;
}) {
  const { latestUpload, failed, handleFileAction } = useCostsSetup(locationId);
  return (
    <div className="md:hidden space-y-3 mt-5">
      {latestInvoices ? (
        <LatestInvoicesCompact
          latest={latestInvoices}
          shellParams={shellParams}
        />
      ) : null}
      {!failed ? (
        <LastFileCompact upload={latestUpload} onView={handleFileAction} />
      ) : null}
    </div>
  );
}

export function CostsMobileBannerHost({
  locationId,
}: {
  locationId: string | null;
}) {
  const { setupData, failed, handleFileAction } = useCostsSetup(locationId);
  if (failed || !setupData || setupData.complete) return null;
  return (
    <div className="md:hidden">
      <MobileSetupBanner setup={setupData} onFileAction={handleFileAction} />
    </div>
  );
}
