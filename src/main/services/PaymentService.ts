import { dbService } from '../db/database'
import fs from 'fs'
import path from 'path'
import { rgb } from 'pdf-lib'
import { BasePDFGenerator } from './BasePDFGenerator'
import { MaintenanceLetter } from './MaintenanceLetterService'
import { normalizeMoney } from '../utils/money'
import { getCurrentFinancialYear } from '../utils/dateUtils'
import { getUserDataPath } from '../utils/runtimePaths'

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
  snapshot_letter_id?: number
  snapshot_financial_year?: string
  snapshot_base_amount?: number
  snapshot_arrears?: number
  snapshot_discount_amount?: number
  snapshot_letter_total?: number
  snapshot_addons_json?: string
}

type ReceiptAddon = {
  addon_name: string
  addon_amount: number
  remarks?: string
}

type LetterWithAddons = MaintenanceLetter & { addons: string }

type ReceiptSnapshot = {
  snapshot_letter_id: number | null
  snapshot_financial_year: string
  snapshot_base_amount: number
  snapshot_arrears: number
  snapshot_discount_amount: number
  snapshot_letter_total: number
  snapshot_addons_json: string
}

class PaymentService extends BasePDFGenerator {
  private getLetterWithAddonsById(letterId: number): LetterWithAddons | undefined {
    return dbService.get(
      `SELECT l.*,
              COALESCE(
                JSON_GROUP_ARRAY(
                  CASE
                    WHEN a.id IS NOT NULL THEN JSON_OBJECT(
                      'addon_name', a.addon_name,
                      'addon_amount', a.addon_amount,
                      'remarks', a.remarks
                    )
                  END
                ),
                '[]'
              ) as addons
       FROM maintenance_letters l
       LEFT JOIN add_ons a ON l.id = a.letter_id
       WHERE l.id = ?
       GROUP BY l.id`,
      [letterId]
    ) as LetterWithAddons | undefined
  }

  private getLetterWithAddonsByUnitAndYear(unitId: number, financialYear: string): LetterWithAddons | undefined {
    return dbService.get(
      `SELECT l.*,
              COALESCE(
                JSON_GROUP_ARRAY(
                  CASE
                    WHEN a.id IS NOT NULL THEN JSON_OBJECT(
                      'addon_name', a.addon_name,
                      'addon_amount', a.addon_amount,
                      'remarks', a.remarks
                    )
                  END
                ),
                '[]'
              ) as addons
       FROM maintenance_letters l
       LEFT JOIN add_ons a ON l.id = a.letter_id
       WHERE l.unit_id = ? AND l.financial_year = ?
       GROUP BY l.id
       ORDER BY l.id DESC
       LIMIT 1`,
      [unitId, financialYear]
    ) as LetterWithAddons | undefined
  }

  private parseReceiptAddons(addonsJson?: string): ReceiptAddon[] {
    if (!addonsJson) return []

    try {
      const parsed = JSON.parse(addonsJson)
      if (!Array.isArray(parsed)) return []

      return parsed.filter(
        (item): item is ReceiptAddon =>
          Boolean(item) &&
          typeof item.addon_name === 'string' &&
          typeof item.addon_amount === 'number'
      )
    } catch {
      return []
    }
  }

  private buildReceiptSnapshot(letter: LetterWithAddons | undefined, fallbackFinancialYear: string): ReceiptSnapshot {
    return {
      snapshot_letter_id: letter?.id ?? null,
      snapshot_financial_year: letter?.financial_year || fallbackFinancialYear,
      snapshot_base_amount: normalizeMoney(letter?.base_amount || 0),
      snapshot_arrears: normalizeMoney(letter?.arrears || 0),
      snapshot_discount_amount: normalizeMoney(letter?.discount_amount || 0),
      snapshot_letter_total: normalizeMoney(letter?.final_amount || 0),
      snapshot_addons_json: letter?.addons || '[]'
    }
  }

  private resolveLinkedLetterAndSnapshot(params: {
    unitId: number
    letterId?: number
    financialYear?: string
  }): {
    linkedLetter: LetterWithAddons | undefined
    resolvedLetterId?: number
    resolvedFinancialYear: string
    snapshot: ReceiptSnapshot
  } {
    let resolvedLetterId = params.letterId
    let resolvedFinancialYear = params.financialYear
    let linkedLetter: LetterWithAddons | undefined

    if (resolvedLetterId) {
      linkedLetter = this.getLetterWithAddonsById(resolvedLetterId)
      if (!linkedLetter) {
        throw new Error('Selected maintenance letter could not be found')
      }
      resolvedFinancialYear = linkedLetter.financial_year
    } else if (resolvedFinancialYear) {
      linkedLetter = this.getLetterWithAddonsByUnitAndYear(params.unitId, resolvedFinancialYear)
      if (linkedLetter?.id) {
        resolvedLetterId = linkedLetter.id
        resolvedFinancialYear = linkedLetter.financial_year
      }
    }

    if (!resolvedFinancialYear) {
      resolvedFinancialYear = getCurrentFinancialYear()
    }

    return {
      linkedLetter,
      resolvedLetterId,
      resolvedFinancialYear,
      snapshot: this.buildReceiptSnapshot(linkedLetter, resolvedFinancialYear)
    }
  }

