/**
 * Formats financial year input to standard YYYY-YY format
 * Handles various input formats and auto-corrects common mistakes
 * 
 * Examples:
 * - "2024-2025" → "2024-25"
 * - "2024-25" → "2024-25" (already correct)
 * - "2025" → "2025-26" (auto-completes next year)
 * - "202526" → "2025-26"
 * - "20252026" → "2025-26"
 */
export const formatFinancialYear = (input: string): string => {
  if (!input) return input
  
  // Remove extra spaces and non-digit characters except hyphen
  const clean = input.trim().replace(/[^\d-]/g, '')
  
  // Handle different input formats
  if (clean.includes('-')) {
    const parts = clean.split('-')
    if (parts.length === 2) {
      const year = parts[0].slice(0, 4)
      const yearPart = parts[1].slice(0, 2)
      
      // If second part has 4 digits, take last 2
      const finalYearPart = yearPart.length === 4 ? yearPart.slice(-2) : yearPart
      
      return `${year}-${finalYearPart}`
    }
  } else {
    // Handle pure number input
    if (clean.length === 6) { // 202526
      return `${clean.slice(0,4)}-${clean.slice(4,6)}`
    }
    if (clean.length === 8) { // 20252026
      return `${clean.slice(0,4)}-${clean.slice(6,8)}`
    }
    if (clean.length >= 4) { // 2025 or more
      const year = clean.slice(0,4)
      const nextYear = (parseInt(year) + 1).toString().slice(-2)
      return `${year}-${nextYear}`
    }
  }
  
  return input // Return as-is if can't format
}

/**
 * Validates if the financial year is in correct YYYY-YY format
 */
export const isValidFinancialYear = (input: string): boolean => {
  return /^\d{4}-\d{2}$/.test(input)
}

/**
 * Gets the current financial year based on current date
 * FY in India starts on April 1
 */
export const getCurrentFinancialYear = (): string => {
  const now = new Date()
  const year = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear()
  return `${year}-${(year + 1).toString().slice(-2)}`
}

/**
 * Returns the next financial year after the supplied/current FY.
 */
export const getUpcomingFinancialYear = (financialYear?: string): string => {
  const baseFY = financialYear || getCurrentFinancialYear()
  const startYear = Number(baseFY.slice(0, 4))
  return `${startYear + 1}-${String(startYear + 2).slice(-2)}`
}
