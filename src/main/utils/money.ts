export function normalizeMoney(value: unknown): number {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : 0

  if (!Number.isFinite(numericValue)) {
    return 0
  }

  return Math.round(numericValue)
}

export function isWholeMoneyNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}
