/**
 * Dry-run services for preview/validation before committing changes
 */

import { dbService } from '../db/database'

export interface DryRunPreview {
  valid: boolean
  conflicts: ConflictItem[]
  summary: {
    entities: Record<string, number>
    warnings: string[]
  }
}

export interface ConflictItem {
  type: 'duplicate_unit' | 'missing_rate' | 'missing_project' | 'invalid_data'
  severity: 'error' | 'warning'
  message: string
  data?: unknown
}

class DryRunService {
  /**
   * Preview import: check for conflicts before actual import
   */
  previewImport(projectId: number, rows: unknown[]): DryRunPreview {
    const conflicts: ConflictItem[] = []
    const unitNumbers = new Set<string>()
    let validRows = 0

    const existing = dbService.query<{ unit_number: string }>(
      'SELECT unit_number FROM units WHERE project_id = ?',
      [projectId]
    )
    const existingSet = new Set(existing.map((u) => u.unit_number))

    for (const row of rows as Record<string, unknown>[]) {
      const unitNumber = String(row.unit_number || '').trim()

      if (!unitNumber) {
        conflicts.push({
          type: 'invalid_data',
          severity: 'error',
          message: 'Missing unit_number'
        })
        continue
      }

      if (unitNumbers.has(unitNumber)) {
        conflicts.push({
          type: 'duplicate_unit',
          severity: 'warning',
          message: `Duplicate unit_number in import: ${unitNumber}`
        })
      } else if (existingSet.has(unitNumber)) {
        conflicts.push({
          type: 'duplicate_unit',
          severity: 'warning',
          message: `Unit already exists in project: ${unitNumber}. Will be updated if provided.`
        })
      }

      unitNumbers.add(unitNumber)
      validRows++
    }

    return {
      valid: conflicts.filter((c) => c.severity === 'error').length === 0,
      conflicts,
      summary: {
        entities: {
          units: validRows,
          letters: rows.length * 3 // Assume avg 3 years per unit
        },
        warnings: conflicts.map((c) => c.message)
      }
    }
  }

  /**
   * Preview billing: calculate amounts + validate rate exists
   */
  previewBilling(projectId: number, financialYear: string, unitIds?: number[]): DryRunPreview {
    const conflicts: ConflictItem[] = []

    // Check project exists
    const project = dbService.get('SELECT id FROM projects WHERE id = ?', [projectId])
    if (!project) {
      conflicts.push({
        type: 'missing_project',
        severity: 'error',
        message: `Project ${projectId} not found`
      })
    }

    // Check rate exists
    const rate = dbService.get(
      'SELECT id FROM maintenance_rates WHERE project_id = ? AND financial_year = ?',
      [projectId, financialYear]
    )
    if (!rate) {
      conflicts.push({
        type: 'missing_rate',
        severity: 'error',
        message: `No maintenance rate found for FY ${financialYear}`
      })
    }

    // Get units
    let units = 0
    if (conflicts.filter((c) => c.severity === 'error').length === 0) {
      const sql = unitIds?.length
        ? 'SELECT COUNT(*) as cnt FROM units WHERE project_id = ? AND id IN (?' +
          ',?'.repeat(unitIds.length - 1) +
          ')'
        : 'SELECT COUNT(*) as cnt FROM units WHERE project_id = ?'
      const params = unitIds?.length ? [projectId, ...unitIds] : [projectId]
      const result = dbService.get(sql, params) as unknown as { cnt: number } | null
      units = result?.cnt || 0
    }

    return {
      valid: conflicts.filter((c) => c.severity === 'error').length === 0,
      conflicts,
      summary: {
        entities: {
          letters: units
        },
        warnings: conflicts.map((c) => c.message)
      }
    }
  }

  /**
   * Preview payment: check for conflicts
   */
  previewPayment(unitId: number, projectId: number): DryRunPreview {
    const conflicts: ConflictItem[] = []

    // Check unit exists
    const unit = dbService.get('SELECT id FROM units WHERE id = ? AND project_id = ?', [
      unitId,
      projectId
    ])
    if (!unit) {
      conflicts.push({
        type: 'missing_project',
        severity: 'error',
        message: 'Unit not found in this project'
      })
    }

    // Check for duplicate recent payments (last 1 hour)
    if (!conflicts.some((c) => c.severity === 'error')) {
      const recent = dbService.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM payments 
         WHERE unit_id = ? AND datetime(payment_date) > datetime('now', '-1 hour')`,
        [unitId]
      )
      if ((recent?.count || 0) > 0) {
        conflicts.push({
          type: 'duplicate_unit',
          severity: 'warning',
          message: 'A payment was recorded for this unit recently. Confirm this is not a duplicate.'
        })
      }
    }

    return {
      valid: conflicts.filter((c) => c.severity === 'error').length === 0,
      conflicts,
      summary: {
        entities: { payments: 1 },
        warnings: conflicts.map((c) => c.message)
      }
    }
  }
}

export const dryRunService = new DryRunService()
