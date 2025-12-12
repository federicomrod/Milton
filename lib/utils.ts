import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
  if (value === null || value === undefined || value === '') return null;

  // Already a JS Date
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString();
  }

  // Try Excel serial date (e.g. 45731.04166… or 45794.04114583333)
  // Excel dates are typically between 1 (Jan 1, 1900) and ~100000 (year 2174)
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());

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
        const seconds = Math.floor(((timeComponent * 24 - hours) * 60 - minutes) * 60);
        base.setUTCHours(hours, minutes, seconds);
      }
      return base.toISOString();
    }
    // Check if it's a Unix timestamp (milliseconds since epoch)
    // Timestamps are typically > 1000000000000 (year 2001) or < -1000000000000
    if (numeric > 1000000000000 || (numeric < -1000000000000 && numeric > -2000000000000)) {
      const date = new Date(numeric);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  // Fallback: try to parse as a normal date string
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    
    // Try parsing as ISO date string first
    const isoDate = new Date(trimmed);
    if (!isNaN(isoDate.getTime())) {
      return isoDate.toISOString();
    }
    
    // Try parsing as Excel serial date string
    const numValue = Number(trimmed);
    if (!Number.isNaN(numValue) && numValue > 1 && numValue < 100000) {
      const base = new Date(Date.UTC(1899, 11, 30));
      base.setUTCDate(base.getUTCDate() + Math.floor(numValue));
      const timeComponent = numValue - Math.floor(numValue);
      if (timeComponent > 0) {
        const hours = Math.floor(timeComponent * 24);
        const minutes = Math.floor((timeComponent * 24 - hours) * 60);
        const seconds = Math.floor(((timeComponent * 24 - hours) * 60 - minutes) * 60);
        base.setUTCHours(hours, minutes, seconds);
      }
      return base.toISOString();
    }
  }

  // If nothing works, return null so we don't blow up the insert
  return null;
}
