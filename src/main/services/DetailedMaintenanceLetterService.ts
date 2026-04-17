import { dbService } from '../db/database'
import { projectService } from './ProjectService'
import { getFYDeadline } from '../utils/dateUtils'
import { normalizeMoney } from '../utils/money'
import { maintenanceLetterService } from './MaintenanceLetterService'
import {
  calculateArrearsBreakdownForCurrentFinancialYear,
  type ArrearsBreakdownEntry
} from './LetterBalanceService'

type CurrentYearCharges = {
  base_amount: number
  na_tax: number
  solar_contribution: number
  cable_charges: number
}

type UnitDetails = {
  unit_number: string
  owner_name: string
  plot_area: number
  rate_per_sqft: number
  sector_code?: string
  unit_type?: string
}

type BankDetails = {
  name: string
  account_no: string
  ifsc_code: string
  bank_name: string
  branch: string
  branch_address: string
  qr_code_path: string
}

export interface DetailedMaintenanceLetter {
  id?: number
  project_id: number
  unit_id: number
  financial_year: string
  base_amount: number
  arrears?: number
  discount_amount: number
  final_amount: number
  is_paid?: boolean
  is_sent?: boolean
  due_date?: string
  status: string
  pdf_path?: string
  generated_date?: string
  unit_number?: string
  owner_name?: string
  project_name?: string
  letterhead_path?: string
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  branch_address?: string
  qr_code_path?: string
  sector_code?: string
  add_ons_total?: number
  unit_type?: string
}

export type ArrearsEntry = ArrearsBreakdownEntry

export interface ChargeEntry {
  description: string
  amount: number
}

export interface DetailedLetterPreviewRow {
  key: string
  particulars: string
  plot_area: number | null
  rate: number | null
  amount: number | null
  penalty: number | null
  discount: number | null
  before_due: number | null
  after_due: number | null
  isTotal?: boolean
}

export interface LetterCalculation {
  unit_details: {
    unit_number: string
    owner_name: string
    plot_area: number
    rate_per_sqft: number
  }
  arrears_breakdown: ArrearsEntry[]
  penalty_percentage: number
  penalty_label: 'Penalty' | 'Late Payment Charges'
  discount_percentage: number
  due_date: string
  current_year_charges: {
    base_amount: number
    na_tax: number
    solar_contribution: number
    cable_charges: number
  }
  charges_breakdown: ChargeEntry[]
  preview_rows: DetailedLetterPreviewRow[]
  totals: {
    total_arrears_with_penalty: number
    total_current_charges: number
    grand_total_before_discount: number
    early_payment_discount: number
    amount_payable_before_due: number
    amount_payable_after_due: number
    penalty_percentage: number
    penalty_label: 'Penalty' | 'Late Payment Charges'
  }
  bank_details: {
    name: string
    account_no: string
    ifsc_code: string
    bank_name: string
    branch: string
    branch_address: string
    qr_code_path: string
  }
}

class DetailedMaintenanceLetterService {
  private getPenaltyPercentageForFinancialYear(
    projectId: number,
    financialYear: string,
    unitType: string | undefined,
    fallbackPenaltyPercentage: number
  ): number {
    const rate =
      dbService.get<{ penalty_percentage: number | null }>(
        `SELECT penalty_percentage
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ? AND unit_type = ?`,
        [projectId, financialYear, unitType || 'Bungalow']
      ) ||
      dbService.get<{ penalty_percentage: number | null }>(
        `SELECT penalty_percentage
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ? AND (unit_type = 'All' OR unit_type IS NULL)`,
        [projectId, financialYear]
      )

    return rate?.penalty_percentage ?? fallbackPenaltyPercentage
  }