  public async generateReceiptPdf(paymentId: number): Promise<string> {
    try {
      const payment = dbService.get<
        Payment &
          Receipt & {
            city?: string
            state?: string
            sector_code?: string
          }
      >(
        `SELECT p.*, u.unit_number, u.owner_name, u.contact_number, u.sector_code,
                pr.name as project_name, pr.address, pr.city, pr.state,
                pr.contact_email, pr.contact_phone,
                r.receipt_number, r.snapshot_letter_id, r.snapshot_financial_year,
                r.snapshot_base_amount, r.snapshot_arrears, r.snapshot_discount_amount,
                r.snapshot_letter_total, r.snapshot_addons_json
         FROM payments p
         JOIN units u ON p.unit_id = u.id
         JOIN projects pr ON p.project_id = pr.id
         LEFT JOIN receipts r ON p.id = r.payment_id
         WHERE p.id = ?`,
        [paymentId]
      )

      if (!payment) throw new Error(`Payment not found: ${paymentId}`)

      const fallbackLetter =
        payment.letter_id
          ? this.getLetterWithAddonsById(payment.letter_id)
          : payment.financial_year
            ? this.getLetterWithAddonsByUnitAndYear(payment.unit_id, payment.financial_year)
            : undefined

      const receiptSnapshot = payment.snapshot_financial_year
        ? {
            financialYear: payment.snapshot_financial_year,
            baseAmount: normalizeMoney(payment.snapshot_base_amount || 0),
            arrearsAmount: normalizeMoney(payment.snapshot_arrears || 0),
            discountAmount: normalizeMoney(payment.snapshot_discount_amount || 0),
            letterTotal: normalizeMoney(payment.snapshot_letter_total || 0),
            addons: this.parseReceiptAddons(payment.snapshot_addons_json)
          }
        : {
            financialYear: fallbackLetter?.financial_year || payment.financial_year || '—',
            baseAmount: normalizeMoney(fallbackLetter?.base_amount || 0),
            arrearsAmount: normalizeMoney(fallbackLetter?.arrears || 0),
            discountAmount: normalizeMoney(fallbackLetter?.discount_amount || 0),
            letterTotal: normalizeMoney(fallbackLetter?.final_amount || 0),
            addons: this.parseReceiptAddons(fallbackLetter?.addons)
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
      drawReceiptRow('Financial Year', receiptSnapshot.financialYear || '—')
      drawReceiptRow('Unit Owner', payment.owner_name || '—')
      drawReceiptRow('Unit Number', payment.unit_number || '—')
      drawReceiptRow('Project', payment.project_name || '—')
      
      const modeLabel = payment.payment_mode === 'Transfer' ? 'Bank Transfer / UPI' : payment.payment_mode || '—'
      drawReceiptRow('Payment Mode', modeLabel)

      this.layout.currentY -= 10

      // ── Payment Breakdown (itemized) ──
      if (
        receiptSnapshot.baseAmount > 0 ||
        receiptSnapshot.addons.length > 0 ||
        receiptSnapshot.arrearsAmount > 0 ||
        receiptSnapshot.discountAmount > 0
      ) {
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
        if (receiptSnapshot.baseAmount > 0) {
          drawReceiptRow(
            'Maintenance Charges',
            `Rs. ${receiptSnapshot.baseAmount.toLocaleString('en-IN')}`
          )
        }

        // Add-ons (filter out zero amounts)
        receiptSnapshot.addons.forEach((addon: ReceiptAddon) => {
          if (addon.addon_amount > 0) {
            drawReceiptRow(
              addon.addon_name,
              `Rs. ${normalizeMoney(addon.addon_amount).toLocaleString('en-IN')}`
            )
          }
        })

        // Arrears if any
        if (receiptSnapshot.arrearsAmount > 0) {
          drawReceiptRow(
            'Arrears (Previous Outstanding)',
            `Rs. ${receiptSnapshot.arrearsAmount.toLocaleString('en-IN')}`
          )
        }

        // Discount if any
        if (receiptSnapshot.discountAmount > 0) {
          drawReceiptRow(
            'Early Payment Discount',
            `-Rs. ${receiptSnapshot.discountAmount.toLocaleString('en-IN')}`
          )
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
      const safeAmount = normalizeMoney(payment.payment_amount ?? 0)
      const amountValue = `Rs. ${safeAmount.toLocaleString('en-IN')}`
      
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
      const pdfDir = path.join(getUserDataPath(), 'receipts')
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
      const {
        linkedLetter,
        resolvedLetterId,
        resolvedFinancialYear,
        snapshot
      } = this.resolveLinkedLetterAndSnapshot({
        unitId: payment.unit_id ?? existingPayment.unit_id,
        letterId: payment.letter_id ?? existingPayment.letter_id,
        financialYear: payment.financial_year ?? existingPayment.financial_year
      })

      const updateData = {
        project_id: payment.project_id ?? existingPayment.project_id,
        unit_id: payment.unit_id ?? existingPayment.unit_id,
        letter_id: resolvedLetterId ?? existingPayment.letter_id,
        payment_date: payment.payment_date ?? existingPayment.payment_date,
        payment_amount: normalizeMoney(payment.payment_amount ?? existingPayment.payment_amount),
        payment_mode: payment.payment_mode ?? existingPayment.payment_mode,
        cheque_number: payment.cheque_number ?? existingPayment.cheque_number,
        remarks: payment.remarks ?? existingPayment.remarks,
        financial_year: resolvedFinancialYear
      }

      // Validate required fields
      if (!updateData.project_id || !updateData.unit_id || !updateData.payment_date ||
          !updateData.payment_amount || !updateData.payment_mode || !updateData.financial_year) {
        throw new Error('Missing required fields for payment update')
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
      ]

      dbService.run(
        'UPDATE payments SET project_id = ?, unit_id = ?, letter_id = ?, payment_date = ?, payment_amount = ?, payment_mode = ?, cheque_number = ?, remarks = ?, financial_year = ? WHERE id = ?',
        params
      )

      const existingReceipt = dbService.get<{ id: number }>('SELECT id FROM receipts WHERE payment_id = ?', [id])
      if (existingReceipt) {
        dbService.run(
          `UPDATE receipts
           SET receipt_date = ?,
               snapshot_letter_id = ?,
               snapshot_financial_year = ?,
               snapshot_base_amount = ?,
               snapshot_arrears = ?,
               snapshot_discount_amount = ?,
               snapshot_letter_total = ?,
               snapshot_addons_json = ?
           WHERE payment_id = ?`,
          [
            updateData.payment_date,
            linkedLetter?.id ?? snapshot.snapshot_letter_id,
            snapshot.snapshot_financial_year,
            snapshot.snapshot_base_amount,
            snapshot.snapshot_arrears,
            snapshot.snapshot_discount_amount,
            snapshot.snapshot_letter_total,
            snapshot.snapshot_addons_json,
            id
          ]
        )
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
      const unitExists = dbService.get<{ id: number }>(
        'SELECT id FROM units WHERE id = ? AND project_id = ?',
        [payment.unit_id, payment.project_id]
      )

      if (!unitExists) {
        throw new Error('Selected unit does not belong to the selected project')
      }

      const {
        linkedLetter,
        resolvedLetterId,
        resolvedFinancialYear,
        snapshot
      } = this.resolveLinkedLetterAndSnapshot({
        unitId: payment.unit_id,
        letterId: payment.letter_id,
        financialYear: payment.financial_year
      })

      // Validate financial year format - accepts both 2024-25 and 2024-2025
      if (!resolvedFinancialYear || !resolvedFinancialYear.match(/^\d{4}-(\d{2}|\d{4})$/)) {
        throw new Error(
          'Invalid or missing financial year. Please provide a valid financial year (e.g., 2024-25 or 2024-2025).'
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
          normalizeMoney(payment.payment_amount),
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
          if (process.env.NODE_ENV !== 'production') {
            console.log('[PAYMENTS] Creating receipt record')
          }
          dbService.run(
            `INSERT INTO receipts (
              payment_id, receipt_number, receipt_date,
              snapshot_letter_id, snapshot_financial_year, snapshot_base_amount,
              snapshot_arrears, snapshot_discount_amount, snapshot_letter_total,
              snapshot_addons_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              paymentId,
              receiptNumber,
              payment.payment_date,
              linkedLetter?.id ?? snapshot.snapshot_letter_id,
              snapshot.snapshot_financial_year,
              snapshot.snapshot_base_amount,
              snapshot.snapshot_arrears,
              snapshot.snapshot_discount_amount,
              snapshot.snapshot_letter_total,
              snapshot.snapshot_addons_json
            ]
          )
          if (process.env.NODE_ENV !== 'production') {
            console.log('[PAYMENTS] Receipt record created successfully')
          }
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            console.error('[PAYMENTS] Failed to create receipt record:', error)
          }
          // Don't fail the payment, just log the error
        }
      }

      // Letter status auto-calculation has been disabled to prevent incorrect Paid status
      // Status must be managed through manual letter updates only

      return paymentId
    })
  }

  private deleteInternal(id: number): boolean {
    // Internal delete without transaction wrapper for use in bulk operations
    const result = dbService.run('DELETE FROM payments WHERE id = ?', [id])
    return result.changes > 0
  }

  public delete(id: number): boolean {
    return dbService.transaction(() => {
      return this.deleteInternal(id)
    })
  }

  public bulkDelete(ids: number[]): boolean {
    // Use single transaction for atomic operation - roll back all on any failure
    return dbService.transaction(() => {
      for (const id of ids) {
        if (!this.deleteInternal(id)) {
          throw new Error(`Failed to delete payment ${id}`)
        }
      }
      return true
    })
  }
}

export const paymentService = new PaymentService()



