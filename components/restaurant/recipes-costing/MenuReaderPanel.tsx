"use client";

import { useState } from "react";
import { menuReadSummaryLines } from "@/lib/restaurant/menu-reading/summary";
import { dishHref } from "@/lib/restaurant/menu-links";
import type {
  MenuOutcome,
  MenuOutcomeCode,
} from "@/lib/restaurant/menu-reading/drafts";
import {
  EstimateWithMilton,
  NoRecipeEditNotice,
} from "@/components/restaurant/menu/EstimateWithMilton";
import { Card, GhostBtn } from "./ui";

interface MenuReadResponse {
  error?: string;
  dishes_read: number;
  drafted: number;
  skipped_has_recipe?: number;
  skipped_no_ingredients?: number;
  skipped_draft_exists?: number;
  no_pos_match?: number;
  not_on_menu?: number;
  failed?: number;
  new_components: number;
  not_found: string[];
  menu_outcomes?: MenuOutcome[];
  truncated?: boolean;
}

/** «Ver detalle»: the menu's dishes grouped by what happened, in this order. */
const DETAIL_GROUPS: Array<{ outcome: MenuOutcomeCode; title: string }> = [
  { outcome: "drafted", title: "Borradores nuevos" },
  { outcome: "no_pos_match", title: "Sin producto en tu POS" },
  { outcome: "has_recipe", title: "Ya tenían receta" },
  { outcome: "draft_exists", title: "Ya tenían borrador" },
  { outcome: "no_ingredients", title: "El menú no dice qué lleva" },
  { outcome: "failed", title: "No pude preparar" },
];

const BLUE_BUTTON =
  "rounded-md bg-[#1B40C8] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#1533A3]";

/**
 * "Leer menú (opcional)": the restaurant's menu (web page or pasted text)
 * becomes Sugerido drafts in Plato por plato for dishes with no recipe.
 * The Excel always wins; quantities stay pending for the person.
 */
