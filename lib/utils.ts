import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalizes date values from various formats (Excel serial dates, Date objects, strings)
 * to ISO 8601 timestamp strings for database insertion.
 *
 * Handles:
 * - Excel serial dates (e.g., 45794.04114583333)
 * - JavaScript Date objects
 * - ISO date strings
 * - Various date string formats
 *
 * @param value - The date value to normalize
 * @returns ISO 8601 timestamp string or null if invalid
 */
export function normalizeDateValue(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;

  // Already a JS Date
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString();
  }

  // FIRST: Try parsing as a date string (before checking for Excel serial dates)
  // This handles cases where dates like "01.03.25" are stored as strings
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "") {
      // Try parsing common date formats first
      // DD.MM.YY or DD.MM.YYYY (e.g., "01.03.25" or "01.03.2025")
      const ddmmyyMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
      if (ddmmyyMatch) {
        const day = parseInt(ddmmyyMatch[1], 10);
        const month = parseInt(ddmmyyMatch[2], 10) - 1; // Month is 0-indexed
        let year = parseInt(ddmmyyMatch[3], 10);
        // Handle 2-digit years: assume 00-30 = 2000-2030, 31-99 = 1931-1999
        if (year < 100) {
          year = year <= 30 ? 2000 + year : 1900 + year;
        }
        const date = new Date(Date.UTC(year, month, day));
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      // MM/DD/YYYY HH:MM:SS or DD.MM.YYYY HH:MM:SS (datetime with time)
      // Ambiguous: prefer MM/DD (US/Excel default) so "01/12/2025 00:00:00" = Jan 12
      const datetimeMatch = trimmed.match(
        /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/
      );
      if (datetimeMatch) {
        let day: number, month: number;
        const p1 = parseInt(datetimeMatch[1], 10);
        const p2 = parseInt(datetimeMatch[2], 10);
        if (p1 > 12) {
          day = p1;
          month = p2 - 1;
        } else if (p2 > 12) {
          month = p1 - 1;
          day = p2;
        } else {
          month = p1 - 1;
          day = p2;
        }
        let year = parseInt(datetimeMatch[3], 10);
        if (year < 100) {
          year = year <= 30 ? 2000 + year : 1900 + year;
        }
        const hours = parseInt(datetimeMatch[4], 10);
        const minutes = parseInt(datetimeMatch[5], 10);
        const seconds = datetimeMatch[6] ? parseInt(datetimeMatch[6], 10) : 0;
        const date = new Date(
          Date.UTC(year, month, day, hours, minutes, seconds)
        );
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      // DD/MM/YY or MM/DD/YYYY (e.g., "01/03/25" or "01/12/2025")
      // Smart detection: if one number > 12, it's the day; else prefer MM/DD (US/Excel default)
      const slashDateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (slashDateMatch) {
        const first = parseInt(slashDateMatch[1], 10);
        const second = parseInt(slashDateMatch[2], 10);
        let year = parseInt(slashDateMatch[3], 10);
        if (year < 100) {
          year = year <= 30 ? 2000 + year : 1900 + year;
        }

        let day: number, month: number;
        if (first > 12) {
          day = first;
          month = second - 1;
        } else if (second > 12) {
          month = first - 1;
          day = second;
        } else {
          // Both <= 12, ambiguous - prefer MM/DD (US/Excel) so "01/12/2025" = Jan 12
          month = first - 1;
          day = second;
        }

        const date = new Date(Date.UTC(year, month, day));
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      // Try parsing as ISO date string
      const isoDate = new Date(trimmed);
      if (!isNaN(isoDate.getTime())) {
        return isoDate.toISOString();
      }

      // Try parsing as Excel serial date string (only if it looks like a number)
      const numValue = Number(trimmed);
      if (!Number.isNaN(numValue) && numValue > 1 && numValue < 100000) {
        const base = new Date(Date.UTC(1899, 11, 30));
        base.setUTCDate(base.getUTCDate() + Math.floor(numValue));
        const timeComponent = numValue - Math.floor(numValue);
        if (timeComponent > 0) {
          const hours = Math.floor(timeComponent * 24);
          const minutes = Math.floor((timeComponent * 24 - hours) * 60);
          const seconds = Math.floor(
            ((timeComponent * 24 - hours) * 60 - minutes) * 60
          );
          base.setUTCHours(hours, minutes, seconds);
        }
        return base.toISOString();
      }
    }
  }

  // SECOND: Try Excel serial date (e.g. 45731.04166… or 45659.99947916667)
  // Excel dates are typically between 1 (Jan 1, 1900) and ~100000 (year 2174)
  // This handles cases where Excel has already converted the date to a serial number
  const numeric =
    typeof value === "number" ? value : Number(String(value).trim());

  if (!Number.isNaN(numeric)) {
    // Excel serial dates are typically in the range 1-100000
    // But we also need to handle larger values that might be timestamps
    if (numeric > 1 && numeric < 100000) {
      // Excel's epoch is 1899-12-30 (ignoring the 1900 leap-year bug – fine for our use)
      const base = new Date(Date.UTC(1899, 11, 30));
      base.setUTCDate(base.getUTCDate() + Math.floor(numeric));
      // Handle time component if present (decimal part)
      const timeComponent = numeric - Math.floor(numeric);
      if (timeComponent > 0) {
        const hours = Math.floor(timeComponent * 24);
        const minutes = Math.floor((timeComponent * 24 - hours) * 60);
        const seconds = Math.floor(
          ((timeComponent * 24 - hours) * 60 - minutes) * 60
        );
        base.setUTCHours(hours, minutes, seconds);
      }
      return base.toISOString();
    }
    // Check if it's a Unix timestamp (milliseconds since epoch)
    // Timestamps are typically > 1000000000000 (year 2001) or < -1000000000000
    if (
      numeric > 1000000000000 ||
      (numeric < -1000000000000 && numeric > -2000000000000)
    ) {
      const date = new Date(numeric);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  // If nothing works, return null so we don't blow up the insert
  return null;
}
