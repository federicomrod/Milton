// lib/utils/report-utils.ts

/**
 * Convert period label (e.g., "October 2025") into start/end ISO strings
 */
export function parsePeriodLabel(
  label: string | null | undefined
): { start: string; end: string } | null {
  if (!label) return null;
  try {
    const [monthName, year] = label.split(" ");
    const start = new Date(`${monthName} 1, ${year}`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0); // last day of month
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  } catch {
    return null;
  }
}

/**
 * Generate list of month options for period selector
 */
export function generateMonthOptions(count: number = 12): string[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  });
}
