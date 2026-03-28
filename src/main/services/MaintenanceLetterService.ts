import { dbService } from '../db/database'
import { projectService } from './ProjectService'
import { addonTemplateService } from './AddonTemplateService'
import { BasePDFGenerator } from './BasePDFGenerator'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

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
  // Project-level bank details
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  branch_address?: string
  qr_code_path?: string
  project_qr_code?: string
  // Sector-level bank details (override project defaults when present)
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

class MaintenanceLetterService extends BasePDFGenerator {

  /**
   * Get project-specific contact information
   */
  private getProjectContactInfo(projectId: number): { email: string; phone: string } {
    const project = dbService.get<{
      contact_email?: string
      contact_phone?: string
    }>(
      'SELECT contact_email, contact_phone FROM projects WHERE id = ?',
      [projectId]
    )
    return {
      email: project?.contact_email || '',
      phone: project?.contact_phone || ''
    }
  }

  /**
   * Resolve QR code path with multiple fallback locations
   */
  private resolveQrCodePath(qrCodePath: string): string | null {
    if (!qrCodePath) return null
    
    // Try multiple possible locations
    const possiblePaths = [
      // Original path (absolute)
      qrCodePath,
      // Resolved path (relative to current working directory)
      path.resolve(qrCodePath),
      // Relative to app directory
      path.join(process.cwd(), qrCodePath),
      // Relative to user data directory
      path.join(app.getPath('userData'), qrCodePath),
      // Relative to user data directory assets folder
      path.join(app.getPath('userData'), 'assets', qrCodePath),
      // If path is already relative to user data directory
      qrCodePath.startsWith('assets/') 
        ? path.join(app.getPath('userData'), qrCodePath)
        : null
    ].filter((path): path is string => Boolean(path))
    
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
             pspc.qr_code_path as sector_qr_code,
             pspc.account_name as sector_account_name,
             pspc.bank_name as sector_bank_name,
             pspc.account_no as sector_account_no,
             pspc.ifsc_code as sector_ifsc_code,
             pspc.branch as sector_branch,
             p.template_type,
             COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
      FROM maintenance_letters l
      JOIN units u ON l.unit_id = u.id
      JOIN projects p ON l.project_id = p.id
      LEFT JOIN project_sector_payment_configs pspc
        ON p.id = pspc.project_id AND UPPER(TRIM(u.sector_code)) = UPPER(TRIM(pspc.sector_code))
      WHERE l.id = ?
    `,
      [id]
    )
  }

  public createBatch(
    projectId: number,
    financialYear: string,
    letterDate: string,
    dueDate: string,
    unitIds: number[],
    addOns: Array<{ addon_name: string; addon_amount: number; remarks?: string }>
  ): boolean {
    return dbService.transaction(() => {
      try {
        const createdLetters: number[] = []
        const chargesConfig = projectService.getChargesConfig(projectId)
        const skippedUnits: number[] = []

        for (const unitId of unitIds) {
          // Check if letter already exists for this unit and financial year
          const existingLetter = dbService.get<{ id: number }>(
            'SELECT id FROM maintenance_letters WHERE unit_id = ? AND financial_year = ?',
            [unitId, financialYear]
          )

          if (existingLetter) {
            skippedUnits.push(unitId)
            console.warn(`Skipping unit ${unitId}: Maintenance letter already exists for financial year ${financialYear}`)
            continue
          }

          // Get unit details for calculation
          const unit = dbService.get<{ area_sqft: number; unit_type: string }>(
            'SELECT area_sqft, unit_type FROM units WHERE id = ?',
            [unitId]
          )

          if (!unit) {
            throw new Error(`Unit not found: ${unitId}`)
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
          const baseAmount = unit.area_sqft * rate.rate_per_sqft

          // 2. GST on base maintenance (from rate config — e.g. 18% for Banjara Hills from 2021-22)
          const gstPercent = rate.gst_percent || 0
          const gstAmount = gstPercent > 0 ? Math.round(baseAmount * gstPercent) / 100 : 0

          // 3. Additional Project Charges — only if configured and > 0
          const naTax = unit.area_sqft * (chargesConfig.na_tax_rate_per_sqft || 0)
          const solar = chargesConfig.solar_contribution || 0
          const cable = chargesConfig.cable_charges || 0

          // 3. Manual Add-ons from the UI
          const addOnsTotal = addOns?.reduce((sum, addon) => sum + addon.addon_amount, 0) || 0

          // 4. Arrears — sum of genuinely unpaid prior-year letters (payments minus letter final)
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
            if (outstanding > 0.01) {
              // Penalty only if configured > 0
              const penaltyPct = chargesConfig.penalty_percentage || 0
              totalArrears += outstanding + outstanding * (penaltyPct / 100)
            }
          }

          // 5. Determine early-payment discount from slabs (if any)
          // Use the slab whose due_date matches or is nearest to the billing due date
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
            // Store as letter.discount_amount — the best early-payment discount
            const bestSlab = earlySlabs[0]
            discountAmount = baseAmount * (bestSlab.discount_percentage / 100)
          }

          // Final amount = sum of all charges — discount is stored separately, not subtracted yet
          const finalAmount = baseAmount + gstAmount + naTax + solar + cable + addOnsTotal + totalArrears

          const result = dbService.run(
            `INSERT INTO maintenance_letters (
              project_id, unit_id, financial_year, base_amount,
              arrears, discount_amount, final_amount, due_date, status, generated_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              projectId,
              unitId,
              financialYear,
              baseAmount,
              totalArrears,
              discountAmount,
              finalAmount,
              dueDate,
              'Generated',
              letterDate
            ]
          )

