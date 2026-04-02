/**
 * Report Export Worker - Builds Excel reports off the renderer thread
 */

import { parentPort } from 'worker_threads'
import fs from 'fs/promises'
import ExcelJS from 'exceljs'

function reportProgress(current: number, total: number, message: string): void {
  parentPort?.postMessage({
    type: 'progress',
    current,
    total,
    percentage: Math.round((current / total) * 100),
    message
  })
}

function reportComplete(success: boolean, data?: unknown, error?: string): void {
  parentPort?.postMessage({
    success,
    result: data,
    error: error ? { code: 'REPORT_EXPORT_ERROR', message: error } : undefined
  })
}

interface YearlyTotal {
  year: string
  billed: number
  paid: number
  balance: number
  unitCount: number
}

interface WorkerRowYearData {
  billed?: number
  paid?: number
  balance?: number
}

interface WorkerRow {
  project_name: string
  unit_number: string
  owner_name: string
  unit_type: string
  unit_status: string
  total_billed: number
  total_paid: number
  outstanding: number
  [year: string]: string | number | WorkerRowYearData
}

interface ReportExportTask {
  id: string
  type: 'report-export'
  data: {
    savePath: string
    rows: WorkerRow[]
    years: string[]
    yearlyTotals: YearlyTotal[]
    stats: {
      totalBilled: number
      totalCollected: number
      outstanding: number
    }
    selectedProjectName?: string
    hasActiveFilters: boolean
    selectedUnitType?: string | null
    selectedStatus?: string | null
    searchText?: string
    outstandingRange?: [number | null, number | null]
    generatedAt: string
  }
}

interface WorkerMessage {
  task: ReportExportTask
}

