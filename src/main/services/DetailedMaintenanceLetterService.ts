import { dbService } from '../db/database'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { projectService } from './ProjectService'
import { getFYDeadline } from '../utils/dateUtils'
import { Logger } from '../utils/logger'

const logger = Logger.getInstance()

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

export interface ArrearsEntry {
  financial_year: string
  amount: number
  penalty: number
  total_with_penalty: number
}

export interface ChargeEntry {
  description: string
  amount: number
}

export interface LetterCalculation {
  unit_details: {
    unit_number: string
    owner_name: string
    plot_area: number
    rate_per_sqft: number
  }
  arrears_breakdown: ArrearsEntry[]
  current_year_charges: {
    base_amount: number
    na_tax: number
    solar_contribution: number
    cable_charges: number
  }
  charges_breakdown: ChargeEntry[]
  totals: {
    total_arrears_with_penalty: number
    total_current_charges: number
    grand_total_before_discount: number
    early_payment_discount: number
    amount_payable_before_due: number
    amount_payable_after_due: number
    penalty_percentage: number
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
  private calculateArrearsWithPenalty(
    projectId: number,
    unitId: number,
    currentFY: string
  ): ArrearsEntry[] {
    // Get all previous financial years
    const previousYears = dbService
      .query<{ financial_year: string }>(
        `SELECT DISTINCT financial_year FROM maintenance_letters 
       WHERE project_id = ? AND financial_year < ? 
       ORDER BY financial_year ASC`,
        [projectId, currentFY]
      )
      .map((row) => row.financial_year)

    const arrears: ArrearsEntry[] = []

    for (const fy of previousYears) {
      // Get the letter for this financial year
      const letter = dbService.get<{
        id: number
        base_amount: number
        final_amount: number
        arrears: number
      }>(
        `SELECT id, base_amount, final_amount, arrears 
         FROM maintenance_letters 
         WHERE project_id = ? AND unit_id = ? AND financial_year = ?`,
        [projectId, unitId, fy]
      )

      if (letter) {
        // Calculate outstanding amount for this year
        const payments =
          dbService.get<{ total: number }>(
            `SELECT COALESCE(SUM(payment_amount), 0) as total 
           FROM payments 
           WHERE unit_id = ? AND financial_year = ?`,
            [unitId, fy]
          )?.total || 0

        const outstanding = Math.max(0, letter.final_amount - payments)

        if (outstanding > 0) {
          const chargesConfig = projectService.getChargesConfig(projectId)
          const penaltyRate = chargesConfig.penalty_percentage / 100
          const penalty = outstanding * penaltyRate
          arrears.push({
            financial_year: fy,
            amount: outstanding,
            penalty: penalty,
            total_with_penalty: outstanding + penalty
          })
        }
      }
    }

    return arrears
  }

  private calculateCurrentYearCharges(projectId: number, unitId: number, currentFY: string): any {
    // Get current year base amount
    const letter = dbService.get<{ base_amount: number }>(
      `SELECT base_amount FROM maintenance_letters 
       WHERE project_id = ? AND unit_id = ? AND financial_year = ?`,
      [projectId, unitId, currentFY]
    )

    const base_amount = letter?.base_amount || 0

    // Get project charges configuration
    const chargesConfig = projectService.getChargesConfig(projectId)

    // Calculate N.A. Tax using configured rate
    const unit = dbService.get<{ area_sqft: number }>('SELECT area_sqft FROM units WHERE id = ?', [
      unitId
    ])
    const na_tax = (unit?.area_sqft || 0) * chargesConfig.na_tax_rate_per_sqft

    // Use configured fixed charges
    const solar_contribution = chargesConfig.solar_contribution
    const cable_charges = chargesConfig.cable_charges

    return {
      base_amount,
      na_tax,
      solar_contribution,
      cable_charges
    }
  }

  private getUnitDetails(projectId: number, unitId: number, financialYear: string): any {
    const unit = dbService.get<{
      unit_number: string
      owner_name: string
      area_sqft: number
      sector_code: string
    }>(
      `SELECT unit_number, owner_name, area_sqft, sector_code 
       FROM units WHERE id = ?`,
      [unitId]
    )

    // Get rate for current year
    const rate = dbService.get<{ rate_per_sqft: number }>(
      `SELECT rate_per_sqft 
       FROM maintenance_rates 
       WHERE project_id = ? AND financial_year = ?`,
      [projectId, financialYear]
    )

    return {
      unit_number: unit?.unit_number || '',
      owner_name: unit?.owner_name || '',
      plot_area: unit?.area_sqft || 0,
      rate_per_sqft: rate?.rate_per_sqft || 0,
      sector_code: unit?.sector_code
    }
  }

  private getBankDetails(projectId: number, sectorCode?: string): any {
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
        branch_address: string
        qr_code_path: string
      }>(
        `SELECT account_name, bank_name, account_no, ifsc_code, branch, branch_address, qr_code_path
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
          branch_address: sectorConfig.branch_address || project?.branch_address || '',
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
    const unitDetails = this.getUnitDetails(projectId, unitId, financialYear)
    const arrears_breakdown = this.calculateArrearsWithPenalty(projectId, unitId, financialYear)
    const current_year_charges = this.calculateCurrentYearCharges(projectId, unitId, financialYear)

    // Build charges breakdown
    const charges_breakdown: ChargeEntry[] = []

    // Add current year charges
    if (current_year_charges.base_amount > 0) {
      charges_breakdown.push({
        description: `Current ${financialYear}`,
        amount: current_year_charges.base_amount
      })
    }

    if (current_year_charges.na_tax > 0) {
      charges_breakdown.push({
        description: `N.A Tax ${financialYear}`,
        amount: current_year_charges.na_tax
      })
    }

    if (current_year_charges.solar_contribution > 0) {
      charges_breakdown.push({
        description: 'Solar Contribution as per AGM',
        amount: current_year_charges.solar_contribution
      })
    }

    if (current_year_charges.cable_charges > 0) {
      charges_breakdown.push({
        description: 'Cable laying for motor Pump',
        amount: current_year_charges.cable_charges
      })
    }

    // Calculate totals
    const total_arrears_with_penalty = arrears_breakdown.reduce(
      (sum, entry) => sum + entry.total_with_penalty,
      0
    )
    const total_current_charges = charges_breakdown.reduce((sum, entry) => sum + entry.amount, 0)
    const grand_total_before_discount = total_arrears_with_penalty + total_current_charges

    // 10% early payment discount
    const chargesConfig = projectService.getChargesConfig(projectId)
    const early_payment_discount =
      grand_total_before_discount * (chargesConfig.early_payment_discount_percentage / 100)
    const amount_payable_before_due = grand_total_before_discount - early_payment_discount
    const amount_payable_after_due = grand_total_before_discount

    const bank_details = this.getBankDetails(projectId, unitDetails.sector_code)

    return {
      unit_details: unitDetails,
      arrears_breakdown,
      current_year_charges,
      charges_breakdown,
      totals: {
        total_arrears_with_penalty,
        total_current_charges,
        grand_total_before_discount,
        early_payment_discount,
        amount_payable_before_due,
        amount_payable_after_due,
        penalty_percentage: chargesConfig.penalty_percentage
      },
      bank_details
    }
  }

  public async generateDetailedPdf(
    projectId: number,
    unitId: number,
    financialYear: string
  ): Promise<string> {
    const calculation = await this.generateDetailedLetter(projectId, unitId, financialYear)
    const project = dbService.get<{ name: string; letterhead_path: string; address?: string; city?: string; state?: string }>(
      'SELECT name, letterhead_path, address, city, state FROM projects WHERE id = ?',
      [projectId]
    )

    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([595.28, 841.89]) // A4 size
    const { width, height } = page.getSize()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    // Add letterhead if available
    const letterheadPath = project?.letterhead_path ? path.resolve(project.letterhead_path) : ''
    const letterheadExt = path.extname(letterheadPath).toLowerCase()
    const isSupportedLetterhead =
      letterheadExt === '.png' || letterheadExt === '.jpg' || letterheadExt === '.jpeg'

    if (isSupportedLetterhead && letterheadPath) {
      try {
        const letterheadBytes = await fs.promises.readFile(letterheadPath)
        const letterheadImage =
          letterheadExt === '.png'
            ? await pdfDoc.embedPng(letterheadBytes)
            : await pdfDoc.embedJpg(letterheadBytes)
        page.drawImage(letterheadImage, {
          x: 0,
          y: height - 100,
          width,
          height: 100
        })
      } catch (error) {
        console.error('Error embedding letterhead image:', error)
        page.drawRectangle({
          x: 0,
          y: height - 100,
          width: width,
          height: 100,
          color: rgb(0.17, 0.48, 0.37)
        })
      }
    } else {
      page.drawRectangle({
        x: 0,
        y: height - 100,
        width: width,
        height: 100,
        color: rgb(0.17, 0.48, 0.37)
      })
    }

    // Header
    const projectName = project?.name || 'MAINTENANCE LETTER'
    page.drawText(projectName.toUpperCase(), {
      x: 50,
      y: height - 50,
      size: 24,
      font: boldFont,
      color: rgb(1, 1, 1)
    })

    // Build subtitle with project address if available
    let subtitle = 'RESIDENTIAL MAINTENANCE LETTER'
    if (project?.address) {
      const cityState = [project.city, project.state].filter(Boolean).join(', ')
      const fullAddress = cityState ? `${project.address}, ${cityState}` : project.address
      subtitle = fullAddress.length > 60 ? fullAddress.substring(0, 57) + '...' : fullAddress
    }
    
    page.drawText(subtitle, {
      x: 50,
      y: height - 80,
      size: 12,
      font: font,
      color: rgb(0.9, 0.9, 0.9)
    })

    // Date and address
    const today = new Date().toLocaleDateString('en-GB')
    page.drawText(`Date: ${today}`, { x: 400, y: height - 50, size: 12, font: boldFont })

    page.drawText('To,', { x: 50, y: height - 150, size: 12, font: boldFont })
    page.drawText(calculation.unit_details.owner_name, {
      x: 50,
      y: height - 170,
      size: 14,
      font: boldFont
    })
    page.drawText(`Unit No: ${calculation.unit_details.unit_number}`, {
      x: 50,
      y: height - 190,
      size: 12,
      font
    })

    // Financial year
    page.drawText(`Maintenance Letter for ${financialYear}`, {
      x: 50,
      y: height - 220,
      size: 14,
      font: boldFont
    })

    // Main table
    let currentY = height - 260
    const tableX = 50
    const tableWidth = 500

    // Table header
    page.drawRectangle({
      x: tableX,
      y: currentY,
      width: tableWidth,
      height: 30,
      color: rgb(0.17, 0.48, 0.37)
    })

    // Header text
    page.drawText('Particulars', {
      x: tableX + 10,
      y: currentY + 10,
      size: 12,
      font: boldFont,
      color: rgb(1, 1, 1)
    })
    page.drawText('Plot Area', {
      x: tableX + 200,
      y: currentY + 10,
      size: 12,
      font: boldFont,
      color: rgb(1, 1, 1)
    })
    page.drawText('Rate per', {
      x: tableX + 280,
      y: currentY + 20,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1)
    })
    page.drawText('Amount', {
      x: tableX + 360,
      y: currentY + 10,
      size: 12,
      font: boldFont,
      color: rgb(1, 1, 1)
    })
    page.drawText(`${calculation.totals.penalty_percentage}%`, {
      x: tableX + 400,
      y: currentY + 20,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1)
    })
    page.drawText('Discount', {
      x: tableX + 440,
      y: currentY + 20,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1)
    })
    page.drawText('Before', {
      x: tableX + 480,
      y: currentY + 20,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1)
    })
    page.drawText('After', {
      x: tableX + 520,
      y: currentY + 20,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1)
    })

    currentY -= 30

    // Draw sub-header line
    page.drawLine({
      start: { x: tableX, y: currentY },
      end: { x: tableX + tableWidth, y: currentY }
    })

    // Arrears entries
    for (const arrears of calculation.arrears_breakdown) {
      currentY -= 20
      page.drawText(`${arrears.financial_year} Arrears`, {
        x: tableX + 10,
        y: currentY,
        size: 10,
        font
      })
      page.drawText(`${calculation.unit_details.plot_area.toFixed(2)}`, {
        x: tableX + 200,
        y: currentY,
        size: 10,
        font
      })
      page.drawText(`${calculation.unit_details.rate_per_sqft.toFixed(2)}`, {
        x: tableX + 280,
        y: currentY,
        size: 10,
        font
      })
      page.drawText(`${arrears.amount.toFixed(2)}`, {
        x: tableX + 360,
        y: currentY,
        size: 10,
        font
      })
      page.drawText(`${arrears.penalty.toFixed(2)}`, {
        x: tableX + 400,
        y: currentY,
        size: 10,
        font
      })
      page.drawText('-', { x: tableX + 440, y: currentY, size: 10, font })
      page.drawText(`${arrears.total_with_penalty.toFixed(2)}`, {
        x: tableX + 480,
        y: currentY,
        size: 10,
        font
      })
      page.drawText(`${arrears.total_with_penalty.toFixed(2)}`, {
        x: tableX + 520,
        y: currentY,
        size: 10,
        font
      })
    }

    // Current year charges
    for (const charge of calculation.charges_breakdown) {
      currentY -= 20
      page.drawText(charge.description, { x: tableX + 10, y: currentY, size: 10, font })
      page.drawText('-', { x: tableX + 200, y: currentY, size: 10, font })
      page.drawText('-', { x: tableX + 280, y: currentY, size: 10, font })
      page.drawText(`${charge.amount.toFixed(2)}`, { x: tableX + 360, y: currentY, size: 10, font })
      page.drawText('-', { x: tableX + 400, y: currentY, size: 10, font })
      page.drawText('-', { x: tableX + 440, y: currentY, size: 10, font })
      page.drawText(`${charge.amount.toFixed(2)}`, { x: tableX + 480, y: currentY, size: 10, font })
      page.drawText(`${charge.amount.toFixed(2)}`, { x: tableX + 520, y: currentY, size: 10, font })
    }

    // Totals
    currentY -= 10
    page.drawLine({
      start: { x: tableX, y: currentY },
      end: { x: tableX + tableWidth, y: currentY }
    })
    currentY -= 20

    // Extract deadline date
    const deadlineDate = getFYDeadline(financialYear)

    page.drawText(`Amount Payable before ${deadlineDate}`, {
      x: tableX + 10,
      y: currentY,
      size: 12,
      font: boldFont
    })
    page.drawText(`${calculation.totals.amount_payable_before_due.toFixed(2)}`, {
      x: tableX + 480,
      y: currentY,
      size: 12,
      font: boldFont
    })

    currentY -= 20
    page.drawText(`Amount Payable after ${deadlineDate}`, {
      x: tableX + 10,
      y: currentY,
      size: 12,
      font: boldFont
    })
    page.drawText(`${calculation.totals.amount_payable_after_due.toFixed(2)}`, {
      x: tableX + 520,
      y: currentY,
      size: 12,
      font: boldFont
    })

    // Bank details
    currentY -= 40
    page.drawText('Bank Details:', { x: tableX, y: currentY, size: 12, font: boldFont })

    currentY -= 20
    page.drawText(`Name: ${calculation.bank_details.name}`, {
      x: tableX,
      y: currentY,
      size: 10,
      font
    })

    currentY -= 15
    page.drawText(`Account No.: ${calculation.bank_details.account_no}`, {
      x: tableX,
      y: currentY,
      size: 10,
      font
    })

    currentY -= 15
    page.drawText(`IFSC Code: ${calculation.bank_details.ifsc_code}`, {
      x: tableX,
      y: currentY,
      size: 10,
      font
    })

    currentY -= 15
    page.drawText(`Bank Name: ${calculation.bank_details.bank_name}`, {
      x: tableX,
      y: currentY,
      size: 10,
      font
    })

    currentY -= 15
    page.drawText(`Branch: ${calculation.bank_details.branch}`, {
      x: tableX,
      y: currentY,
      size: 10,
      font
    })

    if (calculation.bank_details.branch_address) {
      currentY -= 15
      page.drawText(`Branch Address: ${calculation.bank_details.branch_address}`, {
        x: tableX,
        y: currentY,
        size: 10,
        font
      })
    }

    // Add QR code if available
    const qrPath = calculation.bank_details.qr_code_path
      ? path.resolve(calculation.bank_details.qr_code_path)
      : ''
    const qrExt = path.extname(qrPath).toLowerCase()
    const isSupportedQrImage = qrExt === '.png' || qrExt === '.jpg' || qrExt === '.jpeg'
    if (qrPath && isSupportedQrImage) {
        try {
          const qrImageBytes = await fs.promises.readFile(qrPath)
          const qrImage =
          qrExt === '.png'
            ? await pdfDoc.embedPng(qrImageBytes)
            : await pdfDoc.embedJpg(qrImageBytes)
        page.drawImage(qrImage, {
          x: tableX + 400,
          y: currentY - 100,
          width: 100,
          height: 100
        })
        page.drawText('Scan to Pay', {
          x: tableX + 420,
          y: currentY - 115,
          size: 10,
          font: boldFont
        })
      } catch (error) {
        logger.error('Error embedding QR image', error as Error)
      }
    }

    const pdfBytes = await pdfDoc.save()
    const pdfDir = path.join(app.getPath('userData'), 'maintenance-letters-detailed')
    await fs.promises.mkdir(pdfDir, { recursive: true })

    const fileName = `Detailed_Letter_${unitId}_${financialYear}.pdf`
    const filePath = path.join(pdfDir, fileName)
    await fs.promises.writeFile(filePath, pdfBytes)

    return filePath
  }
}

export const detailedMaintenanceLetterService = new DetailedMaintenanceLetterService()
