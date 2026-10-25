"use client";

// «Lee tu menú y estima costos»: the menu reader and «Estimar con Milton» as a
// normal card on Menú › Resumen (above Top platos). It reuses MenuReaderPanel
// and EstimateWithMilton: same endpoints, same chunking, same overlay.
// Estimates never change the real numbers. The card is always visible; without
// recipes.edit its button is disabled and says why.

import { useState } from "react";
import { MenuReaderPanel } from "@/components/restaurant/recipes-costing/MenuReaderPanel";
import {
  GhostBtn,
  PrimaryBtn,
} from "@/components/restaurant/recipes-costing/ui";
import { MENU_READER_ANCHOR } from "@/lib/restaurant/menu-links";
import { NoRecipeEditNotice } from "./EstimateWithMilton";

export const MENU_READER_TITLE = "Lee tu menú y estima costos";
export const MENU_READER_INTRO =
  "Pega el enlace o el texto de tu menú. Milton prepara borradores de receta y estima el costo de los platos sin receta. Las estimaciones no cambian tus números reales.";

export function noRecipeDishesLabel(n: number): string {
  return n === 1 ? "1 plato sin receta" : `${n} platos sin receta`;
}

export function MenuReaderCard({
  canEdit,
  noRecipeDishes,
  locationId,
  onDone,
}: {
  /** capabilities["recipes.edit"] (canEditRecipes). */
  canEdit: boolean;
  /** Dishes with no recipe; null when the page does not know. */
  noRecipeDishes: number | null;
  locationId: string | null;
  /** Refresh the page data after a reading / an estimate run. */
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [estimateLive, setEstimateLive] = useState(false);
  const allDone = noRecipeDishes === 0 && !open;

  if (allDone) {
    return (
      <section
        id={MENU_READER_ANCHOR}
        data-testid="menu-reader-card-done"
        className="scroll-mt-4 rounded-[14px] border border-[#eef0f4] bg-white px-4 py-2.5 text-[13px] text-[#6b7280]"
      >
        <span aria-hidden="true">✓</span> Todos tus platos tienen receta ·{" "}
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setOpen(true)}
          className="font-semibold text-[#1B40C8] disabled:text-[#6b7280] disabled:opacity-100"
        >
          Leer menú de nuevo
        </button>
        {canEdit ? null : <NoRecipeEditNotice className="mt-1" />}
      </section>
    );
  }

  return (
    <section
      id={MENU_READER_ANCHOR}
      data-testid="menu-reader-card"
      className="scroll-mt-4 space-y-2.5 rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3"
    >
      <h2 className="text-[15px] font-semibold text-[#151c2c]">
        {MENU_READER_TITLE}
      </h2>
      <p className="text-[13px] text-[#6b7280]">{MENU_READER_INTRO}</p>
      {noRecipeDishes != null && noRecipeDishes > 0 ? (
        <p className="text-[13px] font-semibold text-[#151c2c]">
          {noRecipeDishesLabel(noRecipeDishes)}
        </p>
      ) : null}
      {!canEdit ? (
        <>
          <PrimaryBtn disabled>Leer mi menú</PrimaryBtn>
          <NoRecipeEditNotice />
        </>
      ) : (
        <>
          {open ? null : estimateLive ? (
            <GhostBtn onClick={() => setOpen(true)}>Leer mi menú</GhostBtn>
          ) : (
            <PrimaryBtn onClick={() => setOpen(true)}>Leer mi menú</PrimaryBtn>
          )}
          <MenuReaderPanel
            embedded
            canEdit
            hideReader={!open}
            busyExternal={false}
            locationId={locationId}
            onDone={onDone}
            onEstimated={onDone}
            estimateVariant="primary"
            onEstimateVisible={setEstimateLive}
          />
        </>
      )}
    </section>
  );
}