  private getCurrentLetter(
    projectId: number,
    unitId: number,
    financialYear: string
  ): {
    id: number
    base_amount: number
    arrears: number
    discount_amount: number
    final_amount: number
    due_date?: string
  } {
    const letter = dbService.get<{
      id: number
      base_amount: number
      arrears: number
      discount_amount: number
      final_amount: number
      due_date?: string
    }>(
      `SELECT id, base_amount, arrears, discount_amount, final_amount, due_date
       FROM maintenance_letters
       WHERE project_id = ? AND unit_id = ? AND financial_year = ?`,
      [projectId, unitId, financialYear]
    )

    if (!letter) {
      throw new Error(
        'Maintenance letter not found for the specified project, unit, and financial year'
      )
    }

    return {
      ...letter,
      base_amount: normalizeMoney(letter.base_amount),
      arrears: normalizeMoney(letter.arrears),
      discount_amount: normalizeMoney(letter.discount_amount),
      final_amount: normalizeMoney(letter.final_amount)
    }
  }

  private getCurrentLetterAddOns(letterId: number): ChargeEntry[] {
    return dbService
      .query<{ addon_name: string; addon_amount: number }>(
        `SELECT addon_name, addon_amount FROM add_ons WHERE letter_id = ? ORDER BY id ASC`,
        [letterId]
      )
      .map((addon) => ({
        description: addon.addon_name,
        amount: normalizeMoney(addon.addon_amount)
      }))
      .filter((addon) => addon.amount > 0)
  }

  private getCurrentRateDiscountPercentage(
    projectId: number,
    financialYear: string,
    unitType: string | undefined,
    dueDate: string | undefined,
    fallbackDiscountAmount: number,
    baseAmount: number
  ): number {
    const rate =
      dbService.get<{ id: number }>(
        `SELECT id
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ? AND unit_type = ?`,
        [projectId, financialYear, unitType || 'Bungalow']
      ) ||
      dbService.get<{ id: number }>(
        `SELECT id
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ? AND (unit_type = 'All' OR unit_type IS NULL)`,
        [projectId, financialYear]
      )

    if (rate?.id && dueDate) {
      const slab = dbService.get<{ discount_percentage: number }>(
        `SELECT discount_percentage
         FROM maintenance_slabs
         WHERE rate_id = ? AND due_date = ? AND is_early_payment = 1
         ORDER BY due_date ASC
         LIMIT 1`,
        [rate.id, dueDate]
      )
      if (slab?.discount_percentage !== undefined) {
        return slab.discount_percentage
      }
    }

    if (baseAmount > 0 && fallbackDiscountAmount > 0) {
      return normalizeMoney((fallbackDiscountAmount / baseAmount) * 100)
    }

    return 0
  }

  private buildPreviewRows(
    calculation: Omit<LetterCalculation, 'preview_rows'>
  ): DetailedLetterPreviewRow[] {
    const rows: DetailedLetterPreviewRow[] = [
      {
        key: 'base',
        particulars: 'Current Maintenance',
        plot_area: calculation.unit_details.plot_area,
        rate: calculation.unit_details.rate_per_sqft,
        amount: calculation.current_year_charges.base_amount,
        penalty: normalizeMoney(
          calculation.current_year_charges.base_amount * (calculation.penalty_percentage / 100)
        ),
        discount: normalizeMoney(calculation.totals.early_payment_discount),
        before_due: normalizeMoney(
          calculation.current_year_charges.base_amount - calculation.totals.early_payment_discount
        ),
        after_due: normalizeMoney(
          calculation.current_year_charges.base_amount +
            calculation.current_year_charges.base_amount * (calculation.penalty_percentage / 100)
        )
      }
    ]

    calculation.charges_breakdown.forEach((charge, index) => {
      rows.push({
        key: `charge-${index}`,
        particulars: charge.description,
        plot_area: null,
        rate: null,
        amount: charge.amount,
        penalty: null,
        discount: null,
        before_due: charge.amount,
        after_due: charge.amount
      })
    })

    calculation.arrears_breakdown.forEach((arrears, index) => {
      rows.push({
        key: `arrears-${index}`,
        particulars: `Arrears (${arrears.financial_year})`,
        plot_area: null,
        rate: null,
        amount: arrears.amount,
        penalty: arrears.penalty,
        discount: null,
        before_due: arrears.total_with_penalty,
        after_due: arrears.total_with_penalty
      })
    })

    rows.push({
      key: 'total',
      particulars: 'Total Amount Payable',
      plot_area: null,
      rate: null,
      amount: null,
      penalty: null,
      discount: null,
      before_due: calculation.totals.amount_payable_before_due,
      after_due: calculation.totals.amount_payable_after_due,
      isTotal: true
    })

    return rows
  }

