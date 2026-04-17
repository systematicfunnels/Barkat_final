import { dbService } from '../db/database'
import { normalizeMoney } from '../utils/money'

export interface ArrearsBreakdownEntry {
  financial_year: string
  amount: number
  penalty: number
  total_with_penalty: number
}

type LetterBalanceStatus = {
  status: string
  is_paid: number
}

function normalizeUnitType(unitType: unknown): string {
  const normalized = String(unitType || '')
    .trim()
    .toLowerCase()

  if (!normalized || normalized === 'flat' || normalized === 'bungalow') return 'Bungalow'
  if (normalized === 'plot') return 'Plot'
  if (normalized === 'garden') return 'Garden'
  if (normalized === 'bmf') return 'Bungalow'
  if (normalized === 'all' || normalized === 'all units') return 'All'
  return String(unitType || '').trim() || 'Bungalow'
}

function getPenaltyPercentageForFinancialYear(
  projectId: number,
  financialYear: string,
  unitType: string | undefined,
  fallbackPenaltyPercentage: number
): number {
  const normalizedUnitType = normalizeUnitType(unitType)
  const rate =
    dbService.get<{ penalty_percentage: number | null }>(
      `SELECT penalty_percentage
       FROM maintenance_rates
       WHERE project_id = ? AND financial_year = ? AND unit_type = ?`,
      [projectId, financialYear, normalizedUnitType]
    ) ||
    dbService.get<{ penalty_percentage: number | null }>(
      `SELECT penalty_percentage
       FROM maintenance_rates
       WHERE project_id = ? AND financial_year = ? AND (unit_type = 'All' OR unit_type IS NULL)`,
      [projectId, financialYear]
    )

  return rate?.penalty_percentage ?? fallbackPenaltyPercentage
}

export function getReceivedPaymentTotalForLetter(letterId: number): number {
  return (
    dbService.get<{ total: number }>(
      `SELECT COALESCE(SUM(payment_amount), 0) as total
       FROM payments
       WHERE letter_id = ? AND payment_status = 'Received'`,
      [letterId]
    )?.total || 0
  )
}

export function calculateArrearsBreakdownForCurrentFinancialYear(params: {
  projectId: number
  unitId: number
  targetFinancialYear: string
  unitType?: string
  fallbackPenaltyPercentage: number
}): ArrearsBreakdownEntry[] {
  const previousLetters = dbService.query<{ id: number; financial_year: string; final_amount: number }>(
    `SELECT id, financial_year, final_amount
     FROM maintenance_letters
     WHERE unit_id = ? AND financial_year < ?
     ORDER BY financial_year ASC`,
    [params.unitId, params.targetFinancialYear]
  )

  const penaltyPct =
    getPenaltyPercentageForFinancialYear(
      params.projectId,
      params.targetFinancialYear,
      params.unitType,
      params.fallbackPenaltyPercentage
    ) || 0

  return previousLetters.flatMap((previousLetter) => {
    const paid = getReceivedPaymentTotalForLetter(previousLetter.id)
    const outstanding = normalizeMoney(Math.max(0, previousLetter.final_amount - paid))

    if (outstanding <= 0) {
      return []
    }

    const penalty = normalizeMoney(outstanding * (penaltyPct / 100))
    return [
      {
        financial_year: previousLetter.financial_year,
        amount: outstanding,
        penalty,
        total_with_penalty: normalizeMoney(outstanding + penalty)
      }
    ]
  })
}

function getNextUnpaidStatus(currentStatus: string | undefined, generatedDate?: string): string {
  const normalizedStatus = String(currentStatus || '').trim().toLowerCase()

  if (normalizedStatus === 'modified') return 'Modified'
  if (normalizedStatus === 'pending') return 'Pending'
  if (normalizedStatus === 'generated') return 'Generated'

  if (generatedDate) {
    return 'Generated'
  }

  return 'Pending'
}

export function getLetterBalanceStatus(letterId: number): LetterBalanceStatus | null {
  const letter = dbService.get<{
    id: number
    final_amount: number
    status?: string
    generated_date?: string
  }>(
    `SELECT id, final_amount, status, generated_date
     FROM maintenance_letters
     WHERE id = ?`,
    [letterId]
  )

  if (!letter) {
    return null
  }

  const totalPaid = getReceivedPaymentTotalForLetter(letterId)
  const isPaid = totalPaid + 0.01 >= normalizeMoney(letter.final_amount)

  if (isPaid) {
    return {
      status: 'Paid',
      is_paid: 1
    }
  }

  return {
    status: getNextUnpaidStatus(letter.status, letter.generated_date),
    is_paid: 0
  }
}

export function recalculateLetterPaymentState(letterId: number): void {
  const nextState = getLetterBalanceStatus(letterId)
  if (!nextState) return

  dbService.run('UPDATE maintenance_letters SET status = ?, is_paid = ? WHERE id = ?', [
    nextState.status,
    nextState.is_paid,
    letterId
  ])
}
