import { dbService } from '../db/database'
import { normalizeMoney } from '../utils/money'
import { getCurrentFinancialYear } from '../utils/dateUtils'

export interface FinancialReportYearlyData {
  billed: number
  paid: number
  balance: number
}

export interface FinancialReportRow {
  key: string
  unit_id: number
  unit_number: string
  owner_name: string
  project_name: string
  unit_type: string
  unit_status: string
  total_billed: number
  total_paid: number
  outstanding: number
  [year: string]: string | number | FinancialReportYearlyData
}

export interface FinancialReportYearlyTotal {
  year: string
  billed: number
  paid: number
  balance: number
  unitCount: number
}

export interface FinancialReportSummary {
  rows: FinancialReportRow[]
  years: string[]
  stats: {
    totalBilled: number
    totalCollected: number
    outstanding: number
  }
  yearlyTotals: FinancialReportYearlyTotal[]
}

export interface FinancialReportFilters {
  searchText?: string
  selectedUnitType?: string | null
  selectedStatus?: string | null
  outstandingRange?: [number | null, number | null]
}

class ReportService {
  public getAvailableFinancialYears(projectId?: number): string[] {
    const defaultFY = getCurrentFinancialYear()
    const currentStartYear = Number(defaultFY.slice(0, 4))
    const nextFY = `${currentStartYear + 1}-${String(currentStartYear + 2).slice(-2)}`

    const rateYears = projectId
      ? dbService.query<{ financial_year: string }>(
          'SELECT DISTINCT financial_year FROM maintenance_rates WHERE project_id = ?',
          [projectId]
        )
      : dbService.query<{ financial_year: string }>(
          'SELECT DISTINCT financial_year FROM maintenance_rates'
        )

    const letterYears = projectId
      ? dbService.query<{ financial_year: string }>(
          'SELECT DISTINCT financial_year FROM maintenance_letters WHERE project_id = ?',
          [projectId]
        )
      : dbService.query<{ financial_year: string }>(
          'SELECT DISTINCT financial_year FROM maintenance_letters'
        )

    return Array.from(
      new Set([
        ...rateYears.map((row) => row.financial_year),
        ...letterYears.map((row) => row.financial_year),
        defaultFY,
        nextFY
      ])
    )
      .filter((year): year is string => /^\d{4}-\d{2}$/.test(String(year)))
      .sort()
      .reverse()
  }