  private calculateCurrentYearCharges(baseAmount: number): CurrentYearCharges {
    return {
      base_amount: normalizeMoney(baseAmount),
      na_tax: 0,
      solar_contribution: 0,
      cable_charges: 0
    }
  }

  private getUnitDetails(projectId: number, unitId: number, financialYear: string): UnitDetails {
    const unit = dbService.get<{
      unit_number: string
      owner_name: string
      area_sqft: number
      sector_code: string
      unit_type: string
    }>(
      `SELECT unit_number, owner_name, area_sqft, sector_code, unit_type
       FROM units WHERE id = ?`,
      [unitId]
    )

    // Get rate for current year using the same priority as maintenance letter generation
    const rate =
      dbService.get<{ rate_per_sqft: number }>(
        `SELECT rate_per_sqft
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ? AND unit_type = ?`,
        [projectId, financialYear, unit?.unit_type]
      ) ||
      dbService.get<{ rate_per_sqft: number }>(
        `SELECT rate_per_sqft
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ? AND (unit_type = 'All' OR unit_type IS NULL)`,
        [projectId, financialYear]
      )

    return {
      unit_number: unit?.unit_number || '',
      owner_name: unit?.owner_name || '',
      plot_area: unit?.area_sqft || 0,
      rate_per_sqft: rate?.rate_per_sqft || 0,
      sector_code: unit?.sector_code,
      unit_type: unit?.unit_type
    }
  }

  private getBankDetails(projectId: number, sectorCode?: string): BankDetails {
    const project = dbService.get<{
      account_name: string
      bank_name: string
      account_no: string
      ifsc_code: string
      branch: string
      branch_address: string
      qr_code_path: string
    }>(
      `SELECT account_name, bank_name, account_no, ifsc_code, branch, branch_address, qr_code_path
       FROM projects WHERE id = ?`,
      [projectId]
    )

    // Check for sector-specific bank details
    if (sectorCode) {
      const sectorConfig = dbService.get<{
        account_name: string
        bank_name: string
        account_no: string
        ifsc_code: string
        branch: string
        qr_code_path: string
      }>(
        `SELECT account_name, bank_name, account_no, ifsc_code, branch, qr_code_path
         FROM project_sector_payment_configs 
         WHERE project_id = ? AND UPPER(TRIM(sector_code)) = UPPER(TRIM(?))`,
        [projectId, sectorCode]
      )

      if (sectorConfig) {
        return {
          name: sectorConfig.account_name || project?.account_name || '',
          account_no: sectorConfig.account_no || project?.account_no || '',
          ifsc_code: sectorConfig.ifsc_code || project?.ifsc_code || '',
          bank_name: sectorConfig.bank_name || project?.bank_name || '',
          branch: sectorConfig.branch || project?.branch || '',
          branch_address: project?.branch_address || '',
          qr_code_path: sectorConfig.qr_code_path || project?.qr_code_path || ''
        }
      }
    }

    return {
      name: project?.account_name || '',
      account_no: project?.account_no || '',
      ifsc_code: project?.ifsc_code || '',
      bank_name: project?.bank_name || '',
      branch: project?.branch || '',
      branch_address: project?.branch_address || '',
      qr_code_path: project?.qr_code_path || ''
    }
  }

