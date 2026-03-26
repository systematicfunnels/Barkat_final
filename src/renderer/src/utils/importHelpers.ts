/**
 * Shared helpers for Excel import mapping across different pages (Units, Billing, etc.)
 */

export interface NormalizedRow {
  [key: string]: unknown
}

/**
 * Creates a normalized version of the row with lowercase keys and trimmed values
 */
export const normalizeRow = (row: Record<string, unknown>): NormalizedRow => {
  const normalizedRow: NormalizedRow = {}
  // Type-safe iteration over object keys
  Object.entries(row).forEach(([key, value]) => {
    if (typeof key === 'string') {
      const normalizedKey = key.toLowerCase().trim()
      normalizedRow[normalizedKey] = value
    }
  })
  return normalizedRow
}

/**
 * Helper to find value by multiple possible keys in a normalized row.
 * Supports exact matches, partial matches, and year detection.
 */
export const getValue = (
  normalizedRow: NormalizedRow,
  possibleKeys: string[],
  strictMode: boolean = false
): unknown => {
  // 1. Try exact matches first
  for (const key of possibleKeys) {
    if (
      normalizedRow[key] !== undefined &&
      normalizedRow[key] !== null &&
      String(normalizedRow[key]).trim() !== ''
    ) {
      return normalizedRow[key]
    }
  }

  // 2. Try partial matches (handling special characters like spaces/underscores)
  for (const key of possibleKeys) {
    const cleanKey = key.replace(/[^a-z0-9]/g, '')
    const match = Object.keys(normalizedRow).find((k) => {
      const cleanK = k.replace(/[^a-z0-9]/g, '')
      if (strictMode) return cleanK === cleanKey
      return cleanK.includes(cleanKey)
    })

    if (match && normalizedRow[match] !== undefined && String(normalizedRow[match]).trim() !== '') {
      return normalizedRow[match]
    }
  }

  return undefined
}

/**
 * Extracts year from a row or header if present
 */
export const detectYear = (normalizedRow: NormalizedRow): number | null => {
  const yearKeys = ['year', 'period', 'session', 'financial year']
  const yearVal = getValue(normalizedRow, yearKeys)

  if (yearVal) {
    const yearMatch = String(yearVal).match(/\b(202[0-9]|203[0-9])\b/)
    if (yearMatch) return parseInt(yearMatch[0])
  }

  // Try to find a key that looks like a year or FY context
  const yearInKey = Object.keys(normalizedRow).find(
    (k) => /\b(202[0-9]|203[0-9])\b/.test(k) || /fy\s*\d{2,4}/i.test(k)
  )
  if (yearInKey) {
    const match = yearInKey.match(/\b(20\d{2})\b/)
    if (match) return parseInt(match[0])
  }

  return null
}

/**
 * Sanitize and convert values to numbers
 */
export const cleanNumber = (val: unknown): number => {
  if (typeof val === 'number') return val
  const str = String(val || '0').trim()
  if (str === '-' || str === '') return 0
  // Handle comma-separated numbers (e.g., 1,000.00)
  const cleaned = str.replace(/,/g, '').replace(/[^0-9.-]/g, '')
  const num = Number(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * Auto-detect project ID from project name in row
 */
export const autoDetectProject = (
  normalizedRow: NormalizedRow,
  projects: { id: number; name: string }[]
): number | null => {
  const possibleKeys = ['project', 'society', 'building', 'project name']
  const projectName = String(getValue(normalizedRow, possibleKeys) || '')
    .trim()
    .toLowerCase()

  if (projectName) {
    const matchedProject = projects.find((p) => p.name.toLowerCase() === projectName)
    return matchedProject ? matchedProject.id : null
  }
  return null
}
