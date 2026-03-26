import { PDFDocument, rgb, StandardFonts, RGB } from 'pdf-lib'
import { CONFIG } from '../config/constants'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export interface PDFFont {
  regular: any
  bold: any
  italic?: any
}

export interface PDFLayout {
  width: number
  height: number
  margin: number
  contentWidth: number
  currentY: number
}

export interface PDFColors {
  PRIMARY: RGB
  SECONDARY: RGB
  ACCENT: RGB
  TEXT: RGB
  GRAY: RGB
  LIGHT_GRAY: RGB
  SUCCESS: RGB
  WARNING: RGB
  ERROR: RGB
  BORDER: RGB
  BACKGROUND: RGB
}

/**
 * Base PDF Generator class with standardized layout and styling
 */
export abstract class BasePDFGenerator {
  protected readonly COLORS: PDFColors = {
    PRIMARY: rgb(0.12, 0.32, 0.58), // Improved contrast navy blue
    SECONDARY: rgb(0.85, 0.65, 0.13), // Gold accent
    ACCENT: rgb(0.17, 0.48, 0.37), // Navy alternative
    TEXT: rgb(0.15, 0.15, 0.15), // Darker for better readability
    GRAY: rgb(0.45, 0.45, 0.45), // Better contrast
    LIGHT_GRAY: rgb(0.96, 0.96, 0.96), // Subtle background
    SUCCESS: rgb(0.17, 0.48, 0.37),
    WARNING: rgb(0.75, 0.55, 0.2),
    ERROR: rgb(CONFIG.PDF.COLORS.RED.r, CONFIG.PDF.COLORS.RED.g, CONFIG.PDF.COLORS.RED.b),
    BORDER: rgb(0.82, 0.82, 0.82), // Softer lines
    BACKGROUND: rgb(0.98, 0.98, 0.98) // Cleaner header background
  }

  protected readonly PAGE_SIZE = CONFIG.PDF.PAGE_SIZE
  protected readonly MARGIN = CONFIG.PDF.MARGIN
  protected readonly FONT_SIZES = {
    HEADER: 24, // Increased from 22 for better hierarchy
    SUBHEADER: 11, // Increased from 10
    BODY: 10, // Increased from 9
    FOOTER: 9, // Increased from 8
    SUBJECT: 12 // Increased from 11
  }

  protected layout: PDFLayout
  protected fonts: PDFFont = {} as PDFFont
  protected pdfDoc: PDFDocument = {} as PDFDocument
  protected page: any = null

  constructor() {
    this.layout = this.initializeLayout()
  }

  /**
   * Initialize PDF document and layout
   */
  protected async initializePDF(): Promise<void> {
    this.pdfDoc = await PDFDocument.create()
    this.page = this.pdfDoc.addPage(this.PAGE_SIZE)
    this.layout = this.initializeLayout()
    this.fonts = await this.loadFonts()
  }

  /**
   * Initialize layout dimensions
   */
  private initializeLayout(): PDFLayout {
    const [width, height] = this.PAGE_SIZE
    return {
      width,
      height,
      margin: this.MARGIN,
      contentWidth: width - this.MARGIN * 2,
      currentY: height - this.MARGIN
    }
  }

  /**
   * Load standard fonts
   */
  protected async loadFonts(): Promise<PDFFont> {
    return {
      regular: await this.pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await this.pdfDoc.embedFont(StandardFonts.HelveticaBold),
      italic: await this.pdfDoc.embedFont(StandardFonts.HelveticaOblique)
    }
  }