  public async generateDetailedLetter(
    projectId: number,
    unitId: number,
    financialYear: string
  ): Promise<LetterCalculation> {
    const currentLetter = this.getCurrentLetter(projectId, unitId, financialYear)
    const unitDetails = this.getUnitDetails(projectId, unitId, financialYear)
    const chargesConfig = projectService.getChargesConfig(projectId)
    const computedArrearsBreakdown = calculateArrearsBreakdownForCurrentFinancialYear({
      projectId,
      unitId,
      targetFinancialYear: financialYear,
      unitType: unitDetails.unit_type,
      fallbackPenaltyPercentage: chargesConfig.penalty_percentage
    })
    const computedArrearsTotal = normalizeMoney(
      computedArrearsBreakdown.reduce((sum, entry) => sum + entry.total_with_penalty, 0)
    )
    const storedArrearsTotal = normalizeMoney(currentLetter.arrears)
    const arrears_breakdown: ArrearsEntry[] =
      storedArrearsTotal <= 0
        ? []
        : Math.abs(storedArrearsTotal - computedArrearsTotal) <= 0.01
          ? computedArrearsBreakdown
          : [
              {
                financial_year: 'Brought Forward',
                amount: storedArrearsTotal,
                penalty: 0,
                total_with_penalty: storedArrearsTotal
              }
            ]
    const current_year_charges = this.calculateCurrentYearCharges(currentLetter.base_amount)
    const currentLetterAddOns = this.getCurrentLetterAddOns(currentLetter.id)

    const charges_breakdown: ChargeEntry[] = [...currentLetterAddOns]

    // Calculate totals
    const total_arrears_with_penalty = storedArrearsTotal
    const total_current_charges = normalizeMoney(
      current_year_charges.base_amount +
        charges_breakdown.reduce((sum, entry) => sum + entry.amount, 0)
    )
    const grand_total_before_discount = normalizeMoney(
      total_arrears_with_penalty + total_current_charges
    )

    const penaltyLabel: 'Penalty' | 'Late Payment Charges' =
      chargesConfig.penalty_label === 'Late Payment Charges'
        ? 'Late Payment Charges'
        : 'Penalty'
    const effectivePenaltyPercentage = this.getPenaltyPercentageForFinancialYear(
      projectId,
      financialYear,
      unitDetails.unit_type,
      chargesConfig.penalty_percentage
    )
    const effectiveDiscountPercentage = this.getCurrentRateDiscountPercentage(
      projectId,
      financialYear,
      unitDetails.unit_type,
      currentLetter.due_date,
      currentLetter.discount_amount,
      current_year_charges.base_amount
    )
    const early_payment_discount = currentLetter.discount_amount
    const amount_payable_before_due = currentLetter.final_amount
    const amount_payable_after_due = grand_total_before_discount

    const bank_details = this.getBankDetails(projectId, unitDetails.sector_code)

    const calculation = {
      unit_details: unitDetails,
      arrears_breakdown,
      penalty_percentage: effectivePenaltyPercentage,
      penalty_label: penaltyLabel,
      discount_percentage: effectiveDiscountPercentage,
      due_date: currentLetter.due_date || getFYDeadline(financialYear),
      current_year_charges,
      charges_breakdown,
      totals: {
        total_arrears_with_penalty,
        total_current_charges,
        grand_total_before_discount,
        early_payment_discount,
        amount_payable_before_due,
        amount_payable_after_due,
        penalty_percentage: effectivePenaltyPercentage,
        penalty_label: penaltyLabel
      },
      bank_details
    }

    return {
      ...calculation,
      preview_rows: this.buildPreviewRows(calculation)
    }
  }

  public async generateDetailedPdf(
    projectId: number,
    unitId: number,
    financialYear: string
  ): Promise<string> {
    const letterId = maintenanceLetterService.getLetterIdByProjectUnitAndYear(
      projectId,
      unitId,
      financialYear
    )

    if (!letterId) {
      throw new Error('Maintenance letter not found for the specified project, unit, and financial year')
    }

    // Keep a single PDF renderer in production so stored letter data,
    // currency formatting, and backend calculations stay aligned.
    return maintenanceLetterService.generatePdf(letterId)
  }
}

export const detailedMaintenanceLetterService = new DetailedMaintenanceLetterService()
