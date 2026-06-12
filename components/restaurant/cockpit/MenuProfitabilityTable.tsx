// components/restaurant/cockpit/MenuProfitabilityTable.tsx
//
// Compact, interactive menu profitability table.
//
// Status column is replaced with a small color-coded dot:
//   * green  → costing complete
//   * yellow → missing setup (no recipe, missing cost, etc.)
//   * red    → costing blocked (unit mismatch, circular reference)
//
// Hovering or focusing the dot reveals the full explanation via a native
// title attribute — no popover library dependency. A small legend sits
// above the table.
//
// Filters: category dropdown, status filter, "only issues" toggle.
// Sort: click any sortable header to toggle asc/desc.

"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import type { MenuMarginRow } from "@/lib/restaurant/profitability-server";
import type { CostStatus } from "@/types/restaurant-costing";

// ---------------------------------------------------------------------------
// Status color mapping
// ---------------------------------------------------------------------------

type StatusTone = "green" | "yellow" | "red";

const STATUS_TONE: Record<string, StatusTone> = {
  complete: "green",
  missing_recipe: "yellow",
  missing_component_recipe: "yellow",
  missing_input_cost: "yellow",
  no_cost_entries: "yellow",
  inactive_recipe: "yellow",
  missing_unit_conversion: "red",
  circular_component_reference: "red",
};

const TONE_BG: Record<StatusTone, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  complete: "Complete",
  missing_recipe: "Missing recipe",
  missing_component_recipe: "Missing component recipe",
  missing_input_cost: "Missing ingredient cost",
  missing_unit_conversion: "Unit mismatch",
  circular_component_reference: "Circular reference",
  no_cost_entries: "No cost entries",
  inactive_recipe: "Inactive recipe",
};

