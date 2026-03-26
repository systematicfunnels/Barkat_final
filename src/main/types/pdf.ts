export interface PDFFont {
  regular: any
  bold: any
  italic: any
}

export interface PDFPage {
  drawText: (
    text: string,
    options: {
      x: number
      y: number
      size: number
      font: any
      color?: any
    }
  ) => void
  drawRectangle: (options: {
    x: number
    y: number
    width: number
    height: number
    color: any
  }) => void
  drawLine: (options: {
    start: { x: number; y: number }
    end: { x: number; y: number }
    thickness: number
    color: any
  }) => void
  drawImage: (
    image: any,
    options: {
      x: number
      y: number
      width: number
      height: number
    }
  ) => void
  getSize: () => { width: number; height: number }
}

export interface PDFDocument {
  addPage: (size?: [number, number]) => PDFPage
  embedFont: (font: any) => Promise<any>
  embedPng: (bytes: Uint8Array) => Promise<any>
  save: () => Promise<Uint8Array>
}

export interface LetterCalculationData {
  id: number
  financial_year: string
  base_amount: number
  unit_number: string
  owner_name: string
  sector_code: string
  area_sqft: number
  project_name: string
  due_date: string
  generated_date: string
  account_name: string
  account_no: string
  ifsc_code: string
  bank_name: string
  branch: string
  branch_address: string
  qr_code_path?: string
}

export interface AddOnData {
  id: number
  letter_id: number
  addon_name: string
  addon_amount: number
}
