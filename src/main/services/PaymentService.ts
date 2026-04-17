import { dbService } from '../db/database'
import fs from 'fs'
import path from 'path'
import { PDFFont, rgb } from 'pdf-lib'
import { BasePDFGenerator } from './BasePDFGenerator'
import type { MaintenanceLetter } from './MaintenanceLetterService'
import { normalizeMoney } from '../utils/money'
import { getCurrentFinancialYear } from '../utils/dateUtils'
import { getUserDataPath } from '../utils/runtimePaths'
import type { BulkPaymentResult } from './BatchOperationsService'
import { recalculateLetterPaymentState } from './LetterBalanceService'

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
  sector_code?: string
  city?: string
  state?: string
  project_letterhead_path?: string
  sector_letterhead_path?: string
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

type ReceiptRecordParams = {
  paymentId: number
  receiptDate: string
  receiptNumber?: string | null
  snapshot: ReceiptSnapshot
}

class PaymentService extends BasePDFGenerator {
  private drawCenteredReceiptDivider(
    text: string,
    options?: {
      y?: number
      size?: number
      lineGap?: number
      lineThickness?: number
      textColor?: ReturnType<typeof rgb>
      lineColor?: ReturnType<typeof rgb>
      minLineWidth?: number
      font?: PDFFont
    }
  ): void {
    const headingText = String(text || '').trim()
    if (!headingText) return

    const size = options?.size ?? 10.5
    const lineGap = options?.lineGap ?? 14
    const lineThickness = options?.lineThickness ?? 0.8
    const textColor = options?.textColor ?? this.COLORS.TEXT
    const lineColor = options?.lineColor ?? this.COLORS.ACCENT
    const minLineWidth = options?.minLineWidth ?? 28
    const font = options?.font ?? this.fonts.bold
    const textY = options?.y ?? this.layout.currentY
    const textWidth = font.widthOfTextAtSize(headingText, size)
    const textX = (this.layout.width - textWidth) / 2
    const lineY = textY + Math.max(3.6, size * 0.42)
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
      y: textY,
      size,
      font,
      color: textColor
    })
  }

  private drawReceiptFooter(text: string, y?: number): void {
    const footerFont = this.fonts.italic ?? this.fonts.regular
    this.drawCenteredReceiptDivider(text, {
      y: typeof y === 'number' ? y : 16,
      size: 8.5,
      lineGap: 14,
      lineThickness: 0.8,
      textColor: this.COLORS.GRAY,
      lineColor: this.COLORS.ACCENT,
      font: footerFont
    })
  }

  private sanitizeFileComponent(value: string): string {
    return String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_')
      .replace(/-+/g, '-')
      .replace(/^[-_.]+|[-_.]+$/g, '') || 'document'
  }

  private resolveAssetPath(assetPath: string): string | null {
    if (!assetPath) return null

    const normalizedPath = path.normalize(assetPath)
    if (normalizedPath.includes('..')) {
      return null
    }

    const possiblePaths = [
      assetPath,
      path.resolve(assetPath),
      path.join(process.cwd(), assetPath),
      path.join(getUserDataPath(), assetPath),
      path.join(getUserDataPath(), 'assets', assetPath),
      assetPath.startsWith('assets/') ? path.join(getUserDataPath(), assetPath) : null
    ].filter((candidate): candidate is string => Boolean(candidate))

    return possiblePaths.find((candidate) => fs.existsSync(candidate)) || null
  }

  private async embedImageFromPath(imagePath: string) {
    const resolvedPath = this.resolveAssetPath(imagePath)
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

  private getEffectiveReceiptLetterheadPath(payment: Payment): string {
    return (
      String(payment.sector_letterhead_path || '').trim() ||
      String(payment.project_letterhead_path || '').trim()
    )
  }

  private async drawReceiptHeader(payment: Payment): Promise<void> {
    const projectName = payment.project_name || 'Barkat'
    const locationParts = [payment.city, payment.state].filter(Boolean) as string[]
    const effectiveLetterheadPath = this.getEffectiveReceiptLetterheadPath(payment)
    const bannerHeight = effectiveLetterheadPath ? 138 : 118
    const bannerTopY = this.layout.currentY + 4
    const bannerBottomY = bannerTopY - bannerHeight
    const brandTealLight = rgb(0.92, 0.97, 0.97)

    let drewLetterhead = false
    if (effectiveLetterheadPath) {
      try {
        const letterheadImage = await this.embedImageFromPath(effectiveLetterheadPath)
        if (letterheadImage) {
          const frameX = this.MARGIN
          const frameY = bannerBottomY + 4
          const frameWidth = this.layout.contentWidth
          const frameHeight = bannerHeight - 2
          const imageAspectRatio = letterheadImage.width / letterheadImage.height
          const frameAspectRatio = frameWidth / frameHeight
          let drawWidth = frameWidth
          let drawHeight = frameHeight

          if (imageAspectRatio > frameAspectRatio) {
            drawHeight = drawWidth / imageAspectRatio
          } else {
            drawWidth = drawHeight * imageAspectRatio
          }

          this.page.drawRectangle({
            x: frameX,
            y: frameY,
            width: frameWidth,
            height: frameHeight,
            color: rgb(1, 1, 1)
          })

          this.page.drawImage(letterheadImage, {
            x: frameX + (frameWidth - drawWidth) / 2,
            y: frameY + (frameHeight - drawHeight) / 2,
            width: drawWidth,
            height: drawHeight
          })

          drewLetterhead = true
        }
      } catch {
        drewLetterhead = false
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

      const projectNameWidth = this.fonts.bold.widthOfTextAtSize(projectName, 18)
      const centerX = (this.layout.width - projectNameWidth) / 2

      this.page.drawText(projectName, {
        x: centerX,
        y: bannerTopY - 34,
        size: 18,
        font: this.fonts.bold,
        color: this.COLORS.SECONDARY
      })

      if (locationParts.length > 0) {
        const locationText = locationParts.join(', ')
        const locationWidth = this.fonts.regular.widthOfTextAtSize(locationText, 10)
        const locationCenterX = (this.layout.width - locationWidth) / 2

        this.page.drawText(locationText, {
          x: locationCenterX,
          y: bannerBottomY + 20,
          size: 8.5,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
      }

      this.page.drawText('Electronic Payment Receipt', {
        x: this.MARGIN + 18,
        y: bannerTopY - 56,
        size: 10,
        font: this.fonts.bold,
        color: this.COLORS.ACCENT
      })
    }

    this.layout.currentY = bannerBottomY - (drewLetterhead ? 10 : 2)

    if (!drewLetterhead && locationParts.length > 0) {
      const locationText = locationParts.join(', ')
      const locationWidth = this.fonts.regular.widthOfTextAtSize(locationText, 8.5)

      this.page.drawRectangle({
        x: this.MARGIN,
        y: this.layout.currentY - 18,
        width: this.layout.contentWidth,
        height: 18,
        color: brandTealLight
      })

      this.page.drawText(locationText, {
        x: this.MARGIN + (this.layout.contentWidth - locationWidth) / 2,
        y: this.layout.currentY - 12,
        size: 8.5,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })

      this.layout.currentY -= 30
    }

    this.layout.currentY -= drewLetterhead ? 20 : 10

    const titleText = 'PAYMENT RECEIPT'
    this.drawCenteredReceiptDivider(titleText, {
      size: 14,
      lineGap: 18,
      lineThickness: 0.9,
      textColor: this.COLORS.TEXT,
      lineColor: this.COLORS.ACCENT
    })
    this.layout.currentY -= 35
  }

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

  private formatReceiptNumber(sequence: number): string {
    return `REC-${sequence}`
  }

  private getNextReceiptSequence(): number {
    const maxAssignedSequence =
      dbService.get<{ max_sequence: number }>(
        `
          SELECT MAX(CAST(SUBSTR(receipt_number, 5) AS INTEGER)) AS max_sequence
          FROM receipts
          WHERE receipt_number GLOB 'REC-[0-9]*'
        `
      )?.max_sequence || 0

    return Math.max(1, maxAssignedSequence + 1)
  }

  public ensureReceiptRecordForPayment({
    paymentId,
    receiptDate,
    receiptNumber,
    snapshot
  }: ReceiptRecordParams): string {
    const normalizedReceiptNumber = receiptNumber?.trim() || null
    const existingReceipt = dbService.get<{ id: number; receipt_number?: string }>(
      'SELECT id, receipt_number FROM receipts WHERE payment_id = ?',
      [paymentId]
    )

    if (existingReceipt?.id) {
      const ensuredReceiptNumber =
        existingReceipt.receipt_number?.trim() ||
        normalizedReceiptNumber ||
        this.formatReceiptNumber(this.getNextReceiptSequence())

      dbService.run(
        `UPDATE receipts
         SET receipt_number = ?,
             receipt_date = ?,
             snapshot_letter_id = ?,
             snapshot_financial_year = ?,
             snapshot_base_amount = ?,
             snapshot_arrears = ?,
             snapshot_discount_amount = ?,
             snapshot_letter_total = ?,
             snapshot_addons_json = ?
         WHERE id = ?`,
        [
          ensuredReceiptNumber,
          receiptDate,
          snapshot.snapshot_letter_id,
          snapshot.snapshot_financial_year,
          snapshot.snapshot_base_amount,
          snapshot.snapshot_arrears,
          snapshot.snapshot_discount_amount,
          snapshot.snapshot_letter_total,
          snapshot.snapshot_addons_json,
          existingReceipt.id
        ]
      )

      return ensuredReceiptNumber
    }

    const insertResult = dbService.run(
      `INSERT INTO receipts (
        payment_id, receipt_number, receipt_date,
        snapshot_letter_id, snapshot_financial_year, snapshot_base_amount,
        snapshot_arrears, snapshot_discount_amount, snapshot_letter_total,
        snapshot_addons_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentId,
        normalizedReceiptNumber,
        receiptDate,
        snapshot.snapshot_letter_id,
        snapshot.snapshot_financial_year,
        snapshot.snapshot_base_amount,
        snapshot.snapshot_arrears,
        snapshot.snapshot_discount_amount,
        snapshot.snapshot_letter_total,
        snapshot.snapshot_addons_json
      ]
    )

    const receiptId = insertResult.lastInsertRowid as number
    const ensuredReceiptNumber =
      normalizedReceiptNumber || this.formatReceiptNumber(this.getNextReceiptSequence())

    if (!normalizedReceiptNumber) {
      dbService.run('UPDATE receipts SET receipt_number = ? WHERE id = ?', [
        ensuredReceiptNumber,
        receiptId
      ])
    }

    return ensuredReceiptNumber
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
            project_letterhead_path?: string
            sector_letterhead_path?: string
          }
      >(
        `SELECT p.*, u.unit_number, u.owner_name, u.contact_number, u.sector_code,
                pr.name as project_name, pr.address, pr.city, pr.state,
                pr.letterhead_path as project_letterhead_path,
                pr.contact_email, pr.contact_phone,
                ps.letterhead_path as sector_letterhead_path,
                r.receipt_number, r.snapshot_letter_id, r.snapshot_financial_year,
                r.snapshot_base_amount, r.snapshot_arrears, r.snapshot_discount_amount,
                r.snapshot_letter_total, r.snapshot_addons_json
         FROM payments p
         JOIN units u ON p.unit_id = u.id
         JOIN projects pr ON p.project_id = pr.id
         LEFT JOIN project_sector_payment_configs ps
           ON ps.project_id = p.project_id
          AND UPPER(TRIM(ps.sector_code)) = UPPER(TRIM(u.sector_code))
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

      payment.receipt_number = this.ensureReceiptRecordForPayment({
        paymentId,
        receiptDate: payment.payment_date,
        receiptNumber: payment.receipt_number,
        snapshot: {
          snapshot_letter_id: payment.snapshot_letter_id ?? fallbackLetter?.id ?? null,
          snapshot_financial_year: receiptSnapshot.financialYear,
          snapshot_base_amount: receiptSnapshot.baseAmount,
          snapshot_arrears: receiptSnapshot.arrearsAmount,
          snapshot_discount_amount: receiptSnapshot.discountAmount,
          snapshot_letter_total: receiptSnapshot.letterTotal,
          snapshot_addons_json: JSON.stringify(receiptSnapshot.addons)
        }
      })

      await this.initializePDF()
      await this.drawReceiptHeader(payment as Payment)

      if (process.env.BARKAT_ENABLE_LEGACY_RECEIPT_LAYOUT === '1' && payment) {
      const legacyPayment = payment as Payment

      // ── Header: Project Name (centered, green) ──
      const projectName = legacyPayment.project_name || 'Barkat'
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
      const rawPayment = legacyPayment as unknown as Record<string, string>
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
      }

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

      const drawWrappedReceiptRow = (label: string, value: string): void => {
        const maxValueWidth = 250
        const words = (value || '-').split(/\s+/).filter(Boolean)
        const lines: string[] = []
        let currentLine = ''

        for (const word of words) {
          const candidate = currentLine ? `${currentLine} ${word}` : word
          const candidateWidth = this.fonts.regular.widthOfTextAtSize(candidate, 11)
          if (candidateWidth <= maxValueWidth || !currentLine) {
            currentLine = candidate
          } else {
            lines.push(currentLine)
            currentLine = word
          }
        }

        if (currentLine) {
          lines.push(currentLine)
        }

        this.page.drawText(label, {
          x: this.MARGIN,
          y: this.layout.currentY,
          size: 11,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })

        const lineHeight = 14
        lines.forEach((line, index) => {
          const lineWidth = this.fonts.regular.widthOfTextAtSize(line, 11)
          this.page.drawText(line, {
            x: this.layout.width - this.MARGIN - lineWidth,
            y: this.layout.currentY - index * lineHeight,
            size: 11,
            font: this.fonts.regular,
            color: this.COLORS.TEXT
          })
        })

        this.layout.currentY -= Math.max(8, lines.length * lineHeight - 6)
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
      const modeLabel =
        payment.payment_mode === 'Transfer' ? 'Bank Transfer / UPI' : payment.payment_mode || '—'
      drawReceiptRow('Payment Mode', modeLabel)
      if (payment.remarks?.trim()) {
        drawWrappedReceiptRow('Remarks', payment.remarks.trim())
      }

      this.layout.currentY -= 8

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
      
      this.layout.currentY -= boxHeight + 18

      // ── Footer ──
      const footerText = 'This is an electronically generated receipt. No signature required.'
      this.drawReceiptFooter(footerText, this.layout.currentY)

      const pdfBytes = await this.pdfDoc.save()
      const pdfDir = path.join(getUserDataPath(), 'receipts')
      if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true })

      const unitIdentifier = payment.unit_number || String(payment.unit_id || 'NA')
      const receiptIdentifier = payment.receipt_number || `REC-${paymentId}`
      const fileName = `Receipt_UnitID-${this.sanitizeFileComponent(unitIdentifier)}_${this.sanitizeFileComponent(receiptIdentifier)}.pdf`
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
    const letterIdsToRecalculate = dbService.transaction(() => {
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
      const previousLetterId = existingPayment.letter_id

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

      const letterIdsToRecalculate = Array.from(
        new Set([previousLetterId, updateData.letter_id].filter((value): value is number => Boolean(value)))
      )
      return letterIdsToRecalculate
    })

    for (const letterId of letterIdsToRecalculate) {
      recalculateLetterPaymentState(letterId)
    }

    return true
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

  public createInternal(payment: Payment): number {
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

    if (payment.payment_status !== 'Pending') {
      this.ensureReceiptRecordForPayment({
        paymentId,
        receiptDate: payment.payment_date,
        receiptNumber: payment.receipt_number,
        snapshot: {
          ...snapshot,
          snapshot_letter_id: linkedLetter?.id ?? snapshot.snapshot_letter_id
        }
      })
    }

    return paymentId
  }

  public create(payment: Payment): number {
    const paymentId = dbService.transaction(() => this.createInternal(payment))
    const createdPayment = this.getById(paymentId)
    if (createdPayment?.letter_id) {
      recalculateLetterPaymentState(createdPayment.letter_id)
    }
    return paymentId
  }

  public createBulk(payments: Payment[]): BulkPaymentResult {
    const results: BulkPaymentResult['results'] = []
    let successful = 0
    let failed = 0

    const bulkResult = dbService.transaction(() => {
      for (let index = 0; index < payments.length; index += 1) {
        try {
          const paymentId = this.createInternal(payments[index])
          results.push({ index, paymentId })
          successful += 1
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          results.push({ index, error: errorMessage })
          failed += 1
        }
      }

      return { successful, failed, results }
    })

    const letterIdsToRecalculate = new Set<number>()
    for (const result of bulkResult.results) {
      if (!result.paymentId) continue
      const createdPayment = this.getById(result.paymentId)
      if (createdPayment?.letter_id) {
        letterIdsToRecalculate.add(createdPayment.letter_id)
      }
    }

    for (const letterId of letterIdsToRecalculate) {
      recalculateLetterPaymentState(letterId)
    }

    return bulkResult
  }

  private deleteInternal(id: number): { deleted: boolean; letterId: number | null } {
    // Internal delete without transaction wrapper for use in bulk operations
    const existingPayment = dbService.get<{ letter_id?: number }>('SELECT letter_id FROM payments WHERE id = ?', [id])
    const result = dbService.run('DELETE FROM payments WHERE id = ?', [id])
    if (result.changes > 0) {
      return {
        deleted: true,
        letterId: existingPayment?.letter_id ?? null
      }
    }
    return {
      deleted: false,
      letterId: null
    }
  }

  public delete(id: number): boolean {
    const result = dbService.transaction(() => this.deleteInternal(id))
    if (result.deleted && result.letterId) {
      recalculateLetterPaymentState(result.letterId)
    }
    return result.deleted
  }

  public bulkDelete(ids: number[]): boolean {
    // Use single transaction for atomic operation - roll back all on any failure
    const deletedLetterIds = dbService.transaction(() => {
      const letterIds = new Set<number>()
      for (const id of ids) {
        const result = this.deleteInternal(id)
        if (!result.deleted) {
          throw new Error(`Failed to delete payment ${id}`)
        }
        if (result.letterId) {
          letterIds.add(result.letterId)
        }
      }
      return Array.from(letterIds)
    })

    for (const letterId of deletedLetterIds) {
      recalculateLetterPaymentState(letterId)
    }

    return true
  }
}

export const paymentService = new PaymentService()



