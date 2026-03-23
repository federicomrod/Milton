"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Target, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { getCurrencySymbol } from "@/lib/utils/formatters";
import {
  getTargetsForModel,
  upsertBulkTargets,
  deleteTargetsForKpi,
} from "@/lib/kpi-targets";
import type { DatabaseKpi } from "@/lib/types/kpi";

// ── helpers ────────────────────────────────────────────────────────────────

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function getAllMonthsInRange(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const months: string[] = [];
  for (
    let d = new Date(fromYear, fromMonth - 1, 1);
    d <= new Date(toYear, toMonth - 1, 1);
    d.setMonth(d.getMonth() + 1)
  ) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
  }
  return months;
}

function resolveDateRange(
  period?: string,
  customDateRange?: { from: string; to: string }
): { from: string; to: string } {
  const today = new Date().toISOString().split("T")[0];
  if (period === "custom" || !period) {
    return (
      customDateRange ?? {
        from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
        to: today,
      }
    );
  }
  if (period === "ytd")
    return { from: `${new Date().getFullYear()}-01-01`, to: today };
  if (period === "year") {
    const y = new Date().getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return {
    from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    to: today,
  };
}

function formatMonthLabel(ym: string): string {
  const match = ym.match(/^(\d{4})-(\d{2})/);
  if (!match) return ym;
  const [, year, month] = match;
  return `${MONTH_ABBR[Number(month) - 1]} '${year.slice(2)}`;
}

type KpiFormat = "number" | "currency" | "percentage" | "months";

function getKpiFormat(kpiName: string): KpiFormat {
  const n = kpiName.toLowerCase().trim();
  if (
    (n.includes("rate") && !n.includes("burn")) ||
    n.includes("percentage") ||
    n.includes("utilization") ||
    n.includes("no show") ||
    n.includes("no-show") ||
    n.includes("churn") ||
    n.includes("attendance") ||
    n.includes("occupancy") ||
    n.includes("cancellation")
  ) {
    if (n.includes("burn rate")) return "currency";
    return "percentage";
  }
  if (
    n.includes("revenue") ||
    n.includes("income") ||
    n.includes("burn") ||
    n.includes("cost") ||
    n.includes("expense") ||
    n.includes("profit")
  )
    return "currency";
  if (n.includes("tenure") || n.includes("months")) return "months";
  return "number";
}

// ── types ──────────────────────────────────────────────────────────────────

interface ManageTargetsModalProps {
  modelId: string;
  selectedKpis: DatabaseKpi[];
  period?: string;
  customDateRange?: { from: string; to: string };
}

// ── component ──────────────────────────────────────────────────────────────

export function ManageTargetsModal({
  modelId,
  selectedKpis,
  period,
  customDateRange,
}: ManageTargetsModalProps) {
  const { prefs } = useUserPreferences();
  const { toast } = useToast();
  const currencySymbol = getCurrencySymbol(prefs.currency);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  // "kpiId:YYYY-MM" -> string value shown in the input
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  // set of dirty keys (changed since last load)
  const dirtyRef = useRef<Set<string>>(new Set());

  const { from, to } = resolveDateRange(period, customDateRange);
  const months = getAllMonthsInRange(from, to);

  // ── load targets when dialog opens ──────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    dirtyRef.current = new Set();
    setLoading(true);
    getTargetsForModel(modelId)
      .then((targets) => {
        const vals: Record<string, string> = {};
        for (const t of targets) {
          const month = t.period.substring(0, 7);
          vals[`${t.kpi_key}:${month}`] = String(t.value);
        }
        setCellValues(vals);
      })
      .catch(() =>
        toast({ title: "Failed to load targets", variant: "destructive" })
      )
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── cell editing ─────────────────────────────────────────────────────────

  const handleCellChange = (kpiId: string, month: string, value: string) => {
    const key = `${kpiId}:${month}`;
    setCellValues((prev) => ({ ...prev, [key]: value }));
    dirtyRef.current.add(key);
  };

  // ── save all dirty cells ─────────────────────────────────────────────────

  const handleSaveAll = async () => {
    const dirty = dirtyRef.current;
    const targets: {
      modelId: string;
      kpiKey: string;
      period: string;
      value: number;
    }[] = [];

    for (const key of dirty) {
      const [kpiId, month] = key.split(":");
      const raw = cellValues[key];
      if (raw === undefined || raw === "") continue; // skip cleared cells
      const value = parseFloat(raw);
      if (isNaN(value)) continue;
      targets.push({ modelId, kpiKey: kpiId, period: `${month}-01`, value });
    }

    setSaving(true);
    try {
      if (targets.length > 0) {
        await upsertBulkTargets(targets);
      }
      dirtyRef.current = new Set();
      toast({ title: `${targets.length} target(s) saved` });
    } catch {
      toast({ title: "Failed to save targets", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── clear all targets ────────────────────────────────────────────────────

  const handleClearAll = async () => {
    setClearing(true);
    try {
      await Promise.all(
        selectedKpis.map((kpi) => deleteTargetsForKpi(modelId, kpi.id))
      );
      setCellValues({});
      dirtyRef.current = new Set();
      toast({ title: "All targets cleared" });
    } catch {
      toast({ title: "Failed to clear targets", variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  // ── unit label per KPI ───────────────────────────────────────────────────

  const getUnit = (kpi: DatabaseKpi): string => {
    const fmt = getKpiFormat(kpi.name);
    if (fmt === "currency") return currencySymbol;
    if (fmt === "percentage") return "%";
    if (fmt === "months") return "mo";
    return "";
  };

  const getStep = (kpi: DatabaseKpi): string => {
    const fmt = getKpiFormat(kpi.name);
    return fmt === "percentage" ? "0.1" : "1";
  };

  // ── clean KPI display name ────────────────────────────────────────────────

  const displayName = (kpi: DatabaseKpi) =>
    kpi.name.replace(" (End of Month)", "").replace(" (ARPM)", "").trim();

  const hasDirty = () => dirtyRef.current.size > 0;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Target className="h-4 w-4" />
            Manage Targets
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-[min(90vw,1100px)] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Manage Targets</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedKpis.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No KPIs selected. Choose KPIs from the dashboard first.
            </p>
          ) : (
            <>
              {/* Scrollable grid */}
              <div className="flex-1 overflow-auto min-h-0">
                <table className="text-sm border-collapse w-full">
                  <thead>
                    <tr>
                      {/* Month column header */}
                      <th className="sticky left-0 z-10 bg-background text-left px-3 py-2 font-medium text-muted-foreground border-b border-r min-w-[90px]">
                        Month
                      </th>
                      {selectedKpis.map((kpi) => {
                        const unit = getUnit(kpi);
                        return (
                          <th
                            key={kpi.id}
                            className="px-2 py-2 font-medium text-left border-b min-w-[110px] max-w-[160px]"
                          >
                            <div className="truncate" title={displayName(kpi)}>
                              {displayName(kpi)}
                            </div>
                            {unit && (
                              <div className="text-[11px] font-normal text-muted-foreground">
                                {unit}
                              </div>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {months.map((month, rowIdx) => (
                      <tr
                        key={month}
                        className={
                          rowIdx % 2 === 0 ? "bg-background" : "bg-muted/30"
                        }
                      >
                        {/* Month label */}
                        <td className="sticky left-0 z-10 px-3 py-1.5 text-sm font-medium text-muted-foreground border-r bg-inherit whitespace-nowrap">
                          {formatMonthLabel(month)}
                        </td>

                        {selectedKpis.map((kpi) => {
                          const key = `${kpi.id}:${month}`;
                          const isDirty = dirtyRef.current.has(key);
                          return (
                            <td key={kpi.id} className="px-1.5 py-1">
                              <input
                                type="number"
                                step={getStep(kpi)}
                                value={cellValues[key] ?? ""}
                                onChange={(e) =>
                                  handleCellChange(
                                    kpi.id,
                                    month,
                                    e.target.value
                                  )
                                }
                                placeholder="—"
                                className={`w-full h-7 px-2 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring transition-colors ${
                                  isDirty
                                    ? "border-primary/60 bg-primary/5"
                                    : "border-transparent hover:border-input"
                                }`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between pt-3 border-t mt-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setClearDialogOpen(true)}
                  disabled={clearing || saving}
                  className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                >
                  {clearing && (
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  )}
                  Clear All
                </Button>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={saving}
                  >
                    Close
                  </Button>
                  <Button size="sm" onClick={handleSaveAll} disabled={saving}>
                    {saving && (
                      <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                    )}
                    Save All
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        title="Clear all targets"
        description="This will permanently delete all targets for every KPI. This cannot be undone."
        confirmText="Clear All"
        variant="destructive"
        onConfirm={handleClearAll}
      />
    </>
  );
}
