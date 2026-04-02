/**
 * PDF Worker - Handles batch PDF generation in background thread
 * Uses the real maintenance letter / receipt services so output stays identical.
 */

import { parentPort } from 'worker_threads'

type PdfMode = 'letters' | 'receipts'

interface PDFTask {
  id: string
  type: 'batch-pdf'
  data: {
    dbPath?: string
    mode: PdfMode
    letterIds?: number[]
    paymentIds?: number[]
  }
}

interface WorkerMessage {
  task: PDFTask
}

type ItemProgress = {
  id: number
  path: string
  success: boolean
  unit_number: string
  owner_name: string
}

type ProgressPayload = {
  currentItem?: ItemProgress
}

function reportProgress(
  current: number,
  total: number,
  message: string,
  data?: ProgressPayload
): void {
  parentPort?.postMessage({
    type: 'progress',
    current,
    total,
    percentage: total > 0 ? Math.round((current / total) * 100) : 0,
    message,
    data
  })
}

function reportComplete(success: boolean, data?: unknown, error?: string): void {
  parentPort?.postMessage({
    success,
    result: data,
    error: error ? { code: 'PDF_ERROR', message: error } : undefined
  })
}

async function loadServices(dbPath?: string): Promise<{
  maintenanceLetterService: { generatePdf: (id: number) => Promise<string> }
  paymentService: { generateReceiptPdf: (id: number) => Promise<string> }
  dbService: {
    get<T>(sql: string, params?: unknown[]): T | undefined
  }
}> {
  if (dbPath) {
    process.env.BARKAT_DB_PATH = dbPath
  }

  const [{ maintenanceLetterService }, { paymentService }, { dbService }] = await Promise.all([
    import('../services/MaintenanceLetterService'),
    import('../services/PaymentService'),
    import('../db/database')
  ])

  return { maintenanceLetterService, paymentService, dbService }
}

function getItemInfo(
  mode: PdfMode,
  id: number,
  dbService: {
    get<T>(sql: string, params?: unknown[]): T | undefined
  }
): { unit_number: string; owner_name: string } {
  if (mode === 'letters') {
    const letter = dbService.get<{ unit_number?: string; owner_name?: string }>(
      `SELECT u.unit_number, u.owner_name
       FROM maintenance_letters l
       JOIN units u ON l.unit_id = u.id
       WHERE l.id = ?`,
      [id]
    )

    return {
      unit_number: letter?.unit_number || `Unit ${id}`,
      owner_name: letter?.owner_name || 'Unknown'
    }
  }

  const payment = dbService.get<{ unit_number?: string; owner_name?: string }>(
    `SELECT u.unit_number, u.owner_name
     FROM payments p
     JOIN units u ON p.unit_id = u.id
     WHERE p.id = ?`,
    [id]
  )

  return {
    unit_number: payment?.unit_number || `Unit ${id}`,
    owner_name: payment?.owner_name || 'Unknown'
  }
}

async function batchGeneratePDFs(task: PDFTask): Promise<void> {
  const { dbPath, mode, letterIds, paymentIds } = task.data
  const ids = mode === 'letters' ? letterIds : paymentIds

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    reportComplete(false, undefined, `No ${mode} IDs provided`)
    return
  }

  const { maintenanceLetterService, paymentService, dbService } = await loadServices(dbPath)
  const total = ids.length
  const files: string[] = []
  const errors: string[] = []
  let generated = 0
  let failed = 0

  reportProgress(0, total, `Preparing ${mode} PDF generation...`)

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]
    const info = getItemInfo(mode, id, dbService)

    try {
      const path =
        mode === 'letters'
          ? await maintenanceLetterService.generatePdf(id)
          : await paymentService.generateReceiptPdf(id)

      generated += 1
      files.push(path)

      reportProgress(index + 1, total, `Generated ${index + 1} of ${total} ${mode}`, {
        currentItem: {
          id,
          path,
          success: true,
          unit_number: info.unit_number,
          owner_name: info.owner_name
        }
      })
    } catch (error) {
      failed += 1
      errors.push(error instanceof Error ? error.message : String(error))

      reportProgress(index + 1, total, `Generated ${index + 1} of ${total} ${mode}`, {
        currentItem: {
          id,
          path: '',
          success: false,
          unit_number: info.unit_number,
          owner_name: info.owner_name
        }
      })
    }
  }

  reportComplete(true, {
    generated,
    failed,
    files,
    errors
  })
}

parentPort?.on('message', async (message: WorkerMessage) => {
  const { task } = message

  if (!task || task.type !== 'batch-pdf') {
    reportComplete(false, undefined, 'Invalid task type')
    return
  }

  try {
    await batchGeneratePDFs(task)
  } catch (error) {
    reportComplete(false, undefined, error instanceof Error ? error.message : String(error))
  }
})
