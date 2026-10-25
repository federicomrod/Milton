"use client";

// «Estimado por Milton» on a dish (issue #212): what Milton thinks the dish
// takes and what each ingredient costs in the country. Muted and dashed on
// purpose: it never replaces the real cost, margin or status of the dish.
// «Usar como borrador» turns it into a draft recipe the person validates.

import { useState } from "react";
import type { DishEstimateRow } from "@/lib/restaurant/menu-reading/estimate";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import {
  ESTIMATE_BADGE,
  ESTIMATE_USE_BUTTON,
  PRICE_ESTIMATE_BADGE,
} from "@/components/restaurant/menu/estimate-overlay";
import { GhostBtn } from "./ui";

const UNIT_LABEL: Record<string, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  l: "l",
  oz: "oz",
  lb: "lb",
  unidad: "unidad",
};

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-[#f1f3f7] px-1.5 py-px text-[11px] font-semibold whitespace-nowrap text-[#5b6476]">
      {children}
    </span>
  );
}

export function EstimatePanel({
  estimate,
  currency,
  canEdit,
  busy = false,
  onUsed,
}: {
  estimate: DishEstimateRow;
  currency: string;
  canEdit: boolean;
  busy?: boolean;
  /** After the draft was made: refresh the dish and its editor. */
  onUsed: () => void;
}) {
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function use() {
    if (posting) return;
    setPosting(true);
    setNote(null);
    try {
      const res = await fetch("/api/restaurant/recipes/menu/estimate/use", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ menu_item_id: estimate.menu_item_id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNote(json.error ?? "No pude usar el estimado como borrador.");
        return;
      }
      onUsed();
    } catch {
      setNote("No pude usar el estimado como borrador.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div
      data-testid="estimate-panel"
      className="space-y-2 rounded-lg border border-dashed border-[#c9cfdb] bg-[#fafbfc] px-3 py-2.5 text-[13px] text-[#6b7280]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{ESTIMATE_BADGE}</Tag>
        <span>
          Cuánto lleva y cuánto cuesta cada ingrediente son aproximaciones; tú
          las validas.
        </span>
      </div>
      {estimate.lines.length > 0 ? (
        <ul className="space-y-1">
          {estimate.lines.map((line, i) => (
            <li
              key={`${line.raw_name}-${i}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <b className="font-semibold text-[#4b5466]">{line.raw_name}</b>
              <span>
                {line.qty} {UNIT_LABEL[line.unit] ?? line.unit}
              </span>
              <Tag>{ESTIMATE_BADGE}</Tag>
              <span aria-hidden>·</span>
              {line.unit_price != null && line.price_source ? (
                <>
                  <span>
                    {formatMoneyEs(line.unit_price, currency, {
                      decimals: line.unit_price >= 1 ? 2 : 4,
                    })}
                    {line.price_unit
                      ? ` / ${UNIT_LABEL[line.price_unit] ?? line.price_unit}`
                      : ""}
                  </span>
                  <Tag>
                    {line.price_source === "real"
                      ? "Real"
                      : PRICE_ESTIMATE_BADGE}
                  </Tag>
                </>
              ) : (
                <span>Sin precio</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {estimate.portion_note ? (
        <p className="text-[12px]">{estimate.portion_note}</p>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <GhostBtn disabled={busy || posting} onClick={() => void use()}>
            {ESTIMATE_USE_BUTTON}
          </GhostBtn>
          {note ? (
            <span role="status" className="text-[12px] text-[#6b7280]">
              {note}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
