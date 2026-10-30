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
import { useT } from "@/lib/i18n/client";
import { userErrorMessage } from "@/lib/restaurant/user-error";

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
  const { d, lang } = useT();
  const w = d.menu.workspace.menuReader;
  /** «Ver detalle»: the menu's dishes grouped by what happened, in this order. */
  const DETAIL_GROUPS: Array<{ outcome: MenuOutcomeCode; title: string }> = [
    { outcome: "drafted", title: w.groups.drafted },
    { outcome: "no_pos_match", title: w.groups.noPosMatch },
    { outcome: "has_recipe", title: w.groups.hasRecipe },
    { outcome: "draft_exists", title: w.groups.draftExists },
    { outcome: "no_ingredients", title: w.groups.noIngredients },
    { outcome: "failed", title: w.groups.failed },
  ];
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
        throw new Error(userErrorMessage(json, w.readFailed));
      }
      setResult(json);
      if (json.drafted > 0) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : w.readFailed);
    } finally {
      setBusy(false);
    }
  }

  const Wrapper = embedded ? "div" : Card;
  return (
    <Wrapper className="space-y-2.5">
      {embedded ? null : (
        <h2 className="text-[15px] font-semibold">{w.title}</h2>
      )}

      {hideReader ? null : (
        <div className="space-y-2.5">
          <div className="flex gap-3 text-[12px] font-semibold">
            <button
              type="button"
              className={mode === "url" ? "text-[#1b2333]" : "text-[#3557c9]"}
              onClick={() => setMode("url")}
            >
              {w.modeUrl}
            </button>
            <button
              type="button"
              className={mode === "text" ? "text-[#1b2333]" : "text-[#3557c9]"}
              onClick={() => setMode("text")}
            >
              {w.modeText}
            </button>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {mode === "url" ? (
              <input
                value={url}
                disabled={busy || !canEdit}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={w.urlPlaceholder}
                className="min-w-0 flex-1 rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm disabled:bg-[#f6f7f9]"
              />
            ) : (
              <textarea
                value={text}
                disabled={busy || !canEdit}
                onChange={(event) => setText(event.target.value)}
                placeholder={w.textPlaceholder}
                rows={5}
                className="min-w-0 flex-1 rounded-md border border-[#d5dae3] px-2 py-1.5 text-sm disabled:bg-[#f6f7f9]"
              />
            )}
            <GhostBtn
              disabled={!canEdit || busy || busyExternal || !value}
              onClick={() => void read()}
            >
              {busy ? w.reading : w.read}
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
          {menuReadSummaryLines(result, lang).map((line) => (
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
                    {showMissing ? w.hide : w.showWhich}
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
                {showDetail ? w.hideDetail : w.showDetail}
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