          const letterId = result.lastInsertRowid as number
          createdLetters.push(letterId)

          // Store GST as add-on row if applicable
          if (gstAmount > 0) {
            dbService.run(
              `INSERT INTO add_ons (letter_id, addon_name, addon_amount) VALUES (?, ?, ?)`,
              [letterId, `GST (${gstPercent}%)`, Math.round(gstAmount * 100) / 100]
            )
          }

          // Store naTax, solar, cable as individual add_on rows so PDF shows real line items
          if (naTax > 0) {
            dbService.run(
              `INSERT INTO add_ons (letter_id, addon_name, addon_amount) VALUES (?, ?, ?)`,
              [letterId, 'N.A. Tax', Math.round(naTax * 100) / 100]
            )
          }
          if (solar > 0) {
            dbService.run(
              `INSERT INTO add_ons (letter_id, addon_name, addon_amount) VALUES (?, ?, ?)`,
              [letterId, 'Solar Contribution', solar]
            )
          }
          if (cable > 0) {
            dbService.run(
              `INSERT INTO add_ons (letter_id, addon_name, addon_amount) VALUES (?, ?, ?)`,
              [letterId, 'Cable Charges', cable]
            )
          }

          // Manual add-ons from the billing form
          if (addOns && addOns.length > 0) {
            for (const addon of addOns) {
              dbService.run(
                `INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks) VALUES (?, ?, ?, ?)`,
                [letterId, addon.addon_name, addon.addon_amount, addon.remarks || null]
              )
            }
          }

          // Add addon templates as add-ons for transparency
          const addonTemplates = addonTemplateService.getEnabledTemplates(projectId)

          for (const template of addonTemplates) {
            let amount = template.amount

            // If it's a rate_per_sqft type, calculate based on unit area
            if (template.addon_type === 'rate_per_sqft') {
              const unitRow = dbService.get<{ area_sqft: number }>(
                'SELECT area_sqft FROM units WHERE id = ?',
                [unitId]
              )
              amount = template.amount * (unitRow?.area_sqft || 0)
            }
            
            if (amount > 0) {
              dbService.run(
                `
                INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks)
                VALUES (?, ?, ?, ?)
              `,
                [letterId, template.addon_name, amount, 'Pre-configured add-on']
              )
            }
          }

