/**
 * Shared date-range logic used by the dashboard and Milton Chat.
 * Converts period + customDateRange to concrete fromDate/toDate strings.
 */
export type DateRangePeriod = "month" | "year" | "ytd" | "custom";

/** Default range when client doesn't send one (matches dashboard useDateRange default: last 90 days). */
export function getDefaultReportPeriod(): { fromDate: string; toDate: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 90);
  return {
    fromDate: from.toISOString().split("T")[0],
    toDate: now.toISOString().split("T")[0],
  };
}

export function resolveDateRange(
  period: DateRangePeriod,
  customDateRange?: { from: string; to: string }
): { fromDate: string; toDate: string } {
  if (period === "custom" && customDateRange?.from && customDateRange?.to) {
    return {
      fromDate: customDateRange.from,
      toDate: customDateRange.to,
    };
  }
  if (period === "year") {
    const now = new Date();
    return {
      fromDate: new Date(now.getFullYear() - 1, 0, 1)
        .toISOString()
        .split("T")[0],
      toDate: new Date(now.getFullYear() - 1, 11, 31)
        .toISOString()
        .split("T")[0],
    };
  }
  if (period === "ytd") {
    return {
      fromDate: new Date(new Date().getFullYear(), 0, 1)
        .toISOString()
        .split("T")[0],
      toDate: new Date().toISOString().split("T")[0],
    };
  }
  // month - last 6 months
  return {
    fromDate: new Date(new Date().setMonth(new Date().getMonth() - 6))
      .toISOString()
      .split("T")[0],
    toDate: new Date().toISOString().split("T")[0],
  };
}
