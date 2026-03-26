import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { numberToWordsIndian } from '../utils/numberToWords'
import QRCode from 'qrcode'

export interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  discount?: number
  taxRate?: number
  amount: number
  hsnCode?: string
  sacCode?: string
}

export interface TaxCalculation {
  name: string
  rate: number
  taxableAmount: number
  taxAmount: number
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
}

export interface PaymentSummaryItem {
  label: string
  amount: number
  bold?: boolean
  color?: any
}

export interface PaymentSummary {
  subtotal: number
  totalDiscount: number
  totalTax: number
  totalAmount: number
  amountPaid?: number
  balanceDue: number
  earlyPaymentDiscount?: number
  penaltyAmount?: number
}

export interface ClientInfo {
  name: string
  address: string
  city: string
  state: string
  pincode: string
  gstin?: string
  phone?: string
  email?: string
}

export interface BusinessInfo {
  name: string
  address: string
  city: string
  state: string
  pincode: string
  gstin: string
  phone: string
  email: string
  website?: string
  pan?: string
  logoPath?: string
  bankDetails?: {
    accountName: string
    accountNumber: string
    bankName: string
    ifscCode: string
    branch: string
  }
  upiDetails?: {
    upiId: string
    upiName: string
  }
}

export interface InvoiceTemplate {
  id: string
  name: string
  type: 'zoho_classic' | 'zoho_modern' | 'minimal' | 'detailed'
  primaryColor: string
  secondaryColor: string
  fontFamily: string
  logoPath?: string
  watermark?: string
  showLogo: boolean
  showWatermark: boolean
}

export class InvoiceGenerator {
  private pdfDoc!: PDFDocument
  private page!: any
  private fonts!: any
  private colors!: any
  private layout: {
    width: number
    height: number
    margin: number
    contentWidth: number
    currentY: number
  }

  constructor() {
    this.layout = {
      width: 595,
      height: 842,
      margin: 50,
      contentWidth: 495,
      currentY: 792
    }
  }

  private async initialize() {
    this.pdfDoc = await PDFDocument.create()
    this.page = this.pdfDoc.addPage([595, 842]) // A4 size
    
    // Load fonts
    this.fonts = {
      regular: await this.pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await this.pdfDoc.embedFont(StandardFonts.HelveticaBold),
      italic: await this.pdfDoc.embedFont(StandardFonts.HelveticaOblique)
    }

    this.colors = {
      primary: rgb(0.2, 0.4, 0.8),
      secondary: rgb(0.5, 0.5, 0.5),
      accent: rgb(0.8, 0.3, 0.2),
      light: rgb(0.95, 0.95, 0.95),
      dark: rgb(0.2, 0.2, 0.2),
      success: rgb(0.2, 0.7, 0.2),
      warning: rgb(0.8, 0.6, 0.1)
    }
  }

