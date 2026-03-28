/**
 * Billing Worker - Handles batch letter generation in background thread
 * Prevents UI blocking during bulk maintenance letter generation
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
    error: error ? { code: 'BILLING_ERROR', message: error } : undefined
  })
}

interface BillingTask {
  id: string
  type: 'billing'
  data: {
    dbPath: string
    projectId: number
    financialYear: string
    letterDate: string
    dueDate: string
    unitIds?: number[]
    addOns?: { addon_name: string; addon_amount: number }[]
  }
}

interface WorkerMessage {
  task: BillingTask
}

// Initialize database connection for this worker
function initDatabase(dbPath: string): Database.Database {
  return new Database(dbPath)
}

// Calculate maintenance amount for a unit
function calculateUnitBilling(
  db: Database.Database,
  unitId: number,
  financialYear: string
): { baseAmount: number; finalAmount: number; errors: string[] } {
  const errors: string[] = []

  // Get unit details
  const unit = db.prepare('SELECT area_sqft, unit_type FROM units WHERE id = ?').get(unitId) as { area_sqft: number; unit_type: string } | undefined

  if (!unit) {
    errors.push(`Unit ${unitId} not found`)
    return { baseAmount: 0, finalAmount: 0, errors }
  }

  // Get rate for this unit type and financial year
  const rate = db.prepare(
    'SELECT rate_per_sqft, gst_percent FROM maintenance_rates WHERE project_id = (SELECT project_id FROM units WHERE id = ?) AND financial_year = ? AND (unit_type = ? OR unit_type IS NULL) ORDER BY id DESC LIMIT 1'
  ).get(unitId, financialYear, unit.unit_type) as { rate_per_sqft: number; gst_percent: number } | undefined

  if (!rate) {
    errors.push(`No rate found for unit ${unitId}, type ${unit.unit_type}, FY ${financialYear}`)
    return { baseAmount: 0, finalAmount: 0, errors }
  }

  const baseAmount = unit.area_sqft * rate.rate_per_sqft
  const gstAmount = baseAmount * (rate.gst_percent / 100)
  const finalAmount = baseAmount + gstAmount

  return { baseAmount, finalAmount, errors }
}

// Generate maintenance letters for units
async function generateLetters(
  db: Database.Database,
  projectId: number,
  financialYear: string,
  letterDate: string,
  dueDate: string,
  unitIds?: number[],
  addOns?: { addon_name: string; addon_amount: number }[]
): Promise<{ generated: number; errors: string[] }> {
  const errors: string[] = []
  let generated = 0

  // Get units to process
  let units: { id: number }[]
  if (unitIds && unitIds.length > 0) {
    const placeholders = unitIds.map(() => '?').join(',')
    units = db.prepare(`SELECT id FROM units WHERE project_id = ? AND id IN (${placeholders})`).all(projectId, ...unitIds) as { id: number }[]
  } else {
    units = db.prepare('SELECT id FROM units WHERE project_id = ?').all(projectId) as { id: number }[]
  }

  const total = units.length

  // Prepared statements
  const upsertLetterStmt = db.prepare(`
    INSERT INTO maintenance_letters (project_id, unit_id, financial_year, base_amount, discount_amount, final_amount, due_date, status, generated_date, is_paid, is_sent)
    VALUES (?, ?, ?, ?, 0, ?, ?, 'Pending', ?, 0, 0)
    ON CONFLICT(unit_id, financial_year) DO UPDATE SET
      project_id = excluded.project_id,
      base_amount = excluded.base_amount,
      discount_amount = excluded.discount_amount,
      final_amount = excluded.final_amount,
      due_date = excluded.due_date,
      status = 'Pending',
      generated_date = excluded.generated_date
  `)

  const addOnStmt = db.prepare(`
    INSERT INTO add_ons (letter_id, addon_name, addon_amount)
    VALUES (?, ?, ?)
  `)

  const getLetterIdStmt = db.prepare('SELECT id FROM maintenance_letters WHERE unit_id = ? AND financial_year = ?')

  const transaction = db.transaction((units: { id: number }[]) => {
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]

      // Calculate billing
      const calculation = calculateUnitBilling(db, unit.id, financialYear)
      if (calculation.errors.length > 0) {
        errors.push(...calculation.errors)
        continue
      }

      // Insert/update letter
      upsertLetterStmt.run(projectId, unit.id, financialYear, calculation.baseAmount, calculation.finalAmount, dueDate, letterDate)

      // Get the letter ID
      const letter = getLetterIdStmt.get(unit.id, financialYear) as { id: number } | undefined
      if (letter && addOns && addOns.length > 0) {
        // Add add-ons
        for (const addon of addOns) {
          if (addon.addon_amount > 0) {
            addOnStmt.run(letter.id, addon.addon_name, addon.addon_amount)
          }
        }
      }

      generated++

      // Report progress every 20 letters
      if (i % 20 === 0 || i === units.length - 1) {
        reportProgress(i + 1, total, `Generating letters: ${i + 1}/${total}`)
      }
    }
  })

  transaction(units)
  return { generated, errors }
}

// Main worker message handler
parentPort?.on('message', async (message: WorkerMessage) => {
  const { task } = message

  if (!task || task.type !== 'billing') {
    reportComplete(false, undefined, 'Invalid task type')
    return
  }

  const { dbPath, projectId, financialYear, letterDate, dueDate, unitIds, addOns } = task.data

  if (!dbPath || !projectId || !financialYear || !letterDate || !dueDate) {
    reportComplete(false, undefined, 'Missing required parameters')
    return
  }

  let db: Database.Database | null = null

  try {
    reportProgress(0, 1, 'Initializing letter generation...')

    db = initDatabase(dbPath)

    const result = await generateLetters(db, projectId, financialYear, letterDate, dueDate, unitIds, addOns)
    reportComplete(true, { generated: result.generated, errors: result.errors })
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