export function MenuReaderPanel({
  canEdit,
  companyId,
  busyExternal,
  locationId,
  onDone,
  onEstimated,
  embedded = false,
  estimateVariant = "button",
  onEstimateVisible,
  hideReader = false,
}: {
  /** The card shows the inputs only after «Leer mi menú» (state is kept). */
  hideReader?: boolean;
  /** The run button's look (the Resumen card makes it the primary one). */
  estimateVariant?: "button" | "primary";
  onEstimateVisible?: (live: boolean) => void;
  /** Inside Resumen's checklist: no card or heading of its own. */
  embedded?: boolean;
  /** From capabilities["recipes.edit"] (canEditRecipes), the API's own gate. */
  canEdit: boolean;
  /** The active company (keys the cached estimate check). */
  companyId?: string | null;
  busyExternal: boolean;
  locationId: string | null;
  /** After a reading that prepared drafts: reload the workspace. */
  onDone: () => void;
  /** After «Estimar con Milton»: refresh the page data (no remount of this panel). */
  onEstimated?: () => void;
}) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MenuReadResponse | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const value = mode === "url" ? url.trim() : text.trim();

  async function read() {
    setBusy(true);
    setError(null);
    setResult(null);
    setShowMissing(false);
    setShowDetail(false);
    try {
      const res = await fetch("/api/restaurant/recipes/menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(mode === "url" ? { url: value } : { text: value }),
          location_id: locationId ?? undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MenuReadResponse;
      if (!res.ok) {
        throw new Error(json.error ?? "No pude leer el menú.");
      }
      setResult(json);
      if (json.drafted > 0) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude leer el menú.");
    } finally {
      setBusy(false);
    }
  }

  const Wrapper = embedded ? "div" : Card;
  return (
    <Wrapper className="space-y-2.5">
      {embedded ? null : (
        <h2 className="text-[15px] font-semibold">Leer menú (opcional)</h2>
      )}

      {hideReader ? null : (
        <div className="space-y-2.5">
          <div className="flex gap-3 text-[12px] font-semibold">
            <button
              type="button"
              className={mode === "url" ? "text-[#1b2333]" : "text-[#3557c9]"}
              onClick={() => setMode("url")}
            >
              Dirección del menú
            </button>
            <button
              type="button"
              className={mode === "text" ? "text-[#1b2333]" : "text-[#3557c9]"}
              onClick={() => setMode("text")}
            >
              Pega el texto del menú
            </button>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {mode === "url" ? (
              <input
                value={url}
                disabled={busy || !canEdit}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://turestaurante.com/menu"
                className="min-w-0 flex-1 rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm disabled:bg-[#f6f7f9]"
              />
            ) : (
              <textarea
                value={text}
                disabled={busy || !canEdit}
                onChange={(event) => setText(event.target.value)}
                placeholder="Copia el menú (de tu página o de un PDF) y pégalo aquí: nombre del plato, precio y descripción."
                rows={5}
                className="min-w-0 flex-1 rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm disabled:bg-[#f6f7f9]"
              />
            )}
            <GhostBtn
              disabled={!canEdit || busy || busyExternal || !value}
              onClick={() => void read()}
            >
              {busy ? "Leyendo tu menú…" : "Leer menú"}
            </GhostBtn>
          </div>
          {canEdit ? null : <NoRecipeEditNotice />}
        </div>
      )}

      <EstimateWithMilton
        canEdit={canEdit}
        companyId={companyId}
        locationId={locationId}
        busyExternal={busyExternal || busy}
        variant={estimateVariant}
        onVisibleChange={onEstimateVisible}
        hideNoRoleNotice
        forceShow={(result?.drafted ?? 0) > 0}
        onDone={onEstimated ?? onDone}
      />

      {error ? (
        <div className="rounded-md border border-[#f1c0c0] bg-[#fdecec] px-3 py-2 text-xs text-[#c03535]">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-1 rounded-md border border-[#cfe0ff] bg-[#f3f7ff] px-3 py-2 text-xs text-[#1b2333]">
          {menuReadSummaryLines(result).map((line) => (
            <p key={line.key}>
              {line.text}
              {line.key === "not_on_menu" && result.not_found.length > 0 ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className={BLUE_BUTTON}
                    aria-expanded={showMissing}
                    onClick={() => setShowMissing((open) => !open)}
                  >
                    {showMissing ? "Ocultar" : "Ver cuáles"}
                  </button>
                </>
              ) : null}
              {line.key === "not_on_menu" && showMissing ? (
                <span className="mt-1 block text-[#6b7280]">
                  {result.not_found.join(", ")}
                </span>
              ) : null}
            </p>
          ))}
          {(result.menu_outcomes ?? []).length > 0 ? (
            <div>
              <button
                type="button"
                className={BLUE_BUTTON}
                aria-expanded={showDetail}
                onClick={() => setShowDetail((open) => !open)}
              >
                {showDetail ? "Ocultar detalle" : "Ver detalle"}
              </button>
              {showDetail ? (
                <div className="mt-2 space-y-2">
                  {DETAIL_GROUPS.map(({ outcome, title }) => {
                    const rows = (result.menu_outcomes ?? []).filter(
                      (row) => row.outcome === outcome
                    );
                    if (rows.length === 0) return null;
                    return (
                      <div key={outcome}>
                        <p className="font-semibold">
                          {title} ({rows.length})
                        </p>
                        <ul className="mt-0.5 space-y-0.5 text-[#6b7280]">
                          {rows.map((row, index) => (
                            <li key={`${row.menu_dish}-${index}`}>
                              <span className="font-medium text-[#1b2333]">
                                {row.menu_dish}
                              </span>
                              {row.products.length > 0 ? (
                                <>
                                  {" → "}
                                  {row.products.map((product, i) => (
                                    <span key={product.odoo_product_id}>
                                      {i > 0 ? ", " : ""}
                                      <a
                                        href={dishHref(product.odoo_product_id)}
                                        className="font-semibold text-[#1B40C8] underline"
                                      >
                                        {product.odoo_name}
                                      </a>
                                    </span>
                                  ))}
                                </>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Wrapper>
  );
}
