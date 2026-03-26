import { dbService } from '../db/database'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { BasePDFGenerator } from './BasePDFGenerator'
import { MaintenanceLetter } from './MaintenanceLetterService'

export interface Payment {
  id?: number
  project_id: number
  unit_id: number
  letter_id?: number
  payment_date: string
  payment_amount: number
  payment_mode: string // Cash, Cheque, UPI
  cheque_number?: string
  remarks?: string
  payment_status?: string // Received, Pending
  created_at?: string
  unit_number?: string
  owner_name?: string
  project_name?: string
  receipt_number?: string
  financial_year?: string
  contact_number?: string
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  branch_address?: string
}

export interface Receipt {
  id?: number
  payment_id: number
  receipt_number: string
  receipt_date: string
}

class PaymentService extends BasePDFGenerator {
  private updateLetterStatus(letterId: number): void {
    const letter = dbService.get<{
      id: number
      final_amount: number
      unit_id: number
      financial_year: string
    }>('SELECT id, final_amount, unit_id, financial_year FROM maintenance_letters WHERE id = ?', [
      letterId
    ])
    if (!letter) return

    // Calculate total payments for this specific letter
    const letterPayments =
      dbService.get<{ total: number }>(
        'SELECT COALESCE(SUM(payment_amount), 0) as total FROM payments WHERE letter_id = ?',
        [letterId]
      )?.total || 0

    // Calculate payments without letter_id but matching unit and financial year
    const unlinkedPayments =
      dbService.get<{ total: number }>(
        `SELECT COALESCE(SUM(payment_amount), 0) as total
       FROM payments 
       WHERE letter_id IS NULL 
         AND unit_id = ? 
         AND TRIM(COALESCE(financial_year, '')) = TRIM(?)`,
        [letter.unit_id, letter.financial_year]
      )?.total || 0

    const totalPaid = letterPayments + unlinkedPayments
    const isPaid = totalPaid + 0.01 >= letter.final_amount

    dbService.run('UPDATE maintenance_letters SET status = ?, is_paid = ? WHERE id = ?', [
      isPaid ? 'Paid' : 'Pending',
      isPaid ? 1 : 0,
      letterId
    ])
  }

  private updateLetterStatusByUnitYear(unitId: number, financialYear?: string): void {
    if (!financialYear) return
    const letter = dbService.get<{ id: number }>(
      'SELECT id FROM maintenance_letters WHERE unit_id = ? AND TRIM(financial_year) = TRIM(?)',
      [unitId, financialYear]
    )
    if (!letter) return
    this.updateLetterStatus(letter.id)
  }

