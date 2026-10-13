"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRestaurantShellChrome } from "@/components/restaurant/shell/shell-chrome-context";
import { useAskMiltonController } from "@/components/restaurant/shell/ask-milton-controller";
import { odooSyncLabel } from "@/lib/restaurant/recipe-costing/display";
import type { RecipeCostingView } from "@/lib/restaurant/recipe-costing/workspace";
import { withShellParams } from "@/lib/restaurant/navigation";

export function CostingHeader({
  view,
  breadcrumbExtra,
}: {
  view: RecipeCostingView;
  breadcrumbExtra?: ReactNode;
}) {
  const chrome = useRestaurantShellChrome();
  const { openAskMilton } = useAskMiltonController();
  const searchParams = useSearchParams();
  const locationId = searchParams.get("location");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const href = (path: string) =>
    withShellParams(path, { locationId, from, to });
  const sync = odooSyncLabel(chrome.lastSyncedAt);
  const title =
    view === "plato"
      ? "Plato por plato"
      : view === "preparaciones"
        ? "Preparaciones"
        : "Menú";
  const showTabs = view === "resumen" || view === "menu-costeado";

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-[#1b2333]">
          {title}
        </h1>
        {sync ? (
          <span className="ml-auto text-xs text-[#7a8396]">{sync}</span>
        ) : (
          <span className="ml-auto" />
        )}
        <button
          type="button"
          onClick={() => openAskMilton()}
          className="rounded-[9px] bg-[#151c2c] px-3 py-1.5 text-xs font-semibold text-white"
        >
          ✦ Preguntar a Milton
        </button>
      </div>
      {showTabs ? (
        <div className="mt-1.5 flex gap-[22px] border-b border-[#dfe3ea] text-[12.5px] text-[#6b7385]">
          <Link
            href={href("/dashboard/restaurant/menu")}
            className="border-b-2 border-transparent py-1.5 hover:text-[#1b2333]"
          >
            Resumen
          </Link>
          <span className="border-b-2 border-[#c2410c] py-1.5 font-semibold text-[#c2410c]">
            Recetas y costeo
          </span>
        </div>
      ) : (
        <div className="mt-0.5 text-[10.5px] text-[#8a92a3]">
          Menú › Recetas y costeo ›{" "}
          <b className="text-[#1b2333]">
            {view === "preparaciones" ? "Preparaciones" : "Plato por plato"}
          </b>
          {breadcrumbExtra}
        </div>
      )}
    </div>
  );
}