  /**
   * Draw standardized header
   */
  protected drawHeader(title: string, subtitle?: string): void {
    const { width, currentY } = this.layout

    // Main title centered
    const titleWidth = this.fonts.bold.widthOfTextAtSize(title, this.FONT_SIZES.HEADER)
    this.page.drawText(title, {
      x: (width - titleWidth) / 2,
      y: currentY,
      size: this.FONT_SIZES.HEADER,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    // Subtitle if provided
    if (subtitle) {
      this.layout.currentY -= 18
      this.page.drawText(subtitle, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: this.FONT_SIZES.SUBHEADER,
        font: this.fonts.bold,
        color: this.COLORS.GRAY
      })
    }

    this.layout.currentY -= 25
  }

  /**
   * Draw section header with background
   */
  protected drawSectionHeader(title: string): void {
    const { width, contentWidth } = this.layout

    // Background box
    this.page.drawRectangle({
      x: this.MARGIN,
      y: this.layout.currentY - 22,
      width: contentWidth,
      height: 22,
      color: this.COLORS.BACKGROUND
    })

    // Centered title
    const titleWidth = this.fonts.bold.widthOfTextAtSize(title, this.FONT_SIZES.SUBJECT)
    this.page.drawText(title, {
      x: (width - titleWidth) / 2,
      y: this.layout.currentY - 15,
      size: this.FONT_SIZES.SUBJECT,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 25
  }

  /**
   * Draw table with standardized styling and proper borders
   */
  protected drawTable(headers: string[], rows: string[][]): void {
    const { contentWidth } = this.layout
    
    // Compute column widths dynamically based on header count
    // 2-col (receipt): 40% label / 60% value
    // 3-col: 50% / 25% / 25%
    // 4-col (letter): 50% / 16.67% / 16.67% / 16.67%
    let columnWidths: number[]
    if (headers.length === 2) {
      columnWidths = [contentWidth * 0.4, contentWidth * 0.6]
    } else if (headers.length === 3) {
      columnWidths = [contentWidth * 0.5, contentWidth * 0.25, contentWidth * 0.25]
    } else {
      columnWidths = [
        contentWidth * 0.5,
        contentWidth * 0.1667,
        contentWidth * 0.1667,
        contentWidth * 0.1667
      ]
    }
    
    // Calculate total table height needed
    const calculateRowHeight = (row: string[]): number => {
      const hasLongText = row.some((cell, i) => cell.length > 40 && i === 0)
      return hasLongText ? 40 : 30
    }
    
    const headerHeight = 32
    const totalRowsHeight = rows.reduce((sum, row) => sum + calculateRowHeight(row), 0)
    const totalTableHeight = headerHeight + totalRowsHeight
    
    // Table boundaries
    const tableX = this.MARGIN
    const tableY = this.layout.currentY - totalTableHeight
    const tableWidth = contentWidth
    const tableHeight = totalTableHeight

    // Draw complete table border
    this.page.drawRectangle({
      x: tableX,
      y: tableY,
      width: tableWidth,
      height: tableHeight,
      color: this.COLORS.BORDER,
      borderColor: this.COLORS.BORDER,
      borderWidth: 1.5,
      borderOpacity: 1
    })

    // Draw header background
    this.page.drawRectangle({
      x: tableX,
      y: tableY + tableHeight - headerHeight,
      width: tableWidth,
      height: headerHeight,
      color: this.COLORS.BACKGROUND
    })

    // Draw header text with proper alignment
    let currentX = tableX
    headers.forEach((header, i) => {
      const columnWidth = columnWidths[i]
      const headerWidth = this.fonts.bold.widthOfTextAtSize(header, 10)
      
      // Truncate if too long
      let displayHeader = header
      let actualHeaderWidth = headerWidth
      const maxHeaderWidth = columnWidth - 12 // 6px padding on each side
      
      if (headerWidth > maxHeaderWidth) {
        const avgCharWidth = 5.5
        const maxChars = Math.floor(maxHeaderWidth / avgCharWidth)
        displayHeader = header.substring(0, maxChars - 3) + '...'
        actualHeaderWidth = this.fonts.bold.widthOfTextAtSize(displayHeader, 10)
      }
      
      // Center header within column
      const columnCenter = currentX + (columnWidth / 2)
      const textX = columnCenter - (actualHeaderWidth / 2)
      const textY = tableY + tableHeight - headerHeight + 10
      
      this.page.drawText(displayHeader, {
        x: textX,
        y: textY,
        size: 10,
        font: this.fonts.bold,
        color: this.COLORS.PRIMARY
      })
      
      // Draw vertical separator (except for last column)
      if (i < headers.length - 1) {
        this.page.drawLine({
          start: { x: currentX + columnWidth, y: tableY },
          end: { x: currentX + columnWidth, y: tableY + tableHeight },
          thickness: 1,
          color: this.COLORS.BORDER
        })
      }
      
      currentX += columnWidth
    })

    // Draw data rows
    let currentRowY = tableY + tableHeight - headerHeight
    rows.forEach((row, rowIndex) => {
      const rowHeight = calculateRowHeight(row)
      currentRowY -= rowHeight
      
      // Draw row background (zebra striping)
      if (rowIndex % 2 === 0) {
        this.page.drawRectangle({
          x: tableX + 1, // Inside border
          y: currentRowY + 1,
          width: tableWidth - 2,
          height: rowHeight - 2,
          color: this.COLORS.LIGHT_GRAY
        })
      }
      
      // Draw row data with proper alignment and text wrapping
      let currentX = tableX
      row.forEach((cell, colIndex) => {
        const columnWidth = columnWidths[colIndex]
        const cellY = currentRowY + rowHeight - 18 // Vertical alignment with padding
        
        // Text wrapping logic for particulars column
        if (cell.length > 30 && colIndex === 0) {
          const avgCharWidth = 5.5
          const maxCharsPerLine = Math.floor((columnWidth - 16) / avgCharWidth) // 8px padding each side
          
          const words = cell.split(' ')
          let line1 = ''
          let line2 = ''
          let currentLine = line1
          
          for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word
            
            if (testLine.length <= maxCharsPerLine) {
              currentLine = testLine
            } else {
              if (!line1) {
                line1 = currentLine = word
              } else if (!line2) {
                line2 = word
                currentLine = word
              } else {
                line2 += ' ' + word
              }
            }
          }
          
          if (!line1 && words.length > 0) {
            line1 = words[0]
          }
          
          if (line2 && line2.length > maxCharsPerLine) {
            line2 = line2.substring(0, maxCharsPerLine) + '...'
          }
          
          // Draw first line
          this.page.drawText(line1, {
            x: currentX + 8, // 8px padding from left border
            y: cellY,
            size: 9,
            font: this.fonts.regular,
            color: this.COLORS.TEXT
          })
          
          // Draw second line if exists
          if (line2 && line2.trim()) {
            this.page.drawText(line2, {
              x: currentX + 8, // Same padding
              y: cellY - 16,
              size: 9,
              font: this.fonts.regular,
              color: this.COLORS.TEXT
            })
          }
        } else {
          // Normal text for amount columns
          const textWidth = this.fonts.regular.widthOfTextAtSize(cell, 10)
          let textX
          
          if (colIndex === 0) {
            // Left align particulars
            textX = currentX + 8 // 8px padding from left border
          } else {
            // Right align amount columns
            textX = currentX + columnWidth - textWidth - 8 // 8px padding from right border
          }
          
          this.page.drawText(cell, {
            x: textX,
            y: cellY,
            size: 10,
            font: this.fonts.regular,
            color: this.COLORS.TEXT
          })
        }
        
        currentX += columnWidth
      })
    })

    // Update layout position below table
    this.layout.currentY = tableY - 20 // 20px spacing below table
  }

  /**
   * Draw info grid (2-column layout)
   */
  protected drawInfoGrid(leftColumn: string[], rightColumn: string[]): void {
    leftColumn.forEach((text, i) => {
      this.page.drawText(text, {
        x: this.MARGIN,
        y: this.layout.currentY - i * 14,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })
    })

    rightColumn.forEach((text, i) => {
      this.page.drawText(text, {
        x: this.layout.width - this.MARGIN - 120,
        y: this.layout.currentY - i * 14,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })
    })

    this.layout.currentY -= Math.max(leftColumn.length, rightColumn.length) * 14 + 10
  }

  /**
   * Draw divider line
   */
  protected drawDivider(): void {
    this.page.drawLine({
      start: { x: this.MARGIN, y: this.layout.currentY - 10 },
      end: { x: this.layout.width - this.MARGIN, y: this.layout.currentY - 10 },
      thickness: 1,
      color: this.COLORS.BORDER
    })
    this.layout.currentY -= 20
  }

  /**
   * Draw standardized footer at current position
   */
  protected drawFooter(text: string): void {
    const { width } = this.layout

    // Ensure minimum space before footer
    const minFooterY = 80 // Minimum Y position for footer
    const footerY = Math.min(this.layout.currentY, minFooterY)

    // Footer line
    this.page.drawLine({
      start: { x: this.MARGIN, y: footerY + 15 },
      end: { x: width - this.MARGIN, y: footerY + 15 },
      thickness: 1,
      color: this.COLORS.BORDER
    })

    // Footer text
    this.page.drawText(text, {
      x: this.MARGIN,
      y: footerY,
      size: this.FONT_SIZES.FOOTER,
      font: this.fonts.italic,
      color: this.COLORS.GRAY
    })
  }

  /**
   * Save PDF with standardized naming
   */
  protected async savePDF(fileName: string, directory?: string): Promise<string> {
    const pdfBytes = await this.pdfDoc.save()
    const targetDir = directory || path.join(app.getPath('userData'), 'pdfs')
    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true })
    }
    const fullPath = path.join(targetDir, fileName)
    await fs.promises.writeFile(fullPath, pdfBytes)
    return fullPath
  }

  /**
   * Format currency consistently
   */
  protected formatCurrency(amount: number): string {
    return `Rs.${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  /**
   * Format date consistently
   */
  protected formatDate(date: string | Date): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }
}