          // Standard charges (N.A. Tax, Solar, Cable) are stored as add_on rows above
          // so each line item appears transparently in the PDF
        }

        // Log summary
        if (skippedUnits.length > 0) {
          console.log(`Created ${createdLetters.length} letters, skipped ${skippedUnits.length} units (already exist)`)
        } else {
          console.log(`Successfully created ${createdLetters.length} maintenance letters`)
        }

        return createdLetters.length > 0
      } catch (error) {
        console.error('Error creating maintenance letters:', error)
        throw error
      }
    })
  }

  public update(id: number, updates: Partial<MaintenanceLetter>): boolean {
    console.log('[UPDATE LETTER] Called with:', { id, updates })
    
    const allowedColumns = [
      'due_date',
      'status',
      'generated_date',
      'pdf_path'
    ]
    
    const keys = Object.keys(updates).filter(
      (key) => allowedColumns.includes(key) && key !== 'id'
    )

    console.log('[UPDATE LETTER] Filtered keys:', keys)

    if (keys.length === 0) {
      console.log('[UPDATE LETTER] No valid keys to update')
      return false
    }

    const fields = keys.map((key) => `${key} = ?`).join(', ')
    // Fix: Properly extract values from updates object
    const values = keys.map((key) => {
      const value = (updates as any)[key]
      console.log(`[UPDATE LETTER] Key ${key}:`, value)
      return value
    })

    console.log('[UPDATE LETTER] SQL:', `UPDATE maintenance_letters SET ${fields} WHERE id = ?`)
    console.log('[UPDATE LETTER] Values:', [...values, id])

    const result = dbService.run(`UPDATE maintenance_letters SET ${fields} WHERE id = ?`, [
      ...values,
      id
    ])
    
    console.log('[UPDATE LETTER] Result:', { changes: result.changes, success: result.changes > 0 })
    return result.changes > 0
  }

  public delete(id: number): boolean {
    return dbService.transaction(() => {
      try {
        const result = dbService.run('DELETE FROM maintenance_letters WHERE id = ?', [id])
        return result.changes > 0
      } catch (error) {
        console.error(`Error deleting maintenance letter ${id}:`, error)
        throw error
      }
    })
  }

  public bulkDelete(ids: number[]): boolean {
    return dbService.transaction(() => {
      let allDeleted = true
      for (const id of ids) {
        if (!this.delete(id)) {
          allDeleted = false
        }
      }
      return allDeleted
    })
  }

  public async generatePdf(id: number): Promise<string> {
    const letter = this.getById(id)
    if (!letter) throw new Error('Maintenance letter not found')

    // Get add-ons for this letter
    const addOns = this.getAddOns(id)

    await this.initializePDF()

    // Letterhead
    this.drawLetterhead(letter)

    // Letter details
    this.layout.currentY -= 20
    this.page.drawText(`Financial Year: ${letter.financial_year}`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })
    this.page.drawText(`Due Date: ${this.formatDate(letter.due_date || '')}`, {
      x: this.layout.width - this.MARGIN - 120,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    // Recipient section
    this.layout.currentY -= 40
    this.drawRecipientSection(letter)

    // Subject line
    this.layout.currentY -= 30
    this.drawSectionHeader('Maintenance Demand Notice')

    // Amount details table
    this.layout.currentY -= 20
    this.drawAmountTable(letter, addOns)

    // Payment details
    this.layout.currentY -= 40
    this.drawPaymentDetails(letter)

    // Bank details
    this.layout.currentY -= 40
    await this.drawBankDetails(letter)

    // Footer
    this.drawFooter('Authorized Signature')

    const pdfBytes = await this.pdfDoc.save()
    const pdfDir = path.join(app.getPath('userData'), 'maintenance-letters')
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir)

    const fileName = `MaintenanceLetter_${letter.id}.pdf`
    const filePath = path.join(pdfDir, fileName)
    fs.writeFileSync(filePath, pdfBytes)

    // Update PDF path in database
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
      // Find the letter for this unit and financial year
      const letter = dbService.get<{ id: number; final_amount: number }>(
        'SELECT id, final_amount FROM maintenance_letters WHERE unit_id = ? AND financial_year = ?',
        [params.unit_id, params.financial_year]
      )

      if (!letter) {
        throw new Error('Maintenance letter not found for the specified unit and financial year')
      }

      // Add the add-on
      dbService.run(
        `
        INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks)
        VALUES (?, ?, ?, ?)
      `,
        [letter.id, params.addon_name, params.addon_amount, params.remarks]
      )

      // Update the final amount
      const newFinalAmount = letter.final_amount + params.addon_amount
      dbService.run('UPDATE maintenance_letters SET final_amount = ? WHERE id = ?', [
        newFinalAmount,
        letter.id
      ])

      return true
    })
  }

  public deleteAddOn(id: number): boolean {
    return dbService.transaction(() => {
      // Get the add-on details before deletion
      const addon = dbService.get<{ letter_id: number; addon_amount: number }>(
        'SELECT letter_id, addon_amount FROM add_ons WHERE id = ?',
        [id]
      )

      if (!addon) {
        throw new Error('Add-on not found')
      }

      // Delete the add-on
      const result = dbService.run('DELETE FROM add_ons WHERE id = ?', [id])

      if (result.changes > 0) {
        // Update the letter's final amount
        dbService.run(
          `
          UPDATE maintenance_letters 
          SET final_amount = final_amount - ? 
          WHERE id = ?
        `,
          [addon.addon_amount, addon.letter_id]
        )
      }

      return result.changes > 0
    })
  }

  /**
   * Wrap text to fit within specified line length
   */
  private wrapText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text]
    }

    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      if ((currentLine + ' ' + word).length <= maxLength) {
        currentLine = currentLine ? currentLine + ' ' + word : word
      } else {
        if (currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          // Word is longer than max length, split it
          for (let i = 0; i < word.length; i += maxLength) {
            lines.push(word.substring(i, i + maxLength))
          }
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines
  }

  private drawLetterhead(letter: MaintenanceLetter): void {
    // Get project details for dynamic heading
    const project = dbService.get<{ 
      name: string; 
      address?: string; 
      city?: string; 
      state?: string;
    }>(
      'SELECT name, address, city, state FROM projects WHERE id = ?',
      [letter.project_id]
    )

    // Society name with period and sectors (like your sample)
    const societyName = project?.name || 'Society'
    const financialYear = letter.financial_year
    const [startYear, endYear] = financialYear.split('-')
    const period = `${this.getMonthName(startYear)} ${startYear} – ${this.getMonthName(endYear)} ${endYear}`
    
    this.page.drawText(societyName.toUpperCase(), {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 18,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20
    
    // Period information (like your sample)
    this.page.drawText(`This is a Maintenance Letter for the period of ${period}`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 20
    
    // Site address
    if (project?.address) {
      const cityState = [project.city, project.state].filter(Boolean).join(', ')
      const fullAddress = cityState ? `${project.address}, ${cityState}` : project.address
      
      // Split long address into multiple lines
      const maxLineLength = 60
      const addressLines = this.wrapText(fullAddress, maxLineLength)
      
      addressLines.forEach((line) => {
        this.page.drawText(line, {
          x: this.MARGIN,
          y: this.layout.currentY,
          size: 10,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
        this.layout.currentY -= 12
      })
    } else {
      // no address — skip fallback subtitle, just move down
      this.layout.currentY -= 12
    }

    this.layout.currentY -= 10
    const contactInfo = this.getProjectContactInfo(letter.project_id)
    const contactParts = [
      contactInfo.email ? `Email: ${contactInfo.email}` : null,
      contactInfo.phone ? `Phone: ${contactInfo.phone}` : null
    ].filter(Boolean)
    if (contactParts.length > 0) {
      this.page.drawText(contactParts.join(' | '), {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })
    }

    this.drawDivider()
  }

  /**
   * Get month name from financial year month
   */
  private getMonthName(month: string): string {
    const months: { [key: string]: string } = {
      '01': 'January', '02': 'February', '03': 'March', '04': 'April',
      '05': 'May', '06': 'June', '07': 'July', '08': 'August',
      '09': 'September', '10': 'October', '11': 'November', '12': 'December'
    }
    return months[month] || 'April'
  }

  private drawRecipientSection(letter: MaintenanceLetter): void {
    // Get unit details with more information
    const unit = dbService.get<{
      unit_number: string;
      owner_name: string;
      contact_number?: string;
      email?: string;
      area_sqft?: number;
      sector_code?: string;
    }>(
      'SELECT unit_number, owner_name, contact_number, email, area_sqft, sector_code FROM units WHERE id = ?',
      [letter.unit_id]
    )

    // Format like your sample: "The letter is addressed to [Owners] for plot [Unit]"
    const owners = letter.owner_name || unit?.owner_name || 'N/A'
    const plotNumber = letter.unit_number || unit?.unit_number || 'N/A'
    const sector = unit?.sector_code ? `Sector "${unit.sector_code}"` : ''
    
    this.page.drawText(`The letter is addressed to ${owners} for plot ${plotNumber}${sector ? ` from ${sector}` : ''}.`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 25
    
    // Add plot area information
    const plotArea = unit?.area_sqft || 0
    this.page.drawText(`Payment Breakdown`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20
    this.page.drawText(`The maintenance fees are calculated based on a plot area of ${plotArea.toLocaleString()} Sqft.`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 35
  }

  private drawAmountTable(letter: MaintenanceLetter, addOns: LetterAddOn[]): void {
    // Get maintenance rate — respect unit_type, also fetch gst_percent
    const rate =
      dbService.get<{ rate_per_sqft: number; gst_percent: number }>(
        `SELECT rate_per_sqft, COALESCE(gst_percent, 0) as gst_percent
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ? AND unit_type = (
           SELECT unit_type FROM units WHERE id = ?
         )`,
        [letter.project_id, letter.financial_year, letter.unit_id]
      ) ||
      dbService.get<{ rate_per_sqft: number; gst_percent: number }>(
        `SELECT rate_per_sqft, COALESCE(gst_percent, 0) as gst_percent
         FROM maintenance_rates
         WHERE project_id = ? AND financial_year = ?
           AND (unit_type = 'All' OR unit_type IS NULL)`,
        [letter.project_id, letter.financial_year]
      )

    const ratePerSqft = rate?.rate_per_sqft || 0

    // Use stored discount_amount (calculated from slabs at letter creation time)
    const discountAmount = letter.discount_amount || 0

    // Column headers: use real due_date, not hardcoded date
    const dueDateFormatted = letter.due_date ? this.formatDate(letter.due_date) : 'Due Date'
    const headers = [
      'Particulars',
      'Amount',
      `Before ${dueDateFormatted} (Early Payment)`,
      `After ${dueDateFormatted}`
    ]
    const rows: string[][] = []

    // Base maintenance
    const maintenanceAmount = letter.base_amount
    const maintenanceEarly =
      discountAmount > 0 ? maintenanceAmount - discountAmount : maintenanceAmount

    rows.push([
      `Current Maintenance (@ Rs.${ratePerSqft.toFixed(2)}/sqft)`,
      this.formatCurrency(maintenanceAmount),
      this.formatCurrency(maintenanceEarly),
      this.formatCurrency(maintenanceAmount)
    ])

    // All add-ons (stored as individual rows — naTax, solar, cable, manual, templates)
    // Filter out zero-amount add-ons (e.g., Cable Charges when not applicable)
    for (const addon of addOns) {
      if (addon.addon_amount > 0) {
        rows.push([
          addon.addon_name,
          this.formatCurrency(addon.addon_amount),
          this.formatCurrency(addon.addon_amount),
          this.formatCurrency(addon.addon_amount)
        ])
      }
    }

    // Arrears (from prior unpaid years)
    if (letter.arrears && letter.arrears > 0) {
      rows.push([
        'Arrears (Previous Outstanding)',
        this.formatCurrency(letter.arrears),
        this.formatCurrency(letter.arrears),
        this.formatCurrency(letter.arrears)
      ])
    }

    // Totals
    const addOnsTotal = addOns.reduce((s, a) => s + a.addon_amount, 0)
    const arrearsAmount = letter.arrears || 0
    const totalFull = maintenanceAmount + addOnsTotal + arrearsAmount
    const totalEarly = maintenanceEarly + addOnsTotal + arrearsAmount

    // Early-payment discount row
    if (discountAmount > 0) {
      rows.push([
        `Early Payment Discount`,
        '',
        `-${this.formatCurrency(discountAmount)}`,
        '-'
      ])
    }

    rows.push([
      'Total Amount Payable',
      '',
      this.formatCurrency(totalEarly),
      this.formatCurrency(totalFull)
    ])

    this.drawTable(headers, rows)
  }

  private drawPaymentDetails(letter: MaintenanceLetter): void {
    // Get project charges configuration for discount/penalty calculations
    const chargesConfig = projectService.getChargesConfig(letter.project_id)
    
    this.page.drawText('Payment Details:', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20

    // Get payment modes from project settings (dynamic)
    const paymentModes = this.getPaymentModes(letter.project_id)
    const paymentInfo = [
      `Due Date: ${this.formatDate(letter.due_date || '')}`,
      `Payment Mode: ${paymentModes}`,
      `Late Payment Charges: ${chargesConfig.penalty_percentage || 0}% per annum`
    ]

    paymentInfo.forEach((info, index) => {
      this.page.drawText(info, {
        x: this.MARGIN,
        y: this.layout.currentY - index * 15,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    this.layout.currentY -= (paymentInfo.length * 15) + 25
  }

  /**
   * Get payment modes from project settings (dynamic from database)
   */
  private getPaymentModes(projectId: number): string {
    // Try to get payment modes from project settings
    const projectSettings = dbService.get<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [`project_${projectId}_payment_modes`]
    )

    if (projectSettings && projectSettings.value) {
      return projectSettings.value
    }

    // Try to get from project table if available
    const project = dbService.get<{ payment_modes?: string }>(
      'SELECT payment_modes FROM projects WHERE id = ?',
      [projectId]
    )

    if (project?.payment_modes) {
      return project.payment_modes
    }

    // Fallback to default modes (but still dynamic - not hardcoded in PDF generation)
    return 'Cheque/Cash/Online Transfer'
  }

  private async drawBankDetails(letter: MaintenanceLetter): Promise<void> {
    // Prefer sector-specific bank details when present, fall back to project defaults
    const hasSectorBank = !!(letter.sector_account_name || letter.sector_account_no || letter.sector_bank_name)

    const effectiveAccountName = hasSectorBank ? letter.sector_account_name : letter.account_name
    const effectiveBankName    = hasSectorBank ? letter.sector_bank_name    : letter.bank_name
    const effectiveAccountNo   = hasSectorBank ? letter.sector_account_no   : letter.account_no
    const effectiveIfsc        = hasSectorBank ? letter.sector_ifsc_code    : letter.ifsc_code
    const effectiveBranch      = hasSectorBank ? letter.sector_branch       : letter.branch
    const effectiveBranchAddr  = hasSectorBank ? undefined                  : letter.branch_address

    // Add extra space before bank details to prevent bottom cutoff
    this.layout.currentY -= 15

    this.page.drawText('Bank Details for Payment', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 35

    const bankFields: [string, string | undefined][] = [
      ['Account Name', effectiveAccountName],
      ['Account No',   effectiveAccountNo],
      ['Bank Name',    effectiveBankName],
      ['IFSC Code',    effectiveIfsc],
      ['Branch',       effectiveBranch],
      ['Branch Address', effectiveBranchAddr]
    ]

    const bankInfo = bankFields
      .filter(([, v]) => v && String(v).trim() !== '')
      .map(([label, v]) => `${label}: ${v}`)

    if (bankInfo.length === 0) {
      this.page.drawText('Bank details not configured. Please update project settings.', {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.italic,
        color: this.COLORS.GRAY
      })
      this.layout.currentY -= 20
    } else {
      bankInfo.forEach((info, index) => {
        this.page.drawText(info, {
          x: this.MARGIN,
          y: this.layout.currentY - index * 18,
          size: 10,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
      })
      this.layout.currentY -= bankInfo.length * 18 + 20
    }

    // QR code — prefer sector QR, fall back to project QR
    const qrCodePath = letter.sector_qr_code || letter.project_qr_code

    if (qrCodePath) {
      const qrLabel = hasSectorBank
        ? `Scan QR — Sector ${letter.sector_code || ''}`
        : 'Scan QR to Pay'

      const qrSize = 90
      const qrX = this.layout.width - this.MARGIN - qrSize - 15
      const qrY = this.layout.currentY + bankInfo.length * 18 + 20

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

          // Draw the QR code image
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
        console.warn('Failed to embed QR code:', error)
      }
    }
  }
}

export const maintenanceLetterService = new MaintenanceLetterService()