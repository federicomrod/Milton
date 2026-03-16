"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export type DateRangePeriod = "month" | "year" | "ytd" | "custom";

export interface DateRangePickerProps {
  period: DateRangePeriod;
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: DateRangePeriod) => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
  className?: string;
}

interface QuickRange {
  label: string;
  value: DateRangePeriod;
  getRange: () => { from: string; to: string };
}

export function DateRangePicker({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
  className,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempCustomRange, setTempCustomRange] = useState(customDateRange);

  const openPicker = () => {
    setTempCustomRange(customDateRange);
    setIsOpen(true);
  };

  const now = new Date();
  const formatDate = (date: Date) => date.toISOString().split("T")[0];

  const quickRanges: QuickRange[] = [
    {
      label: "Last 7 days",
      value: "custom",
      getRange: () => {
        const from = new Date(now);
        from.setDate(from.getDate() - 7);
        return { from: formatDate(from), to: formatDate(now) };
      },
    },
    {
      label: "Last 30 days",
      value: "custom",
      getRange: () => {
        const from = new Date(now);
        from.setDate(from.getDate() - 30);
        return { from: formatDate(from), to: formatDate(now) };
      },
    },
    {
      label: "Last 90 days",
      value: "custom",
      getRange: () => {
        const from = new Date(now);
        from.setDate(from.getDate() - 90);
        return { from: formatDate(from), to: formatDate(now) };
      },
    },
    {
      label: "This Month",
      value: "month",
      getRange: () => {
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: formatDate(from), to: formatDate(to) };
      },
    },
    {
      label: "Last Month",
      value: "custom",
      getRange: () => {
        const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const to = new Date(now.getFullYear(), now.getMonth(), 0);
        return { from: formatDate(from), to: formatDate(to) };
      },
    },
    {
      label: "Last 3 months",
      value: "custom",
      getRange: () => {
        const from = new Date(now);
        from.setMonth(from.getMonth() - 3);
        return { from: formatDate(from), to: formatDate(now) };
      },
    },
    {
      label: "Last 6 months",
      value: "custom",
      getRange: () => {
        const from = new Date(now);
        from.setMonth(from.getMonth() - 6);
        return { from: formatDate(from), to: formatDate(now) };
      },
    },
    {
      label: "Year to Date",
      value: "ytd",
      getRange: () => {
        const from = new Date(now.getFullYear(), 0, 1);
        return { from: formatDate(from), to: formatDate(now) };
      },
    },
    {
      label: "Last Year",
      value: "year",
      getRange: () => {
        const from = new Date(now.getFullYear() - 1, 0, 1);
        const to = new Date(now.getFullYear() - 1, 11, 31);
        return { from: formatDate(from), to: formatDate(to) };
      },
    },
  ];

  /**
   * Formats a stored "YYYY-MM-DD" string for display without timezone shift.
   * Parsing bare ISO date strings with `new Date()` treats them as UTC midnight,
   * which shows the previous day in UTC− timezones. Appending "T00:00:00" forces
   * local-time interpretation so the displayed date always matches the stored value.
   */
  const formatStoredDate = (
    dateStr: string,
    opts: Intl.DateTimeFormatOptions
  ) => new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", opts);

  const getDisplayText = () => {
    if (period === "year") return "Last Year";
    if (period === "ytd") return "Year to Date";
    if (period === "custom") {
      const opts: Intl.DateTimeFormatOptions = {
        month: "short",
        day: "numeric",
        year: "numeric",
      };
      return `${formatStoredDate(customDateRange.from, opts)} - ${formatStoredDate(customDateRange.to, opts)}`;
    }
    // month
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${from.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })} - ${to.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  };

  const handleQuickRangeClick = (range: QuickRange) => {
    if (range.value === "custom") {
      const newRange = range.getRange();
      setTempCustomRange(newRange);
      onCustomDateRangeChange(newRange);
      onPeriodChange("custom");
    } else {
      onPeriodChange(range.value);
    }
    setIsOpen(false);
  };

  const isValidRange = () => {
    if (!tempCustomRange.from || !tempCustomRange.to) return false;
    const fromDate = new Date(tempCustomRange.from + "T00:00:00");
    const toDate = new Date(tempCustomRange.to + "T00:00:00");
    return fromDate <= toDate;
  };

  const handleApplyCustom = () => {
    if (!isValidRange()) return;
    onCustomDateRangeChange(tempCustomRange);
    onPeriodChange("custom");
    setIsOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("gap-2 font-normal", className)}
        onClick={openPicker}
      >
        <Clock className="h-4 w-4" />
        <span className="hidden sm:inline">{getDisplayText()}</span>
        <span className="sm:hidden">Range</span>
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="!max-w-[calc(100%-2rem)] !w-full sm:!max-w-2xl md:!max-w-4xl lg:!max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Select Time Range
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Quick Ranges */}
            <div>
              <Label className="text-sm font-medium mb-3 block">
                Quick ranges
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {quickRanges.map((range) => (
                  <Button
                    key={range.label}
                    variant="outline"
                    className="justify-start h-auto py-2.5 px-3 text-sm"
                    onClick={() => handleQuickRangeClick(range)}
                  >
                    {range.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom Range */}
            <div className="space-y-4 border-t pt-4">
              <Label className="text-sm font-medium">Custom range</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground font-medium">
                    From
                  </Label>
                  <div className="border rounded-lg">
                    <Calendar
                      value={
                        tempCustomRange.from
                          ? new Date(tempCustomRange.from + "T00:00:00")
                          : undefined
                      }
                      onChange={(date) => {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(
                          2,
                          "0"
                        );
                        const day = String(date.getDate()).padStart(2, "0");
                        const dateStr = `${year}-${month}-${day}`;

                        // If the selected from date is after the to date, adjust the to date
                        const newFromDate = new Date(dateStr + "T00:00:00");
                        const currentToDate = tempCustomRange.to
                          ? new Date(tempCustomRange.to + "T00:00:00")
                          : null;

                        if (currentToDate && newFromDate > currentToDate) {
                          // Auto-adjust to date to be the same as from date
                          setTempCustomRange({
                            from: dateStr,
                            to: dateStr,
                          });
                        } else {
                          setTempCustomRange({
                            ...tempCustomRange,
                            from: dateStr,
                          });
                        }
                      }}
                      toDate={
                        tempCustomRange.to
                          ? new Date(tempCustomRange.to + "T00:00:00")
                          : undefined
                      }
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground font-medium">
                    To
                  </Label>
                  <div className="border rounded-lg">
                    <Calendar
                      value={
                        tempCustomRange.to
                          ? new Date(tempCustomRange.to + "T00:00:00")
                          : undefined
                      }
                      onChange={(date) => {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(
                          2,
                          "0"
                        );
                        const day = String(date.getDate()).padStart(2, "0");
                        const dateStr = `${year}-${month}-${day}`;

                        // If the selected to date is before the from date, adjust the from date
                        const newToDate = new Date(dateStr + "T00:00:00");
                        const currentFromDate = tempCustomRange.from
                          ? new Date(tempCustomRange.from + "T00:00:00")
                          : null;

                        if (currentFromDate && newToDate < currentFromDate) {
                          // Auto-adjust from date to be the same as to date
                          setTempCustomRange({
                            from: dateStr,
                            to: dateStr,
                          });
                        } else {
                          setTempCustomRange({
                            ...tempCustomRange,
                            to: dateStr,
                          });
                        }
                      }}
                      fromDate={
                        tempCustomRange.from
                          ? new Date(tempCustomRange.from + "T00:00:00")
                          : undefined
                      }
                    />
                  </div>
                </div>
              </div>
              {!isValidRange() &&
                tempCustomRange.from &&
                tempCustomRange.to && (
                  <p className="text-sm text-destructive">
                    Start date cannot be after end date
                  </p>
                )}
              <Button
                onClick={handleApplyCustom}
                className="w-full"
                size="sm"
                disabled={!isValidRange()}
              >
                Apply custom range
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