  public getFinancialSummary(
    projectId?: number,
    filters: FinancialReportFilters = {}
  ): FinancialReportSummary {
    const units = projectId
      ? dbService.query<{
          id: number
          unit_number: string
          owner_name: string
          project_name: string
          unit_type: string | null
          status: string | null
        }>(
          `SELECT u.id, u.unit_number, u.owner_name, p.name as project_name, u.unit_type, u.status
           FROM units u
           JOIN projects p ON p.id = u.project_id
           WHERE u.project_id = ?
           ORDER BY u.unit_number ASC`,
          [projectId]
        )
      : dbService.query<{
          id: number
          unit_number: string
          owner_name: string
          project_name: string
          unit_type: string | null
          status: string | null
        }>(
          `SELECT u.id, u.unit_number, u.owner_name, p.name as project_name, u.unit_type, u.status
           FROM units u
           JOIN projects p ON p.id = u.project_id
           ORDER BY p.name ASC, u.unit_number ASC`
        )

    const letters = projectId
      ? dbService.query<{
          unit_id: number
          financial_year: string
          final_amount: number
        }>(
          `SELECT unit_id, financial_year, final_amount
           FROM maintenance_letters
           WHERE project_id = ?`,
          [projectId]
        )
      : dbService.query<{
          unit_id: number
          financial_year: string
          final_amount: number
        }>(
          `SELECT unit_id, financial_year, final_amount
           FROM maintenance_letters`
        )

    const payments = projectId
      ? dbService.query<{
          unit_id: number
          financial_year: string
          payment_amount: number
        }>(
          `SELECT unit_id, financial_year, payment_amount
           FROM payments
           WHERE project_id = ?`,
          [projectId]
        )
      : dbService.query<{
          unit_id: number
          financial_year: string
          payment_amount: number
        }>(
          `SELECT unit_id, financial_year, payment_amount
           FROM payments`
        )

    const years = this.getAvailableFinancialYears(projectId).slice().reverse()
    const letterMap = new Map(
      letters.map((letter) => [
        `${letter.unit_id}:${letter.financial_year}`,
        normalizeMoney(letter.final_amount)
      ])
    )
    const paymentTotals = new Map<string, number>()
    payments.forEach((payment) => {
      const key = `${payment.unit_id}:${payment.financial_year}`
      paymentTotals.set(
        key,
        normalizeMoney((paymentTotals.get(key) || 0) + payment.payment_amount)
      )
    })

    const rows: FinancialReportRow[] = units.map((unit) => {
      const row: FinancialReportRow = {
        key: String(unit.id),
        unit_id: unit.id,
        unit_number: unit.unit_number,
        owner_name: unit.owner_name,
        project_name: unit.project_name || 'N/A',
        unit_type: unit.unit_type || 'Plot',
        unit_status: unit.status || 'Sold',
        total_billed: 0,
        total_paid: 0,
        outstanding: 0
      }

      years.forEach((year) => {
        const key = `${unit.id}:${year}`
        const billed = letterMap.get(key) || 0
        const paid = paymentTotals.get(key) || 0
        const balance = normalizeMoney(billed - paid)

        row[year] = { billed, paid, balance }
        row.total_billed = normalizeMoney(row.total_billed + billed)
        row.total_paid = normalizeMoney(row.total_paid + paid)
      })

      row.outstanding = normalizeMoney(row.total_billed - row.total_paid)
      return row
    })

    const normalizedSearch = String(filters.searchText || '').trim().toLowerCase()
    const filteredRows = rows.filter((row) => {
      const matchSearch =
        !normalizedSearch ||
        row.unit_number.toLowerCase().includes(normalizedSearch) ||
        row.owner_name.toLowerCase().includes(normalizedSearch) ||
        row.project_name.toLowerCase().includes(normalizedSearch)
      const matchUnitType = !filters.selectedUnitType || row.unit_type === filters.selectedUnitType
      const matchStatus = !filters.selectedStatus || row.unit_status === filters.selectedStatus
      const [minOutstanding, maxOutstanding] = filters.outstandingRange || [null, null]
      const matchMinOutstanding = minOutstanding === null || row.outstanding >= minOutstanding
      const matchMaxOutstanding = maxOutstanding === null || row.outstanding <= maxOutstanding

      return matchSearch && matchUnitType && matchStatus && matchMinOutstanding && matchMaxOutstanding
    })

    const totalBilled = normalizeMoney(filteredRows.reduce((sum, row) => sum + row.total_billed, 0))
    const totalCollected = normalizeMoney(filteredRows.reduce((sum, row) => sum + row.total_paid, 0))
    const yearlyTotals: FinancialReportYearlyTotal[] = years.map((year) => {
      const billed = normalizeMoney(
        filteredRows.reduce((sum, row) => sum + (((row[year] as FinancialReportYearlyData) || {}).billed || 0), 0)
      )
      const paid = normalizeMoney(
        filteredRows.reduce((sum, row) => sum + (((row[year] as FinancialReportYearlyData) || {}).paid || 0), 0)
      )
      const balance = normalizeMoney(
        filteredRows.reduce((sum, row) => sum + (((row[year] as FinancialReportYearlyData) || {}).balance || 0), 0)
      )
      const unitCount = filteredRows.filter((row) => {
        const yearData = row[year] as FinancialReportYearlyData | undefined
        return (yearData?.billed || 0) > 0
      }).length

      return { year, billed, paid, balance, unitCount }
    })

    return {
      rows: filteredRows,
      years,
      stats: {
        totalBilled,
        totalCollected,
        outstanding: normalizeMoney(totalBilled - totalCollected)
      },
      yearlyTotals
    }
  }
}

export const reportService = new ReportService()
