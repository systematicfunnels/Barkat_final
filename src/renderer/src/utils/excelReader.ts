import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'

export interface WorkbookSheetData {
  [sheetName: string]: Record<string, unknown>[]
}

const sheetJsToJson = (worksheet: XLSX.WorkSheet): Record<string, unknown>[] =>
  XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: ''
  })

const excelJsToJson = (worksheet: ExcelJS.Worksheet): Record<string, unknown>[] => {
  const jsonData: Record<string, unknown>[] = []

  const headers: { [key: number]: string } = {}
  const headerUsageCount = new Map<string, number>()
  const headerRow = worksheet.getRow(1)

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const headerText = cell.text ? String(cell.text).trim() : ''
    const baseHeader = headerText || `Column${colNumber}`
    const normalizedHeader = baseHeader.toLowerCase()
    const seenCount = headerUsageCount.get(normalizedHeader) || 0

    headers[colNumber] = seenCount === 0 ? baseHeader : `${baseHeader}_${seenCount}`
    headerUsageCount.set(normalizedHeader, seenCount + 1)
  })

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return

    const rowObject: Record<string, unknown> = {}
    const columnIndices = Object.keys(headers).map(Number)

    columnIndices.forEach((colNumber) => {
      const header = headers[colNumber]
      const cell = row.getCell(colNumber)

      let value: ExcelJS.CellValue = cell.value

      if (value && typeof value === 'object' && 'richText' in value) {
        value = value.richText.map((rt) => rt.text).join('')
      }

      if (value && typeof value === 'object' && 'result' in value) {
        value = (value as ExcelJS.CellFormulaValue).result ?? null
      }

      if (value instanceof Date) {
        value = value.toISOString()
      }

      if (value && typeof value === 'object' && 'hyperlink' in value) {
        value = (value as ExcelJS.CellHyperlinkValue).text || value.hyperlink
      }

      rowObject[header] = value !== null && value !== undefined ? value : ''
    })

    jsonData.push(rowObject)
  })

  return jsonData
}

/**
 * Robustly reads an Excel (.xlsx, .xls) or CSV file and returns its content as an array of objects.
 * Each object represents a row, with keys derived from the first row's headers.
 *
 * @param file The File object from an input or drop event
 * @returns A promise that resolves to an array of record objects
 */
export const readExcelWorkbook = async (file: File): Promise<WorkbookSheetData> => {
  try {
    if (!file) {
      throw new Error('No file provided')
    }

    const fileName = file.name.toLowerCase()
    const isCsv = fileName.endsWith('.csv')
    const isXls = fileName.endsWith('.xls')

    const data = await file.arrayBuffer()

    if (isXls) {
      const workbook = XLSX.read(data, { type: 'array' })
      if (workbook.SheetNames.length === 0) {
        throw new Error('The file is empty or has no worksheets.')
      }

      return Object.fromEntries(
        workbook.SheetNames.map((sheetName) => [
          sheetName,
          sheetJsToJson(workbook.Sheets[sheetName])
        ])
      )
    }

    if (isCsv) {
      const workbook = XLSX.read(data, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) {
        throw new Error('The file is empty or has no worksheets.')
      }

      return {
        [sheetName]: sheetJsToJson(workbook.Sheets[sheetName])
      }
    }

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(data)
    if (workbook.worksheets.length === 0) {
      throw new Error('The file is empty or has no worksheets.')
    }

    return Object.fromEntries(
      workbook.worksheets.map((worksheet) => [worksheet.name, excelJsToJson(worksheet)])
    )
  } catch (error) {
    console.error('Excel Reader Error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read file: ${errorMessage}`)
  }
}

export const readExcelFile = async (file: File): Promise<Record<string, unknown>[]> => {
  const workbook = await readExcelWorkbook(file)
  const [firstSheetName] = Object.keys(workbook)
  if (!firstSheetName) {
    throw new Error('The file is empty or has no worksheets.')
  }
  return workbook[firstSheetName]
}
