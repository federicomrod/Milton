/**
 * KPI series computation from model_data.
 * Injects real data for KPIs that can be derived from model tables (e.g. Active Members from members).
 */
import {
  readField,
  parseFlexibleDate,
} from "./kpi-calculations/fieldAccessors";

export interface MemberRecord {
  id?: string;
  name?: string;
  status?: string;
  /** snake_case variant */
  join_date?: number | string;
  /** Title Case variant (uploaded CSVs) */
  "Join Date"?: string;
  status_change_date?: number | string;
  /** Title Case cancel date (uploaded CSVs) */
  "Cancel Date"?: string;
  [key: string]: unknown;
}

export interface KpiSeriesPoint {
  period: string;
  value: number;
}

const EXCEL_EPOCH = new Date(1899, 11, 30).getTime();
const MS_PER_DAY = 86400 * 1000;

/**
 * Parses a date from Excel serial (number) or ISO/YYYY-MM-DD string.
 * Returns milliseconds since epoch or null if invalid.
 */
export function parseDatePoint(
  v: number | string | undefined | null
): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return EXCEL_EPOCH + v * MS_PER_DAY;
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

/**
 * Active Members formula:
 * COUNT(members WHERE join_date <= :date_point AND
 *   (status = 'active' OR
 *    (status IN ('paused', 'cancelled') AND cancel/status_change_date > :date_point)))
 *
 * Handles both snake_case field names (normalised data) and Title Case field names
 * (uploaded CSV data: "Join Date", "Cancel Date", "Status").
 */
export function isActiveMemberAt(
  member: MemberRecord,
  datePointMs: number
): boolean {
  // Read join date — try snake_case first, then "Join Date" from CSV uploads
  const joinDateRaw = readField(member, "join_date", "Join Date");
  const joinDate =
    parseFlexibleDate(joinDateRaw) ??
    (joinDateRaw != null ? new Date(parseDatePoint(joinDateRaw) ?? NaN) : null);
  if (
    !joinDate ||
    isNaN(joinDate.getTime()) ||
    joinDate.getTime() > datePointMs
  )
    return false;

  // Read status — handles both "status" (snake_case) and "Status" (Title Case)
  const status = (
    (readField(member, "status", "Status") ?? "") as string
  ).toLowerCase();
  if (status === "active") return true;

  if (status === "paused" || status === "cancelled") {
    // Cancellation date — may live in "cancel_date", "Cancel Date", or "status_change_date"
    const cancelRaw = readField(
      member,
      "cancel_date",
      "Cancel Date",
      "status_change_date"
    );
    const cancelDate =
      parseFlexibleDate(cancelRaw) ??
      (cancelRaw != null ? new Date(parseDatePoint(cancelRaw) ?? NaN) : null);
    return (
      cancelDate != null &&
      !isNaN(cancelDate.getTime()) &&
      cancelDate.getTime() > datePointMs
    );
  }

  return false;
}

/**
 * Returns end-of-month date strings (YYYY-MM) for the last `months` months.
 */
function getMonthPeriods(months: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
  }
  return out;
}

/**
 * Last millisecond of the given month (YYYY-MM).
 */
function periodToEndMs(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, 0, 23, 59, 59, 999).getTime();
}

/**
 * Computes Active Members count at each period from members data.
 * Uses formula: join_date <= date_point AND (status='active' OR (status in ('paused','cancelled') AND status_change_date > date_point)).
 */
export function computeActiveMembersSeries(
  members: MemberRecord[],
  options?: { periods?: string[]; maxPeriods?: number }
): KpiSeriesPoint[] {
  const maxPeriods = options?.maxPeriods ?? 12;
  const periods = options?.periods ?? getMonthPeriods(maxPeriods);

  return periods.map((period) => {
    const datePointMs = periodToEndMs(period);
    const value = members.filter((m) =>
      isActiveMemberAt(m, datePointMs)
    ).length;
    return { period, value };
  });
}

/**
 * Detects if a KPI is "Active Members" by name or formula.
 */
export function isActiveMembersKpi(
  name: string | undefined,
  formula: string | null | undefined
): boolean {
  const n = (name ?? "").toLowerCase();
  const f = (formula ?? "").toLowerCase();
  return (
    n.includes("active members") ||
    (f.includes("count") &&
      f.includes("members") &&
      (f.includes("join_date") || f.includes("join date")))
  );
}
