/**
 * Utility functions for date and financial year calculations.
 */

/**
 * Returns the current financial year in YYYY-YY format (e.g., "2024-25").
 * Indian financial year starts from April 1st.
 */
export function getCurrentFinancialYear(): string {
  const now = new Date()
  const currentMonth = now.getMonth() + 1 // 0-indexed
  const currentYear = now.getFullYear()

  if (currentMonth >= 4) {
    // April to December
    const nextYearShort = (currentYear + 1).toString().slice(-2)
    return `${currentYear}-${nextYearShort}`
  } else {
    // January to March
    const prevYear = currentYear - 1
    const currentYearShort = currentYear.toString().slice(-2)
    return `${prevYear}-${currentYearShort}`
  }
}

/**
 * Returns the start year of a financial year string.
 * @param fy Financial year string in YYYY-YY or YYYY format.
 */
export function getFYStartYear(fy: string): number {
  const parts = fy.split('-')
  return parseInt(parts[0])
}

/**
 * Returns the deadline date string for a given financial year.
 * Usually 30th June of the start year or end year.
 */
export function getFYDeadline(fy: string): string {
  const startYear = getFYStartYear(fy)
  return `30th June ${startYear + 1}`
}