  public async generateReceiptPdf(paymentId: number): Promise<string> {
    try {
      const payment = dbService.get<Payment>(
        `SELECT p.*, u.unit_number, u.owner_name, u.contact_number, u.sector_code,
                pr.name as project_name, pr.address, pr.city, pr.state,
                pr.contact_email, pr.contact_phone,
                pr.account_name as proj_account_name,
                pr.bank_name    as proj_bank_name,
                pr.account_no   as proj_account_no,
                pr.ifsc_code    as proj_ifsc_code,
                pr.branch       as proj_branch,
                pr.branch_address as proj_branch_address,
                pspc.account_name as sec_account_name,
                pspc.bank_name    as sec_bank_name,
                pspc.account_no   as sec_account_no,
                pspc.ifsc_code    as sec_ifsc_code,
                pspc.branch       as sec_branch,
                r.receipt_number
         FROM payments p
         JOIN units u ON p.unit_id = u.id
         JOIN projects pr ON p.project_id = pr.id
         LEFT JOIN receipts r ON p.id = r.payment_id
         LEFT JOIN project_sector_payment_configs pspc
           ON pr.id = pspc.project_id
          AND UPPER(TRIM(u.sector_code)) = UPPER(TRIM(pspc.sector_code))
         WHERE p.id = ?`,
        [paymentId]
      )

      if (!payment) throw new Error(`Payment not found: ${paymentId}`)

      // Get associated maintenance letter and its addons
      let letterAndAddons: (MaintenanceLetter & { addons: string }) | undefined = undefined
      if (payment.letter_id) {
        letterAndAddons = dbService.get(
          `SELECT l.*, 
                  JSON_GROUP_ARRAY(
                    JSON_OBJECT(
                      'addon_name', a.addon_name,
                      'addon_amount', a.addon_amount,
                      'remarks', a.remarks
                    )
                  ) as addons
           FROM maintenance_letters l
           LEFT JOIN add_ons a ON l.id = a.letter_id
           WHERE l.id = ?
           GROUP BY l.id`,
          [payment.letter_id]
        ) as (MaintenanceLetter & { addons: string }) | undefined
      } else {
        // Try to find letter by unit and financial year
        letterAndAddons = dbService.get(
          `SELECT l.*, 
                  JSON_GROUP_ARRAY(
                    JSON_OBJECT(
                      'addon_name', a.addon_name,
                      'addon_amount', a.addon_amount,
                      'remarks', a.remarks
                    )
                  ) as addons
           FROM maintenance_letters l
           LEFT JOIN add_ons a ON l.id = a.letter_id
           WHERE l.unit_id = ? AND l.financial_year = ?
           GROUP BY l.id`,
          [payment.unit_id, payment.financial_year]
        ) as (MaintenanceLetter & { addons: string }) | undefined
      }

      // Parse addons JSON if it exists
      let addons = []
      if (letterAndAddons && letterAndAddons.addons) {
        try {
          const parsed = JSON.parse(letterAndAddons.addons)
          // Filter out null entries (when no addons exist)
          addons = parsed.filter(item => item.addon_name !== null)
        } catch (e) {
          console.warn('Failed to parse addons JSON:', e)
        }
      }

      await this.initializePDF()

      // ── Letterhead: real project name + address ──
      const projectName = (payment.project_name || 'Payment Receipt').toUpperCase()
      this.page.drawText(projectName, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 16,
        font: this.fonts.bold,
        color: this.COLORS.PRIMARY
      })
      this.layout.currentY -= 18

      const rawPayment = payment as unknown as Record<string, string>
      const addrParts = [rawPayment.address, rawPayment.city, rawPayment.state].filter(Boolean)
      if (addrParts.length > 0) {
        this.page.drawText(addrParts.join(', '), {
          x: this.MARGIN,
          y: this.layout.currentY,
          size: 9,
          font: this.fonts.regular,
          color: this.COLORS.GRAY
        })
        this.layout.currentY -= 14
      }

      const contactParts = [
        rawPayment.contact_email ? `Email: ${rawPayment.contact_email}` : null,
        rawPayment.contact_phone ? `Phone: ${rawPayment.contact_phone}` : null
      ].filter(Boolean)
      if (contactParts.length > 0) {
        this.page.drawText(contactParts.join('  |  '), {
          x: this.MARGIN,
          y: this.layout.currentY,
          size: 9,
          font: this.fonts.regular,
          color: this.COLORS.GRAY
        })
        this.layout.currentY -= 14
      }

      this.drawDivider()

      // ── Receipt title ──
      this.drawSectionHeader('PAYMENT RECEIPT')
      this.layout.currentY -= 10

      // ── Receipt meta ──
      this.drawInfoGrid(
        ['Receipt No:', 'Payment Date:', 'Financial Year:'],
        [
          payment.receipt_number || `REC-${paymentId}`,
          this.formatDate(payment.payment_date),
          payment.financial_year || '—'
        ]
      )

      // ── Recipient ──
      this.layout.currentY -= 10
      this.drawSectionHeader('RECIPIENT DETAILS')
      this.layout.currentY -= 10
      this.drawInfoGrid(
        ['Unit No:', 'Owner Name:', 'Contact:', 'Project:'],
        [
          payment.unit_number || '—',
          payment.owner_name || '—',
          payment.contact_number || '—',
          payment.project_name || '—'
        ]
      )

      // ── Payment details table ──
      this.layout.currentY -= 10
      this.drawSectionHeader('PAYMENT DETAILS')
      this.layout.currentY -= 10

      const modeLabel =
        payment.payment_mode === 'Transfer' ? 'Bank Transfer / UPI' : payment.payment_mode || '—'
      const refLabel = payment.cheque_number
        ? `${modeLabel} — Ref: ${payment.cheque_number}`
        : modeLabel

      // Build payment breakdown table
      const tableRows: string[][] = []
      
      // If we have letter details, show the breakdown
      if (letterAndAddons) {
        // Base maintenance amount
        if (letterAndAddons.base_amount > 0) {
          tableRows.push([
            'Maintenance Charges',
            this.formatCurrency(letterAndAddons.base_amount)
          ])
        }

        // Add-ons
        addons.forEach((addon: any) => {
          tableRows.push([
            addon.addon_name,
            this.formatCurrency(addon.addon_amount)
          ])
        })

        // Arrears if any
        if (letterAndAddons.arrears && letterAndAddons.arrears > 0) {
          tableRows.push([
            'Arrears (Previous Outstanding)',
            this.formatCurrency(letterAndAddons.arrears)
          ])
        }

        // Discount if any
        if (letterAndAddons.discount_amount && letterAndAddons.discount_amount > 0) {
          tableRows.push([
            'Early Payment Discount',
            `-${this.formatCurrency(letterAndAddons.discount_amount)}`
          ])
        }

        // Separator line
        tableRows.push(['', ''])

        // Total amount paid
        tableRows.push([
          'Total Amount Paid',
          this.formatCurrency(payment.payment_amount)
        ])
      } else {
        // Fallback to simple details if no letter found
        tableRows.push([
          'Amount Paid',
          this.formatCurrency(payment.payment_amount)
        ])
      }

      // Payment mode and reference
      tableRows.push(['Payment Mode', refLabel])
      
      if (payment.remarks) {
        tableRows.push(['Remarks', payment.remarks])
      }

      this.drawTable(['Particulars', 'Details'], tableRows)

      // ── Bank details — prefer sector-specific account, fall back to project default ──
      this.layout.currentY -= 10
      const raw = payment as unknown as Record<string, string>
      const hasSector = !!(raw.sec_account_name || raw.sec_account_no || raw.sec_bank_name)
      this.drawBankDetails({
        account_name:   hasSector ? raw.sec_account_name   : raw.proj_account_name,
        bank_name:      hasSector ? raw.sec_bank_name      : raw.proj_bank_name,
        account_no:     hasSector ? raw.sec_account_no     : raw.proj_account_no,
        ifsc_code:      hasSector ? raw.sec_ifsc_code      : raw.proj_ifsc_code,
        branch:         hasSector ? raw.sec_branch         : raw.proj_branch,
        branch_address: hasSector ? undefined              : raw.proj_branch_address
      })

      // ── Footer ──
      this.drawFooter('Authorised Signatory')

      const pdfBytes = await this.pdfDoc.save()
      const pdfDir = path.join(app.getPath('userData'), 'receipts')
      if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true })

      const fileName = `Receipt_${payment.receipt_number || paymentId}.pdf`
      const filePath = path.join(pdfDir, fileName)
      await fs.promises.writeFile(filePath, pdfBytes)
      return filePath
    } catch (error) {
      throw new Error(
        `Failed to generate receipt: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }


  public update(id: number, payment: Partial<Payment>): boolean {
    return dbService.transaction(() => {
      const existingPayment = dbService.get<Payment>('SELECT * FROM payments WHERE id = ?', [id])
      if (!existingPayment) {
        throw new Error('Payment not found')
      }

      // Prepare update data with validation
      const updateData = {
        project_id: payment.project_id ?? existingPayment.project_id,
        unit_id: payment.unit_id ?? existingPayment.unit_id,
        letter_id: payment.letter_id ?? existingPayment.letter_id,
        payment_date: payment.payment_date ?? existingPayment.payment_date,
        payment_amount: payment.payment_amount ?? existingPayment.payment_amount,
        payment_mode: payment.payment_mode ?? existingPayment.payment_mode,
        cheque_number: payment.cheque_number ?? existingPayment.cheque_number,
        remarks: payment.remarks ?? existingPayment.remarks,
        financial_year: payment.financial_year ?? existingPayment.financial_year
      };

      // Validate required fields
      if (!updateData.project_id || !updateData.unit_id || !updateData.payment_date || 
          !updateData.payment_amount || !updateData.payment_mode || !updateData.financial_year) {
        throw new Error('Missing required fields for payment update');
      }

      // Update payment record
      const params = [
        updateData.project_id,
        updateData.unit_id,
        updateData.letter_id,
        updateData.payment_date,
        updateData.payment_amount,
        updateData.payment_mode,
        updateData.cheque_number,
        updateData.remarks,
        updateData.financial_year,
        id
      ];

      console.log('SQL Parameters:', params);
      console.log('Parameter count:', params.length);
      
      dbService.run(
        'UPDATE payments SET project_id = ?, unit_id = ?, letter_id = ?, payment_date = ?, payment_amount = ?, payment_mode = ?, cheque_number = ?, remarks = ?, financial_year = ? WHERE id = ?',
        params
      )

      // Update letter status if letter_id or financial_year changed
      const shouldUpdateLetterStatus = 
        payment.letter_id !== undefined && payment.letter_id !== existingPayment.letter_id ||
        payment.financial_year !== undefined && payment.financial_year !== existingPayment.financial_year

      if (shouldUpdateLetterStatus) {
        if (payment.letter_id) {
          this.updateLetterStatus(payment.letter_id)
        } else if (payment.unit_id && payment.financial_year) {
          this.updateLetterStatusByUnitYear(payment.unit_id, payment.financial_year)
        }
      }

      return true
    })
  }

  public getAll(): Payment[] {
    return dbService.query<Payment>(`
      SELECT p.*, u.unit_number, u.owner_name, pr.name as project_name, r.receipt_number,
             COALESCE(p.financial_year, l.financial_year) as financial_year
      FROM payments p
      JOIN units u ON p.unit_id = u.id
      JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      LEFT JOIN maintenance_letters l ON p.letter_id = l.id
      ORDER BY p.payment_date DESC, p.id DESC
    `)
  }

  public getByProject(projectId: number): Payment[] {
    return dbService.query<Payment>(
      `SELECT p.*, u.unit_number, u.owner_name, pr.name as project_name, r.receipt_number,
              COALESCE(p.financial_year, l.financial_year) as financial_year
       FROM payments p
       JOIN units u ON p.unit_id = u.id
       JOIN projects pr ON p.project_id = pr.id
       LEFT JOIN receipts r ON p.id = r.payment_id
       LEFT JOIN maintenance_letters l ON p.letter_id = l.id
       WHERE p.project_id = ?
       ORDER BY p.payment_date DESC, p.id DESC`,
      [projectId]
    )
  }

  public getById(id: number): Payment | undefined {
    return dbService.get<Payment>(
      `
      SELECT p.*, u.unit_number, u.owner_name, pr.name as project_name, r.receipt_number,
             COALESCE(p.financial_year, l.financial_year) as financial_year
      FROM payments p
      JOIN units u ON p.unit_id = u.id
      JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      LEFT JOIN maintenance_letters l ON p.letter_id = l.id
      WHERE p.id = ?
    `,
      [id]
    )
  }

  public create(payment: Payment): number {
    return dbService.transaction(() => {
      let resolvedLetterId = payment.letter_id
      let resolvedFinancialYear = payment.financial_year

      // Validate and resolve financial year
      if (!resolvedFinancialYear) {
        // If no financial year provided, try to get it from the letter
        if (resolvedLetterId) {
          resolvedFinancialYear = dbService.get<{ financial_year: string }>(
            'SELECT financial_year FROM maintenance_letters WHERE id = ?',
            [resolvedLetterId]
          )?.financial_year
        }

        // If still no financial year, try to get it from the unit's latest letter
        if (!resolvedFinancialYear) {
          resolvedFinancialYear = dbService.get<{ financial_year: string }>(
            'SELECT financial_year FROM maintenance_letters WHERE unit_id = ? ORDER BY financial_year DESC LIMIT 1',
            [payment.unit_id]
          )?.financial_year
        }

        // If still no financial year, use current financial year
        if (!resolvedFinancialYear) {
          const currentYear =
            new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear()
          resolvedFinancialYear = `${currentYear}-${(currentYear + 1).toString().slice(2)}`
        }
      }

      // Validate and resolve letter ID
      if (!resolvedLetterId && resolvedFinancialYear) {
        resolvedLetterId = dbService.get<{ id: number }>(
          'SELECT id FROM maintenance_letters WHERE unit_id = ? AND TRIM(financial_year) = TRIM(?)',
          [payment.unit_id, resolvedFinancialYear]
        )?.id
      }

      // Validate financial year format
      if (!resolvedFinancialYear || !resolvedFinancialYear.match(/^\d{4}-\d{2}$/)) {
        throw new Error(
          'Invalid or missing financial year. Please provide a valid financial year (e.g., 2024-25).'
        )
      }

      const result = dbService.run(
        `INSERT INTO payments (
          project_id, unit_id, letter_id, financial_year, payment_date, payment_amount, 
          payment_mode, cheque_number, remarks, payment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payment.project_id,
          payment.unit_id,
          resolvedLetterId,
          resolvedFinancialYear,
          payment.payment_date,
          payment.payment_amount,
          payment.payment_mode,
          payment.cheque_number,
          payment.remarks,
          payment.payment_status || 'Received'
        ]
      )

      const paymentId = result.lastInsertRowid as number

      // Automatically generate a receipt number if not provided
      if (payment.payment_status !== 'Pending') {
        const receiptNumber = payment.receipt_number || `REC-${paymentId}`
        try {
          console.log('🧾 Creating receipt record:', receiptNumber)
          dbService.run(
            `INSERT INTO receipts (payment_id, receipt_number, receipt_date)
             VALUES (?, ?, ?)`,
            [paymentId, receiptNumber, payment.payment_date]
          )
          console.log('✅ Receipt record created successfully:', receiptNumber)
        } catch (error) {
          console.error('❌ Failed to create receipt record:', error)
          // Don't fail the payment, just log the error
        }
      }

      if (resolvedLetterId) {
        this.updateLetterStatus(resolvedLetterId)
      } else {
        this.updateLetterStatusByUnitYear(payment.unit_id, resolvedFinancialYear)
      }

      return paymentId
    })
  }

  /**
   * Draw bank details on receipt PDF — only shows fields that have real values
   */
  private drawBankDetails(bank: {
    account_name?: string
    bank_name?: string
    account_no?: string
    ifsc_code?: string
    branch?: string
    branch_address?: string
  }): void {
    this.page.drawText('Bank Details', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })
    this.layout.currentY -= 18

    const fields: [string, string | undefined][] = [
      ['Account Name', bank.account_name],
      ['Account No', bank.account_no],
      ['Bank Name', bank.bank_name],
      ['IFSC Code', bank.ifsc_code],
      ['Branch', bank.branch],
      ['Branch Address', bank.branch_address]
    ]

    const lines = fields
      .filter(([, v]) => v && String(v).trim() !== '')
      .map(([label, v]) => `${label}: ${v}`)

    if (lines.length === 0) {
      this.page.drawText('Bank details not configured. Please update project settings.', {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.italic,
        color: this.COLORS.GRAY
      })
      this.layout.currentY -= 14
      return
    }

    lines.forEach((line) => {
      this.page.drawText(line, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
      this.layout.currentY -= 12
    })
    this.layout.currentY -= 8
  }

  public delete(id: number): boolean {
    return dbService.transaction(() => {
      try {
        const payment = dbService.get<Payment>('SELECT * FROM payments WHERE id = ?', [id])
        const result = dbService.run('DELETE FROM payments WHERE id = ?', [id])

        if (result.changes > 0 && payment) {
          if (payment.letter_id) {
            this.updateLetterStatus(payment.letter_id)
          } else {
            this.updateLetterStatusByUnitYear(payment.unit_id, payment.financial_year)
          }
        }

        return result.changes > 0
      } catch (error) {
        console.error(`Error deleting payment ${id}:`, error)
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
}

export const paymentService = new PaymentService()
