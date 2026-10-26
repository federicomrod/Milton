// components/restaurant/costs/CostsFileWorkspace.tsx
//
// Client wrapper for CostsSetupSection that manages visibility: hidden by
// default, visible when the picker/workflow is active (file in progress,
// preview, import pending, or reset panel open). Renders full-width under the
// tabs row, above tab content.

"use client";

import { useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { CostsSetupSection } from "./CostsSetupSection";
import {
  COSTS_FILE_ANCHOR,
  OPEN_COSTS_PICKER_EVENT,
} from "@/lib/restaurant/costs-picker";

export function CostsFileWorkspace({
  locationId,
  companyId,
}: {
  locationId: string | null;
  companyId: string | null;
}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasWork, setHasWork] = useState(false);

  useEffect(() => {
    // Open on OPEN_COSTS_PICKER_EVENT
    const onOpen = () => setVisible(true);
    window.addEventListener(OPEN_COSTS_PICKER_EVENT, onOpen);

    // Open if URL hash is #COSTS_FILE_ANCHOR
    const checkHash = () => {
      if (window.location.hash === `#${COSTS_FILE_ANCHOR}`) {
        setVisible(true);
      }
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);

    return () => {
      window.removeEventListener(OPEN_COSTS_PICKER_EVENT, onOpen);
      window.removeEventListener("hashchange", checkHash);
    };
  }, []);

  // Track if there's work in progress from the setup section
  const handleWorkInProgress = useCallback((inProgress: boolean) => {
    setHasWork(inProgress);
  }, []);

  const handleBusyChange = useCallback((isBusy: boolean) => {
    setBusy(isBusy);
  }, []);

  const handleClose = () => {
    // Only allow closing if not busy and no work in progress
    if (!busy && !hasWork) {
      setVisible(false);
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      data-testid="costs-file-workspace"
      className="w-full rounded-lg border border-[#dfe3ea] bg-white p-4 my-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-bold text-[#151c2c]">
          Archivo de costos
        </h2>
        {!busy && !hasWork ? (
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-[#6b7385] hover:bg-[#f1f3f7]"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <CostsSetupSection
        locationId={locationId}
        companyId={companyId}
        onWorkInProgress={handleWorkInProgress}
        onBusyChange={handleBusyChange}
      />
    </div>
  );
}
