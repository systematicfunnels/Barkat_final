/**
 * PDF Worker - Handles batch PDF generation in background thread
 * Prevents UI blocking during bulk PDF letter/receipt generation
 */

import { parentPort } from 'worker_threads'
import Database from 'better-sqlite3'

// Progress reporting helper
function reportProgress(current: number, total: number, message: string): void {
  parentPort?.postMessage({
    type: 'progress',
    current,
    total,
    percentage: Math.round((current / total) * 100),
    message
  })
}

// Task completion helper
function reportComplete(success: boolean, data?: unknown, error?: string): void {
  parentPort?.postMessage({
    success,
    result: data,
    error: error ? { code: 'PDF_ERROR', message: error } : undefined
  })
}

interface PDFTask {
  id: string
  type: 'batch-pdf'
  data: {
    dbPath: string
    mode: 'letters' | 'receipts'
    letterIds?: number[]
    paymentIds?: number[]
    outputDir: string
  }
}

interface WorkerMessage {
  task: PDFTask
}

// Initialize database connection for this worker
function initDatabase(dbPath: string): Database.Database {
  return new Database(dbPath)
}

// Generate PDF for a single letter (placeholder - actual PDF generation would use pdf-lib)
async function generateLetterPDF(
  db: Database.Database,
  letterId: number,
  outputDir: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    // Get letter details
    const letter = db.prepare(`
      SELECT l.*, u.unit_number, u.owner_name, u.area_sqft, u.contact_number, u.email,
             p.name as project_name, p.address, p.city, p.state, p.contact_email, p.contact_phone
      FROM maintenance_letters l
      JOIN units u ON l.unit_id = u.id
      JOIN projects p ON l.project_id = p.id
      WHERE l.id = ?
    `).get(letterId) as Record<string, unknown> | undefined

    if (!letter) {
      return { success: false, error: `Letter ${letterId} not found` }
    }

    // In a real implementation, this would generate an actual PDF using pdf-lib
    // For now, we return a placeholder result
    const fileName = `letter_${letterId}_${Date.now()}.pdf`
    const filePath = `${outputDir}/${fileName}`

    // Simulate PDF generation delay
    await new Promise(resolve => setTimeout(resolve, 50))

    return { success: true, filePath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

// Generate PDF for a single receipt (placeholder - actual PDF generation would use pdf-lib)
async function generateReceiptPDF(
  db: Database.Database,
  paymentId: number,
  outputDir: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    // Get payment details
    const payment = db.prepare(`
      SELECT p.*, u.unit_number, u.owner_name, u.contact_number, u.sector_code,
             pr.name as project_name, pr.address, pr.city, pr.state,
             pr.contact_email, pr.contact_phone, r.receipt_number
      FROM payments p
      JOIN units u ON p.unit_id = u.id
      JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      WHERE p.id = ?
    `).get(paymentId) as Record<string, unknown> | undefined

    if (!payment) {
      return { success: false, error: `Payment ${paymentId} not found` }
    }

    // In a real implementation, this would generate an actual PDF using pdf-lib
    // For now, we return a placeholder result
    const fileName = `receipt_${paymentId}_${Date.now()}.pdf`
    const filePath = `${outputDir}/${fileName}`

    // Simulate PDF generation delay
    await new Promise(resolve => setTimeout(resolve, 50))

    return { success: true, filePath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

// Batch generate PDFs
async function batchGeneratePDFs(
  db: Database.Database,
  mode: 'letters' | 'receipts',
  ids: number[],
  outputDir: string
): Promise<{ generated: number; failed: number; files: string[]; errors: string[] }> {
  const errors: string[] = []
  const files: string[] = []
  let generated = 0
  let failed = 0
  const total = ids.length

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]

    try {
      let result: { success: boolean; filePath?: string; error?: string }

      if (mode === 'letters') {
        result = await generateLetterPDF(db, id, outputDir)
      } else {
        result = await generateReceiptPDF(db, id, outputDir)
      }

      if (result.success && result.filePath) {
        files.push(result.filePath)
        generated++
      } else {
        errors.push(result.error || `Failed to generate PDF for ID ${id}`)
        failed++
      }

      // Report progress every 10 PDFs
      if (i % 10 === 0 || i === ids.length - 1) {
        reportProgress(i + 1, total, `Generating PDFs: ${i + 1}/${total} (${mode})`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`Error processing ID ${id}: ${message}`)
      failed++
    }
  }

  return { generated, failed, files, errors }
}

// Main worker message handler
parentPort?.on('message', async (message: WorkerMessage) => {
  const { task } = message

  if (!task || task.type !== 'batch-pdf') {
    reportComplete(false, undefined, 'Invalid task type')
    return
  }

  const { dbPath, mode, letterIds, paymentIds, outputDir } = task.data

  if (!dbPath || !mode || !outputDir) {
    reportComplete(false, undefined, 'Missing required parameters')
    return
  }

  const ids = mode === 'letters' ? letterIds : paymentIds
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    reportComplete(false, undefined, `No ${mode} IDs provided`)
    return
  }

  let db: Database.Database | null = null

  try {
    reportProgress(0, ids.length, `Initializing ${mode} PDF generation...`)

    db = initDatabase(dbPath)

    const result = await batchGeneratePDFs(db, mode, ids, outputDir)
    reportComplete(true, {
      generated: result.generated,
      failed: result.failed,
      files: result.files,
      errors: result.errors
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reportComplete(false, undefined, message)
  } finally {
    if (db) {
      try {
        db.close()
      } catch {
        // Ignore close errors
      }
    }
  }
})
