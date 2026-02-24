/**
 * Field accessor helpers for KPI calculations.
 *
 * Uploaded CSVs use Title Case field names ("Join Date", "Class Starting Time", etc.)
 * while normalised data uses snake_case ("join_date", "date_time", etc.).
 * These helpers read both variants transparently, and parse the flexible M/D/YY
 * date format that uploads produce.
 */

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Returns the first non-null/empty value found under any of the given keys. */
export function readField(record: any, ...keys: string[]): any {
  for (const key of keys) {
    const v = record[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * Parses a date from several formats:
 *  - ISO date-only  "2024-01-15"         → local midnight (avoids UTC shift)
 *  - ISO datetime   "2024-01-15T10:00:00" or "2024-01-15 10:00:00"
 *  - US short       "6/26/25"  or "1/10/26"  (M/D/YY  → 20YY)
 *  - US long        "6/26/2025"
 *
 * Always returns a local-time Date so that .getFullYear()/.getMonth() give
 * the correct calendar values without UTC offset surprises.
 */
export function parseFlexibleDate(value: any): Date | null {
  if (value == null || value === "") return null;
  const str = String(value).trim();

  // ISO date-only — force local midnight to avoid the UTC→local day-shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // ISO / SQL datetime
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(str)) {
    const dt = new Date(str.replace(" ", "T"));
    return isNaN(dt.getTime()) ? null : dt;
  }

  // M/D/YY or M/D/YYYY
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const month = parseInt(mdy[1], 10) - 1;
    const day = parseInt(mdy[2], 10);
    const yRaw = parseInt(mdy[3], 10);
    const year = yRaw < 100 ? 2000 + yRaw : yRaw;
    const dt = new Date(year, month, day);
    return isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

/**
 * Converts a Date to a "YYYY-MM" period string using LOCAL time methods,
 * so there is no UTC offset shift for dates near midnight.
 */
export function toPeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Entity-specific accessors
// ---------------------------------------------------------------------------

/** Member record accessors */
export const memberAcc = {
  joinDate: (r: any): Date | null =>
    parseFlexibleDate(readField(r, "join_date", "Join Date")),
  cancelDate: (r: any): Date | null =>
    parseFlexibleDate(readField(r, "cancel_date", "Cancel Date")),
  statusChangeDate: (r: any): Date | null =>
    parseFlexibleDate(readField(r, "status_change_date", "Status Change Date")),
  /** Returns lowercase status string, e.g. "active", "cancelled" */
  status: (r: any): string =>
    (readField(r, "status", "Status") ?? "").toLowerCase(),
};

/** Class record accessors */
export const classAcc = {
  /** Unique class identifier (maps to the booking's class reference) */
  id: (r: any): string => readField(r, "id", "Class ID") ?? "",
  /** Class start datetime */
  dateTime: (r: any): Date | null =>
    parseFlexibleDate(
      readField(r, "date_time", "Class Starting Time", "Date & Time")
    ),
  capacity: (r: any): number =>
    parseFloat(readField(r, "capacity", "Capacity") ?? 0) || 0,
};

/** Booking record accessors */
export const bookingAcc = {
  classId: (r: any): string => readField(r, "class_id", "Class ID") ?? "",
  /**
   * Returns a normalised lowercase attendance status.
   * "No-show" and "no_show" both become "no_show".
   */
  attendanceStatus: (r: any): string => {
    const raw = (
      readField(r, "attendance_status", "Attendance Status") ?? ""
    ).toLowerCase();
    return raw.replace(/-/g, "_"); // "no-show" → "no_show"
  },
};

/** Transaction record accessors */
export const txAcc = {
  date: (r: any): Date | null =>
    parseFlexibleDate(readField(r, "date", "Date")),
  amount: (r: any): number =>
    parseFloat(readField(r, "amount", "Amount") ?? 0) || 0,
  /**
   * Returns "inflow" or "outflow".
   * Handles both a plain "type" field and "Direction (inflow / outflow)".
   */
  type: (r: any): string =>
    (
      readField(r, "type", "Direction (inflow / outflow)", "direction") ?? ""
    ).toLowerCase(),
};