  /**
   * Generate invoice with complete itemization and calculations
   */
  async generateInvoice(
    invoiceData: {
      invoiceNumber: string
      invoiceDate: string
      dueDate: string
      clientInfo: ClientInfo
      businessInfo: BusinessInfo
      items: InvoiceItem[]
      template: InvoiceTemplate
      notes?: string
      terms?: string
      paymentSummary?: PaymentSummary
    }
  ): Promise<string> {
    // Initialize PDF document
    await this.initialize()

    const { invoiceNumber, invoiceDate, dueDate, clientInfo, businessInfo, items, template, notes, terms } = invoiceData

    // Apply template styling
    this.applyTemplate(template)

    // Draw invoice sections
    await this.drawHeader(businessInfo, invoiceNumber, invoiceDate, dueDate, template)
    this.drawBusinessInfo(businessInfo, template)
    this.drawClientInfo(clientInfo, template)
    this.drawItemizedTable(items, template)
    
    // Calculate taxes and totals
    const taxCalculations = this.calculateTaxes(items)
    const paymentSummary = this.calculatePaymentSummary(items, taxCalculations, invoiceData.paymentSummary)
    
    this.drawTaxSummary(taxCalculations, template)
    this.drawPaymentSummary(paymentSummary, template)
    this.drawAmountInWords(paymentSummary.totalAmount)
    this.drawUPIQRCode(businessInfo, paymentSummary, template)
    
    if (notes) this.drawNotes(notes, template)
    if (terms) this.drawTerms(terms, template)
    
    this.drawFooter(businessInfo, template)

    // Save PDF
    const pdfBytes = await this.pdfDoc.save()
    const pdfDir = path.join(app.getPath('userData'), 'invoices')
    if (!fs.existsSync(pdfDir)) {
      await fs.promises.mkdir(pdfDir, { recursive: true })
    }

    const fileName = `Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
    const filePath = path.join(pdfDir, fileName)
    await fs.promises.writeFile(filePath, pdfBytes)

    return filePath
  }

  /**
   * Apply Zoho Books style template customization
   */
  private applyTemplate(template: InvoiceTemplate): void {
    switch (template.type) {
      case 'zoho_classic':
        this.colors.primary = rgb(0.1, 0.3, 0.6)
        this.colors.secondary = rgb(0.4, 0.4, 0.4)
        this.layout.margin = 60
        break
      case 'zoho_modern':
        this.colors.primary = rgb(0.2, 0.6, 0.8)
        this.colors.accent = rgb(1.0, 0.4, 0.2)
        this.layout.margin = 40
        break
      case 'minimal':
        this.colors.primary = rgb(0.1, 0.1, 0.1)
        this.colors.secondary = rgb(0.6, 0.6, 0.6)
        break
      case 'detailed':
        this.colors.primary = rgb(0.2, 0.4, 0.7)
        this.colors.accent = rgb(0.8, 0.3, 0.1)
        break
    }
  }

  /**
   * Draw invoice header with template styling
   */
  private async drawHeader(businessInfo: BusinessInfo, invoiceNumber: string, invoiceDate: string, dueDate: string, template: InvoiceTemplate): Promise<void> {
    // Logo and business name
    if (template.showLogo && businessInfo.logoPath) {
      try {
        const logoBytes = await fs.promises.readFile(businessInfo.logoPath)
        const logoImage = await this.pdfDoc.embedPng(logoBytes)
        this.page.drawImage(logoImage, {
          x: this.layout.margin,
          y: this.layout.currentY - 40,
          width: 80,
          height: 40
        })
      } catch (error) {
        console.warn('Logo not found, using text instead')
      }
    }

    // Invoice title and number
    this.page.drawText('INVOICE', {
      x: this.layout.width - this.layout.margin - 100,
      y: this.layout.currentY - 30,
      size: 24,
      font: this.fonts.bold,
      color: this.colors.primary
    })

    this.page.drawText(`#${invoiceNumber}`, {
      x: this.layout.width - this.layout.margin - 100,
      y: this.layout.currentY - 50,
      size: 16,
      font: this.fonts.bold,
      color: this.colors.secondary
    })

    this.layout.currentY -= 80

    // Invoice details
    const invoiceDetails = [
      `Invoice Date: ${this.formatDate(invoiceDate)}`,
      `Due Date: ${this.formatDate(dueDate)}`
    ]

    invoiceDetails.forEach((detail, index) => {
      this.page.drawText(detail, {
        x: this.layout.width - this.layout.margin - 150,
        y: this.layout.currentY - index * 15,
        size: 10,
        font: this.fonts.regular,
        color: this.colors.dark
      })
    })

    this.layout.currentY -= 40
  }

  /**
   * Draw business information section
   */
  private drawBusinessInfo(businessInfo: BusinessInfo, _template: InvoiceTemplate): void {
    this.page.drawText('Bill From:', {
      x: this.layout.margin,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.colors.primary
    })

    this.layout.currentY -= 20

    const businessDetails = [
      businessInfo.name,
      businessInfo.address,
      `${businessInfo.city}, ${businessInfo.state} - ${businessInfo.pincode}`,
      `GSTIN: ${businessInfo.gstin}`,
      `Phone: ${businessInfo.phone}`,
      `Email: ${businessInfo.email}`
    ]

    businessDetails.forEach((detail, index) => {
      if (detail) {
        this.page.drawText(detail, {
          x: this.layout.margin,
          y: this.layout.currentY - index * 12,
          size: 9,
          font: this.fonts.regular,
          color: this.colors.dark
        })
      }
    })

    this.layout.currentY -= (businessDetails.filter(d => d).length * 12) + 20
  }

  /**
   * Draw client information section
   */
  private drawClientInfo(clientInfo: ClientInfo, _template: InvoiceTemplate): void {
    this.page.drawText('Bill To:', {
      x: this.layout.margin,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.colors.primary
    })

    this.layout.currentY -= 20

    const clientDetails = [
      clientInfo.name,
      clientInfo.address,
      `${clientInfo.city}, ${clientInfo.state} - ${clientInfo.pincode}`,
      clientInfo.gstin && `GSTIN: ${clientInfo.gstin}`,
      clientInfo.phone && `Phone: ${clientInfo.phone}`,
      clientInfo.email && `Email: ${clientInfo.email}`
    ].filter(Boolean)

    clientDetails.forEach((detail, index) => {
      this.page.drawText(detail, {
        x: this.layout.margin,
        y: this.layout.currentY - index * 12,
        size: 9,
        font: this.fonts.regular,
        color: this.colors.dark
      })
    })

    this.layout.currentY -= (clientDetails.length * 12) + 30
  }

  /**
   * Draw itemized table with detailed calculations
   */
  private drawItemizedTable(items: InvoiceItem[], _template: InvoiceTemplate): void {
    // Table headers
    const headers = ['Item Description', 'HSN/SAC', 'Qty', 'Unit Price', 'Discount', 'Tax %', 'Amount']
    const columnWidths = [200, 60, 40, 60, 50, 40, 85]
    
    // Draw header background
    this.page.drawRectangle({
      x: this.layout.margin,
      y: this.layout.currentY - 25,
      width: this.layout.contentWidth,
      height: 25,
      color: this.colors.primary
    })

    // Draw headers
    headers.forEach((header, index) => {
      const xPos = this.layout.margin + 5 + columnWidths.slice(0, index).reduce((a, b) => a + b, 0)
      this.page.drawText(header, {
        x: xPos,
        y: this.layout.currentY - 16,
        size: 9,
        font: this.fonts.bold,
        color: rgb(1, 1, 1)
      })
    })

    this.layout.currentY -= 25

    // Draw items with alternating row colors
    items.forEach((item, index) => {
      // Row background for alternating colors
      if (index % 2 === 0) {
        this.page.drawRectangle({
          x: this.layout.margin,
          y: this.layout.currentY - 20,
          width: this.layout.contentWidth,
          height: 20,
          color: this.colors.light
        })
      }

      const row = [
        item.description,
        item.hsnCode || item.sacCode || '-',
        item.quantity.toString(),
        `₹${item.unitPrice.toFixed(2)}`,
        item.discount ? `${item.discount}%` : '-',
        item.taxRate ? `${item.taxRate}%` : '-',
        `₹${item.amount.toFixed(2)}`
      ]

      row.forEach((cell, cellIndex) => {
        const xPos = this.layout.margin + 5 + columnWidths.slice(0, cellIndex).reduce((a, b) => a + b, 0)
        this.page.drawText(cell, {
          x: xPos,
          y: this.layout.currentY - 12,
          size: 8,
          font: this.fonts.regular,
          color: this.colors.dark
        })
      })

      this.layout.currentY -= 20
    })

    // Table border
    this.page.drawRectangle({
      x: this.layout.margin,
      y: this.layout.currentY - (items.length * 20),
      width: this.layout.contentWidth,
      height: (items.length * 20) + 25,
      borderColor: this.colors.secondary,
      borderWidth: 1
    })

    this.layout.currentY -= 20
  }

  /**
   * Calculate taxes with GST breakdown
   */
  private calculateTaxes(items: InvoiceItem[]): TaxCalculation[] {
    const taxGroups: { [key: number]: { taxableAmount: number; taxAmount: number } } = {}

    items.forEach(item => {
      if (item.taxRate) {
        const taxableAmount = item.amount - (item.amount * (item.discount || 0) / 100)
        const taxAmount = taxableAmount * (item.taxRate / 100)
        
        if (!taxGroups[item.taxRate]) {
          taxGroups[item.taxRate] = { taxableAmount: 0, taxAmount: 0 }
        }
        
        taxGroups[item.taxRate].taxableAmount += taxableAmount
        taxGroups[item.taxRate].taxAmount += taxAmount
      }
    })

    return Object.entries(taxGroups).map(([rate, data]) => ({
      name: `GST @ ${rate}%`,
      rate: parseFloat(rate),
      taxableAmount: data.taxableAmount,
      taxAmount: data.taxAmount,
      cgstAmount: data.taxAmount / 2,
      sgstAmount: data.taxAmount / 2,
      igstAmount: data.taxAmount // For inter-state supplies
    }))
  }

  /**
   * Calculate payment summary with discounts and penalties
   */
  private calculatePaymentSummary(items: InvoiceItem[], taxes: TaxCalculation[], customSummary?: PaymentSummary): PaymentSummary {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0)
    const totalTax = taxes.reduce((sum, tax) => sum + tax.taxAmount, 0)
    const totalDiscount = items.reduce((sum, item) => sum + (item.amount * (item.discount || 0) / 100), 0)
    
    const totalAmount = subtotal + totalTax - totalDiscount

    return {
      subtotal,
      totalDiscount,
      totalTax,
      totalAmount,
      amountPaid: customSummary?.amountPaid || 0,
      balanceDue: totalAmount - (customSummary?.amountPaid || 0),
      earlyPaymentDiscount: customSummary?.earlyPaymentDiscount,
      penaltyAmount: customSummary?.penaltyAmount
    }
  }

  /**
   * Draw tax summary section
   */
  private drawTaxSummary(taxes: TaxCalculation[], _template: InvoiceTemplate): void {
    this.page.drawText('Tax Summary:', {
      x: this.layout.margin,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.colors.primary
    })

    this.layout.currentY -= 25

    taxes.forEach((tax, index) => {
      const taxText = tax.igstAmount 
        ? `IGST @ ${tax.rate}%: ₹${tax.igstAmount.toFixed(2)}`
        : `CGST @ ${tax.rate/2}%: ₹${(tax.cgstAmount || 0).toFixed(2)} | SGST @ ${tax.rate/2}%: ₹${(tax.sgstAmount || 0).toFixed(2)}`
      
      this.page.drawText(taxText, {
        x: this.layout.margin,
        y: this.layout.currentY - index * 15,
        size: 9,
        font: this.fonts.regular,
        color: this.colors.dark
      })
    })

    this.layout.currentY -= (taxes.length * 15) + 20
  }

  /**
   * Draw payment summary section
   */
  private drawPaymentSummary(summary: PaymentSummary, _template: InvoiceTemplate): void {
    const startX = this.layout.width - this.layout.margin - 200

    this.page.drawText('Payment Summary:', {
      x: startX,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.colors.primary
    })

    this.layout.currentY -= 25

    const summaryItems: PaymentSummaryItem[] = [
      { label: 'Subtotal:', amount: summary.subtotal },
      { label: 'Total Discount:', amount: -summary.totalDiscount },
      { label: 'Total Tax:', amount: summary.totalTax },
      { label: 'Total Amount:', amount: summary.totalAmount, bold: true }
    ]

    if (summary.earlyPaymentDiscount) {
      summaryItems.push(
        { label: 'Early Payment Discount:', amount: -summary.earlyPaymentDiscount }
      )
    }

    if (summary.penaltyAmount) {
      summaryItems.push(
        { label: 'Late Payment Penalty:', amount: summary.penaltyAmount }
      )
    }

    if (summary.amountPaid) {
      summaryItems.push(
        { label: 'Amount Paid:', amount: -summary.amountPaid }
      )
    }

    summaryItems.push(
      { label: 'Balance Due:', amount: summary.balanceDue, bold: true, color: this.colors.accent }
    )

    summaryItems.forEach((item, index) => {
      this.page.drawText(item.label, {
        x: startX,
        y: this.layout.currentY - index * 15,
        size: 9,
        font: item.bold ? this.fonts.bold : this.fonts.regular,
        color: item.color || this.colors.dark
      })

      this.page.drawText(`₹${Math.abs(item.amount).toFixed(2)}`, {
        x: this.layout.width - this.layout.margin - 50,
        y: this.layout.currentY - index * 15,
        size: 9,
        font: item.bold ? this.fonts.bold : this.fonts.regular,
        color: item.color || this.colors.dark
      })
    })

    this.layout.currentY -= (summaryItems.length * 15) + 30
  }

  /**
   * Draw amount in words
   */
  private drawAmountInWords(amount: number): void {
    const words = numberToWordsIndian(amount)
    this.page.drawText(`Amount in words: Rupees ${words} Only`, {
      x: this.layout.margin,
      y: this.layout.currentY,
      size: 9,
      font: this.fonts.italic,
      color: this.colors.secondary
    })
    this.layout.currentY -= 25
  }

  /**
   * Generate and draw UPI QR code
   */
  private async drawUPIQRCode(businessInfo: BusinessInfo, summary: PaymentSummary, _template: InvoiceTemplate): Promise<void> {
    if (!businessInfo.upiDetails?.upiId) return

    // Generate UPI payment string
    const upiString = `upi://pay?pa=${businessInfo.upiDetails.upiId}&pn=${encodeURIComponent(businessInfo.upiDetails.upiName)}&am=${summary.balanceDue}&cu=INR`

    try {
      // Generate QR code
      const qrCodeDataUrl = await QRCode.toDataURL(upiString, {
        width: 200,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })

      // Convert data URL to bytes
      const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '')
      const qrCodeBytes = Buffer.from(base64Data, 'base64')

      const qrImage = await this.pdfDoc.embedPng(qrCodeBytes)

      this.page.drawText('Scan to Pay via UPI:', {
        x: this.layout.margin,
        y: this.layout.currentY,
        size: 10,
        font: this.fonts.bold,
        color: this.colors.primary
      })

      this.page.drawImage(qrImage, {
        x: this.layout.margin,
        y: this.layout.currentY - 120,
        width: 100,
        height: 100
      })

      this.page.drawText(`UPI ID: ${businessInfo.upiDetails.upiId}`, {
        x: this.layout.margin,
        y: this.layout.currentY - 130,
        size: 8,
        font: this.fonts.regular,
        color: this.colors.dark
      })

      this.page.drawText(`Amount: ₹${summary.balanceDue.toFixed(2)}`, {
        x: this.layout.margin,
        y: this.layout.currentY - 145,
        size: 8,
        font: this.fonts.bold,
        color: this.colors.accent
      })

    } catch (error) {
      console.error('Error generating UPI QR code:', error)
      this.page.drawText('UPI QR Code unavailable', {
        x: this.layout.margin,
        y: this.layout.currentY,
        size: 8,
        font: this.fonts.italic,
        color: this.colors.secondary
      })
    }

    this.layout.currentY -= 160
  }

  /**
   * Draw notes section
   */
  private drawNotes(notes: string, _template: InvoiceTemplate): void {
    this.page.drawText('Notes:', {
      x: this.layout.margin,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.colors.primary
    })

    this.layout.currentY -= 20

    // Wrap long notes
    const lines = this.wrapText(notes, 80)
    lines.forEach((line, index) => {
      this.page.drawText(line, {
        x: this.layout.margin,
        y: this.layout.currentY - index * 12,
        size: 9,
        font: this.fonts.regular,
        color: this.colors.dark
      })
    })

    this.layout.currentY -= (lines.length * 12) + 20
  }

  /**
   * Draw terms section
   */
  private drawTerms(terms: string, _template: InvoiceTemplate): void {
    this.page.drawText('Terms & Conditions:', {
      x: this.layout.margin,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.colors.primary
    })

    this.layout.currentY -= 20

    const lines = this.wrapText(terms, 80)
    lines.forEach((line, index) => {
      this.page.drawText(line, {
        x: this.layout.margin,
        y: this.layout.currentY - index * 12,
        size: 9,
        font: this.fonts.regular,
        color: this.colors.dark
      })
    })

    this.layout.currentY -= (lines.length * 12) + 20
  }

  /**
   * Draw footer with business info
   */
  private drawFooter(businessInfo: BusinessInfo, _template: InvoiceTemplate): void {
    // Footer separator
    this.drawLine({
      start: { x: this.layout.margin, y: this.layout.currentY },
      end: { x: this.layout.width - this.layout.margin, y: this.layout.currentY },
      thickness: 1,
      color: this.colors.secondary
    })

    this.layout.currentY -= 30

    // Business details in footer
    const footerInfo = [
      businessInfo.name,
      `GSTIN: ${businessInfo.gstin}`,
      businessInfo.email,
      businessInfo.phone,
      businessInfo.website
    ].filter(Boolean)

    footerInfo.forEach((info, index) => {
      this.page.drawText(info, {
        x: this.layout.margin,
        y: this.layout.currentY - index * 10,
        size: 8,
        font: this.fonts.regular,
        color: this.colors.secondary
      })
    })

    // Page number
    this.page.drawText('Page 1 of 1', {
      x: this.layout.width - this.layout.margin - 50,
      y: 30,
      size: 8,
      font: this.fonts.regular,
      color: this.colors.secondary
    })
  }

  /**
   * Helper methods
   */
  private formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''

    words.forEach(word => {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      if (testLine.length <= maxWidth) {
        currentLine = testLine
      } else {
        if (currentLine) lines.push(currentLine)
        currentLine = word
      }
    })

    if (currentLine) lines.push(currentLine)
    return lines
  }

  private drawLine(options: { start: { x: number; y: number }; end: { x: number; y: number }; thickness: number; color: any }): void {
    this.page.drawLine({
      start: options.start,
      end: options.end,
      thickness: options.thickness,
      color: options.color
    })
  }
}

export default InvoiceGenerator
