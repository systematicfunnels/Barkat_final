import { dbService } from '../db/database'
import { projectService } from './ProjectService'
import { BasePDFGenerator } from './BasePDFGenerator'
import fs from 'fs'
import path from 'path'
import { PDFFont, rgb } from 'pdf-lib'
import { normalizeMoney } from '../utils/money'
import { getUserDataPath } from '../utils/runtimePaths'
import { calculateArrearsBreakdownForCurrentFinancialYear } from './LetterBalanceService'

export interface MaintenanceLetter {
  id?: number
  project_id: number
  unit_id: number
  financial_year: string
  base_amount: number
  arrears?: number
  snapshot_discount_percentage?: number
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
  contact_number?: string
  project_name?: string
  project_code?: string
  sector_code?: string
  unit_type?: string
  letterhead_path?: string
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  branch_address?: string
  qr_code_path?: string
  snapshot_account_name?: string
  snapshot_bank_name?: string
  snapshot_account_no?: string
  snapshot_ifsc_code?: string
  snapshot_branch?: string
  snapshot_branch_address?: string
  snapshot_qr_code_path?: string
  snapshot_uses_sector_config?: boolean | number
  project_qr_code?: string
  sector_qr_code?: string
  sector_letterhead_path?: string
  sector_account_name?: string
  sector_bank_name?: string
  sector_account_no?: string
  sector_ifsc_code?: string
  sector_branch?: string
  template_type?: string
  add_ons_total?: number
}

export interface LetterAddOn {
  id?: number
  letter_id: number
  addon_name: string
  addon_amount: number
  remarks?: string
  created_at?: string
}

export interface BatchLetterResult {
  success: boolean
  createdCount: number
  skippedCount: number
  createdLetterIds: number[]
  skippedUnitIds: number[]
}

class MaintenanceLetterService extends BasePDFGenerator {
  private formatLongDate(date: string | Date): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date

    if (Number.isNaN(dateObj.getTime())) {
      return typeof date === 'string' ? date : this.formatDate(dateObj)
    }