function buildStatusTitle(row: MenuMarginRow): string {
  const label = STATUS_LABEL[row.cost.status] ?? row.cost.status;
  // Prefer the engine's first issue message (which already includes the
  // recipe path), and fall back to the bare label.
  const detail = row.cost.issues[0]?.message;
  const mappingHint = row.raw_pos_names.length === 0 ? " · No POS mapping" : "";
  return detail
    ? `${label}: ${detail}${mappingHint}`
    : `${label}${mappingHint}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function makeFmt(currency: string) {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const locale = safe === "MXN" ? "es-MX" : "en-US";
  return {
    money: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
    money2: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    num: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
  };
}

function pct(n: number | null, digits = 1): string {
  return n !== null && Number.isFinite(n) ? n.toFixed(digits) + "%" : "—";
}

// ---------------------------------------------------------------------------
// Sort logic
// ---------------------------------------------------------------------------

type SortKey =
  | "name"
  | "revenue"
  | "units"
  | "price"
  | "cost"
  | "gp"
  | "gm"
  | "fc";

function sortValue(row: MenuMarginRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "revenue":
      return row.revenue;
    case "units":
      return row.units_sold;
    case "price":
      return row.selling_price;
    case "cost":
      return row.cost.cost;
    case "gp":
      return row.estimated_gross_profit;
    case "gm":
      return row.cost.gross_margin_pct;
    case "fc":
      return row.cost.food_cost_pct;
  }
}

function compareNullsLast(
  a: number | string | null,
  b: number | string | null,
  dir: 1 | -1
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls always last
  if (b === null) return -1;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * dir;
  }
  return ((a as number) - (b as number)) * dir;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MenuProfitabilityTable({
  rows,
  currency,
}: {
  rows: MenuMarginRow[];
  currency: string;
}) {
  const fmt = makeFmt(currency);

  const [category, setCategory] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "complete" | "issues"
  >("all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.category) set.add(r.category);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const effectiveStatus = onlyIssues ? "issues" : statusFilter;
    const f = rows.filter((r) => {
      if (category !== "__all__" && r.category !== category) return false;
      const hasIssue = r.cost.status !== "complete";
      if (effectiveStatus === "complete" && hasIssue) return false;
      if (effectiveStatus === "issues" && !hasIssue) return false;
      return true;
    });
    const dir: 1 | -1 = sortDir === "desc" ? -1 : 1;
    return [...f].sort((a, b) =>
      compareNullsLast(sortValue(a, sortKey), sortValue(b, sortKey), dir)
    );
  }, [rows, category, statusFilter, onlyIssues, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const sortIcon = (k: SortKey) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "desc" ? (
      <ArrowDown className="h-3 w-3" />
    ) : (
      <ArrowUp className="h-3 w-3" />
    );
  };

  // Issue count for the filter chip.
  const totalIssues = rows.filter((r) => r.cost.status !== "complete").length;

  return (
    <div className="space-y-3">
      {/* Filter bar + legend */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="__all__">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Status</span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "complete" | "issues")
              }
              disabled={onlyIssues}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
            >
              <option value="all">All</option>
              <option value="complete">Complete only</option>
              <option value="issues">Issues only</option>
            </select>
          </label>
          <Button
            size="sm"
            variant={onlyIssues ? "default" : "outline"}
            className="h-8 text-xs gap-1.5"
            onClick={() => setOnlyIssues((v) => !v)}
          >
            <Dot tone="yellow" />
            Only show issues
            <span className="tabular-nums opacity-80">({totalIssues})</span>
          </Button>
        </div>
        <Legend />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No menu items match the current filters.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr className="text-left text-xs text-muted-foreground">
                    <SortableTh
                      active={sortKey === "name"}
                      onClick={() => toggleSort("name")}
                      icon={sortIcon("name")}
                    >
                      Menu item
                    </SortableTh>
                    <th className="px-3 py-3 font-medium">POS mapping</th>
                    <SortableTh
                      active={sortKey === "units"}
                      onClick={() => toggleSort("units")}
                      icon={sortIcon("units")}
                      align="right"
                    >
                      Units
                    </SortableTh>
                    <SortableTh
                      active={sortKey === "revenue"}
                      onClick={() => toggleSort("revenue")}
                      icon={sortIcon("revenue")}
                      align="right"
                    >
                      Revenue
                    </SortableTh>
                    <SortableTh
                      active={sortKey === "price"}
                      onClick={() => toggleSort("price")}
                      icon={sortIcon("price")}
                      align="right"
                    >
                      Price
                    </SortableTh>
                    <SortableTh
                      active={sortKey === "cost"}
                      onClick={() => toggleSort("cost")}
                      icon={sortIcon("cost")}
                      align="right"
                    >
                      Est. cost
                    </SortableTh>
                    <SortableTh
                      active={sortKey === "gp"}
                      onClick={() => toggleSort("gp")}
                      icon={sortIcon("gp")}
                      align="right"
                    >
                      Gross profit
                    </SortableTh>
                    <SortableTh
                      active={sortKey === "gm"}
                      onClick={() => toggleSort("gm")}
                      icon={sortIcon("gm")}
                      align="right"
                    >
                      GM %
                    </SortableTh>
                    <SortableTh
                      active={sortKey === "fc"}
                      onClick={() => toggleSort("fc")}
                      icon={sortIcon("fc")}
                      align="right"
                    >
                      FC %
                    </SortableTh>
                    <th
                      className="px-3 py-3 font-medium text-center w-10"
                      title="Status"
                    >
                      <span className="sr-only">Status</span>
                      <span aria-hidden>•</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((r, i) => {
                    const tone = STATUS_TONE[r.cost.status] ?? "yellow";
                    const showCostNumbers =
                      r.cost.status === "complete" && r.cost.cost !== null;
                    return (
                      <tr
                        key={r.menu_item_id}
                        className={
                          (i % 2 === 1 ? "bg-muted/20" : "bg-background") +
                          " border-b border-border hover:bg-muted/30 align-middle"
                        }
                      >
                        <td className="px-3 py-2 font-medium">
                          <div>{r.name}</div>
                          {r.category && (
                            <div className="text-xs text-muted-foreground">
                              {r.category}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                          {r.raw_pos_names.length === 0 ? (
                            <span className="text-amber-700 dark:text-amber-300">
                              No POS mapping
                            </span>
                          ) : r.raw_pos_names.length === 1 ? (
                            r.raw_pos_names[0]
                          ) : (
                            <>
                              {r.raw_pos_names[0]}
                              <span className="text-muted-foreground">
                                {" "}
                                +{r.raw_pos_names.length - 1}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt.num.format(r.units_sold)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt.money.format(r.revenue)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.selling_price !== null
                            ? fmt.money2.format(r.selling_price)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {showCostNumbers
                            ? fmt.money2.format(r.cost.cost!)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {showCostNumbers && r.estimated_gross_profit !== null
                            ? fmt.money.format(r.estimated_gross_profit)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {showCostNumbers ? pct(r.cost.gross_margin_pct) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {showCostNumbers ? pct(r.cost.food_cost_pct) : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <StatusDot
                            tone={tone}
                            title={buildStatusTitle(r)}
                            status={r.cost.status}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > 100 && (
              <p className="text-xs text-muted-foreground px-4 py-2 border-t">
                Showing first 100 of {filtered.length} matching items.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Dot({ tone }: { tone: StatusTone }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${TONE_BG[tone]}`}
      aria-hidden
    />
  );
}

function StatusDot({
  tone,
  title,
  status,
}: {
  tone: StatusTone;
  title: string;
  status: CostStatus;
}) {
  return (
    <span
      className="inline-flex items-center justify-center group cursor-help"
      title={title}
      tabIndex={0}
      role="img"
      aria-label={`Status: ${STATUS_LABEL[status] ?? status}`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_BG[tone]} ring-2 ring-background group-hover:ring-muted transition-shadow`}
      />
    </span>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Dot tone="green" /> Complete
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot tone="yellow" /> Missing setup
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot tone="red" /> Costing blocked
      </span>
      <span className="text-muted-foreground/70 hidden md:inline">
        · hover the dot for details
      </span>
    </div>
  );
}

function SortableTh({
  children,
  onClick,
  active,
  icon,
  align = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  icon: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-3 font-medium ${align === "right" ? "text-right" : ""}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={
          "inline-flex items-center gap-1 hover:text-foreground transition-colors " +
          (active ? "text-foreground" : "")
        }
      >
        <span>{children}</span>
        {icon}
      </button>
    </th>
  );
}
