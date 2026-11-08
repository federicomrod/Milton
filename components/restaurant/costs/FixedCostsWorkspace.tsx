"use client";

// Costos fijos on desktop: one multi-month overview, ONE import review, and a
// collapsed activity log. The restaurant is chosen by the shell's persistent
// selector; this workspace only shows it. The month window moves when the person
// moves it, and never because a file was imported.

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { costsTabHref } from "@/lib/restaurant/costs-tabs";
import {
  categoryLabel,
  type AmountCategory,
} from "@/lib/restaurant/fixed-costs";
import type { ItemView } from "@/lib/restaurant/fixed-costs-server";
import type { ActivityEntry } from "@/lib/restaurant/fixed-cost-activity";
import {
  monthText,
  shiftMonth,
  type Overview,
} from "@/lib/restaurant/fixed-cost-overview";
import { FixedCostOverview } from "./FixedCostOverview";
import { FixedCostImport, type ImportApplied } from "./FixedCostImport";
import { FixedCostRecurring } from "./FixedCostRecurring";
import { FixedCostActivity } from "./FixedCostActivity";

type ItemsByMonth = Record<string, Partial<Record<AmountCategory, ItemView[]>>>;

export function FixedCostsWorkspace({
  overview,
  itemsByMonth,
  activity,
  currency,
  selectedMonth,
  currentMonth,
  locationId,
  locationName,
  restaurants,
  shellParams,
  canWrite,
}: {
  overview: Overview;
  itemsByMonth: ItemsByMonth;
  activity: ActivityEntry[];
  currency: string;
  /** The last month of the window (YYYY-MM-01). */
  selectedMonth: string;
  currentMonth: string;
  locationId: string | null;
  locationName: string | null;
  restaurants: Array<{ id: string; name: string }>;
  shellParams: Record<string, string | string[] | undefined>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const { d, lang, fmt } = useT();
  const o = d.costs.fixedOverview;
  const [, startNav] = useTransition();
  const [expanded, setExpanded] = useState<ReadonlySet<AmountCategory>>(
    new Set()
  );
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [detail, setDetail] = useState<{
    month: string;
    category: AmountCategory;
  } | null>(null);
  const windowMonths = overview.months.map((m) => m.month);
  const money = (n: number) => formatMoney(n, currency, lang);

  const href = useCallback(
    (month: string) =>
      costsTabHref("costos-fijos", {
        ...shellParams,
        month: month.slice(0, 7),
      }),
    [shellParams]
  );
  const goTo = useCallback(
    (month: string) => {
      const target = month > currentMonth ? currentMonth : month;
      startNav(() => router.push(href(target)));
    },
    [router, href, currentMonth]
  );

  const onApplied = useCallback(
    (a: ImportApplied) => {
      setChanged(new Set(a.changed));
      router.refresh();
    },
    [router]
  );

  // Changed categories that have positions open on their own while the result
  // is on screen, so the change is visible. Closing the result lets them rest.
  const shownExpanded = useMemo(() => {
    const next = new Set(expanded);
    for (const k of changed) {
      const c = k.split("|")[1] as AmountCategory;
      if (overview.positions[c]?.length) next.add(c);
    }
    return next;
  }, [expanded, changed, overview.positions]);

  const last = overview.months[overview.months.length - 1];
  // Recurring references still unrecorded in the selected month, from one source month.
  const recurring = useMemo(() => {
    const cells = Object.entries(last.cells).filter(
      ([, c]) => c.state === "recurring"
    ) as Array<[AmountCategory, (typeof last.cells)[AmountCategory]]>;
    if (cells.length === 0) return null;
    const from = cells
      .map(([, c]) => c.referenceMonth as string)
      .sort()
      .reverse()[0];
    return {
      from,
      categories: cells
        .filter(([, c]) => c.referenceMonth === from)
        .map(([k]) => k),
    };
  }, [last]);

  const title = locationName ?? o.groupLabel;
  const detailCell = detail
    ? overview.months.find((m) => m.month === detail.month)?.cells[
        detail.category
      ]
    : null;
  const detailItems = detail
    ? (itemsByMonth[detail.month]?.[detail.category] ?? [])
    : [];

  return (
    <div className="space-y-4 pb-24 lg:pb-0" data-testid="fixed-workspace">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#6b7385]">
            {o.restaurantLabel}
          </p>
          <h2
            className="text-xl font-bold text-[#151c2c]"
            data-testid="workspace-scope"
          >
            {title}
          </h2>
        </div>
        <FixedCostImport
          month={selectedMonth}
          locationId={locationId}
          restaurants={restaurants}
          currency={currency}
          overview={overview}
          windowMonths={windowMonths}
          onApplied={onApplied}
          onViewMonths={(months) => goTo(months[months.length - 1])}
          onDismiss={() => setChanged(new Set())}
          onUndone={() => {
            setChanged(new Set());
            router.refresh();
          }}
          canWrite={canWrite}
        />
      </header>

      {canWrite && recurring ? (
        <FixedCostRecurring
          month={selectedMonth}
          from={recurring.from}
          categories={recurring.categories}
          locationId={locationId}
          currency={currency}
          onApplied={(keys) =>
            onApplied({
              changed: keys,
              months: [selectedMonth],
              commandId: null,
            })
          }
        />
      ) : null}

      <FixedCostOverview
        overview={overview}
        currency={currency}
        selectedMonth={selectedMonth}
        expanded={shownExpanded}
        onToggle={(c) =>
          setExpanded((cur) => {
            const next = new Set(cur);
            if (next.has(c)) next.delete(c);
            else next.add(c);
            return next;
          })
        }
        onOpen={(month, category) => setDetail({ month, category })}
        changed={changed}
        onShift={(delta) => goTo(shiftMonth(selectedMonth, delta))}
        canShiftLater={selectedMonth < currentMonth}
      />

      {detail && detailCell ? (
        <aside
          role="dialog"
          aria-modal="false"
          aria-label={fmt(o.detailTitle, {
            category: categoryLabel(detail.category, lang),
            month: monthText(detail.month, lang),
          })}
          data-testid="cell-detail"
          className="space-y-2 rounded-xl border border-[#1B40C8] bg-white p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-bold text-[#151c2c]">
              {fmt(o.detailTitle, {
                category: categoryLabel(detail.category, lang),
                month: monthText(detail.month, lang),
              })}
            </h3>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="min-h-[32px] text-sm font-semibold text-[#1B40C8] underline"
            >
              {o.detailClose}
            </button>
          </div>
          <p className="text-sm">
            {o.detailTotal}:{" "}
            <span className="font-semibold">
              {detailCell.amount === null ? "—" : money(detailCell.amount)}
            </span>
          </p>
          {detailItems.length === 0 ? (
            <p className="text-xs text-[#6b7385]">{o.detailOnlyTotal}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {detailItems.map((i) => (
                <li key={i.id}>
                  {i.kind === "legacy_base" ? o.noDetail : (i.label ?? "—")} ·{" "}
                  {money(i.cents / 100)} ·{" "}
                  <span className="text-xs text-[#6b7385]">
                    {i.origin.fileName
                      ? fmt(o.sourceFile, { name: i.origin.fileName })
                      : i.origin.copiedFrom
                        ? fmt(o.sourceCopy, {
                            month: monthText(i.origin.copiedFrom, lang),
                          })
                        : i.origin.manual
                          ? o.sourceManual
                          : o.sourceUnknown}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      ) : null}

      <FixedCostActivity entries={activity} currency={currency} />
    </div>
  );
}