    return dateObj.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  private drawWrappedTextBlock(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    size: number,
    font: typeof this.fonts.regular,
    color: ReturnType<typeof rgb>,
    align: 'left' | 'center' = 'left',
    lineHeight: number = size + 4
  ): number {
    const lines = this.wrapTextLines(text, maxWidth, font, size).filter(Boolean)
    if (lines.length === 0) return 0

    lines.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(line, size)
      const drawX = align === 'center' ? x + (maxWidth - lineWidth) / 2 : x

      this.page.drawText(line, {
        x: drawX,
        y: y - index * lineHeight,
        size,
        font,
        color
      })
    })

    return lines.length * lineHeight
  }

  private wrapTextLines(
    text: string,
    maxWidth: number,
    font: typeof this.fonts.regular,
    size: number
  ): string[] {
    const words = String(text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)

    if (words.length === 0) return ['']

    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word
      if (font.widthOfTextAtSize(nextLine, size) <= maxWidth || currentLine === '') {
        currentLine = nextLine
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }

    if (currentLine) lines.push(currentLine)
    return lines
  }

  private formatUnitReference(plotNumber: string, sector?: string, unitType?: string): string {
    const normalizedPlotNumber = String(plotNumber || '').trim() || '01'
    const normalizedSector = String(sector || '').trim()
    const normalizedUnitType = String(unitType || 'Plot').trim() || 'Plot'
    const unitPrefix =
      normalizedUnitType === 'BMF'
        ? 'BMF-'
        : normalizedUnitType === 'Bungalow'
          ? 'B-'
          : `${normalizedUnitType.substring(0, 1)}-`
    const normalizedNumberWithoutPrefix = normalizedPlotNumber.replace(
      new RegExp(`^${unitPrefix.replace('-', '\\-')}`, 'i'),
      ''
    )
    const unitDisplay = `${unitPrefix}${normalizedNumberWithoutPrefix || '01'}`

    return `${normalizedSector ? `${normalizedSector}/` : ''}${unitDisplay}`
  }

  private getCurrentBankSnapshot(projectId: number, sectorCode?: string): {
    accountName: string
    bankName: string
    accountNo: string
    ifscCode: string
    branch: string
    branchAddress: string
    qrCodePath: string
    usesSectorConfig: 0 | 1
  } {
    const projectDefaultBank = dbService.get<{
      account_name?: string
      bank_name?: string
      account_no?: string
      ifsc_code?: string
      branch?: string
      branch_address?: string
      qr_code_path?: string
    }>(
      `SELECT account_name, bank_name, account_no, ifsc_code, branch, branch_address, qr_code_path
       FROM projects
       WHERE id = ?`,
      [projectId]
    )

    const sectorBank =
      sectorCode && String(sectorCode).trim() !== ''
        ? dbService.get<{
            account_name?: string
            bank_name?: string
            account_no?: string
            ifsc_code?: string
            branch?: string
            branch_address?: string
            qr_code_path?: string
          }>(
            `SELECT account_name, bank_name, account_no, ifsc_code, branch, qr_code_path
             FROM project_sector_payment_configs
             WHERE project_id = ? AND UPPER(TRIM(sector_code)) = UPPER(TRIM(?))`,
            [projectId, sectorCode]
          )
        : undefined

    const usesSectorConfig = !!(
      sectorBank &&
      (sectorBank.account_name || sectorBank.account_no || sectorBank.bank_name || sectorBank.ifsc_code)
    )

    return {
      accountName: usesSectorConfig
        ? sectorBank?.account_name || ''
        : projectDefaultBank?.account_name || '',
      bankName: usesSectorConfig
        ? sectorBank?.bank_name || ''
        : projectDefaultBank?.bank_name || '',
      accountNo: usesSectorConfig
        ? sectorBank?.account_no || ''
        : projectDefaultBank?.account_no || '',
      ifscCode: usesSectorConfig
        ? sectorBank?.ifsc_code || ''
        : projectDefaultBank?.ifsc_code || '',
      branch: usesSectorConfig
        ? sectorBank?.branch || ''
        : projectDefaultBank?.branch || '',
      branchAddress: usesSectorConfig ? sectorBank?.branch_address || '' : projectDefaultBank?.branch_address || '',
      qrCodePath: usesSectorConfig
        ? sectorBank?.qr_code_path || ''
        : projectDefaultBank?.qr_code_path || '',
      usesSectorConfig: usesSectorConfig ? 1 : 0
    }
  }

  private resolveLetterBankDetails(letter: MaintenanceLetter): {
    accountName: string
    bankName: string
    accountNo: string
    ifscCode: string
    branch: string
    branchAddress: string
    qrCodePath: string
    usesSectorConfig: boolean
  } {
    const hasSnapshot = !!(
      letter.snapshot_account_name ||
      letter.snapshot_account_no ||
      letter.snapshot_bank_name ||
      letter.snapshot_ifsc_code ||
      letter.snapshot_branch ||
      letter.snapshot_branch_address ||
      letter.snapshot_qr_code_path
    )

    if (hasSnapshot) {
      return {
        accountName: letter.snapshot_account_name || '',
        bankName: letter.snapshot_bank_name || '',
        accountNo: letter.snapshot_account_no || '',
        ifscCode: letter.snapshot_ifsc_code || '',
        branch: letter.snapshot_branch || '',
        branchAddress: letter.snapshot_branch_address || '',
        qrCodePath: letter.snapshot_qr_code_path || '',
        usesSectorConfig: Boolean(letter.snapshot_uses_sector_config)
      }
    }

    const hasSectorBank = !!(letter.sector_account_name || letter.sector_account_no || letter.sector_bank_name)

    return {
      accountName: hasSectorBank ? letter.sector_account_name || '' : letter.account_name || '',
      bankName: hasSectorBank ? letter.sector_bank_name || '' : letter.bank_name || '',
      accountNo: hasSectorBank ? letter.sector_account_no || '' : letter.account_no || '',
      ifscCode: hasSectorBank ? letter.sector_ifsc_code || '' : letter.ifsc_code || '',
      branch: hasSectorBank ? letter.sector_branch || '' : letter.branch || '',
      branchAddress: hasSectorBank ? '' : letter.branch_address || '',
      qrCodePath: hasSectorBank ? letter.sector_qr_code || '' : letter.project_qr_code || '',
      usesSectorConfig: hasSectorBank
    }
  }

  private resolveQrCodePath(qrCodePath: string): string | null {
    if (!qrCodePath) return null
    
    // Security: Prevent path traversal attacks by normalizing and checking for parent directory references
    const normalizedPath = path.normalize(qrCodePath)
    if (normalizedPath.includes('..')) {
      return null
    }
    
    const possiblePaths = Array.from(new Set([
      qrCodePath,
      path.resolve(qrCodePath),
      path.join(process.cwd(), qrCodePath),
      path.join(getUserDataPath(), qrCodePath),
      path.join(getUserDataPath(), 'assets', qrCodePath),
      qrCodePath.startsWith('assets/') 
        ? path.join(getUserDataPath(), qrCodePath)
        : null
    ].filter((p): p is string => Boolean(p))))

    return possiblePaths.find((possiblePath) => fs.existsSync(possiblePath)) ?? null
  }

  private async embedImageFromPath(imagePath: string) {
    const resolvedPath = this.resolveQrCodePath(imagePath)
    if (!resolvedPath) return null

    const imageBytes = fs.readFileSync(resolvedPath)
    const isPng =
      imageBytes.length > 4 &&
      imageBytes[0] === 0x89 &&
      imageBytes[1] === 0x50 &&
      imageBytes[2] === 0x4e &&
      imageBytes[3] === 0x47
    const isJpeg =
      imageBytes.length > 3 &&
      imageBytes[0] === 0xff &&
      imageBytes[1] === 0xd8 &&
      imageBytes[2] === 0xff

    if (isPng) {
      return this.pdfDoc.embedPng(imageBytes)
    }
    if (isJpeg) {
      return this.pdfDoc.embedJpg(imageBytes)
    }

    const ext = path.extname(resolvedPath).toLowerCase()
    return ext === '.png'
      ? this.pdfDoc.embedPng(imageBytes)
      : this.pdfDoc.embedJpg(imageBytes)
  }

  private sanitizeFileComponent(value: string): string {
    return String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_')
      .replace(/-+/g, '-')
      .replace(/^[-_.]+|[-_.]+$/g, '') || 'document'
  }

  private sanitizeSortableUnitComponent(value: string): string {
    return this.sanitizeFileComponent(value).replace(/\d+/g, (digits) =>
      digits.length >= 3 ? digits : digits.padStart(3, '0')
    )
  }

  private getProjectFolderName(projectCode?: string, projectName?: string): string {
    const normalizedCode = this.sanitizeFileComponent(projectCode || '')
    const normalizedName = this.sanitizeFileComponent(projectName || '')

    if (normalizedCode && normalizedName) {
      return `${normalizedCode}_${normalizedName}`
    }

    return normalizedCode || normalizedName || 'Unknown_Project'
  }

  private getEffectiveLetterheadPath(
    letter: MaintenanceLetter,
    projectLetterheadPath?: string
  ): string {
    return (
      String(letter.sector_letterhead_path || '').trim() ||
      String(letter.letterhead_path || '').trim() ||
      String(projectLetterheadPath || '').trim()
    )
  }

  private drawElectronicFooter(text: string): void {
    const footerFont = this.fonts.italic ?? this.fonts.regular
    const footerY = 16
    const footerSize = 8.5
    const textWidth = footerFont.widthOfTextAtSize(text, footerSize)
    const footerX = (this.layout.width - textWidth) / 2
    const lineGap = 14
    const lineY = footerY + 4
    const leftLineEndX = footerX - lineGap
    const rightLineStartX = footerX + textWidth + lineGap

    if (leftLineEndX - this.MARGIN > 24) {
      this.page.drawLine({
        start: { x: this.MARGIN, y: lineY },
        end: { x: leftLineEndX, y: lineY },
        thickness: 0.8,
        color: this.COLORS.ACCENT
      })
    }

    if (this.layout.width - this.MARGIN - rightLineStartX > 24) {
      this.page.drawLine({
        start: { x: rightLineStartX, y: lineY },
        end: { x: this.layout.width - this.MARGIN, y: lineY },
        thickness: 0.8,
        color: this.COLORS.ACCENT
      })
    }

    this.page.drawText(text, {
      x: footerX,
      y: footerY,
      size: footerSize,
      font: footerFont,
      color: this.COLORS.GRAY
    })
  }

  private drawCenteredSectionDivider(
    text: string,
    options?: {
      size?: number
      lineGap?: number
      lineThickness?: number
      textColor?: ReturnType<typeof rgb>
      lineColor?: ReturnType<typeof rgb>
      minLineWidth?: number
      advanceAfter?: number
      font?: PDFFont
    }
  ): void {
    const headingText = String(text || '').trim()
    if (!headingText) return

    const size = options?.size ?? 10.4
    const lineGap = options?.lineGap ?? 14
    const lineThickness = options?.lineThickness ?? 0.8
    const textColor = options?.textColor ?? this.COLORS.TEXT
    const lineColor = options?.lineColor ?? this.COLORS.ACCENT
    const minLineWidth = options?.minLineWidth ?? 28
    const font = options?.font ?? this.fonts.bold
    const textWidth = font.widthOfTextAtSize(headingText, size)
    const textX = (this.layout.width - textWidth) / 2
    const lineY = this.layout.currentY + Math.max(3.6, size * 0.42)
    const leftLineEndX = textX - lineGap
    const rightLineStartX = textX + textWidth + lineGap

    if (leftLineEndX - this.MARGIN > minLineWidth) {
      this.page.drawLine({
        start: { x: this.MARGIN, y: lineY },
        end: { x: leftLineEndX, y: lineY },
        thickness: lineThickness,
        color: lineColor
      })
    }

    if (this.layout.width - this.MARGIN - rightLineStartX > minLineWidth) {
      this.page.drawLine({
        start: { x: rightLineStartX, y: lineY },
        end: { x: this.layout.width - this.MARGIN, y: lineY },
        thickness: lineThickness,
        color: lineColor
      })
    }

    this.page.drawText(headingText, {
      x: textX,
      y: this.layout.currentY,
      size,
      font,
      color: textColor
    })

    if (typeof options?.advanceAfter === 'number') {
      this.layout.currentY -= options.advanceAfter
    }
  }

  public getAll(): MaintenanceLetter[] {
    return dbService.query<MaintenanceLetter>(`
      SELECT l.*, u.unit_number, u.owner_name, u.unit_type, u.sector_code, p.name as project_name,
             p.letterhead_path,
             ps.letterhead_path as sector_letterhead_path,
             COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
      FROM maintenance_letters l
      JOIN units u ON l.unit_id = u.id
      JOIN projects p ON l.project_id = p.id
      LEFT JOIN project_sector_payment_configs ps
        ON p.id = ps.project_id
       AND UPPER(TRIM(ps.sector_code)) = UPPER(TRIM(u.sector_code))
      ORDER BY l.generated_date DESC, l.id DESC
    `)
  }

  public getByProject(projectId: number): MaintenanceLetter[] {
    return dbService.query<MaintenanceLetter>(
      `SELECT l.*, u.unit_number, u.owner_name, u.unit_type, u.sector_code, p.name as project_name,
              p.letterhead_path,
              ps.letterhead_path as sector_letterhead_path,
              COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
       FROM maintenance_letters l
       JOIN units u ON l.unit_id = u.id
       JOIN projects p ON l.project_id = p.id
       LEFT JOIN project_sector_payment_configs ps
         ON p.id = ps.project_id
        AND UPPER(TRIM(ps.sector_code)) = UPPER(TRIM(u.sector_code))
       WHERE l.project_id = ?
       ORDER BY l.generated_date DESC, l.id DESC`,
      [projectId]
    )
  }

  public getById(id: number): MaintenanceLetter | undefined {
    return dbService.get<MaintenanceLetter>(
      `
      SELECT l.*, u.unit_number, u.owner_name, u.contact_number, u.unit_type, u.sector_code,
             p.name as project_name, p.project_code,
             p.account_name, p.bank_name, p.branch, p.branch_address, p.account_no, p.ifsc_code,
             p.letterhead_path,
             p.qr_code_path as project_qr_code,
             COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total,
             ps.account_name as sector_account_name,
             ps.bank_name as sector_bank_name,
             ps.account_no as sector_account_no,
             ps.ifsc_code as sector_ifsc_code,
             ps.branch as sector_branch,
             ps.letterhead_path as sector_letterhead_path,
             ps.qr_code_path as sector_qr_code
      FROM maintenance_letters l
      JOIN units u ON l.unit_id = u.id
      JOIN projects p ON l.project_id = p.id
      LEFT JOIN project_sector_payment_configs ps ON p.id = ps.project_id AND UPPER(TRIM(ps.sector_code)) = UPPER(TRIM(u.sector_code))
      WHERE l.id = ?
    `,
      [id]
    )
  }

  public async generatePdf(id: number): Promise<string> {
    const letter = this.getById(id)
    if (!letter) throw new Error('Maintenance letter not found')

    const effectiveBankDetails = this.resolveLetterBankDetails(letter)

    const missingBankDetails: string[] = []
    if (!effectiveBankDetails.accountName || String(effectiveBankDetails.accountName).trim() === '') {
      missingBankDetails.push('Account Name')
    }
    if (!effectiveBankDetails.accountNo || String(effectiveBankDetails.accountNo).trim() === '') {
      missingBankDetails.push('Account Number')
    }
    if (!effectiveBankDetails.bankName || String(effectiveBankDetails.bankName).trim() === '') {
      missingBankDetails.push('Bank Name')
    }
    if (!effectiveBankDetails.ifscCode || String(effectiveBankDetails.ifscCode).trim() === '') {
      missingBankDetails.push('IFSC Code')
    }

    if (missingBankDetails.length > 0) {
      throw new Error(
        `Cannot generate PDF: Missing required bank details: ${missingBankDetails.join(', ')}. ` +
        `Please configure the matching sector bank details in Project Settings first.`
      )
    }

    const addOns = this.getAddOns(id)

    await this.initializePDF()

    await this.drawLetterheadLetter(letter)
    await this.drawRecipientSection(letter)
    this.drawCenteredUnderlinedTitle(letter.financial_year)
    this.drawAmountTable(letter, addOns)
    await this.drawBankDetails(letter)
    this.drawElectronicFooter('This is an electronically generated maintenance letter. No signature required.')

    const pdfBytes = await this.pdfDoc.save()
    const pdfDir = path.join(
      getUserDataPath(),
      'maintenance-letters',
      this.getProjectFolderName(letter.project_code, letter.project_name),
      this.sanitizeFileComponent(letter.financial_year || 'Unknown-Year')
    )
    
    try {
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true })
      }
    } catch (error) {
      throw new Error('Unable to create PDF output directory')
    }

    const unitIdentifier = letter.unit_number || String(letter.unit_id || 'NA')
    const fileName = `MaintenanceLetter_${this.sanitizeSortableUnitComponent(unitIdentifier)}_${this.sanitizeFileComponent(letter.financial_year)}.pdf`
    const filePath = path.join(pdfDir, fileName)
    
    try {
      fs.writeFileSync(filePath, pdfBytes)
    } catch (error) {
      throw new Error('Unable to save PDF file')
    }

    dbService.run('UPDATE maintenance_letters SET pdf_path = ? WHERE id = ?', [filePath, id])

    return filePath
  }

  public getAddOns(letterId: number): LetterAddOn[] {
    return dbService.query<LetterAddOn>('SELECT * FROM add_ons WHERE letter_id = ?', [letterId])
  }

  public getAllAddOns(): LetterAddOn[] {
    return dbService.query<LetterAddOn>('SELECT * FROM add_ons')
  }

  public addAddOn(params: {
    unit_id: number
    financial_year: string
    addon_name: string
    addon_amount: number
    remarks?: string
  }): boolean {
    return dbService.transaction(() => {
      const letter = dbService.get<{ id: number; final_amount: number }>(
        'SELECT id, final_amount FROM maintenance_letters WHERE unit_id = ? AND financial_year = ?',
        [params.unit_id, params.financial_year]
      )
      if (!letter) return false
      
      dbService.run(
        'INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks) VALUES (?, ?, ?, ?)',
        [letter.id, params.addon_name, normalizeMoney(params.addon_amount), params.remarks]
      )
      
      const newFinalAmount = normalizeMoney(letter.final_amount + normalizeMoney(params.addon_amount))
      dbService.run('UPDATE maintenance_letters SET final_amount = ? WHERE id = ?', [newFinalAmount, letter.id])
      
      return true
    })
  }

  public deleteAddOn(id: number): boolean {
    return dbService.transaction(() => {
      const addon = dbService.get<{ letter_id: number; addon_amount: number }>(
        'SELECT letter_id, addon_amount FROM add_ons WHERE id = ?',
        [id]
      )
      if (!addon) return false
      
      const result = dbService.run('DELETE FROM add_ons WHERE id = ?', [id])
      
      if (result.changes > 0) {
        const letter = dbService.get<{ final_amount: number }>(
          'SELECT final_amount FROM maintenance_letters WHERE id = ?',
          [addon.letter_id]
        )
        if (letter) {
          const newFinalAmount = normalizeMoney(letter.final_amount - addon.addon_amount)
          dbService.run('UPDATE maintenance_letters SET final_amount = ? WHERE id = ?', [newFinalAmount, addon.letter_id])
        }
        return true
      }
      return false
    })
  }

  public createBatch(
    projectId: number,
    financialYear: string,
    letterDate: string,
    dueDate: string,
    unitIds: number[],
    addOns: Array<{ addon_name: string; addon_amount: number; remarks?: string }>
  ): boolean {
    return this.createBatchDetailed(projectId, financialYear, letterDate, dueDate, unitIds, addOns)
      .success
  }

  public createBatchDetailed(
    projectId: number,
    financialYear: string,
    letterDate: string,
    dueDate: string,
    unitIds: number[] | undefined,
    addOns: Array<{ addon_name: string; addon_amount: number; remarks?: string }>
  ): BatchLetterResult {
    return dbService.transaction(() => {
      try {
        const createdLetters: number[] = []
        const chargesConfig = projectService.getChargesConfig(projectId)
        const skippedUnits: number[] = []
        const targetUnitIds =
          unitIds && unitIds.length > 0
            ? unitIds
            : dbService
                .query<{ id: number }>('SELECT id FROM units WHERE project_id = ? ORDER BY unit_number ASC', [
                  projectId
                ])
                .map((unit) => unit.id)

        if (targetUnitIds.length === 0) {
          throw new Error('No units found for the selected project')
        }

        for (const unitId of targetUnitIds) {
          // Check if letter already exists for this unit and financial year
          const existingLetter = dbService.get<{ id: number }>(
            'SELECT id FROM maintenance_letters WHERE unit_id = ? AND financial_year = ?',
            [unitId, financialYear]
          )

          if (existingLetter) {
            skippedUnits.push(unitId)
            continue
          }

          // Get unit details for calculation
          const unit = dbService.get<{ area_sqft: number; unit_type: string; sector_code?: string }>(
            'SELECT area_sqft, unit_type, sector_code FROM units WHERE id = ?',
            [unitId]
          )

          if (!unit) {
            throw new Error(`Unit not found: ${unitId}`)
          }

          if (!String(unit.sector_code || '').trim()) {
            throw new Error(
              `Unit ${unitId} is missing a sector code. Assign sector codes before generating maintenance letters.`
            )
          }

          // Get maintenance rate - prefer unit_type-specific rate, fallback to 'All'
          const rate =
            dbService.get<{ id: number; rate_per_sqft: number; gst_percent: number }>(
              `SELECT id, rate_per_sqft, COALESCE(gst_percent, 0) as gst_percent
               FROM maintenance_rates
               WHERE project_id = ? AND financial_year = ? AND unit_type = ?`,
              [projectId, financialYear, unit.unit_type]
            ) ||
            dbService.get<{ id: number; rate_per_sqft: number; gst_percent: number }>(
              `SELECT id, rate_per_sqft, COALESCE(gst_percent, 0) as gst_percent
               FROM maintenance_rates
               WHERE project_id = ? AND financial_year = ? AND (unit_type = 'All' OR unit_type IS NULL)`,
              [projectId, financialYear]
            )

          if (!rate) {
            throw new Error(
              `No maintenance rate found for project ${projectId}, year ${financialYear}, unit type ${unit.unit_type}`
            )
          }

          // 1. Current Year Maintenance (Base)
          const baseAmount = normalizeMoney(unit.area_sqft * rate.rate_per_sqft)

          // 2. GST on base maintenance (from rate config)
          const gstPercent = rate.gst_percent || 0
          const gstAmount = gstPercent > 0 ? normalizeMoney((baseAmount * gstPercent) / 100) : 0

          // 3. Manual Add-ons from the UI (unit-specific)
          const normalizedAddOns =
            addOns?.map((addon) => ({
              ...addon,
              addon_amount: normalizeMoney(addon.addon_amount)
            })) || []
          const addOnsTotal = normalizedAddOns.reduce((sum, addon) => sum + addon.addon_amount, 0)

          // 4. Arrears - sum of genuinely unpaid prior-year letters using the same rule as previews
          const totalArrears = normalizeMoney(
            calculateArrearsBreakdownForCurrentFinancialYear({
              projectId,
              unitId,
              targetFinancialYear: financialYear,
              unitType: unit.unit_type,
              fallbackPenaltyPercentage: chargesConfig.penalty_percentage || 0
            }).reduce((sum, entry) => sum + entry.total_with_penalty, 0)
          )

          // 5. Determine early-payment discount from slabs (if any)
          let discountAmount = 0
          let snapshotDiscountPercentage = 0
          const slabs = dbService.query<{
            due_date: string
            discount_percentage: number
            is_early_payment: number
          }>(
            `SELECT due_date, discount_percentage, is_early_payment
             FROM maintenance_slabs WHERE rate_id = ? ORDER BY due_date ASC`,
            [rate.id]
          )
          const earlySlabs = slabs.filter((s) => s.is_early_payment && s.discount_percentage > 0)
          if (earlySlabs.length > 0) {
            const bestSlab = earlySlabs[0]
            snapshotDiscountPercentage = bestSlab.discount_percentage
            discountAmount = normalizeMoney(baseAmount * (bestSlab.discount_percentage / 100))
          }

          // Final amount = sum of all charges minus discount
          const finalAmount = normalizeMoney(
            baseAmount + gstAmount + addOnsTotal + totalArrears - discountAmount
          )

          const bankSnapshot = this.getCurrentBankSnapshot(projectId, unit.sector_code)
          const missingSectorBankFields = [
            !bankSnapshot.accountName ? 'account name' : null,
            !bankSnapshot.bankName ? 'bank name' : null,
            !bankSnapshot.accountNo ? 'account number' : null,
            !bankSnapshot.ifscCode ? 'IFSC code' : null
          ].filter(Boolean)

          if (missingSectorBankFields.length > 0) {
            throw new Error(
              `Missing bank details for sector ${unit.sector_code}. Complete ${missingSectorBankFields.join(', ')} in Project Settings, or provide project default bank details, before generating maintenance letters.`
            )
          }

          const result = dbService.run(
            `INSERT INTO maintenance_letters (
              project_id, unit_id, financial_year, base_amount,
              arrears, snapshot_discount_percentage, discount_amount, final_amount, due_date,
              snapshot_account_name, snapshot_bank_name, snapshot_account_no, snapshot_ifsc_code,
              snapshot_branch, snapshot_branch_address, snapshot_qr_code_path, snapshot_uses_sector_config,
              status, generated_date, is_paid, is_sent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              projectId,
              unitId,
              financialYear,
              baseAmount,
              totalArrears,
              snapshotDiscountPercentage,
              discountAmount,
              finalAmount,
              dueDate,
              bankSnapshot.accountName,
              bankSnapshot.bankName,
              bankSnapshot.accountNo,
              bankSnapshot.ifscCode,
              bankSnapshot.branch,
              bankSnapshot.branchAddress,
              bankSnapshot.qrCodePath,
              bankSnapshot.usesSectorConfig,
              'Generated',
              letterDate,
              0,
              0
            ]
          )

          const letterId = result.lastInsertRowid as number
          createdLetters.push(letterId)

          // Store GST as add-on row if applicable
          if (gstAmount > 0) {
            dbService.run(
              `INSERT INTO add_ons (letter_id, addon_name, addon_amount) VALUES (?, ?, ?)`,
              [letterId, `GST (${gstPercent}%)`, normalizeMoney(gstAmount)]
            )
          }

          // Manual add-ons from billing form
          if (normalizedAddOns.length > 0) {
            for (const addon of normalizedAddOns) {
              dbService.run(
                `INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks) VALUES (?, ?, ?, ?)`,
                [letterId, addon.addon_name, addon.addon_amount, addon.remarks || null]
              )
            }
          }
        }

        return {
          success: createdLetters.length > 0,
          createdCount: createdLetters.length,
          skippedCount: skippedUnits.length,
          createdLetterIds: createdLetters,
          skippedUnitIds: skippedUnits
        }
      } catch (error) {
        throw error
      }
    })
  }

  public update(id: number, updates: Partial<MaintenanceLetter>): boolean {
    const allowedFields = ['base_amount', 'arrears', 'discount_amount', 'final_amount', 'due_date', 'status', 'is_paid', 'is_sent']
    const fields: string[] = []
    const values: unknown[] = []
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined) {
        fields.push(`${key} = ?`)
        values.push(value)
      }
    }
    
    if (fields.length === 0) return false
    
    values.push(id)
    const result = dbService.run(
      `UPDATE maintenance_letters SET ${fields.join(', ')} WHERE id = ?`,
      values
    )
    return result.changes > 0
  }

  public delete(id: number): boolean {
    const result = dbService.run('DELETE FROM maintenance_letters WHERE id = ?', [id])
    return result.changes > 0
  }

  public bulkDelete(ids: number[]): boolean {
    const placeholders = ids.map(() => '?').join(',')
    const result = dbService.run(`DELETE FROM maintenance_letters WHERE id IN (${placeholders})`, ids)
    return result.changes > 0
  }

  public getLetterIdByProjectUnitAndYear(
    projectId: number,
    unitId: number,
    financialYear: string
  ): number | undefined {
    const result = dbService.get<{ id: number }>(
      'SELECT id FROM maintenance_letters WHERE project_id = ? AND unit_id = ? AND financial_year = ?',
      [projectId, unitId, financialYear]
    )
    return result?.id
  }

  protected async drawLetterheadLetter(letter: MaintenanceLetter): Promise<void> {
    const project = dbService.get<{ 
      name: string; 
      address?: string; 
      city?: string; 
      state?: string;
      registration_no?: string;
      letterhead_path?: string;
    }>(
      'SELECT name, address, city, state, registration_no, letterhead_path FROM projects WHERE id = ?',
      [letter.project_id]
    )

    const brandTealLight = rgb(0.92, 0.97, 0.97)
    const societyName = project?.name || letter.project_name || 'Maintenance Letter'
    const regNo = project?.registration_no || ''
    const effectiveLetterheadPath = this.getEffectiveLetterheadPath(letter, project?.letterhead_path)
    const bannerHeight = effectiveLetterheadPath ? 138 : 118
    const bannerTopY = this.layout.currentY + 4
    const bannerBottomY = bannerTopY - bannerHeight

    const sublineParts = [
      letter.sector_code?.trim() ? `Sector ${letter.sector_code.trim()}` : null,
      regNo ? `Regd. No. ${regNo}` : null
    ].filter(Boolean) as string[]

    let drewLetterhead = false
    if (effectiveLetterheadPath) {
      try {
        const letterheadImage = await this.embedImageFromPath(effectiveLetterheadPath)
        if (letterheadImage) {
          const frameX = this.MARGIN
          const frameY = bannerBottomY + 4
          const frameWidth = this.layout.contentWidth
          const frameHeight = bannerHeight - 2

          this.page.drawRectangle({
            x: frameX,
            y: frameY,
            width: frameWidth,
            height: frameHeight,
            color: rgb(1, 1, 1)
          })

          const imageAspectRatio = letterheadImage.width / letterheadImage.height
          const frameAspectRatio = frameWidth / frameHeight
          let drawWidth = frameWidth
          let drawHeight = frameHeight

          if (imageAspectRatio > frameAspectRatio) {
            drawHeight = drawWidth / imageAspectRatio
          } else {
            drawWidth = drawHeight * imageAspectRatio
          }

          this.page.drawImage(letterheadImage, {
            x: frameX + (frameWidth - drawWidth) / 2,
            y: frameY + (frameHeight - drawHeight) / 2,
            width: drawWidth,
            height: drawHeight
          })

          drewLetterhead = true
        }
      } catch (error) {
        console.error('Failed to draw header letterhead image:', error)
      }
    }

    if (!drewLetterhead) {
      this.page.drawRectangle({
        x: this.MARGIN,
        y: bannerBottomY,
        width: this.layout.contentWidth,
        height: bannerHeight,
        color: rgb(0.98, 0.98, 0.97)
      })

      const nameLines = this.wrapTextLines(societyName, this.layout.contentWidth - 32, this.fonts.bold, 24)
      nameLines.slice(0, 2).forEach((line, index) => {
        this.page.drawText(line, {
          x: this.MARGIN + 18,
          y: bannerTopY - 34 - index * 24,
          size: 24,
          font: this.fonts.bold,
          color: this.COLORS.SECONDARY
        })
      })

      this.page.drawText('Sector Maintenance Statement', {
        x: this.MARGIN + 18,
        y: bannerTopY - 58,
        size: 10,
        font: this.fonts.bold,
        color: this.COLORS.ACCENT
      })

      if (sublineParts.length > 0) {
        this.page.drawText(sublineParts.join('  |  '), {
          x: this.MARGIN + 18,
          y: bannerBottomY + 20,
          size: 8.5,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
      }
    }

    this.layout.currentY = bannerBottomY - (drewLetterhead ? 10 : 2)

    if (project?.address && !drewLetterhead) {
      this.page.drawRectangle({
        x: this.MARGIN,
        y: this.layout.currentY - 18,
        width: this.layout.contentWidth,
        height: 18,
        color: brandTealLight
      })

      const cityState = [project.city, project.state].filter(Boolean).join(', ')
      const fullAddress = cityState ? `${project.address}, ${cityState}` : project.address
      const addressLines = this.wrapTextLines(
        fullAddress,
        this.layout.contentWidth - 24,
        this.fonts.regular,
        8.5
      )

      this.page.drawText(addressLines[0] || fullAddress, {
        x: this.MARGIN + 12,
        y: this.layout.currentY - 12,
        size: 8.5,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })

      this.layout.currentY -= 30
    }

    this.layout.currentY -= drewLetterhead ? 20 : 10
    this.drawCenteredSectionDivider('MAINTENANCE LETTER', {
      size: 10.3,
      advanceAfter: 18,
      lineThickness: 0.8
    })
  }

  private drawCenteredUnderlinedTitle(financialYear: string): void {
    if (!financialYear || !financialYear.includes('-')) {
      this.layout.currentY -= 25
      return
    }
    
    const [startYear, endYearShort] = financialYear.split('-')
    if (!startYear || !endYearShort) {
      this.layout.currentY -= 25
      return
    }
    
    const endYear = endYearShort.length === 2 ? startYear.slice(0, 2) + endYearShort : startYear
    const titleText = `FOR APRIL ${startYear} - MARCH ${endYear}`
    this.drawCenteredSectionDivider(titleText, {
      size: 10.2,
      advanceAfter: 18,
      lineThickness: 0.8
    })

    this.page.drawText('ITEMS & ARREARS', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10.8,
      font: this.fonts.bold,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 18
  }

  protected async drawRecipientSection(letter: MaintenanceLetter): Promise<void> {
    const unit = dbService.get<{
      unit_number: string;
      owner_name: string;
      area_sqft?: number;
      sector_code?: string;
      unit_type?: string;
    }>(
      'SELECT unit_number, owner_name, area_sqft, sector_code, unit_type FROM units WHERE id = ?',
      [letter.unit_id]
    )
    const owners = letter.owner_name || unit?.owner_name || 'N/A'
    const plotNumber = letter.unit_number || unit?.unit_number || '01'
    const sector = unit?.sector_code?.trim() || letter.sector_code?.trim() || ''
    const unitType = unit?.unit_type || 'Plot'
    const generatedDate =
      letter.generated_date && !Number.isNaN(new Date(letter.generated_date).getTime())
        ? new Date(letter.generated_date)
        : new Date()
    const issueDate = generatedDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
    const dueDate = this.formatDate(letter.due_date || generatedDate)
    const sectionTopY = this.layout.currentY
    const cardWidth = this.layout.contentWidth
    const leftX = this.MARGIN
    const badgeText = this.formatUnitReference(plotNumber, sector, unitType)
    const badgeWidth = this.fonts.bold.widthOfTextAtSize(badgeText, 8) + 20
    const cardPaddingX = 14
    const rightPaneWidth = 166
    const summaryCardHeight = 76
    const ownerContentWidth = Math.max(220, cardWidth - rightPaneWidth - 52)
    const ownerMaxWidth = Math.max(200, ownerContentWidth - 14)
    const ownerLines = this.wrapTextLines(owners, ownerMaxWidth, this.fonts.bold, 15).slice(0, 2)
    const ownerBlockHeight = Math.max(20, ownerLines.length * 17)
    const metaLines = [
      `UNIT REF: ${badgeText}`,
      `TYPE: ${unitType}`,
      sector ? `SECTOR: ${sector}` : null
    ].filter(Boolean) as string[]
    const metaBlockHeight = metaLines.length * 13
    const rightPaneHeight = 18 + 10 + summaryCardHeight
    const cardHeight = Math.max(106, 38 + ownerBlockHeight + metaBlockHeight, rightPaneHeight + 28)
    const cardBottomY = sectionTopY - cardHeight

    this.page.drawRectangle({
      x: leftX,
      y: cardBottomY,
      width: cardWidth,
      height: cardHeight,
      color: rgb(0.985, 0.987, 0.988),
      borderColor: this.COLORS.BORDER,
      borderWidth: 0.65
    })

    this.page.drawRectangle({
      x: leftX,
      y: cardBottomY + cardHeight - 17,
      width: cardWidth,
      height: 17,
      color: rgb(0.945, 0.952, 0.953)
    })

    this.page.drawText('CUSTOMER:', {
      x: leftX + cardPaddingX,
      y: cardBottomY + cardHeight - 13.5,
      size: 7.8,
      font: this.fonts.regular,
      color: this.COLORS.GRAY
    })

    const ownerTopY = cardBottomY + cardHeight - 40
    ownerLines.forEach((line, index) => {
      this.page.drawText(line, {
        x: leftX + cardPaddingX,
        y: ownerTopY - index * 17,
        size: 15,
        font: this.fonts.bold,
        color: this.COLORS.TEXT
      })
    })

    metaLines.forEach((line, index) => {
      this.page.drawText(String(line), {
        x: leftX + cardPaddingX,
        y: ownerTopY - ownerBlockHeight - 9 - index * 13,
        size: 8.6,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    const rightPaneX = leftX + cardWidth - rightPaneWidth - 16
    const badgeX = rightPaneX + rightPaneWidth - badgeWidth
    const badgeY = cardBottomY + cardHeight - 17
    const summaryY = cardBottomY + 12

    this.page.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeWidth,
      height: 15,
      color: rgb(0.16, 0.52, 0.70),
      borderColor: rgb(0.12, 0.45, 0.60),
      borderWidth: 0.4
    })

    this.page.drawText(badgeText, {
      x: badgeX + 9,
      y: badgeY + 4.2,
      size: 8,
      font: this.fonts.bold,
      color: rgb(1, 1, 1)
    })

    this.page.drawRectangle({
      x: rightPaneX,
      y: summaryY,
      width: rightPaneWidth,
      height: summaryCardHeight,
      color: rgb(0.10, 0.56, 0.55),
      borderColor: rgb(0.07, 0.44, 0.43),
      borderWidth: 0.55
    })

    this.page.drawText('MAINTENANCE', {
      x: rightPaneX + 11,
      y: summaryY + summaryCardHeight - 18,
      size: 10.9,
      font: this.fonts.bold,
      color: rgb(1, 1, 1)
    })

    this.page.drawRectangle({
      x: rightPaneX + 10,
      y: summaryY + 9,
      width: rightPaneWidth - 20,
      height: summaryCardHeight - 31,
      color: rgb(0.23, 0.67, 0.66)
    })

    const summaryLabelX = rightPaneX + 19
    const summaryValueRightX = rightPaneX + rightPaneWidth - 18
    const summaryRowStartY = summaryY + summaryCardHeight - 34
    const summaryRowGap = 13
    ;[
      ['Issue Date', issueDate],
      ['Due Date', dueDate],
      ['Statement FY', letter.financial_year]
    ].forEach(([label, value], index) => {
      const rowY = summaryRowStartY - index * summaryRowGap
      const valueText = String(value)
      const valueWidth = this.fonts.bold.widthOfTextAtSize(valueText, 7.9)
      this.page.drawText(`${label}:`, {
        x: summaryLabelX,
        y: rowY,
        size: 7.25,
        font: this.fonts.regular,
        color: rgb(0.92, 0.985, 0.98)
      })
      this.page.drawText(valueText, {
        x: summaryValueRightX - valueWidth,
        y: rowY,
        size: 7.9,
        font: this.fonts.bold,
        color: rgb(1, 1, 1)
      })
    })

    this.layout.currentY = cardBottomY - 20

    this.page.drawText('Dear Resident,', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10.5,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 16

    const introText =
      'Below is the maintenance statement for your unit, including the current maintenance amount, any add-ons, previous arrears, and the payable totals.'
    const introHeight = this.drawWrappedTextBlock(
      introText,
      this.MARGIN,
      this.layout.currentY,
      this.layout.contentWidth,
      8.75,
      this.fonts.regular,
      this.COLORS.GRAY
    )

    this.layout.currentY -= Math.max(26, introHeight + 8)
  }

  private drawAmountTable(letter: MaintenanceLetter, addOns: LetterAddOn[]): void {
    const unit = dbService.get<{ area_sqft: number; unit_type: string }>(
      'SELECT area_sqft, unit_type FROM units WHERE id = ?',
      [letter.unit_id]
    )

    if (!unit?.area_sqft || unit.area_sqft <= 0) {
      throw new Error(`Invalid plot area (${unit?.area_sqft || 0}) for unit. Please check unit configuration.`)
    }

    const plotArea = unit.area_sqft
    const baseAmount = normalizeMoney(letter.base_amount || 0)
    const discountAmount = normalizeMoney(letter.discount_amount || 0)
    const arrearsAmount = normalizeMoney(letter.arrears || 0)
    const normalizedAddOns = addOns
      .map((addon) => ({
        ...addon,
        addon_amount: normalizeMoney(addon.addon_amount)
      }))
      .filter((addon) => addon.addon_amount > 0)

    const ratePerSqft = plotArea > 0 ? baseAmount / plotArea : 0
    const roundedRatePerSqft = Number.isFinite(ratePerSqft)
      ? Math.round(ratePerSqft * 100) / 100
      : 0

    const totalBefore = normalizeMoney(letter.final_amount || 0)
    const totalAfter = normalizeMoney(totalBefore + discountAmount)
    const addOnsTotal = normalizedAddOns.reduce((sum, addon) => sum + addon.addon_amount, 0)
    const storedDiscountPercentage = Number(letter.snapshot_discount_percentage || 0)
    const discountPercentage =
      storedDiscountPercentage > 0
        ? storedDiscountPercentage
        : baseAmount > 0 && discountAmount > 0
          ? Math.round((discountAmount / baseAmount) * 10000) / 100
          : 0
    const discountPercentageLabel = Number.isInteger(discountPercentage)
      ? String(discountPercentage)
      : discountPercentage.toFixed(2).replace(/\.00$/, '')
    const [startYear, endYearShort] = String(letter.financial_year || '').split('-')
    const fullEndYear =
      !endYearShort
        ? undefined
        : endYearShort.length === 2
          ? `${String(letter.financial_year).slice(0, 2)}${endYearShort}`
          : endYearShort
    const paymentDeadlineLabel = letter.due_date ? this.formatLongDate(letter.due_date) : undefined
    const paymentAfterStartLabel = startYear ? `1 August ${startYear}` : undefined
    const financialYearEndLabel = fullEndYear ? `31 March ${fullEndYear}` : undefined

    const breakdownRows: Array<{
      title: string
      details: string
      amount: string
    }> = [
      {
        title: 'Current Maintenance',
        details: `${plotArea.toLocaleString('en-IN')} sqft x Rs. ${roundedRatePerSqft.toLocaleString('en-IN', {
          minimumFractionDigits: roundedRatePerSqft % 1 === 0 ? 0 : 2,
          maximumFractionDigits: 2
        })}`,
        amount: this.formatCurrency(baseAmount)
      }
    ]

    for (const addon of normalizedAddOns) {
      breakdownRows.push({
        title: addon.addon_name,
        details: addon.remarks?.trim() || 'Additional charge included in this statement',
        amount: this.formatCurrency(addon.addon_amount)
      })
    }

    if (arrearsAmount > 0) {
      breakdownRows.push({
        title: 'Arrears',
        details: 'Previous outstanding amount carried forward',
        amount: this.formatCurrency(arrearsAmount)
      })
    }

    const displayRows = [...breakdownRows]
    while (displayRows.length < 4) {
      displayRows.push({
        title: '',
        details: '',
        amount: ''
      })
    }

    const tableX = this.MARGIN
    const tableWidth = this.layout.contentWidth * 0.655
    const totalsGap = 14
    const totalsWidth = this.layout.contentWidth - tableWidth - totalsGap
    const totalsX = tableX + tableWidth + totalsGap
    const headerHeight = 30
    const columnWidths = [
      tableWidth * 0.10,
      tableWidth * 0.31,
      tableWidth * 0.39,
      tableWidth * 0.20
    ]
    const columnPositions = [
      tableX,
      tableX + columnWidths[0],
      tableX + columnWidths[0] + columnWidths[1],
      tableX + columnWidths[0] + columnWidths[1] + columnWidths[2],
      tableX + tableWidth
    ]

    const titleFontSize = 8.75
    const detailFontSize = 8.25
    const titleLineSpacing = 10
    const detailLineSpacing = 9
    const rowTopPadding = 13
    const rowBottomPadding = 8

    const rowMetrics = displayRows.map((row, index) => {
      const titleLines = this.wrapTextLines(row.title, columnWidths[1] - 16, this.fonts.bold, titleFontSize)
      const detailLines = this.wrapTextLines(
        row.details,
        columnWidths[2] - 16,
        this.fonts.regular,
        detailFontSize
      )

      const titleBlockHeight =
        titleLines.length > 0
          ? titleFontSize + (titleLines.length - 1) * titleLineSpacing
          : 0
      const detailBlockHeight =
        detailLines.length > 0
          ? detailFontSize + (detailLines.length - 1) * detailLineSpacing
          : 0
      const contentHeight = Math.max(titleBlockHeight, detailBlockHeight, row.amount ? titleFontSize : 0)
      const minHeight = index < 2 ? 28 : 24

      return {
        titleLines,
        detailLines,
        rowHeight: Math.max(minHeight, rowTopPadding + contentHeight + rowBottomPadding)
      }
    })

    const rowHeights = rowMetrics.map((metric) => metric.rowHeight)

    const tableHeight = headerHeight + rowHeights.reduce((sum, height) => sum + height, 0)
    const tableY = this.layout.currentY - tableHeight

    this.page.drawRectangle({
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: tableHeight,
      borderColor: this.COLORS.BORDER,
      borderWidth: 0.65
    })

    this.page.drawRectangle({
      x: tableX,
      y: tableY + tableHeight - headerHeight,
      width: tableWidth,
      height: headerHeight,
      color: rgb(0.18, 0.42, 0.31)
    })

    ;['No.', 'Item Description', 'Details', 'Amount'].forEach((header, index) => {
      const width = columnWidths[index]
      const textWidth = this.fonts.bold.widthOfTextAtSize(header, 8.5)
      this.page.drawText(header, {
        x: columnPositions[index] + (width - textWidth) / 2,
        y: tableY + tableHeight - 19,
        size: 8.5,
        font: this.fonts.bold,
        color: rgb(1, 1, 1)
      })
    })

    for (let i = 1; i < columnPositions.length - 1; i++) {
      this.page.drawLine({
        start: { x: columnPositions[i], y: tableY },
        end: { x: columnPositions[i], y: tableY + tableHeight },
        thickness: 0.6,
        color: this.COLORS.BORDER
      })
    }

    let currentRowY = tableY + tableHeight - headerHeight
    displayRows.forEach((row, rowIndex) => {
      const rowHeight = rowHeights[rowIndex]
      currentRowY -= rowHeight

      this.page.drawRectangle({
        x: tableX,
        y: currentRowY,
        width: tableWidth,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? rgb(0.992, 0.994, 0.994) : rgb(1, 1, 1)
      })

      if (rowIndex < displayRows.length - 1) {
        this.page.drawLine({
          start: { x: tableX, y: currentRowY },
          end: { x: tableX + tableWidth, y: currentRowY },
          thickness: 0.5,
          color: this.COLORS.BORDER
        })
      }

      const { titleLines, detailLines } = rowMetrics[rowIndex]
      const amountWidth = this.fonts.bold.widthOfTextAtSize(row.amount, 8.75)

      const serial = String(rowIndex + 1).padStart(2, '0')
      const serialWidth = this.fonts.regular.widthOfTextAtSize(serial, 8.25)
      this.page.drawText(serial, {
        x: columnPositions[0] + (columnWidths[0] - serialWidth) / 2,
        y: currentRowY + rowHeight - rowTopPadding - 1,
        size: 8.25,
        font: this.fonts.regular,
        color: row.title ? this.COLORS.GRAY : rgb(0.82, 0.82, 0.82)
      })

      titleLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: columnPositions[1] + 8,
          y: currentRowY + rowHeight - rowTopPadding - lineIndex * titleLineSpacing,
          size: titleFontSize,
          font: this.fonts.bold,
          color: this.COLORS.TEXT
        })
      })

      detailLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: columnPositions[2] + 8,
          y: currentRowY + rowHeight - rowTopPadding - lineIndex * detailLineSpacing,
          size: detailFontSize,
          font: this.fonts.regular,
          color: this.COLORS.GRAY
        })
      })

      if (row.amount) {
        this.page.drawText(row.amount, {
          x: columnPositions[3] + columnWidths[3] - amountWidth - 8,
          y: currentRowY + rowHeight - rowTopPadding - 1,
          size: titleFontSize,
          font: this.fonts.bold,
          color: this.COLORS.TEXT
        })
      }
    })

    const totalsRows: Array<{
      label: string
      value: string
      note?: string
      tone?: 'default' | 'discount' | 'highlight'
    }> = [
      {
        label: 'Subtotal',
        value: this.formatCurrency(baseAmount + addOnsTotal + arrearsAmount)
      }
    ]

    if (discountAmount > 0) {
      totalsRows.push({
        label: `Discount (${discountPercentageLabel}%)`,
        value: `- ${this.formatCurrency(discountAmount)}`,
        tone: 'discount'
      })
    }

    totalsRows.push({
      label: paymentDeadlineLabel
        ? 'Payment (Before)'
        : fullEndYear
          ? `Total (Before 31 March ${fullEndYear})`
          : 'TOTAL',
      note: paymentDeadlineLabel ? paymentDeadlineLabel : undefined,
      value: this.formatCurrency(totalBefore)
    })

    totalsRows.push({
      label:
        paymentDeadlineLabel && financialYearEndLabel
          ? 'Total Payment (After)'
          : paymentDeadlineLabel
            ? 'Total Payment'
            : fullEndYear
              ? 'Payment'
              : 'Payment After Due',
      note:
        paymentAfterStartLabel && financialYearEndLabel
          ? `${paymentAfterStartLabel} Till ${financialYearEndLabel}`
          : fullEndYear
            ? `(After 31 March ${fullEndYear})`
            : undefined,
      value: this.formatCurrency(totalAfter),
      tone: 'highlight'
    })

    const totalsInsetX = 16
    const totalsRowMetrics = totalsRows.map((row, index) => {
      const labelFontSize = row.tone === 'highlight' ? 8 : 8
      const valueFontSize = row.tone === 'highlight' ? 9.25 : 9
      const labelLineHeight = row.tone === 'highlight' ? 10 : 10
      const noteFontSize = 7
      const noteLineHeight = 9
      const valueWidth = this.fonts.bold.widthOfTextAtSize(row.value, valueFontSize)
      const availableLabelWidth = Math.max(78, totalsWidth - totalsInsetX * 2 - valueWidth - 14)
      const labelLines = this.wrapTextLines(row.label, availableLabelWidth, this.fonts.bold, labelFontSize)
      const noteLines = row.note
        ? String(row.note)
            .split('\n')
            .flatMap((noteLine) =>
              this.wrapTextLines(noteLine, totalsWidth - totalsInsetX * 2, this.fonts.regular, noteFontSize)
            )
        : []
      const labelBlockHeight = labelLines.length * labelLineHeight
      const noteBlockHeight = noteLines.length > 0 ? 4 + noteLines.length * noteLineHeight : 0
      const minimumHeight = row.tone === 'highlight' ? 54 : index === 2 ? 40 : 28
      const rowHeight = Math.max(minimumHeight, 14 + Math.max(labelBlockHeight, valueFontSize + 2) + noteBlockHeight + 10)

      return {
        ...row,
        labelFontSize,
        valueFontSize,
        labelLineHeight,
        noteFontSize,
        noteLineHeight,
        valueWidth,
        labelLines,
        noteLines,
        rowHeight
      }
    })
    const totalsHeaderHeight = 36
    const totalsHeight = totalsHeaderHeight + totalsRowMetrics.reduce((sum, row) => sum + row.rowHeight, 0)
    const totalsY = this.layout.currentY - totalsHeight

    this.page.drawRectangle({
      x: totalsX,
      y: totalsY,
      width: totalsWidth,
      height: totalsHeight,
      color: rgb(0.985, 0.99, 0.99),
      borderColor: this.COLORS.BORDER,
      borderWidth: 0.65
    })

    this.page.drawRectangle({
      x: totalsX,
      y: totalsY + totalsHeight - totalsHeaderHeight,
      width: totalsWidth,
      height: totalsHeaderHeight,
      color: rgb(0.18, 0.42, 0.31)
    })

    this.page.drawText('PAYMENT OVERVIEW', {
      x: totalsX + totalsInsetX,
      y: totalsY + totalsHeight - 22,
      size: 10,
      font: this.fonts.bold,
      color: rgb(1, 1, 1)
    })

    let totalsCursorY = totalsY + totalsHeight - totalsHeaderHeight
    totalsRowMetrics.forEach((row, index) => {
      const rowHeight = row.rowHeight
      totalsCursorY -= rowHeight

      if (row.tone === 'highlight') {
        this.page.drawRectangle({
          x: totalsX,
          y: totalsCursorY,
          width: totalsWidth,
          height: rowHeight,
          color: rgb(0.985, 0.985, 0.97)
        })
        this.page.drawLine({
          start: { x: totalsX + totalsInsetX, y: totalsCursorY + rowHeight },
          end: { x: totalsX + totalsWidth - totalsInsetX, y: totalsCursorY + rowHeight },
          thickness: 0.6,
          color: this.COLORS.BORDER
        })
      } else if (index > 0) {
        this.page.drawLine({
          start: { x: totalsX + totalsInsetX, y: totalsCursorY + rowHeight },
          end: { x: totalsX + totalsWidth - totalsInsetX, y: totalsCursorY + rowHeight },
          thickness: 0.5,
          color: this.COLORS.BORDER
        })
      }

      const rowColor =
        row.tone === 'highlight'
          ? this.COLORS.TEXT
          : row.tone === 'discount'
            ? this.COLORS.WARNING
            : this.COLORS.TEXT
      const noteColor = this.COLORS.GRAY
      const topLineY = totalsCursorY + rowHeight - (row.tone === 'highlight' ? 18 : 22)

      row.labelLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: totalsX + totalsInsetX,
          y: topLineY - lineIndex * row.labelLineHeight,
          size: row.labelFontSize,
          font: this.fonts.bold,
          color: rowColor
        })
      })

      this.page.drawText(row.value, {
        x: totalsX + totalsWidth - row.valueWidth - totalsInsetX,
        y: topLineY,
        size: row.tone === 'highlight' ? 10.1 : row.valueFontSize,
        font: this.fonts.bold,
        color: row.tone === 'discount' || row.tone === 'highlight' ? this.COLORS.WARNING : rowColor
      })

      row.noteLines.forEach((line, lineIndex) => {
        const noteStartY = topLineY - row.labelLines.length * row.labelLineHeight - 4
        this.page.drawText(line, {
          x: totalsX + totalsInsetX,
          y: noteStartY - lineIndex * row.noteLineHeight,
          size: row.noteFontSize,
          font: this.fonts.regular,
          color: noteColor
        })
      })
    })

    this.layout.currentY = Math.min(tableY, totalsY) - 8
  }
  protected async drawBankDetails(letter: MaintenanceLetter): Promise<void> {
    const effectiveBankDetails = this.resolveLetterBankDetails(letter)

    this.layout.currentY -= 6

    const headerText = effectiveBankDetails.usesSectorConfig
      ? `PAYMENT OPTIONS - SECTOR ${letter.sector_code || ''}`
      : 'PAYMENT OPTIONS'
    this.drawCenteredSectionDivider(headerText, {
      size: 10.2,
      advanceAfter: 10,
      lineThickness: 0.8
    })

    const branchValue = [effectiveBankDetails.branch || '', effectiveBankDetails.branchAddress || '']
      .filter(Boolean)
      .join(', ')

    const bankData: [string, string][] = [
      ['Bank', effectiveBankDetails.bankName || ''],
      ['Branch', branchValue],
      ['Account Name', effectiveBankDetails.accountName || ''],
      ['Account No.', effectiveBankDetails.accountNo || ''],
      ['IFSC Code', effectiveBankDetails.ifscCode || '']
    ].filter(([, value]) => value && value.trim() !== '') as [string, string][]

    if (bankData.length === 0) {
      this.page.drawText('Bank details not configured. Please update project settings.', {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.italic,
        color: this.COLORS.GRAY
      })
      this.layout.currentY -= 20
      return
    }

    const qrCodePath = effectiveBankDetails.qrCodePath
    const footerTextY = 12
    const footerReserveTopY = footerTextY + 26
    const sectionWidth = this.layout.width - (this.MARGIN * 2)
    const sectionGap = qrCodePath ? 14 : 0
    const qrColumnWidth = qrCodePath ? 182 : 0
    const tableWidth = qrCodePath ? sectionWidth - qrColumnWidth - sectionGap : sectionWidth
    const sectionTopY = this.layout.currentY
    const tableX = this.MARGIN

    const cardHeaderHeight = 28
    const labelColumnWidth = tableWidth * 0.26
    const baseRowMetrics = bankData.map(([label, value]) => {
      const labelLines = this.wrapTextLines(label, labelColumnWidth - 20, this.fonts.bold, 7.7)
      const valueLines = this.wrapTextLines(
        value,
        tableWidth - labelColumnWidth - 20,
        this.fonts.regular,
        8.2
      )
      const lineCount = Math.max(labelLines.length, valueLines.length)
      return {
        labelLines,
        valueLines,
        rowHeight: Math.max(29, 12 + lineCount * 10)
      }
    })
    const actualAvailableCardHeight = Math.max(0, sectionTopY - footerReserveTopY - 6)
    const desiredBodyHeight = baseRowMetrics.reduce((sum, row) => sum + row.rowHeight, 0)
    const targetCardHeight = Math.max(0, Math.min(qrCodePath ? 188 : 156, actualAvailableCardHeight))
    const availableBodyHeight = Math.max(0, targetCardHeight - cardHeaderHeight)
    const bodyScale =
      desiredBodyHeight > 0 ? Math.min(1, availableBodyHeight / desiredBodyHeight) : 1
    let rowMetrics = baseRowMetrics.map((row) => ({
      ...row,
      rowHeight: row.rowHeight * bodyScale
    }))
    let scaledBodyHeight = rowMetrics.reduce((sum, row) => sum + row.rowHeight, 0)
    if (scaledBodyHeight > 0 && availableBodyHeight > 0 && scaledBodyHeight !== availableBodyHeight) {
      const normalizeScale = availableBodyHeight / scaledBodyHeight
      rowMetrics = rowMetrics.map((row) => ({
        ...row,
        rowHeight: row.rowHeight * normalizeScale
      }))
      scaledBodyHeight = rowMetrics.reduce((sum, row) => sum + row.rowHeight, 0)
    }
    const tableHeight = cardHeaderHeight + scaledBodyHeight
    const tableY = sectionTopY - tableHeight
    const readableScale = Math.max(bodyScale, 0.88)
    const bankHeaderFontSize = readableScale < 0.94 ? 9.7 : 10.2
    const bankLabelFontSize = Math.max(6.8, 7.7 * readableScale)
    const bankValueFontSize = Math.max(7.2, 8.2 * readableScale)
    const bankLabelLineHeight = Math.max(7.4, bankLabelFontSize + 1.15)
    const bankValueLineHeight = Math.max(7.8, bankValueFontSize + 1.25)

    this.page.drawRectangle({
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: tableHeight,
      color: rgb(1, 1, 1),
      borderColor: this.COLORS.BORDER,
      borderWidth: 0.65
    })

    this.page.drawRectangle({
      x: tableX,
      y: tableY + tableHeight - cardHeaderHeight,
      width: tableWidth,
      height: cardHeaderHeight,
      color: rgb(0.94, 0.95, 0.96)
    })

    this.page.drawText('BANK TRANSFER', {
      x: tableX + 12,
      y: tableY + tableHeight - 18.2,
      size: bankHeaderFontSize,
      font: this.fonts.bold,
      color: this.COLORS.TEXT
    })

    let rowCursorY = tableY + tableHeight - cardHeaderHeight
    rowMetrics.forEach((metric, index) => {
      rowCursorY -= metric.rowHeight

      if (index > 0) {
        this.page.drawLine({
          start: { x: tableX + 1, y: rowCursorY + metric.rowHeight },
          end: { x: tableX + tableWidth - 1, y: rowCursorY + metric.rowHeight },
          thickness: 0.5,
          color: this.COLORS.BORDER
        })
      }

      this.page.drawLine({
        start: { x: tableX + labelColumnWidth, y: rowCursorY },
        end: { x: tableX + labelColumnWidth, y: rowCursorY + metric.rowHeight },
        thickness: 0.5,
        color: this.COLORS.BORDER
      })

      const labelBlockHeight = metric.labelLines.length * bankLabelLineHeight
      const valueBlockHeight = metric.valueLines.length * bankValueLineHeight
      const labelStartY =
        rowCursorY + (metric.rowHeight + labelBlockHeight) / 2 - bankLabelFontSize
      const valueStartY =
        rowCursorY + (metric.rowHeight + valueBlockHeight) / 2 - bankValueFontSize

      metric.labelLines.forEach((line, lineIndex) => {
        this.page.drawText(line.toUpperCase(), {
          x: tableX + 10,
          y: labelStartY - lineIndex * bankLabelLineHeight,
          size: bankLabelFontSize,
          font: this.fonts.bold,
          color: this.COLORS.GRAY
        })
      })

      metric.valueLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: tableX + labelColumnWidth + 10,
          y: valueStartY - lineIndex * bankValueLineHeight,
          size: bankValueFontSize,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
      })
    })

    if (qrCodePath) {
      const qrCardX = tableX + tableWidth + sectionGap
      const qrCardHeight = tableHeight
      const qrCardY = sectionTopY - qrCardHeight
      const qrFrameInset = 0
      const qrFrameAvailableWidth = qrColumnWidth - qrFrameInset * 2
      const qrFrameAvailableHeight = qrCardHeight - qrFrameInset * 2
      const qrFrameSize = Math.max(
        0,
        Math.min(qrFrameAvailableWidth, qrFrameAvailableHeight)
      )
      const qrFrameX = qrCardX + (qrColumnWidth - qrFrameSize) / 2
      const qrFrameY = qrCardY + (qrCardHeight - qrFrameSize) / 2
      const qrFrameWidth = qrFrameSize
      const qrFrameHeight = qrFrameSize

      try {
        const qrImage = await this.embedImageFromPath(qrCodePath)

        if (qrImage) {
          const imageAspectRatio = qrImage.width / qrImage.height
          const frameAspectRatio = qrFrameWidth / qrFrameHeight

          let drawWidth = qrFrameWidth
          let drawHeight = qrFrameHeight

          if (imageAspectRatio > frameAspectRatio) {
            drawHeight = drawWidth / imageAspectRatio
          } else {
            drawWidth = drawHeight * imageAspectRatio
          }

          const drawX = qrFrameX + (qrFrameWidth - drawWidth) / 2
          const drawY = qrFrameY + (qrFrameHeight - drawHeight) / 2

          this.page.drawImage(qrImage, {
            x: drawX,
            y: drawY,
            width: drawWidth,
            height: drawHeight
          })
        }
      } catch (error) {
        // QR code embedding failed - continue without it
      }

      this.layout.currentY = footerReserveTopY
      return
    }

    this.layout.currentY = footerReserveTopY
  }
}

export const maintenanceLetterService = new MaintenanceLetterService()