parentPort?.on('message', async (message: WorkerMessage) => {
  const { task } = message

  if (!task || task.type !== 'report-export') {
    reportComplete(false, undefined, 'Invalid task type')
    return
  }

  const {
    savePath,
    rows,
    years,
    yearlyTotals,
    stats,
    selectedProjectName,
    hasActiveFilters,
    selectedUnitType,
    selectedStatus,
    searchText,
    outstandingRange,
    generatedAt
  } = task.data

  if (!savePath || !Array.isArray(rows) || !Array.isArray(years) || !Array.isArray(yearlyTotals)) {
    reportComplete(false, undefined, 'Missing required export parameters')
    return
  }

  try {
    reportProgress(0, 100, 'Preparing workbook...')

    const workbook = new ExcelJS.Workbook()
    const worksheetName = hasActiveFilters ? 'Filtered Financial Report' : 'Financial Report'
    const worksheet = workbook.addWorksheet(worksheetName)
    const summarySheet = workbook.addWorksheet('Yearly Summary')

    summarySheet.columns = [
      { header: 'Financial Year', key: 'year', width: 20 },
      { header: 'Units Billed', key: 'unitCount', width: 15 },
      { header: 'Total Billed', key: 'billed', width: 15 },
      { header: 'Total Collected', key: 'paid', width: 15 },
      { header: 'Outstanding', key: 'balance', width: 15 },
      { header: 'Collection %', key: 'collectionRate', width: 15 }
    ]

    for (const total of yearlyTotals) {
      const collectionRate = total.billed > 0 ? (total.paid / total.billed) * 100 : 0
      summarySheet.addRow({
        year: total.year,
        unitCount: total.unitCount,
        billed: total.billed,
        paid: total.paid,
        balance: total.balance,
        collectionRate: `${collectionRate.toFixed(1)}%`
      })
    }

    summarySheet.addRow({})
    const totalRow = summarySheet.addRow({
      year: 'GRAND TOTAL',
      unitCount: yearlyTotals.reduce((sum, item) => sum + item.unitCount, 0),
      billed: yearlyTotals.reduce((sum, item) => sum + item.billed, 0),
      paid: yearlyTotals.reduce((sum, item) => sum + item.paid, 0),
      balance: yearlyTotals.reduce((sum, item) => sum + item.balance, 0),
      collectionRate: `${stats.totalBilled > 0 ? ((stats.totalCollected / stats.totalBilled) * 100).toFixed(1) : '0.0'}%`
    })
    totalRow.font = { bold: true }
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    }

    const columns: Array<{ header: string; key: string; width: number }> = [
      { header: 'Project', key: 'Project', width: 20 },
      { header: 'Unit', key: 'Unit', width: 15 },
      { header: 'Owner', key: 'Owner', width: 25 },
      { header: 'Type', key: 'Type', width: 10 },
      { header: 'Status', key: 'Status', width: 10 }
    ]

    for (const year of years) {
      columns.push({ header: `${year} - Billed`, key: `${year}_Billed`, width: 15 })
      columns.push({ header: `${year} - Paid`, key: `${year}_Paid`, width: 15 })
      columns.push({ header: `${year} - Balance`, key: `${year}_Balance`, width: 15 })
    }

    columns.push({ header: 'Total Billed', key: 'Total_Billed', width: 15 })
    columns.push({ header: 'Total Paid', key: 'Total_Paid', width: 15 })
    columns.push({ header: 'Total Outstanding', key: 'Total_Outstanding', width: 15 })
    worksheet.columns = columns

    const filterSummaryRows: string[][] = []
    if (hasActiveFilters) {
      filterSummaryRows.push(['FILTERED FINANCIAL REPORT'])
      filterSummaryRows.push([`Generated: ${generatedAt}`])
      if (selectedProjectName) filterSummaryRows.push([`Project: ${selectedProjectName}`])
      if (selectedUnitType) filterSummaryRows.push([`Unit Type: ${selectedUnitType}`])
      if (selectedStatus) filterSummaryRows.push([`Status: ${selectedStatus}`])
      if (searchText) filterSummaryRows.push([`Search: "${searchText}"`])
      if (outstandingRange?.[0] !== null || outstandingRange?.[1] !== null) {
        filterSummaryRows.push([
          `Outstanding Range: ${outstandingRange?.[0] !== null ? `Rs. ${outstandingRange?.[0]}` : 'Any'} - ${outstandingRange?.[1] !== null ? `Rs. ${outstandingRange?.[1]}` : 'Any'}`
        ])
      }
      filterSummaryRows.push([''])
    }

    if (filterSummaryRows.length > 0) {
      worksheet.insertRows(1, filterSummaryRows)
    }

    reportProgress(10, 100, 'Writing report rows...')

    rows.forEach((row, index) => {
      const exportRow: Record<string, string | number> = {
        Project: row.project_name,
        Unit: row.unit_number,
        Owner: row.owner_name,
        Type: row.unit_type,
        Status: row.unit_status,
        Total_Billed: row.total_billed,
        Total_Paid: row.total_paid,
        Total_Outstanding: row.outstanding
      }

      for (const year of years) {
        const yearData = row[year] as WorkerRowYearData | undefined
        exportRow[`${year}_Billed`] = yearData?.billed || 0
        exportRow[`${year}_Paid`] = yearData?.paid || 0
        exportRow[`${year}_Balance`] = yearData?.balance || 0
      }

      worksheet.addRow(exportRow)

      if (index % 100 === 0 || index === rows.length - 1) {
        reportProgress(10 + Math.round(((index + 1) / Math.max(rows.length, 1)) * 70), 100, `Writing rows: ${index + 1}/${rows.length}`)
      }
    })

    const summaryRow = worksheet.addRow({})
    summaryRow.getCell('Project').value = 'GRAND TOTAL'
    summaryRow.getCell('Project').font = { bold: true }

    for (const year of years) {
      const total = yearlyTotals.find((item) => item.year === year)
      summaryRow.getCell(`${year}_Billed`).value = total?.billed || 0
      summaryRow.getCell(`${year}_Paid`).value = total?.paid || 0
      summaryRow.getCell(`${year}_Balance`).value = total?.balance || 0
      summaryRow.getCell(`${year}_Billed`).font = { bold: true }
      summaryRow.getCell(`${year}_Paid`).font = { bold: true }
      summaryRow.getCell(`${year}_Balance`).font = { bold: true }
    }

    summaryRow.getCell('Total_Billed').value = stats.totalBilled
    summaryRow.getCell('Total_Paid').value = stats.totalCollected
    summaryRow.getCell('Total_Outstanding').value = stats.outstanding
    summaryRow.getCell('Total_Billed').font = { bold: true }
    summaryRow.getCell('Total_Paid').font = { bold: true }
    summaryRow.getCell('Total_Outstanding').font = { bold: true }

    const headerRowNumber = filterSummaryRows.length + 1
    worksheet.getRow(headerRowNumber).font = { bold: true }
    worksheet.getRow(headerRowNumber).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    }

    summarySheet.getRow(1).font = { bold: true }
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    }

    reportProgress(90, 100, 'Saving workbook...')
    const buffer = await workbook.xlsx.writeBuffer()
    await fs.writeFile(savePath, Buffer.from(buffer))

    reportProgress(100, 100, 'Export completed')
    reportComplete(true, { savePath })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reportComplete(false, undefined, message)
  }
})
