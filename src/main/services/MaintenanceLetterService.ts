import { dbService } from '../db/database'
import { projectService } from './ProjectService'
import { BasePDFGenerator } from './BasePDFGenerator'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { rgb } from 'pdf-lib'
import { normalizeMoney } from '../utils/money'

export interface MaintenanceLetter {
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
      path.join(app.getPath('userData'), qrCodePath),
      path.join(app.getPath('userData'), 'assets', qrCodePath),
      qrCodePath.startsWith('assets/') 
        ? path.join(app.getPath('userData'), qrCodePath)
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
    this.drawFooter('Authorized Signature')

    const pdfBytes = await this.pdfDoc.save()
    const pdfDir = path.join(app.getPath('userData'), 'maintenance-letters')
    
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

          // Get maintenance rate — prefer unit_type-specific rate, fallback to 'All'
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

          // 4. Arrears — sum of genuinely unpaid prior-year letters
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
              arrears, discount_amount, final_amount, due_date,
              snapshot_account_name, snapshot_bank_name, snapshot_account_no, snapshot_ifsc_code,
              snapshot_branch, snapshot_branch_address, snapshot_qr_code_path, snapshot_uses_sector_config,
              status, generated_date, is_paid, is_sent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              projectId,
              unitId,
              financialYear,
              baseAmount,
              totalArrears,
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

    const societyName = project?.name || 'Society'
    
    this.page.drawText(societyName, {
      x: this.MARGIN + 50,
      y: this.layout.currentY,
      size: 28,
      font: this.fonts.bold,
      color: rgb(0.2, 0.5, 0.3)
    })

    this.layout.currentY -= 35
    
    const sectorCode = letter.sector_code ? `Sector "${letter.sector_code}"` : 'Sector "A"'
    this.page.drawText(`${sectorCode} Plot Owners Co-operative Housing Society Ltd.`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.bold,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 15
    
    const regNo = project?.registration_no || ''
    if (regNo) {
      this.page.drawText(`Regd No: ${regNo}`, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })

      this.layout.currentY -= 12
    }
    
