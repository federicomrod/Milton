// components/restaurant/costs/CostsFileWorkspace.tsx
//
// Always mounts CostsSetupSection so the first «Subir archivo» / «Ver» click
// can open the picker. The wrapper toggles open/closed without `hidden` (or
// any display:none) on the file panel's ancestors.

"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { CostsSetupSection } from "./CostsSetupSection";
import {
  COSTS_FILE_ANCHOR,
  OPEN_COSTS_PICKER_EVENT,
} from "@/lib/restaurant/costs-picker";

const CLOSED_CLASS =
  "invisible pointer-events-none absolute w-px h-px overflow-hidden";
const OPEN_CLASS =
  "w-full rounded-lg border border-[#dfe3ea] bg-white p-4 my-5";

export function CostsFileWorkspace({
  locationId,
  companyId,
}: {
  locationId: string | null;
  companyId: string | null;
}) {
  const { d } = useT();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasWork, setHasWork] = useState(false);

  useEffect(() => {
    const onOpen = () => {
      setVisible(true);
      requestAnimationFrame(() => {
        document
          .getElementById(COSTS_FILE_ANCHOR)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };
    window.addEventListener(OPEN_COSTS_PICKER_EVENT, onOpen);

    const checkHash = () => {
      if (window.location.hash === `#${COSTS_FILE_ANCHOR}`) setVisible(true);
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);

    return () => {
      window.removeEventListener(OPEN_COSTS_PICKER_EVENT, onOpen);
      window.removeEventListener("hashchange", checkHash);
    };
  }, []);

  const handleWorkInProgress = useCallback((inProgress: boolean) => {
    setHasWork(inProgress);
    if (inProgress) setVisible(true);
  }, []);

  const handleBusyChange = useCallback((isBusy: boolean) => {
    setBusy(isBusy);
  }, []);

  const handleClose = () => {
    if (!busy && !hasWork) setVisible(false);
  };

  return (
    <div
      data-testid="costs-file-workspace"
      data-open={visible ? "true" : "false"}
      className={visible ? OPEN_CLASS : CLOSED_CLASS}
    >
      {visible ? (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-[#151c2c]">
            {d.costs.setup.costsFile}
          </h2>
          {!busy && !hasWork ? (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg p-1.5 text-[#6b7385] hover:bg-[#f1f3f7]"
              aria-label={d.costs.setup.close}
            >
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      ) : null}
      <div id={COSTS_FILE_ANCHOR}>
        <CostsSetupSection
          locationId={locationId}
          companyId={companyId}
          embeddedInWorkspace
          onWorkInProgress={handleWorkInProgress}
          onBusyChange={handleBusyChange}
        />
      </div>
    </div>
  );
}
