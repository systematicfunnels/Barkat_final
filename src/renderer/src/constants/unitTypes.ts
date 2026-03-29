/**
 * Shared constants for unit types across the application
 * This ensures consistency between filters, forms, and database constraints
 */

/** Core unit types (must match database CHECK constraints) */
export const UNIT_TYPES = ['Plot', 'Bungalow', 'Garden'] as const

/** Unit types for filters (includes 'All' option) */
export const UNIT_TYPE_FILTER_OPTIONS = ['All', ...UNIT_TYPES] as const

/** Unit type display colors for tags/badges */
export const UNIT_TYPE_COLORS: Record<string, string> = {
  Plot: 'green',
  Bungalow: 'blue',
  Garden: 'gold',
  All: 'default'
}
