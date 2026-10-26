"use client";

// «Estimado por Milton» on a dish (issue #212): what Milton thinks the dish
// takes and what each ingredient costs in the country. Muted and dashed on
// purpose: it never replaces the real cost, margin or status of the dish.
// «Usar como borrador» turns it into a draft recipe the person validates.

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { DishEstimateRow } from "@/lib/restaurant/menu-reading/estimate";
import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import {
  ESTIMATE_BADGE,
  ESTIMATE_USE_BUTTON,
  ESTIMATE_USE_SUCCESS,
  PRICE_ESTIMATE_BADGE,
  canUseEstimateAsDraft,
} from "@/components/restaurant/menu/estimate-overlay";
import { useToast } from "@/components/ui/use-toast";
import { PrimaryBtn } from "./ui";

const UNIT_LABEL: Record<string, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  l: "l",
  oz: "oz",
  lb: "lb",
  unidad: "unidad",
};

function Tag({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "estimate";
}) {
  return variant === "estimate" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ai-lavender)] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[var(--brand-ink)]">
      <Sparkles className="h-3 w-3 text-[var(--brand-blue)]" />
      {children}
    </span>
  ) : (
    <span className="rounded-full bg-[var(--ai-lavender)] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[var(--brand-ink)]">
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
  const { toast } = useToast();
  const canUse = canUseEstimateAsDraft(estimate);

  async function use() {
    if (posting || !canUse) return;
    setPosting(true);
    setNote(null);
    try {
      const res = await fetch("/api/restaurant/recipes/menu/estimate/use", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ menu_item_id: estimate.menu_item_id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        applied?: number;
      };
      if (!res.ok) {
        setNote(json.error ?? "No pude usar el estimado como borrador.");
        return;
      }
      toast({
        title: ESTIMATE_USE_SUCCESS(
          typeof json.applied === "number"
            ? json.applied
            : estimate.lines.length
        ),
      });
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
      className="space-y-2 rounded-lg bg-[#D8D0F8]/40 px-3 py-2.5 text-[13px]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tag variant="estimate">{ESTIMATE_BADGE}</Tag>
        <span className="text-[var(--brand-ink)]">
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
              <b className="font-semibold text-[var(--brand-ink)]">
                {line.raw_name}
              </b>
              <span className="text-[var(--brand-ink)]">
                {line.qty} {UNIT_LABEL[line.unit] ?? line.unit}
              </span>
              <Tag>{ESTIMATE_BADGE}</Tag>
              <span aria-hidden className="text-[var(--brand-ink)]">
                ·
              </span>
              {line.unit_price != null && line.price_source ? (
                <>
                  <span className="font-semibold text-[var(--brand-blue)]">
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
                <span className="text-[var(--brand-ink)]">Sin precio</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {estimate.portion_note ? (
        <p className="text-[12px] text-[var(--brand-ink)]">
          {estimate.portion_note}
        </p>
      ) : null}
      {canEdit && canUse ? (
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryBtn disabled={busy || posting} onClick={() => void use()}>
            {ESTIMATE_USE_BUTTON}
          </PrimaryBtn>
          {note ? (
            <span
              role="status"
              className="text-[12px] text-[var(--brand-muted)]"
            >
              {note}
            </span>
          ) : null}
        </div>
      ) : note ? (
        <span role="status" className="text-[12px] text-[var(--brand-muted)]">
          {note}
        </span>
      ) : null}
    </div>
  );
}
