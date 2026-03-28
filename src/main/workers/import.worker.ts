/**
 * Import Worker - Handles large Excel/CSV imports in background thread
 * Prevents UI blocking during bulk unit/ledger imports
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
    error: error ? { code: 'IMPORT_ERROR', message: error } : undefined
  })
}

interface ImportTask {
  id: string
  type: 'import'
  data: {
    dbPath: string
    projectId: number
    rows: Record<string, unknown>[]
    mode: 'units' | 'ledger' | 'payments'
  }
}

interface WorkerMessage {
  task: ImportTask
}

// Initialize database connection for this worker
function initDatabase(dbPath: string): Database.Database {
  return new Database(dbPath)
}

// Import units from parsed Excel data
async function importUnits(db: Database.Database, projectId: number, rows: Record<string, unknown>[]): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = []
  let imported = 0
  const total = rows.length

  // Prepared statements
  const insertStmt = db.prepare(`
    INSERT INTO units (project_id, unit_number, sector_code, unit_type, area_sqft, owner_name, contact_number, email, billing_address, resident_address, status, penalty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const updateStmt = db.prepare(`
    UPDATE units SET owner_name = ?, area_sqft = ?, unit_type = ?, status = ?, contact_number = ?, email = ?, billing_address = ?, resident_address = ?, sector_code = ?, penalty = ?
    WHERE project_id = ? AND unit_number = ?
  `)

  const checkExistsStmt = db.prepare('SELECT id FROM units WHERE project_id = ? AND unit_number = ?')

  const transaction = db.transaction((rows: Record<string, unknown>[]) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const unitNumber = String(row.unit_number || '').trim()

      if (!unitNumber) {
        errors.push(`Row ${i + 1}: Missing unit_number`)
        continue
      }

      // Check if unit exists
      const existing = checkExistsStmt.get(projectId, unitNumber) as { id: number } | undefined

      const ownerName = String(row.owner_name || 'Unknown').trim()
      const areaSqft = Number(row.area_sqft) || 1000
      const unitType = String(row.unit_type || 'Bungalow').trim()
      const status = String(row.status || 'Sold').trim()
      const contactNumber = String(row.contact_number || '').trim()
      const email = String(row.email || '').trim()
      const billingAddress = String(row.billing_address || '').trim()
      const residentAddress = String(row.resident_address || '').trim()
      const sectorCode = String(row.sector_code || '').trim()
      const penalty = Number(row.penalty) || 0

      if (existing) {
        // Update existing unit
        updateStmt.run(ownerName, areaSqft, unitType, status, contactNumber, email, billingAddress, residentAddress, sectorCode, penalty, projectId, unitNumber)
      } else {
        // Insert new unit
        insertStmt.run(projectId, unitNumber, sectorCode, unitType, areaSqft, ownerName, contactNumber, email, billingAddress, residentAddress, status, penalty)
      }

      imported++

      // Report progress every 50 rows
      if (i % 50 === 0 || i === rows.length - 1) {
        reportProgress(i + 1, total, `Importing units: ${i + 1}/${total}`)
      }
    }
  })

  transaction(rows)
  return { imported, errors }
}

// Main worker message handler
parentPort?.on('message', async (message: WorkerMessage) => {
  const { task } = message

  if (!task || task.type !== 'import') {
    reportComplete(false, undefined, 'Invalid task type')
    return
  }

  const { dbPath, projectId, rows, mode } = task.data

  if (!dbPath || !projectId || !rows || !Array.isArray(rows)) {
    reportComplete(false, undefined, 'Missing required parameters')
    return
  }

  let db: Database.Database | null = null

  try {
    reportProgress(0, rows.length, 'Initializing import...')

    db = initDatabase(dbPath)

    if (mode === 'units') {
      const result = await importUnits(db, projectId, rows)
      reportComplete(true, { imported: result.imported, errors: result.errors })
    } else {
      reportComplete(false, undefined, `Import mode '${mode}' not yet implemented in worker`)
    }
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
