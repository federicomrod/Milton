"use client";

import { useState, useEffect, useRef } from "react";
import { Target, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { getCurrencySymbol } from "@/lib/utils/formatters";
import {
  getTargetsForKpi,
  upsertTarget,
  upsertBulkTargets,
  deleteTarget,
} from "@/lib/kpi-targets";
import type { KpiTarget } from "@/lib/kpi-targets";

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
  if (period === "ytd") {
    return { from: `${new Date().getFullYear()}-01-01`, to: today };
  }
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

// "YYYY-MM" or "YYYY-MM-DD" -> "Jan 2026"
function formatMonthLabel(period: string): string {
  const match = period.match(/^(\d{4})-(\d{2})/);
  if (!match) return period;
  const [, year, month] = match;
  return `${MONTH_ABBR[Number(month) - 1]} ${year}`;
}

interface KpiTargetPopoverProps {
  kpiId: string;
  kpiName: string;
  modelId: string;
  period?: string;
  customDateRange?: { from: string; to: string };
  format: "number" | "currency" | "percentage" | "months";
}

export function KpiTargetPopover({
  kpiId,
  kpiName,
  modelId,
  period,
  customDateRange,
  format,
}: KpiTargetPopoverProps) {
  const { prefs } = useUserPreferences();
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<KpiTarget[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [applyAll, setApplyAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { from, to } = resolveDateRange(period, customDateRange);
  const months = getAllMonthsInRange(from, to);

  const unit =
    format === "currency"
      ? getCurrencySymbol(prefs.currency)
      : format === "percentage"
        ? "%"
        : format === "months"
          ? "mo"
          : "";

  // Initialise selected month when popover opens
  useEffect(() => {
    if (!open) return;
    if (months.length > 0) {
      setSelectedMonth((prev) =>
        months.includes(prev) ? prev : months[months.length - 1]
      );
    }
    setLoadingTargets(true);
    getTargetsForKpi(modelId, kpiId)
      .then(setTargets)
      .catch(() =>
        toast({ title: "Failed to load targets", variant: "destructive" })
      )
      .finally(() => setLoadingTargets(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleEditStart = (target: KpiTarget) => {
    setSelectedMonth(target.period.substring(0, 7));
    setInputValue(String(target.value));
    setApplyAll(false);
  };

  const handleSave = async () => {
    const numValue = parseFloat(inputValue);
    if (isNaN(numValue)) return;
    setSaving(true);
    try {
      if (applyAll) {
        await upsertBulkTargets(
          months.map((m) => ({
            modelId,
            kpiKey: kpiId,
            period: `${m}-01`,
            value: numValue,
          }))
        );
      } else {
        await upsertTarget(modelId, kpiId, `${selectedMonth}-01`, numValue);
      }
      const updated = await getTargetsForKpi(modelId, kpiId);
      setTargets(updated);
      setInputValue("");
      setApplyAll(false);
      toast({ title: "Target saved" });
    } catch {
      toast({ title: "Failed to save target", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (targetId: string) => {
    setDeletingId(targetId);
    try {
      await deleteTarget(targetId);
      setTargets((prev) => prev.filter((t) => t.id !== targetId));
      toast({ title: "Target deleted" });
    } catch {
      toast({ title: "Failed to delete target", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`transition-colors ${open ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        title={`Set target for ${kpiName}`}
        aria-label={`Set target for ${kpiName}`}
      >
        <Target className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-50 w-72 bg-background border border-border rounded-lg shadow-lg p-4 space-y-3">
          <p className="text-sm font-medium">Set Target</p>

          {/* Month selector */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={applyAll}
              className="w-full text-sm border border-input rounded-md px-2 py-1.5 bg-background disabled:opacity-50"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          </div>

          {/* Value input */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Value{unit ? ` (${unit})` : ""}
            </label>
            <Input
              type="number"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={unit ? `e.g. 10000 ${unit}` : "e.g. 100"}
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>

          {/* Apply to all months */}
          <div className="flex items-center gap-2">
            <Checkbox
              id={`apply-all-${kpiId}`}
              checked={applyAll}
              onCheckedChange={(v) => setApplyAll(!!v)}
            />
            <label
              htmlFor={`apply-all-${kpiId}`}
              className="text-xs text-muted-foreground cursor-pointer select-none"
            >
              Apply to all months in range
            </label>
          </div>

          {/* Save button */}
          <Button
            size="sm"
            className="w-full h-8"
            onClick={handleSave}
            disabled={saving || !inputValue}
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Save
          </Button>

          {/* Existing targets list */}
          {loadingTargets ? (
            <div className="flex justify-center pt-1">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : targets.length > 0 ? (
            <div className="border-t pt-3 space-y-1">
              <p className="text-xs text-muted-foreground font-medium mb-2">
                Existing targets
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {targets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-xs gap-2"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {formatMonthLabel(t.period)}
                    </span>
                    <span className="font-medium flex-1 text-right">
                      {t.value}
                      {unit ? ` ${unit}` : ""}
                    </span>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleEditStart(t)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deletingId === t.id}
                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        {deletingId === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
