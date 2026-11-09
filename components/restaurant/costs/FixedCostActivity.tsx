"use client";

// Activity: collapsed by default, one entry per OPERATION (an upload, an undo, a
// re-approval, a copy), never one line per history row. Each entry names its
// file or source, its destination months and its outcome, and opens to the
// before/after of every category. The audit rows underneath are never merged.

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { categoryLabel } from "@/lib/restaurant/fixed-costs";
import type { ActivityEntry } from "@/lib/restaurant/fixed-cost-activity";
import { monthText } from "@/lib/restaurant/fixed-cost-overview";

const TAG: Record<ActivityEntry["kind"], string> = {
  approved: "bg-[#E7EDFD] text-[#1B40C8]",
  reapproved: "bg-[#E7EDFD] text-[#1B40C8]",
  undone: "bg-[#FDE68A] text-[#0F172A]",
  copied: "bg-[#EEF0F4] text-[#4a5266]",
  saved: "bg-[#EEF0F4] text-[#4a5266]",
  item: "bg-[#EEF0F4] text-[#4a5266]",
};

export function FixedCostActivity({
  entries,
  elsewhere = 0,
  currency,
}: {
  entries: ActivityEntry[];
  /** Operations that touched another restaurant or the group. */
  elsewhere?: number;
  currency: string;
}) {
  const { d, lang, locale, fmt } = useT();
  const a = d.costs.fixedActivity;
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const money = (n: number | null) =>
    n === null ? "—" : formatMoney(n, currency, lang);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const kindText = (k: ActivityEntry["kind"]) => a[k];
  const dirText = {
    up: a.up,
    down: a.down,
    same: a.noChange,
    new: a.created,
    removed: a.removed,
  };

  return (
    <section
      aria-label={a.title}
      data-testid="fixed-activity"
      className="rounded-2xl border border-[#dfe3ea] bg-white"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
        data-testid="activity-toggle"
      >
        <span className="text-sm font-bold text-[#151c2c]">
          {a.title}
          <span className="ml-2 font-normal text-[#6b7385]">
            {entries.length === 0
              ? a.empty
              : fmt(a.summary, { n: entries.length })}
          </span>
        </span>
        <span className="text-sm font-semibold text-[#1B40C8]">
          {open ? a.hide : a.show}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-[#dfe3ea] p-4">
          <p className="text-xs text-[#6b7385]">{a.note}</p>
          {elsewhere > 0 ? (
            <p
              className="text-xs text-[#4a5266]"
              data-testid="activity-elsewhere"
            >
              {fmt(a.elsewhere, { n: elsewhere })}
            </p>
          ) : null}
          {entries.length === 0 ? (
            <p className="text-sm text-[#4a5266]">{a.empty}</p>
          ) : (
            <ol className="space-y-2">
              {entries.map((e) => {
                const expanded = openId === e.id;
                return (
                  <li
                    key={e.id}
                    data-testid={`activity-${e.kind}`}
                    className="rounded-lg border border-[#eef0f4] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${TAG[e.kind]}`}
                      >
                        {kindText(e.kind)}
                      </span>
                      <span className="text-xs text-[#6b7385]">
                        {when(e.at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#151c2c]">
                      {e.source ? fmt(a.from, { name: e.source }) : null}
                      {e.source && e.months.length ? " · " : null}
                      {e.months.length
                        ? fmt(a.months, {
                            list: e.months
                              .map((m) => monthText(m, lang))
                              .join(", "),
                          })
                        : null}
                    </p>
                    {e.changes.length > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpenId(expanded ? null : e.id)}
                          aria-expanded={expanded}
                          className="mt-1 min-h-[32px] text-sm font-semibold text-[#1B40C8] underline"
                        >
                          {expanded ? a.hideDetail : a.detail}
                        </button>
                        {expanded ? (
                          <ul className="mt-1 space-y-1 text-sm">
                            {e.changes.map((c) => (
                              <li key={`${c.month}|${c.category}`}>
                                <span className="font-semibold">
                                  {categoryLabel(c.category, lang)}
                                </span>{" "}
                                · {monthText(c.month, lang)} · {money(c.before)}{" "}
                                → {money(c.after)} ·{" "}
                                <span className="text-[#4a5266]">
                                  {dirText[c.direction]}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
