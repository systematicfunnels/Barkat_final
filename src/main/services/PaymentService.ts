import { dbService } from '../db/database'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { rgb } from 'pdf-lib'
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
                r.receipt_number
         FROM payments p
         JOIN units u ON p.unit_id = u.id
         JOIN projects pr ON p.project_id = pr.id
         LEFT JOIN receipts r ON p.id = r.payment_id
         WHERE p.id = ?`,
        [paymentId]
      )

      if (!payment) throw new Error(`Payment not found: ${paymentId}`)

      // Get associated maintenance letter and its addons for itemized breakdown
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

      // ── Header: Project Name (centered, green) ──
      const projectName = payment.project_name || 'Barkat'
      const projectNameWidth = this.fonts.bold.widthOfTextAtSize(projectName, 18)
      const centerX = (this.layout.width - projectNameWidth) / 2
      
      this.page.drawText(projectName, {
        x: centerX,
        y: this.layout.currentY,
        size: 18,
        font: this.fonts.bold,
        color: this.COLORS.SUCCESS // Green color
      })
      this.layout.currentY -= 22

      // ── Location (centered, gray) ──
      const rawPayment = payment as unknown as Record<string, string>
      const locationParts = [rawPayment.city, rawPayment.state].filter(Boolean)
      if (locationParts.length > 0) {
        const locationText = locationParts.join(', ')
        const locationWidth = this.fonts.regular.widthOfTextAtSize(locationText, 10)
        const locationCenterX = (this.layout.width - locationWidth) / 2
        
        this.page.drawText(locationText, {
          x: locationCenterX,
          y: this.layout.currentY,
          size: 10,
          font: this.fonts.regular,
          color: this.COLORS.GRAY
        })
      }
      this.layout.currentY -= 25

      // ── Horizontal Line ──
      this.page.drawLine({
        start: { x: this.MARGIN, y: this.layout.currentY },
        end: { x: this.layout.width - this.MARGIN, y: this.layout.currentY },
        thickness: 1.5,
        color: this.COLORS.SUCCESS
      })
      this.layout.currentY -= 25

      // ── PAYMENT RECEIPT Title (centered, bold) ──
      const titleText = 'PAYMENT RECEIPT'
      const titleWidth = this.fonts.bold.widthOfTextAtSize(titleText, 14)
      const titleCenterX = (this.layout.width - titleWidth) / 2
      
      this.page.drawText(titleText, {
        x: titleCenterX,
        y: this.layout.currentY,
        size: 14,
        font: this.fonts.bold,
        color: this.COLORS.TEXT
      })
      this.layout.currentY -= 35

      // ── Receipt Details (key-value pairs) ──
      const drawReceiptRow = (label: string, value: string): void => {
        // Draw label (left aligned)
        this.page.drawText(label, {
          x: this.MARGIN,
          y: this.layout.currentY,
          size: 11,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
        
        // Draw value (right aligned)
        const valueWidth = this.fonts.regular.widthOfTextAtSize(value, 11)
        this.page.drawText(value, {
          x: this.layout.width - this.MARGIN - valueWidth,
          y: this.layout.currentY,
          size: 11,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
        
        // Draw subtle separator line
        this.layout.currentY -= 8
        this.page.drawLine({
          start: { x: this.MARGIN, y: this.layout.currentY },
          end: { x: this.layout.width - this.MARGIN, y: this.layout.currentY },
          thickness: 0.5,
          color: this.COLORS.LIGHT_GRAY
        })
        this.layout.currentY -= 18
      }

      // Format payment date
      const formatDate = (dateStr: string): string => {
        if (!dateStr) return '—'
        const date = new Date(dateStr)
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      }

      // Draw all receipt rows
      drawReceiptRow('Receipt No.', payment.receipt_number || `REC-${paymentId}`)
      drawReceiptRow('Payment Date', formatDate(payment.payment_date || ''))
      drawReceiptRow('Financial Year', payment.financial_year || '—')
      drawReceiptRow('Unit Owner', payment.owner_name || '—')
      drawReceiptRow('Unit Number', payment.unit_number || '—')
      drawReceiptRow('Project', payment.project_name || '—')
      
      const modeLabel = payment.payment_mode === 'Transfer' ? 'Bank Transfer / UPI' : payment.payment_mode || '—'
      drawReceiptRow('Payment Mode', modeLabel)

      this.layout.currentY -= 10

      // ── Payment Breakdown (itemized) ──
      if (letterAndAddons) {
        // Draw breakdown header
        this.layout.currentY -= 5
        const breakdownText = 'Payment Breakdown'
        const breakdownWidth = this.fonts.bold.widthOfTextAtSize(breakdownText, 12)
        const breakdownX = (this.layout.width - breakdownWidth) / 2
        
        this.page.drawText(breakdownText, {
          x: breakdownX,
          y: this.layout.currentY,
          size: 12,
          font: this.fonts.bold,
          color: this.COLORS.TEXT
        })
        this.layout.currentY -= 20

        // Base maintenance amount
        if (letterAndAddons.base_amount > 0) {
          drawReceiptRow('Maintenance Charges', `₹${letterAndAddons.base_amount.toLocaleString('en-IN')}`)
        }

        // Add-ons (filter out zero amounts)
        addons.forEach((addon: any) => {
          if (addon.addon_amount > 0) {
            drawReceiptRow(addon.addon_name, `₹${addon.addon_amount.toLocaleString('en-IN')}`)
          }
        })

        // Arrears if any
        if (letterAndAddons.arrears && letterAndAddons.arrears > 0) {
          drawReceiptRow('Arrears (Previous Outstanding)', `₹${letterAndAddons.arrears.toLocaleString('en-IN')}`)
        }

        // Discount if any
        if (letterAndAddons.discount_amount && letterAndAddons.discount_amount > 0) {
          drawReceiptRow('Early Payment Discount', `-₹${letterAndAddons.discount_amount.toLocaleString('en-IN')}`)
        }

        // Separator line before total
        this.layout.currentY -= 5
        this.page.drawLine({
          start: { x: this.MARGIN, y: this.layout.currentY },
          end: { x: this.layout.width - this.MARGIN, y: this.layout.currentY },
          thickness: 1,
          color: this.COLORS.BORDER
        })
        this.layout.currentY -= 20
      }

      // ── Amount Received Box (green highlight) ──
      const amountLabel = 'Amount Received'
      const safeAmount = payment.payment_amount ?? 0
      const amountValue = `₹${safeAmount.toLocaleString('en-IN')}`
      
      const amountLabelWidth = this.fonts.bold.widthOfTextAtSize(amountLabel, 12)
      const amountValueWidth = this.fonts.bold.widthOfTextAtSize(amountValue, 14)
      
      // Calculate box dimensions
      const boxPadding = 15
      const boxHeight = 45
      const boxWidth = Math.max(amountLabelWidth + amountValueWidth + boxPadding * 3, 250)
      const boxX = (this.layout.width - boxWidth) / 2
      
      // Draw green background box
      this.page.drawRectangle({
        x: boxX,
        y: this.layout.currentY - boxHeight + 10,
        width: boxWidth,
        height: boxHeight,
        color: rgb(0.9, 0.98, 0.9), // Very light green background
        borderColor: this.COLORS.SUCCESS,
        borderWidth: 1
      })
      
      // Draw Amount Received label (left side of box)
      this.page.drawText(amountLabel, {
        x: boxX + boxPadding,
        y: this.layout.currentY - 18,
        size: 12,
        font: this.fonts.bold,
        color: this.COLORS.SUCCESS
      })
      
      // Draw amount value (right side of box)
      this.page.drawText(amountValue, {
        x: boxX + boxWidth - amountValueWidth - boxPadding,
        y: this.layout.currentY - 20,
        size: 14,
        font: this.fonts.bold,
        color: this.COLORS.SUCCESS
      })
      
      this.layout.currentY -= boxHeight + 25

      // ── Footer ──
      const footerText = 'This is an electronically generated receipt. No signature required.'
      const footerWidth = this.fonts.italic?.widthOfTextAtSize(footerText, 9) || 
                         this.fonts.regular.widthOfTextAtSize(footerText, 9)
      const footerCenterX = (this.layout.width - footerWidth) / 2
      
      this.page.drawText(footerText, {
        x: footerCenterX,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.italic || this.fonts.regular,
        color: this.COLORS.GRAY
      })

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
