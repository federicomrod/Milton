"use client";

// Recurring costs are expectations, not recorded actuals. This is the ONE
// explicit review that turns them into recorded amounts for a target month:
// nothing is copied while a page is read, reloaded or navigated. The copy keeps
// item detail (the database copies the source items) and only fills categories
// that are still empty, so no existing amount is touched.

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/restaurant/costs-format";
import {
  categoryLabel,
  type AmountCategory,
} from "@/lib/restaurant/fixed-costs";
import type { CopyPreview } from "@/lib/restaurant/fixed-cost-commands";
import { monthText } from "@/lib/restaurant/fixed-cost-overview";

const BTN =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#1B40C8] px-4 text-sm font-semibold text-white hover:bg-[#1533A3] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2";
const BTN_LIGHT =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#1B40C8] bg-white px-4 text-sm font-semibold text-[#1B40C8] hover:bg-[#E7EDFD] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]";

export function FixedCostRecurring({
  month,
  from,
  categories,
  locationId,
  currency,
  onApplied,
}: {
  /** Target month (YYYY-MM-01). */
  month: string;
  /** The month the recurring references come from (YYYY-MM-01). */
  from: string;
  /** Categories that are recurring and still empty in `month`. */
  categories: AmountCategory[];
  locationId: string | null;
  currency: string;
  onApplied: (changed: string[]) => void;
}) {
  const { d, lang, fmt } = useT();
  const o = d.costs.fixedOverview;
  const r = d.costs.fixedReview;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency, lang);

  async function load() {
    setError(null);
    setOpen(true);
    const q = new URLSearchParams({
      month: month.slice(0, 7),
      from: from.slice(0, 7),
    });
    if (locationId) q.set("location", locationId);
    const res = await fetch(`/api/restaurant/fixed-costs/copy?${q}`);
    const j = res.ok ? await res.json().catch(() => null) : null;
    if (j?.categories) setPreview(j as CopyPreview);
    else setError(r.failed);
  }

  // Only the recurring categories that are still empty here: nothing existing is replaced.
  const rows = (preview?.categories ?? []).filter(
    (c) =>
      categories.includes(c.category as AmountCategory) &&
      c.state === "missing_in_destination" &&
      c.source
  );

  async function accept() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/restaurant/fixed-costs/copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          month,
          from,
          location_id: locationId,
          commandKey: crypto.randomUUID(),
          categories: rows.map((c) => c.category),
          decisions: {},
          expected: Object.fromEntries(
            rows.map((c) => [
              `${locationId ?? "group"}|${month}|${c.category}`,
              c.destination_version,
            ])
          ),
        }),
      });
      if (!res.ok) {
        setError(r.failed);
        return;
      }
      onApplied(rows.map((c) => `${month}|${c.category}`));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (categories.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="recurring">
      {!open ? (
        <button type="button" className={BTN_LIGHT} onClick={load}>
          {fmt(o.acceptRecurring, { month: monthText(month, lang) })}
        </button>
      ) : (
        <section
          aria-label={o.recurring}
          className="space-y-3 rounded-xl border border-[#1B40C8] bg-[#F8FAFF] p-4"
        >
          <h3 className="text-sm font-bold text-[#151c2c]">
            {fmt(o.acceptRecurring, { month: monthText(month, lang) })}
          </h3>
          <p className="text-xs text-[#6b7385]">
            {o.recurring} · {monthText(from, lang)}
          </p>
          <ul className="space-y-1 text-sm">
            {rows.map((c) => (
              <li key={c.category} data-testid={`recurring-${c.category}`}>
                <span className="font-semibold">
                  {categoryLabel(c.category, lang)}
                </span>{" "}
                · {r.nothingBefore} → {money(c.source?.amount ?? 0)}
                {c.source?.items.length ? (
                  <span className="text-xs text-[#6b7385]">
                    {" "}
                    ({c.source.items.map((i) => i.label ?? "—").join(", ")})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="text-sm text-[#b42318]">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className={BTN}
              disabled={busy || rows.length === 0}
              onClick={accept}
            >
              {busy ? r.saving : r.confirm}
            </button>
            <button
              type="button"
              className={BTN_LIGHT}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {r.cancel}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
