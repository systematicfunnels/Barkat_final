import { dbService } from '../db/database'
import { projectService } from './ProjectService'
import { BasePDFGenerator } from './BasePDFGenerator'
import fs from 'fs'
import path from 'path'
import { rgb } from 'pdf-lib'
import { normalizeMoney } from '../utils/money'
import { getUserDataPath } from '../utils/runtimePaths'

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
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return 0

    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word
      const nextWidth = font.widthOfTextAtSize(nextLine, size)

      if (nextWidth <= maxWidth || currentLine === '') {
        currentLine = nextLine
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

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
    const sectorBank =
      sectorCode && String(sectorCode).trim() !== ''
        ? dbService.get<{
            account_name?: string
            bank_name?: string
            account_no?: string
            ifsc_code?: string
            branch?: string
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
      accountName: usesSectorConfig ? sectorBank?.account_name || '' : '',
      bankName: usesSectorConfig ? sectorBank?.bank_name || '' : '',
      accountNo: usesSectorConfig ? sectorBank?.account_no || '' : '',
      ifscCode: usesSectorConfig ? sectorBank?.ifsc_code || '' : '',
      branch: usesSectorConfig ? sectorBank?.branch || '' : '',
      branchAddress: '',
      qrCodePath: usesSectorConfig ? sectorBank?.qr_code_path || '' : '',
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

  private getPenaltyPercentageForFinancialYear(
    projectId: number,
    financialYear: string,
    unitType: string,
    fallbackPenaltyPercentage: number
  ): number {
    const normalizedUnitType = this.normalizeUnitType(unitType)
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

  private normalizeUnitType(unitType: unknown): string {
    const normalized = String(unitType || '')
      .trim()
      .toLowerCase()
    if (!normalized || normalized === 'flat' || normalized === 'bungalow') return 'Bungalow'
    if (normalized === 'plot') return 'Plot'
    if (normalized === 'garden') return 'Garden'
    if (normalized === 'bmf') return 'Bungalow' // BMF = Bungalow Maintenace Fee
    if (normalized === 'all' || normalized === 'all units') return 'All'
    return String(unitType || '').trim() || 'Bungalow'
  }

  private resolveQrCodePath(qrCodePath: string): string | null {
    if (!qrCodePath) return null
    
    // Security: Prevent path traversal attacks by normalizing and checking for parent directory references
    const normalizedPath = path.normalize(qrCodePath)
    if (normalizedPath.includes('..')) {
      return null
    }
    
    const possiblePaths = [
      qrCodePath,
      path.resolve(qrCodePath),
      path.join(process.cwd(), qrCodePath),
      path.join(getUserDataPath(), qrCodePath),
      path.join(getUserDataPath(), 'assets', qrCodePath),
      qrCodePath.startsWith('assets/') 
        ? path.join(getUserDataPath(), qrCodePath)
        : null
    ].filter((p): p is string => Boolean(p))
    
    const foundPath = possiblePaths.find((p) => fs.existsSync(p))
    
    if (foundPath) {
      return foundPath
    }
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath
      }
    }
    
    return null
  }

  public getAll(): MaintenanceLetter[] {
    return dbService.query<MaintenanceLetter>(`
      SELECT l.*, u.unit_number, u.owner_name, u.unit_type, p.name as project_name,
             COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
      FROM maintenance_letters l
      JOIN units u ON l.unit_id = u.id
      JOIN projects p ON l.project_id = p.id
      ORDER BY l.generated_date DESC, l.id DESC
    `)
  }

  public getByProject(projectId: number): MaintenanceLetter[] {
    return dbService.query<MaintenanceLetter>(
      `SELECT l.*, u.unit_number, u.owner_name, u.unit_type, p.name as project_name,
              COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
       FROM maintenance_letters l
       JOIN units u ON l.unit_id = u.id
       JOIN projects p ON l.project_id = p.id
       WHERE l.project_id = ?
       ORDER BY l.generated_date DESC, l.id DESC`,
      [projectId]
    )
  }

  public getById(id: number): MaintenanceLetter | undefined {
    return dbService.get<MaintenanceLetter>(
      `
      SELECT l.*, u.unit_number, u.owner_name, u.contact_number, u.unit_type, u.sector_code,
             p.name as project_name,
             p.account_name, p.bank_name, p.branch, p.branch_address, p.account_no, p.ifsc_code,
             p.qr_code_path as project_qr_code,
             COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total,
             ps.account_name as sector_account_name,
             ps.bank_name as sector_bank_name,
             ps.account_no as sector_account_no,
             ps.ifsc_code as sector_ifsc_code,
             ps.branch as sector_branch,
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

    this.drawLetterheadLetter(letter)
    this.drawRecipientSection(letter)
    this.drawCenteredUnderlinedTitle(letter.financial_year)
    this.drawAmountTable(letter, addOns)
    await this.drawBankDetails(letter)
    this.drawFooter('Authorized Signatory')

    const pdfBytes = await this.pdfDoc.save()
    const pdfDir = path.join(getUserDataPath(), 'maintenance-letters')
    
    try {
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true })
      }
    } catch (error) {
      throw new Error('Unable to create PDF output directory')
    }

    const fileName = `MaintenanceLetter_${letter.id}.pdf`
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

          // 4. Arrears - sum of genuinely unpaid prior-year letters
          const previousLetters = dbService.query<{ final_amount: number; id: number }>(
            `SELECT id, final_amount FROM maintenance_letters
             WHERE unit_id = ? AND financial_year < ? ORDER BY financial_year ASC`,
            [unitId, financialYear]
          )

          let totalArrears = 0
          for (const prev of previousLetters) {
            const paid =
              dbService.get<{ total: number }>(
                `SELECT COALESCE(SUM(payment_amount), 0) as total FROM payments
                 WHERE letter_id = ? AND payment_status != 'Pending'`,
                [prev.id]
              )?.total || 0
            const outstanding = Math.max(0, prev.final_amount - paid)
            if (outstanding > 0) {
              const previousYearPenaltyPct = this.getPenaltyPercentageForFinancialYear(
                projectId,
                financialYear,
                unit.unit_type,
                chargesConfig.penalty_percentage || 0
              )
              const penaltyPct = previousYearPenaltyPct || 0
              totalArrears += normalizeMoney(outstanding + outstanding * (penaltyPct / 100))
            }
          }
          totalArrears = normalizeMoney(totalArrears)

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
              `Missing sector bank details for sector ${unit.sector_code}. Complete ${missingSectorBankFields.join(', ')} in Project Settings before generating maintenance letters.`
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

  protected drawLetterheadLetter(letter: MaintenanceLetter): void {
    const project = dbService.get<{ 
      name: string; 
      address?: string; 
      city?: string; 
      state?: string;
      registration_no?: string;
    }>(
      'SELECT name, address, city, state, registration_no FROM projects WHERE id = ?',
      [letter.project_id]
    )

    const brandDark = rgb(0.05, 0.09, 0.10)
    const brandTeal = rgb(0.08, 0.55, 0.54)
    const brandTealLight = rgb(0.92, 0.97, 0.97)
    const societyName = project?.name || letter.project_name || 'Maintenance Letter'
    const regNo = project?.registration_no || ''
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
    const bannerHeight = 86
    const bannerTopY = this.layout.currentY + 8
    const bannerBottomY = bannerTopY - bannerHeight
    const leftWidth = this.layout.contentWidth * 0.58
    const rightWidth = this.layout.contentWidth - leftWidth
    const leftX = this.MARGIN
    const rightX = this.MARGIN + leftWidth

    this.page.drawRectangle({
      x: this.MARGIN,
      y: bannerTopY,
      width: this.layout.contentWidth,
      height: 4,
      color: brandTeal
    })

    this.page.drawRectangle({
      x: leftX,
      y: bannerBottomY,
      width: leftWidth,
      height: bannerHeight,
      color: brandDark
    })

    this.page.drawRectangle({
      x: rightX,
      y: bannerBottomY,
      width: rightWidth,
      height: bannerHeight,
      color: brandTeal
    })

    this.page.drawText('MAINTENANCE LETTER', {
      x: leftX + 16,
      y: bannerTopY - 18,
      size: 8.5,
      font: this.fonts.bold,
      color: rgb(0.72, 0.89, 0.88)
    })

    const nameLines = this.wrapTextLines(societyName, leftWidth - 32, this.fonts.bold, 22)
    nameLines.slice(0, 2).forEach((line, index) => {
      this.page.drawText(line, {
        x: leftX + 16,
        y: bannerTopY - 38 - index * 22,
        size: 22,
        font: this.fonts.bold,
        color: rgb(1, 1, 1)
      })
    })

    const sublineParts = [
      letter.sector_code?.trim() ? `Sector ${letter.sector_code.trim()}` : null,
      regNo ? `Regd. No. ${regNo}` : null
    ].filter(Boolean) as string[]

    if (sublineParts.length > 0) {
      this.page.drawText(sublineParts.join('  |  '), {
        x: leftX + 16,
        y: bannerBottomY + 12,
        size: 8.5,
        font: this.fonts.regular,
        color: rgb(0.83, 0.89, 0.89)
      })
    }

    const rightInnerX = rightX + 18
    const rightContentWidth = rightWidth - 36
    const metaCardY = bannerBottomY + 10
    const metaCardHeight = 42
    const metaCardColor = rgb(0.16, 0.61, 0.60)

    this.page.drawText('MAINTENANCE', {
      x: rightInnerX,
      y: bannerTopY - 28,
      size: 15.5,
      font: this.fonts.bold,
      color: rgb(1, 1, 1)
    })

    this.page.drawText('Statement', {
      x: rightInnerX,
      y: bannerTopY - 44,
      size: 9,
      font: this.fonts.regular,
      color: rgb(0.86, 0.96, 0.96)
    })

    this.page.drawRectangle({
      x: rightInnerX,
      y: metaCardY,
      width: rightContentWidth,
      height: metaCardHeight,
      color: metaCardColor
    })

    const metaLabelX = rightInnerX + 10
    const metaValueX = rightInnerX + 76
    ;[
      ['Issue Date', issueDate],
      ['Due Date', dueDate],
      ['Statement FY', letter.financial_year]
    ].forEach(([label, value], index) => {
      const rowY = metaCardY + metaCardHeight - 14 - index * 12.5
      this.page.drawText(`${label}:`, {
        x: metaLabelX,
        y: rowY,
        size: 7.4,
        font: this.fonts.bold,
        color: rgb(0.83, 0.95, 0.95)
      })
      this.page.drawText(String(value), {
        x: metaValueX,
        y: rowY,
        size: 8.2,
        font: this.fonts.bold,
        color: rgb(1, 1, 1)
      })
    })

    this.layout.currentY = bannerBottomY - 18

    if (project?.address) {
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

    this.layout.currentY -= 12
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

    this.page.drawText(titleText, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10.5,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 22
  }

  protected drawRecipientSection(letter: MaintenanceLetter): void {
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

    const unitDisplay = unitType === 'BMF' 
      ? `BMF-${plotNumber}` 
      : unitType === 'Bungalow' 
        ? `B-${plotNumber}` 
        : `${unitType.substring(0, 1)}-${plotNumber}`
    const sectionTopY = this.layout.currentY
    const leftWidth = this.layout.contentWidth
    const leftX = this.MARGIN
    const badgeText = `${sector ? `${sector}/` : ''}${unitDisplay}`
    const badgeWidth = this.fonts.bold.widthOfTextAtSize(badgeText, 9) + 20
    const ownerMaxWidth = Math.max(200, leftWidth - badgeWidth - 42)
    const ownerLines = this.wrapTextLines(owners, ownerMaxWidth, this.fonts.bold, 14).slice(0, 2)
    const ownerBlockHeight = Math.max(18, ownerLines.length * 16)
    const metaLines = [
      `Unit Type: ${unitType}`,
      sector ? `Sector: ${sector}` : null,
      `Unit Ref: ${sector ? `${sector}/` : ''}${unitDisplay}`
    ].filter(Boolean) as string[]
    const metaBlockHeight = metaLines.length * 12
    const cardHeight = Math.max(92, 42 + ownerBlockHeight + metaBlockHeight)
    const cardBottomY = sectionTopY - cardHeight

    this.page.drawRectangle({
      x: leftX,
      y: cardBottomY,
      width: leftWidth,
      height: cardHeight,
      color: rgb(1, 1, 1),
      borderColor: this.COLORS.BORDER,
      borderWidth: 1
    })

    this.page.drawRectangle({
      x: leftX,
      y: cardBottomY + cardHeight - 18,
      width: leftWidth,
      height: 18,
      color: rgb(0.93, 0.97, 0.98)
    })

    const ownerTopY = cardBottomY + cardHeight - 42
    ownerLines.forEach((line, index) => {
      this.page.drawText(line, {
        x: leftX + 14,
        y: ownerTopY - index * 16,
        size: 14,
        font: this.fonts.bold,
        color: this.COLORS.TEXT
      })
    })

    metaLines.forEach((line, index) => {
        this.page.drawText(String(line), {
          x: leftX + 14,
          y: ownerTopY - ownerBlockHeight - 4 - index * 12,
          size: 8.5,
          font: this.fonts.regular,
          color: this.COLORS.GRAY
        })
      })

    const badgeX = leftX + leftWidth - badgeWidth - 14
    const badgeY = cardBottomY + cardHeight - 42

    this.page.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeWidth,
      height: 20,
      color: rgb(0.08, 0.55, 0.54)
    })

    this.page.drawText(badgeText, {
      x: badgeX + 10,
      y: badgeY + 6,
      size: 9,
      font: this.fonts.bold,
      color: rgb(1, 1, 1)
    })

    this.layout.currentY = cardBottomY - 20

    this.page.drawText('Dear Resident,', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10.5,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 18

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

    this.layout.currentY -= Math.max(30, introHeight + 8)
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

    this.page.drawText('CHARGE SUMMARY', {
      x: this.MARGIN,
      y: this.layout.currentY + 8,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 10

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

    const tableX = this.MARGIN
    const tableWidth = this.layout.contentWidth * 0.67
    const totalsGap = 16
    const totalsWidth = this.layout.contentWidth - tableWidth - totalsGap
    const totalsX = tableX + tableWidth + totalsGap
    const headerHeight = 28
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

    const rowHeights = breakdownRows.map((row) => {
      const titleLines = this.wrapTextLines(row.title, columnWidths[1] - 16, this.fonts.bold, 8.75)
      const detailLines = this.wrapTextLines(row.details, columnWidths[2] - 16, this.fonts.regular, 8.25)
      const lineCount = Math.max(titleLines.length, detailLines.length, 1)
      return Math.max(26, 12 + lineCount * 10)
    })

    const tableHeight = headerHeight + rowHeights.reduce((sum, height) => sum + height, 0)
    const tableY = this.layout.currentY - tableHeight

    this.page.drawRectangle({
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: tableHeight,
      borderColor: this.COLORS.BORDER,
      borderWidth: 1
    })

    this.page.drawRectangle({
      x: tableX,
      y: tableY + tableHeight - headerHeight,
      width: tableWidth,
      height: headerHeight,
      color: rgb(0.12, 0.32, 0.58)
    })

    ;['No.', 'Item Description', 'Details', 'Amount'].forEach((header, index) => {
      const width = columnWidths[index]
      const textWidth = this.fonts.bold.widthOfTextAtSize(header, 8.5)
      this.page.drawText(header, {
        x: columnPositions[index] + (width - textWidth) / 2,
        y: tableY + tableHeight - 18,
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
    breakdownRows.forEach((row, rowIndex) => {
      const rowHeight = rowHeights[rowIndex]
      currentRowY -= rowHeight

      this.page.drawRectangle({
        x: tableX,
        y: currentRowY,
        width: tableWidth,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? rgb(0.99, 0.995, 0.995) : rgb(1, 1, 1)
      })

      if (rowIndex < breakdownRows.length - 1) {
        this.page.drawLine({
          start: { x: tableX, y: currentRowY },
          end: { x: tableX + tableWidth, y: currentRowY },
          thickness: 0.5,
          color: this.COLORS.BORDER
        })
      }

      const titleLines = this.wrapTextLines(row.title, columnWidths[1] - 16, this.fonts.bold, 8.75)
      const detailLines = this.wrapTextLines(row.details, columnWidths[2] - 16, this.fonts.regular, 8.25)
      const amountWidth = this.fonts.bold.widthOfTextAtSize(row.amount, 8.75)

      const serial = String(rowIndex + 1).padStart(2, '0')
      const serialWidth = this.fonts.regular.widthOfTextAtSize(serial, 8.25)
      this.page.drawText(serial, {
        x: columnPositions[0] + (columnWidths[0] - serialWidth) / 2,
        y: currentRowY + rowHeight - 14,
        size: 8.25,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })

      titleLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: columnPositions[1] + 8,
          y: currentRowY + rowHeight - 13 - lineIndex * 10,
          size: 8.75,
          font: this.fonts.bold,
          color: this.COLORS.TEXT
        })
      })

      detailLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: columnPositions[2] + 8,
          y: currentRowY + rowHeight - 13 - lineIndex * 9,
          size: 8.25,
          font: this.fonts.regular,
          color: this.COLORS.GRAY
        })
      })

      this.page.drawText(row.amount, {
        x: columnPositions[3] + columnWidths[3] - amountWidth - 8,
        y: currentRowY + rowHeight - 14,
        size: 8.75,
        font: this.fonts.bold,
        color: this.COLORS.TEXT
      })
    })

    const totalsRows: Array<{
      label: string
      value: string
      tone?: 'default' | 'discount' | 'highlight'
    }> = [
      {
        label: 'Statement Total',
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
      label: 'Before Due Date',
      value: this.formatCurrency(totalBefore)
    })

    totalsRows.push({
      label: 'After Due Date',
      value: this.formatCurrency(totalAfter),
      tone: 'highlight'
    })

    const totalsRowHeights = totalsRows.map((row) => (row.tone === 'highlight' ? 38 : 30))
    const totalsHeaderHeight = 36
    const totalsHeight = totalsHeaderHeight + totalsRowHeights.reduce((sum, height) => sum + height, 0)
    const totalsY = this.layout.currentY - totalsHeight
    const totalsInsetX = 16

    this.page.drawRectangle({
      x: totalsX,
      y: totalsY,
      width: totalsWidth,
      height: totalsHeight,
      color: rgb(0.985, 0.99, 0.99),
      borderColor: this.COLORS.BORDER,
      borderWidth: 1
    })

    this.page.drawRectangle({
      x: totalsX,
      y: totalsY + totalsHeight - totalsHeaderHeight,
      width: totalsWidth,
      height: totalsHeaderHeight,
      color: rgb(0.08, 0.55, 0.54)
    })

    this.page.drawText('PAYMENT SUMMARY', {
      x: totalsX + totalsInsetX,
      y: totalsY + totalsHeight - 22,
      size: 9,
      font: this.fonts.bold,
      color: rgb(1, 1, 1)
    })

    let totalsCursorY = totalsY + totalsHeight - totalsHeaderHeight
    totalsRows.forEach((row, index) => {
      const rowHeight = totalsRowHeights[index]
      totalsCursorY -= rowHeight

      const labelFontSize = row.tone === 'highlight' ? 9 : 8
      const valueFontSize = row.tone === 'highlight' ? 9.5 : 9

      if (row.tone === 'highlight') {
        this.page.drawRectangle({
          x: totalsX,
          y: totalsCursorY,
          width: totalsWidth,
          height: rowHeight,
          color: rgb(0.08, 0.55, 0.54)
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
          ? rgb(1, 1, 1)
          : row.tone === 'discount'
            ? this.COLORS.SUCCESS
            : this.COLORS.TEXT
      const valueWidth = this.fonts.bold.widthOfTextAtSize(row.value, valueFontSize)
      const textTopPadding = row.tone === 'highlight' ? 23 : 20

      this.page.drawText(row.label, {
        x: totalsX + totalsInsetX,
        y: totalsCursorY + rowHeight - textTopPadding,
        size: labelFontSize,
        font: this.fonts.bold,
        color: rowColor
      })

      this.page.drawText(row.value, {
        x: totalsX + totalsWidth - valueWidth - totalsInsetX,
        y: totalsCursorY + rowHeight - textTopPadding,
        size: valueFontSize,
        font: this.fonts.bold,
        color: rowColor
      })
    })

    this.layout.currentY = Math.min(tableY, totalsY) - 24
  }

  protected drawStyledTable(
    headers: string[], 
    rows: string[][], 
    rowTypes: Array<'normal' | 'yellow' | 'orange'>
  ): void {
    if (headers.length === 0 || rows.length === 0) return
    
    const { contentWidth } = this.layout
    const borderWidth = 1.5
    
    // Rebalanced widths so financial values have enough room without clipping.
    const columnWidths = [
      contentWidth * 0.20, // Particulars
      contentWidth * 0.08, // Plot Area
      contentWidth * 0.09, // Rate per year
      contentWidth * 0.12, // Amount
      contentWidth * 0.115, // Penalty
      contentWidth * 0.11, // Discount
      contentWidth * 0.1425, // Before
      contentWidth * 0.1425 // After
    ]
    
    const calculateRowHeight = (row: string[]): number => {
      const hasLongText = row.some((cell, i) => cell.length > 40 && i === 0)
      return hasLongText ? 36 : 30  // Slightly taller rows for better spacing
    }
    
    const headerHeight = 45
    const totalRowsHeight = rows.reduce((sum, row) => sum + calculateRowHeight(row), 0)
    const totalTableHeight = headerHeight + totalRowsHeight
    
    const tableX = this.MARGIN
    const tableY = this.layout.currentY - totalTableHeight
    const tableWidth = contentWidth

    this.page.drawRectangle({
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: totalTableHeight,
      borderColor: this.COLORS.BORDER,
      borderWidth: borderWidth,
      color: undefined
    })

    this.page.drawRectangle({
      x: tableX + borderWidth,
      y: tableY + totalTableHeight - headerHeight,
      width: tableWidth - (borderWidth * 2),
      height: headerHeight - borderWidth,
      color: rgb(0.92, 0.95, 0.99),
      borderWidth: 0
    })

    let colX = tableX + borderWidth
    const colPositions: number[] = [colX]
    for (let i = 0; i < columnWidths.length; i++) {
      colX += columnWidths[i]
      colPositions.push(colX)
    }

    for (let i = 1; i < colPositions.length - 1; i++) {
      const x = colPositions[i]
      this.page.drawLine({
        start: { x: x, y: tableY + totalTableHeight - borderWidth },
        end: { x: x, y: tableY + borderWidth },
        thickness: 1,
        color: this.COLORS.BORDER
      })
    }

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]
      const x = colPositions[i]
      const colWidth = columnWidths[i]
      const lines = header.split('\n')
      
      lines.forEach((line, lineIndex) => {
        // FIX: Truncate header text if too wide
        let displayLine = line
        const lineWidth = this.fonts.bold.widthOfTextAtSize(line, 9)
        if (lineWidth > colWidth - 8) {
          // Truncate with ellipsis
          let left = 0
          let right = line.length
          let result = ''
          while (left <= right) {
            const mid = Math.floor((left + right) / 2)
            const testStr = line.substring(0, mid) + '...'
            const testWidth = this.fonts.bold.widthOfTextAtSize(testStr, 9)
            if (testWidth <= colWidth - 8) {
              result = testStr
              left = mid + 1
            } else {
              right = mid - 1
            }
          }
          displayLine = result || line.substring(0, 3) + '...'
        }
        
        const displayWidth = this.fonts.bold.widthOfTextAtSize(displayLine, 9)
        const textX = x + (colWidth - displayWidth) / 2
        const textY = tableY + totalTableHeight - headerHeight + 28 - (lineIndex * 12)
        
        this.page.drawText(displayLine, {
          x: textX,
          y: textY,
          size: 9,
          font: this.fonts.bold,
          color: this.COLORS.PRIMARY
        })
      })
    }

    this.page.drawLine({
      start: { x: tableX + borderWidth, y: tableY + totalTableHeight - headerHeight },
      end: { x: tableX + tableWidth - borderWidth, y: tableY + totalTableHeight - headerHeight },
      thickness: 1,
      color: this.COLORS.BORDER
    })

    let currentRowY = tableY + totalTableHeight - headerHeight
    
    // Only truncate long descriptive text. Financial values should stay complete.
    const truncateText = (text: string, maxWidth: number, font: typeof this.fonts.regular, size: number): string => {
      const textWidth = font.widthOfTextAtSize(text, size)
      if (textWidth <= maxWidth) return text
      
      // Binary search for max chars that fit
      let left = 0
      let right = text.length
      let result = ''
      
      while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        const testStr = text.substring(0, mid) + '...'
        const testWidth = font.widthOfTextAtSize(testStr, size)
        
        if (testWidth <= maxWidth) {
          result = testStr
          left = mid + 1
        } else {
          right = mid - 1
        }
      }
      
      return result || text.substring(0, 3) + '...'
    }

    const fitCellText = (
      text: string,
      maxWidth: number,
      font: typeof this.fonts.regular,
      preferredSize: number,
      allowTruncate: boolean
    ): { text: string; size: number; width: number } => {
      for (const size of [preferredSize, 8.5, 8, 7.5, 7]) {
        const width = font.widthOfTextAtSize(text, size)
        if (width <= maxWidth) {
          return { text, size, width }
        }
      }

      if (!allowTruncate) {
        const width = font.widthOfTextAtSize(text, 7)
        return { text, size: 7, width }
      }

      const truncatedText = truncateText(text, maxWidth, font, preferredSize)
      return {
        text: truncatedText,
        size: preferredSize,
        width: font.widthOfTextAtSize(truncatedText, preferredSize)
      }
    }
    
    rows.forEach((row, rowIndex) => {
      const rowHeight = calculateRowHeight(row)
      currentRowY -= rowHeight
      
      const rowType = rowTypes[rowIndex]
      
      if (rowType === 'yellow') {
        this.page.drawRectangle({
          x: tableX + borderWidth,
          y: currentRowY,
          width: tableWidth - (borderWidth * 2),
          height: rowHeight,
          color: rgb(0.95, 0.98, 0.92),
          borderWidth: 0
        })
      } else if (rowType === 'orange') {
        this.page.drawRectangle({
          x: tableX + borderWidth,
          y: currentRowY,
          width: tableWidth - (borderWidth * 2),
          height: rowHeight,
          color: rgb(0.98, 0.94, 0.86),
          borderWidth: 0
        })
      } else if (rowIndex % 2 === 0) {
        this.page.drawRectangle({
          x: tableX + borderWidth,
          y: currentRowY,
          width: tableWidth - (borderWidth * 2),
          height: rowHeight,
          color: rgb(0.985, 0.985, 0.985),
          borderWidth: 0
        })
      }
      
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const originalCell = row[colIndex]
        const x = colPositions[colIndex]
        const colWidth = columnWidths[colIndex]
        
        const isHighlightRow = rowType === 'yellow' || rowType === 'orange'
        const font = isHighlightRow ? this.fonts.bold : this.fonts.regular
        
        const padding = colIndex === 0 ? 8 : 10 // Left=8, Right-aligned needs 10
        const safetyMargin = 2 // Extra safety margin to prevent touching borders
        const availableWidth = colWidth - padding - safetyMargin

        const isDescriptionColumn = colIndex === 0
        const fittedCell = fitCellText(
          originalCell,
          availableWidth,
          font,
          9,
          isDescriptionColumn
        )
        const cellY = currentRowY + (rowHeight / 2) - (fittedCell.size / 3)
        
        let textX
        
        if (isDescriptionColumn) {
          textX = x + 4 // Left padding
        } else {
          textX = x + colWidth - fittedCell.width - 5 // Right padding
        }
        
        this.page.drawText(fittedCell.text, {
          x: textX,
          y: cellY,
          size: fittedCell.size,
          font: font,
          color: this.COLORS.TEXT
        })
      }
      
      if (rowIndex < rows.length - 1) {
        this.page.drawLine({
          start: { x: tableX + borderWidth, y: currentRowY },
          end: { x: tableX + tableWidth - borderWidth, y: currentRowY },
          thickness: 0.5,
          color: this.COLORS.BORDER
        })
      }
    })

    this.layout.currentY = tableY - 20
  }

  protected async drawBankDetails(letter: MaintenanceLetter): Promise<void> {
    const effectiveBankDetails = this.resolveLetterBankDetails(letter)

    this.layout.currentY -= 10

    const headerText = effectiveBankDetails.usesSectorConfig
      ? `PAYMENT DETAILS - SECTOR ${letter.sector_code || ''}`
      : 'BANK DETAILS FOR PAYMENT'
    this.page.drawText(headerText, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 18

    const bankData: [string, string][] = [
      ['Account Name', effectiveBankDetails.accountName || ''],
      ['Account No.', effectiveBankDetails.accountNo || ''],
      ['IFSC Code', effectiveBankDetails.ifscCode || ''],
      ['Bank Name', effectiveBankDetails.bankName || ''],
      ['Branch', effectiveBankDetails.branch || ''],
      ['Branch Address', effectiveBankDetails.branchAddress || '']
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
    const sectionWidth = this.layout.width - (this.MARGIN * 2)
    const sectionGap = qrCodePath ? 16 : 0
    const qrColumnWidth = qrCodePath ? 178 : 0
    const tableWidth = qrCodePath ? sectionWidth - qrColumnWidth - sectionGap : sectionWidth
    const sectionTopY = this.layout.currentY
    const tableX = this.MARGIN

    const cardHeaderHeight = 24
    const labelColumnWidth = tableWidth * 0.26
    const rowMetrics = bankData.map(([label, value]) => {
      const labelLines = this.wrapTextLines(label, labelColumnWidth - 18, this.fonts.bold, 8)
      const valueLines = this.wrapTextLines(value, tableWidth - labelColumnWidth - 18, this.fonts.regular, 8.5)
      const lineCount = Math.max(labelLines.length, valueLines.length)
      return {
        labelLines,
        valueLines,
        rowHeight: Math.max(30, 12 + lineCount * 10)
      }
    })
    const tableHeight = cardHeaderHeight + rowMetrics.reduce((sum, row) => sum + row.rowHeight, 0)
    const tableY = sectionTopY - tableHeight

    this.page.drawRectangle({
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: tableHeight,
      color: rgb(1, 1, 1),
      borderColor: this.COLORS.BORDER,
      borderWidth: 1
    })

    this.page.drawRectangle({
      x: tableX,
      y: tableY + tableHeight - cardHeaderHeight,
      width: tableWidth,
      height: cardHeaderHeight,
      color: rgb(0.93, 0.97, 0.98)
    })

    this.page.drawText('BANK TRANSFER DETAILS', {
      x: tableX + 12,
      y: tableY + tableHeight - 16,
      size: 8,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
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

      metric.labelLines.forEach((line, lineIndex) => {
        this.page.drawText(line.toUpperCase(), {
          x: tableX + 10,
          y: rowCursorY + metric.rowHeight - 12 - lineIndex * 9,
          size: 8,
          font: this.fonts.bold,
          color: this.COLORS.GRAY
        })
      })

      metric.valueLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x: tableX + labelColumnWidth + 10,
          y: rowCursorY + metric.rowHeight - 13 - lineIndex * 10,
          size: 8.5,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
      })
    })

    if (qrCodePath) {
      const qrLabel = effectiveBankDetails.usesSectorConfig
        ? `SCAN TO PAY - SECTOR ${letter.sector_code || ''}`
        : 'SCAN TO PAY'

      const qrCardX = tableX + tableWidth + sectionGap
      const qrCardHeight = Math.max(tableHeight, 220)
      const qrCardY = sectionTopY - qrCardHeight
      const qrHeaderHeight = 28
      const qrFrameInset = 14
      const qrFrameX = qrCardX + qrFrameInset
      const qrFrameY = qrCardY + 46
      const qrFrameWidth = qrColumnWidth - qrFrameInset * 2
      const qrFrameHeight = qrCardHeight - qrHeaderHeight - 72

      this.page.drawRectangle({
        x: qrCardX,
        y: qrCardY,
        width: qrColumnWidth,
        height: qrCardHeight,
        color: rgb(0.97, 0.99, 0.99),
        borderColor: this.COLORS.BORDER,
        borderWidth: 1
      })

      this.page.drawRectangle({
        x: qrCardX,
        y: qrCardY + qrCardHeight - qrHeaderHeight,
        width: qrColumnWidth,
        height: qrHeaderHeight,
        color: rgb(0.08, 0.55, 0.54)
      })

      const qrLabelWidth = this.fonts.bold.widthOfTextAtSize(qrLabel, 8.5)
      this.page.drawText(qrLabel, {
        x: qrCardX + (qrColumnWidth - qrLabelWidth) / 2,
        y: qrCardY + qrCardHeight - 18,
        size: 8.5,
        font: this.fonts.bold,
        color: rgb(1, 1, 1)
      })

      const qrHint1 = 'Use any UPI app to scan'
      const qrHint2 = 'and complete payment instantly'
      this.page.drawText(qrHint1, {
        x: qrCardX + (qrColumnWidth - this.fonts.regular.widthOfTextAtSize(qrHint1, 7.5)) / 2,
        y: qrCardY + 24,
        size: 7.5,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })

      this.page.drawText(qrHint2, {
        x: qrCardX + (qrColumnWidth - this.fonts.regular.widthOfTextAtSize(qrHint2, 7.5)) / 2,
        y: qrCardY + 14,
        size: 7.5,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })

      try {
        const resolvedQrPath = this.resolveQrCodePath(qrCodePath)

        if (resolvedQrPath) {
          const qrImageBytes = fs.readFileSync(resolvedQrPath)

          const isPng =
            qrImageBytes.length > 4 &&
            qrImageBytes[0] === 0x89 &&
            qrImageBytes[1] === 0x50 &&
            qrImageBytes[2] === 0x4e &&
            qrImageBytes[3] === 0x47

          const isJpeg =
            qrImageBytes.length > 3 &&
            qrImageBytes[0] === 0xff &&
            qrImageBytes[1] === 0xd8 &&
            qrImageBytes[2] === 0xff

          let qrImage
          if (isPng) {
            qrImage = await this.pdfDoc.embedPng(qrImageBytes)
          } else if (isJpeg) {
            qrImage = await this.pdfDoc.embedJpg(qrImageBytes)
          } else {
            const ext = path.extname(resolvedQrPath).toLowerCase()
            qrImage =
              ext === '.png'
                ? await this.pdfDoc.embedPng(qrImageBytes)
                : await this.pdfDoc.embedJpg(qrImageBytes)
          }

          if (qrImage) {
            this.page.drawRectangle({
              x: qrFrameX,
              y: qrFrameY,
              width: qrFrameWidth,
              height: qrFrameHeight,
              color: rgb(1, 1, 1),
              borderColor: this.COLORS.BORDER,
              borderWidth: 1
            })

            const imageAspectRatio = qrImage.width / qrImage.height
            const frameAspectRatio = qrFrameWidth / qrFrameHeight

            let drawWidth = qrFrameWidth - 14
            let drawHeight = qrFrameHeight - 14

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
        }
      } catch (error) {
        // QR code embedding failed - continue without it
      }

      this.layout.currentY = Math.min(tableY, qrCardY) - 20
      return
    }

    this.layout.currentY = tableY - 20
  }
}

export const maintenanceLetterService = new MaintenanceLetterService()


