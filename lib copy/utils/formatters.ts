/**
 * Formatter utilities for currency, numbers, and dates
 * Based on user preferences (currency, locale, timezone, format)
 */

/**
 * Format a number as currency based on user's preference
 * @param value - The numeric value to format
 * @param currency - Currency code (EUR, USD, GBP, CHF)
 * @param locale - Locale for formatting (default: auto-detected from currency)
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: string = "EUR",
  locale?: string
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return `${getCurrencySymbol(currency)} 0`
  }

  // Auto-detect locale from currency if not provided
  const detectedLocale = locale || getLocaleFromCurrency(currency)

  try {
    return new Intl.NumberFormat(detectedLocale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  } catch (error) {
    console.warn("Currency formatting failed:", error)
    return `${getCurrencySymbol(currency)} ${value.toFixed(2)}`
  }
}

/**
 * Format a number based on user's preference
 * @param value - The numeric value to format
 * @param numberFormat - Format preference (1,000.00 or 1.000,00)
 */
export function formatNumber(
  value: number | null | undefined,
  numberFormat: string = "1,000.00"
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "0"
  }

  // Determine locale from number format preference
  const locale = numberFormat === "1.000,00" ? "de-DE" : "en-US"

  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  } catch (error) {
    console.warn("Number formatting failed:", error)
    return value.toString()
  }
}

/**
 * Format a date string based on user's timezone and format preference
 * @param dateString - ISO date string or Date object
 * @param timezone - IANA timezone (e.g., Europe/Berlin)
 * @param dateFormat - Format preference (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD)
 */
export function formatDate(
  dateString: string | Date | null | undefined,
  timezone: string = "UTC",
  dateFormat: string = "DD/MM/YYYY"
): string {
  if (!dateString) return "-"

  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return dateString.toString()

    // Get locale from date format
    const locale = dateFormat === "MM/DD/YYYY" ? "en-US" : "en-GB"

    // Format based on preference
    switch (dateFormat) {
      case "DD/MM/YYYY":
        return date.toLocaleDateString("en-GB", {
          timeZone: timezone,
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      case "MM/DD/YYYY":
        return date.toLocaleDateString("en-US", {
          timeZone: timezone,
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        })
      case "YYYY-MM-DD":
        const year = date.toLocaleDateString("en-CA", { timeZone: timezone, year: "numeric" })
        const month = date.toLocaleDateString("en-CA", { timeZone: timezone, month: "2-digit" })
        const day = date.toLocaleDateString("en-CA", { timeZone: timezone, day: "2-digit" })
        return `${year}-${month}-${day}`
      default:
        return date.toLocaleDateString(locale, { timeZone: timezone })
    }
  } catch (error) {
    console.warn("Date formatting failed:", error)
    return dateString.toString()
  }
}

/**
 * Format a date with time based on user's timezone
 * @param dateString - ISO date string or Date object
 * @param timezone - IANA timezone
 */
export function formatDateTime(
  dateString: string | Date | null | undefined,
  timezone: string = "UTC"
): string {
  if (!dateString) return "-"

  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return dateString.toString()

    return date.toLocaleString("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch (error) {
    console.warn("DateTime formatting failed:", error)
    return dateString.toString()
  }
}

/**
 * Helper: Get currency symbol
 */
function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    EUR: "€",
    USD: "$",
    GBP: "£",
    CHF: "CHF",
  }
  return symbols[currency] || currency
}

/**
 * Helper: Get locale from currency code
 */
function getLocaleFromCurrency(currency: string): string {
  const locales: Record<string, string> = {
    EUR: "de-DE",
    USD: "en-US",
    GBP: "en-GB",
    CHF: "de-CH",
  }
  return locales[currency] || "en-US"
}

/**
 * Format a percentage value
 * @param value - Decimal value (0.15 for 15%)
 * @param decimals - Number of decimal places (default: 1)
 */
export function formatPercentage(
  value: number | null | undefined,
  decimals: number = 1
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "0%"
  }

  return `${(value * 100).toFixed(decimals)}%`
}