    this.page.drawText('(Registered under The Maharashtra Co-operative Societies Act 1960)', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 8,
      font: this.fonts.italic,
      color: this.COLORS.GRAY
    })

    this.layout.currentY -= 15
    
    if (project?.address) {
      const cityState = [project.city, project.state].filter(Boolean).join(', ')
      const fullAddress = cityState ? `${project.address}, ${cityState}` : project.address
      
      this.page.drawText(fullAddress, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })
    }

    this.layout.currentY -= 15
    this.page.drawLine({
      start: { x: this.MARGIN, y: this.layout.currentY },
      end: { x: this.layout.width - this.MARGIN, y: this.layout.currentY },
      thickness: 1,
      color: this.COLORS.BORDER
    })

    this.layout.currentY -= 25
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
    const titleText = `MAINTENANCE LETTER FOR APRIL ${startYear} – MARCH ${endYear}`
    
    const titleWidth = this.fonts.bold.widthOfTextAtSize(titleText, 12)
    const titleX = (this.layout.width - titleWidth) / 2
    
    this.page.drawText(titleText, {
      x: titleX,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.COLORS.TEXT
    })
    
    this.page.drawLine({
      start: { x: titleX, y: this.layout.currentY - 3 },
      end: { x: titleX + titleWidth, y: this.layout.currentY - 3 },
      thickness: 1,
      color: this.COLORS.TEXT
    })
    
    this.layout.currentY -= 25
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
    const sector = unit?.sector_code || 'A'
    const unitType = unit?.unit_type || 'Plot'

    const unitDisplay = unitType === 'BMF' 
      ? `BMF-${plotNumber}` 
      : unitType === 'Bungalow' 
        ? `B-${plotNumber}` 
        : `${unitType.substring(0, 1)}-${plotNumber}`

    const today = new Date()
    const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const dateWidth = this.fonts.regular.widthOfTextAtSize(dateStr, 11)
    this.page.drawText(dateStr, {
      x: this.layout.width - this.MARGIN - dateWidth,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 40
    
    this.page.drawText('To,', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 20
    
    this.page.drawText(owners, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.bold,
      color: this.COLORS.TEXT
    })

    const sectorBoxWidth = 35
    const unitBoxWidth = 55  // Wider box for longer unit identifiers like "BMF-011"
    const boxHeight = 25
    const boxGap = 5
    const boxY = this.layout.currentY - 5
    const startX = this.layout.width - this.MARGIN - (sectorBoxWidth + unitBoxWidth + boxGap)
    
    // Sector box
    this.page.drawRectangle({
      x: startX,
      y: boxY,
      width: sectorBoxWidth,
      height: boxHeight,
      borderColor: this.COLORS.BORDER,
      borderWidth: 1
    })
    const sectorTextWidth = this.fonts.bold.widthOfTextAtSize(sector, 12)
    // Truncate sector if too long
    let displaySector = sector
    if (sectorTextWidth > sectorBoxWidth - 6) {
      displaySector = sector.substring(0, 2)
    }
    const finalSectorWidth = this.fonts.bold.widthOfTextAtSize(displaySector, 12)
    this.page.drawText(displaySector, {
      x: startX + (sectorBoxWidth - finalSectorWidth) / 2,
      y: boxY + 8,
      size: 12,
      font: this.fonts.bold,
      color: this.COLORS.TEXT
    })
    
    // Unit display box
    this.page.drawRectangle({
      x: startX + sectorBoxWidth + boxGap,
      y: boxY,
      width: unitBoxWidth,
      height: boxHeight,
      borderColor: this.COLORS.BORDER,
      borderWidth: 1
    })
    
    // Handle text that might be too wide for the box
    let displayUnitText = unitDisplay
    let unitTextWidth = this.fonts.bold.widthOfTextAtSize(displayUnitText, 12)
    
    // If text is too wide, try smaller font or truncate
    let unitFontSize = 12
    if (unitTextWidth > unitBoxWidth - 8) {
      // Try smaller font first
      unitFontSize = 10
      unitTextWidth = this.fonts.bold.widthOfTextAtSize(displayUnitText, unitFontSize)
      
      // If still too wide, truncate with ellipsis
      if (unitTextWidth > unitBoxWidth - 8) {
        const avgCharWidth = unitFontSize * 0.6
        const maxChars = Math.floor((unitBoxWidth - 8) / avgCharWidth)
        if (displayUnitText.length > maxChars) {
          displayUnitText = displayUnitText.substring(0, maxChars - 2) + '..'
          unitTextWidth = this.fonts.bold.widthOfTextAtSize(displayUnitText, unitFontSize)
        }
      }
    }
    
    this.page.drawText(displayUnitText, {
      x: startX + sectorBoxWidth + boxGap + (unitBoxWidth - unitTextWidth) / 2,
      y: boxY + 8 + (12 - unitFontSize) / 2,  // Adjust Y for smaller font
      size: unitFontSize,
      font: this.fonts.bold,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 45
    
    this.page.drawText('Respected Sir / Madam,', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 50
  }

  private drawAmountTable(letter: MaintenanceLetter, addOns: LetterAddOn[]): void {
    // Get unit details first
    const unit = dbService.get<{ area_sqft: number; unit_type: string }>(
      'SELECT area_sqft, unit_type FROM units WHERE id = ?',
      [letter.unit_id]
    )
    
    // Validate plot area
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

    const derivedDiscountPercentage =
      baseAmount > 0 && discountAmount > 0
        ? Math.round((discountAmount / baseAmount) * 100)
        : 0

    const beforeAmount = normalizeMoney(baseAmount - discountAmount)
    const afterAmount = normalizeMoney(baseAmount)
    const totalBefore = normalizeMoney(letter.final_amount || 0)
    const totalAfter = normalizeMoney(totalBefore + discountAmount)

    const dueDate = letter.due_date ? new Date(letter.due_date) : new Date()
    const day = dueDate.getDate()
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December']
    const monthName = monthNames[dueDate.getMonth()]
    const year = dueDate.getFullYear()
    
    const getDaySuffix = (d: number): string => {
      if (d % 100 >= 11 && d % 100 <= 13) return 'th'
      switch (d % 10) {
        case 1: return 'st'
        case 2: return 'nd'
        case 3: return 'rd'
        default: return 'th'
      }
    }
    const dueDateFormatted = `${day}${getDaySuffix(day)} ${monthName} ${year}`

    const finYear = letter.financial_year || ''
    const yearMatch = finYear.match(/(\d{4})/g)
    const finYearDisplay = yearMatch ? yearMatch.join('-') : finYear

    const headers = [
      'Particulars',
      'Plot Area\nSqft',
      'Rate per year\n/ persqft',
      'Amount',
      'Penalty',
      `Discount\n${derivedDiscountPercentage}%`,
      `Before ${finYearDisplay}`,
      `After ${finYearDisplay}`
    ]

    const rows: string[][] = []
    const rowTypes: Array<'normal' | 'yellow' | 'orange'> = []

    rows.push([
      `Current ${letter.financial_year}`,
      plotArea.toLocaleString('en-IN'),
      `Rs. ${roundedRatePerSqft.toLocaleString('en-IN', {
        minimumFractionDigits: roundedRatePerSqft % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2
      })}`,
      this.formatCurrency(baseAmount),
      '-',
      this.formatCurrency(discountAmount),
      this.formatCurrency(beforeAmount),
      this.formatCurrency(afterAmount)
    ])
    rowTypes.push('normal')

    for (const addon of normalizedAddOns) {
      if (addon.addon_amount > 0) {
        rows.push([
          addon.addon_name,
          '',
          '',
          this.formatCurrency(addon.addon_amount),
          '',
          '',
          this.formatCurrency(addon.addon_amount),
          this.formatCurrency(addon.addon_amount)
        ])
        rowTypes.push('normal')
      }
    }

    if (arrearsAmount > 0) {
      rows.push([
        'Arrears (Previous Outstanding)',
        '',
        '',
        this.formatCurrency(arrearsAmount),
        '',
        '',
        this.formatCurrency(arrearsAmount),
        this.formatCurrency(arrearsAmount)
      ])
      rowTypes.push('normal')
    }
    
    rows.push([
      `Amount Payable before ${dueDateFormatted}`,
      '',
      '',
      '',
      '',
      '',
      this.formatCurrency(totalBefore),
      ''
    ])
    rowTypes.push('yellow')

    rows.push([
      `Amount payable after ${dueDateFormatted}`,
      '',
      '',
      '',
      '',
      '',
      '',
      this.formatCurrency(totalAfter)
    ])
    rowTypes.push('orange')

    this.drawStyledTable(headers, rows, rowTypes)
  }

  private drawStyledTable(
    headers: string[], 
    rows: string[][], 
    rowTypes: Array<'normal' | 'yellow' | 'orange'>
  ): void {
    if (headers.length === 0 || rows.length === 0) return
    
    const { contentWidth } = this.layout
    const borderWidth = 1.5
    
    // Adjusted column widths - better distribution for currency values
    const columnWidths = [
      contentWidth * 0.23, // Particulars (descriptions)
      contentWidth * 0.09, // Plot Area
      contentWidth * 0.10, // Rate per year
      contentWidth * 0.115, // Amount
      contentWidth * 0.115, // Penalty
      contentWidth * 0.11, // Discount
      contentWidth * 0.12, // Before (totals need more space)
      contentWidth * 0.12  // After (totals need more space)
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
      color: rgb(0.95, 0.95, 0.95),
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
          color: this.COLORS.TEXT
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
    
    // Helper function to truncate text to fit column width
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
          color: rgb(1, 1, 0.6),
          borderWidth: 0
        })
      } else if (rowType === 'orange') {
        this.page.drawRectangle({
          x: tableX + borderWidth,
          y: currentRowY,
          width: tableWidth - (borderWidth * 2),
          height: rowHeight,
          color: rgb(1, 0.85, 0.7),
          borderWidth: 0
        })
      }
      
      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        let cell = row[colIndex]
        const x = colPositions[colIndex]
        const colWidth = columnWidths[colIndex]
        // Proper vertical centering: currentRowY is at bottom of row, add half row height + font offset
        const fontSize = 9
        const cellY = currentRowY + (rowHeight / 2) - (fontSize / 3)
        
        const isHighlightRow = rowType === 'yellow' || rowType === 'orange'
        const font = isHighlightRow ? this.fonts.bold : this.fonts.regular
        
        // FIX: Truncate text if too wide for column - with safety margin
        const padding = colIndex === 0 ? 8 : 10 // Left=8, Right-aligned needs 10
        const safetyMargin = 2 // Extra safety margin to prevent touching borders
        const availableWidth = colWidth - padding - safetyMargin
        
        let textWidth = font.widthOfTextAtSize(cell, 9)
        
        // Truncate text if too wide for column
        if (textWidth > availableWidth && availableWidth > 10) {
          cell = truncateText(cell, availableWidth, font, 9)
          textWidth = font.widthOfTextAtSize(cell, 9)
        }
        
        let textX
        
        if (colIndex === 0) {
          textX = x + 4 // Left padding
        } else {
          textX = x + colWidth - textWidth - 5 // Right padding
        }
        
        this.page.drawText(cell, {
          x: textX,
          y: cellY,
          size: 9,
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

    this.layout.currentY -= 15

    const headerText = 'PLEASE NOTE NEW BANK DETAILS'
    const headerWidth = this.fonts.bold.widthOfTextAtSize(headerText, 11)
    const headerX = (this.layout.width - headerWidth) / 2
    
    this.page.drawText(headerText, {
      x: headerX,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.bold,
      color: rgb(0.9, 0, 0)
    })

    this.layout.currentY -= 25

    const bankData: [string, string][] = [
      ['Name', effectiveBankDetails.accountName || ''],
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

    const tableWidth = this.layout.width - (this.MARGIN * 2)
    const labelWidth = tableWidth * 0.25
    const rowHeight = 22
    const tableHeight = bankData.length * rowHeight
    const tableX = this.MARGIN
    const tableY = this.layout.currentY - tableHeight

    this.page.drawRectangle({
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: tableHeight,
      borderColor: this.COLORS.BORDER,
      borderWidth: 1
    })

    bankData.forEach(([label, value], index) => {
      const rowY = tableY + tableHeight - ((index + 1) * rowHeight)
      
      if (index > 0) {
        this.page.drawLine({
          start: { x: tableX, y: rowY + rowHeight },
          end: { x: tableX + tableWidth, y: rowY + rowHeight },
          thickness: 0.5,
          color: this.COLORS.BORDER
        })
      }
      
      this.page.drawLine({
        start: { x: tableX + labelWidth, y: rowY },
        end: { x: tableX + labelWidth, y: rowY + rowHeight },
        thickness: 0.5,
        color: this.COLORS.BORDER
      })
      
      // FIX: Truncate label and value if too long
      const maxLabelWidth = labelWidth - 16
      const maxValueWidth = tableWidth - labelWidth - 16
      
      let displayLabel = label
      let labelW = this.fonts.bold.widthOfTextAtSize(label, 9)
      if (labelW > maxLabelWidth) {
        let left = 0, right = label.length, result = ''
        while (left <= right) {
          const mid = Math.floor((left + right) / 2)
          const testStr = label.substring(0, mid) + '...'
          const testW = this.fonts.bold.widthOfTextAtSize(testStr, 9)
          if (testW <= maxLabelWidth) { result = testStr; left = mid + 1 }
          else { right = mid - 1 }
        }
        displayLabel = result || label.substring(0, 3) + '...'
      }
      
      let displayValue = value
      let valueW = this.fonts.regular.widthOfTextAtSize(value, 9)
      if (valueW > maxValueWidth) {
        let left = 0, right = value.length, result = ''
        while (left <= right) {
          const mid = Math.floor((left + right) / 2)
          const testStr = value.substring(0, mid) + '...'
          const testW = this.fonts.regular.widthOfTextAtSize(testStr, 9)
          if (testW <= maxValueWidth) { result = testStr; left = mid + 1 }
          else { right = mid - 1 }
        }
        displayValue = result || value.substring(0, 3) + '...'
      }
      
      this.page.drawText(displayLabel, {
        x: tableX + 8,
        y: rowY + 7,
        size: 9,
        font: this.fonts.bold,
        color: this.COLORS.TEXT
      })
      
      this.page.drawText(displayValue, {
        x: tableX + labelWidth + 8,
        y: rowY + 7,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    this.layout.currentY = tableY - 20

    const qrCodePath = effectiveBankDetails.qrCodePath

    if (qrCodePath) {
      const qrLabel = effectiveBankDetails.usesSectorConfig
        ? `Scan QR — Sector ${letter.sector_code || ''}`
        : 'Scan QR to Pay'

      const qrSize = 90
      const qrX = this.layout.width - this.MARGIN - qrSize - 15
      const qrY = this.layout.currentY + 40

      this.page.drawText(qrLabel, {
        x: qrX,
        y: qrY + qrSize + 8,
        size: 9,
        font: this.fonts.bold,
        color: this.COLORS.PRIMARY
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
            this.page.drawImage(qrImage, {
              x: qrX,
              y: qrY,
              width: qrSize,
              height: qrSize
            })
          }
        }
      } catch (error) {
        // QR code embedding failed - continue without it
      }
    }
  }
}

export const maintenanceLetterService = new MaintenanceLetterService()
