import { dbService } from '../db/database'
import { normalizeMoney } from '../utils/money'

export interface Unit {
  id?: number
  project_id: number
  unit_number: string
  sector_code?: string
  unit_type?: string
  area_sqft: number
  owner_name: string
  contact_number?: string
  email?: string
  status?: string
  penalty?: number
  penalty_percentage?: number
  billing_address?: string
  resident_address?: string
  project_name?: string // Joined field
}

class UnitService {
  private logDebug(message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message, ...args)
    }
  }

  private sanitizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : String(value || '').trim()
  }

  private normalizeUnitStatus(status: unknown): string {
    const normalized = this.sanitizeText(status).toLowerCase()
    if (
      !normalized ||
      normalized === 'sold' ||
      normalized === 'active' ||
      normalized === 'occupied'
    ) {
      return 'Sold'
    }
    if (normalized === 'unsold' || normalized === 'inactive') {
      return 'Unsold'
    }
    if (normalized === 'vacant') {
      return 'Vacant'
    }
    return this.sanitizeText(status) || 'Sold'
  }

  private normalizeUnitType(unitType: unknown): string {
    const normalized = this.sanitizeText(unitType).toLowerCase()
    if (!normalized || normalized === 'flat' || normalized === 'bungalow') return 'Bungalow'
    if (normalized === 'plot') return 'Plot'
    if (normalized === 'garden') return 'Garden'
    return this.sanitizeText(unitType) || 'Bungalow'
  }

  private normalizeIsoDate(value: unknown): string | null {
    const rawValue = this.sanitizeText(value)
    if (!rawValue) return null

    const isoMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    }

    const slashMatch = rawValue.match(/^(\d{4})\/(\d{2})\/(\d{2})$/)
    if (slashMatch) {
      return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`
    }

    const date = new Date(rawValue)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString().slice(0, 10)
  }

  private extractSectorFromUnitNumber(unitNumber: unknown): string {
    const normalizedUnitNumber = String(unitNumber || '').trim()
    if (!normalizedUnitNumber) return ''

    const hyphenIndex = normalizedUnitNumber.indexOf('-')
    if (hyphenIndex > 0) {
      return normalizedUnitNumber.slice(0, hyphenIndex).trim().toUpperCase()
    }

    const slashIndex = normalizedUnitNumber.indexOf('/')
    if (slashIndex > 0) {
      return normalizedUnitNumber.slice(0, slashIndex).trim().toUpperCase()
    }

    return ''
  }

  private normalizeSectorCode(sectorCode: unknown, unitNumber: unknown): string | null {
    const explicitSector = String(sectorCode || '').trim()
    if (explicitSector) {
      return explicitSector.toUpperCase()
    }

    const inferredSector = this.extractSectorFromUnitNumber(unitNumber)
    return inferredSector || null
  }

  public getAll(): Unit[] {
    return dbService.query<Unit>(`
      SELECT u.*, p.name as project_name 
      FROM units u 
      JOIN projects p ON u.project_id = p.id 
      ORDER BY p.name, u.unit_number ASC
    `)
  }

  public getByProject(projectId: number): Unit[] {
    return dbService.query<Unit>(
      'SELECT * FROM units WHERE project_id = ? ORDER BY unit_number ASC',
      [projectId]
    )
  }

  public create(unit: Unit): number {
    const normalizedSectorCode = this.normalizeSectorCode(unit.sector_code, unit.unit_number)
    const result = dbService.run(
      `INSERT INTO units (
        project_id, unit_number, sector_code, unit_type, area_sqft, owner_name, contact_number, email, billing_address, resident_address, status, penalty, penalty_percentage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        unit.project_id,
        unit.unit_number,
        normalizedSectorCode,
        this.normalizeUnitType(unit.unit_type),
        unit.area_sqft,
        unit.owner_name,
        unit.contact_number,
        unit.email,
        unit.billing_address || '',
        unit.resident_address || '',
        this.normalizeUnitStatus(unit.status),
        unit.penalty || 0,
        unit.penalty_percentage || null
      ]
    )
    return result.lastInsertRowid as number
  }

  public update(id: number, unit: Partial<Unit>): boolean {
    const normalizedUnit: Partial<Unit> = { ...unit }
    if ('sector_code' in normalizedUnit || 'unit_number' in normalizedUnit) {
      const normalizedSectorCode = this.normalizeSectorCode(
        normalizedUnit.sector_code,
        normalizedUnit.unit_number
      )
      normalizedUnit.sector_code = normalizedSectorCode === null ? undefined : normalizedSectorCode
    }
    if ('status' in normalizedUnit) {
      normalizedUnit.status = this.normalizeUnitStatus(normalizedUnit.status)
    }
    if ('unit_type' in normalizedUnit) {
      normalizedUnit.unit_type = this.normalizeUnitType(normalizedUnit.unit_type)
    }

    const allowedColumns = [
      'project_id',
      'unit_number',
      'sector_code',
      'unit_type',
      'area_sqft',
      'owner_name',
      'contact_number',
      'email',
      'billing_address',
      'resident_address',
      'status',
      'penalty',
      'penalty_percentage'
    ]
    const keys = Object.keys(normalizedUnit).filter(
      (key) => allowedColumns.includes(key) && key !== 'id' && key !== 'project_name'
    )

    if (keys.length === 0) return false

    const fields = keys.map((key) => `${key} = ?`).join(', ')
    const values = keys.map((key) => normalizedUnit[key as keyof Unit])

    const result = dbService.run(`UPDATE units SET ${fields} WHERE id = ?`, [...values, id])
    return result.changes > 0
  }

  public delete(id: number): boolean {
    return dbService.transaction(() => {
      try {
        this.logDebug(`[UNIT_SERVICE] Starting deletion for unit ID: ${id}`)

        // 1. Check if unit exists
        const unit = dbService.get('SELECT id FROM units WHERE id = ?', [id])
        if (!unit) {
          console.warn(`[UNIT_SERVICE] Unit ${id} not found, skipping deletion`)
          return false
        }

        // 2. Delete the unit - let ON DELETE CASCADE handle the rest
        // Tables handled by CASCADE in schema.ts:
        // - maintenance_letters
        // - payments
        // - receipts (via payments)
        // - add_ons (via maintenance_letters)

        const result = dbService.run('DELETE FROM units WHERE id = ?', [id])

        if (result.changes > 0) {
          this.logDebug(
            `[UNIT_SERVICE] Successfully deleted unit ${id} and all related data via cascade.`
          )
          return true
        } else {
          return false
        }
      } catch (error) {
        console.error(`[UNIT_SERVICE] Error deleting unit ${id}:`, error)
        throw error
      }
    })
  }

  /**
   * Complex ledger import that creates Units, Maintenance Letters, and Add-ons in one transaction.
   * Explodes one Excel row into multiple entities.
   */
  public importLedger(projectId: number, rows: Record<string, unknown>[]): boolean {
    this.logDebug(
      `[IMPORT] Starting ledger import for project ${projectId} with ${rows.length} rows`
    )

    // Pre-validation: Check for potential issues before processing
    const validationErrors: string[] = []
    rows.forEach((row, index) => {
      if (!String(row.unit_number || '').trim()) {
        validationErrors.push(`Row ${index + 1}: Missing Unit Number`)
      }
      if (!String(row.owner_name || '').trim()) {
        // Optional: warn but don't block if owner name is missing
      }
    })

    if (validationErrors.length > 0) {
      const errorDetails = validationErrors.map(error => 
        error.includes('Missing') 
          ? `${error} - Please check your Excel file and ensure this column is filled`
          : error
      ).join('\n')
      
      throw new Error(
        `Import validation failed:\n${errorDetails}\n\nPlease review your Excel file and fix the highlighted issues.`
      )
    }

    return dbService.transaction(() => {
      // 1. Ensure project exists
      const project = dbService.get('SELECT id FROM projects WHERE id = ?', [projectId])
      if (!project) throw new Error(`Project ID ${projectId} does not exist`)

      for (const [index, row] of rows.entries()) {
        try {
          // A. Unit Creation/Retrieval
          let unitId: number
          const unitNumber = String(row.unit_number || '').trim()
          if (!unitNumber) continue
          const normalizedSectorCode = this.normalizeSectorCode(row.sector_code, unitNumber)

          const existingUnit = dbService.get<{ id: number }>(
            'SELECT id FROM units WHERE project_id = ? AND unit_number = ?',
            [projectId, unitNumber]
          )

          if (existingUnit) {
            unitId = existingUnit.id
            // Update owner name if it's different/missing
            if (row.owner_name) {
              dbService.run('UPDATE units SET owner_name = ? WHERE id = ?', [
                row.owner_name as string,
                unitId
              ])
            }
            // Update penalty if provided
            if (row.penalty !== undefined) {
              dbService.run('UPDATE units SET penalty = ? WHERE id = ?', [
                Number(row.penalty) || 0,
                unitId
              ])
            }
            if (row.contact_number !== undefined) {
              dbService.run('UPDATE units SET contact_number = ? WHERE id = ?', [
                String(row.contact_number || ''),
                unitId
              ])
            }
            if (row.email !== undefined) {
              dbService.run('UPDATE units SET email = ? WHERE id = ?', [
                String(row.email || ''),
                unitId
              ])
            }
            if (row.unit_type) {
              dbService.run('UPDATE units SET unit_type = ? WHERE id = ?', [
                this.normalizeUnitType(row.unit_type),
                unitId
              ])
            }
            if (row.area_sqft !== undefined && Number(row.area_sqft) > 0) {
              dbService.run('UPDATE units SET area_sqft = ? WHERE id = ?', [
                Number(row.area_sqft),
                unitId
              ])
            }
            if (row.status) {
              dbService.run('UPDATE units SET status = ? WHERE id = ?', [
                this.normalizeUnitStatus(row.status),
                unitId
              ])
            }
            if (normalizedSectorCode !== null || row.sector_code !== undefined) {
              dbService.run('UPDATE units SET sector_code = ? WHERE id = ?', [
                normalizedSectorCode,
                unitId
              ])
            }
            // Update address fields if provided
            if (row.billing_address !== undefined) {
              dbService.run('UPDATE units SET billing_address = ? WHERE id = ?', [
                String(row.billing_address || ''),
                unitId
              ])
            }
            if (row.resident_address !== undefined) {
              dbService.run('UPDATE units SET resident_address = ? WHERE id = ?', [
                String(row.resident_address || ''),
                unitId
              ])
            }
          } else {
            unitId = this.create({
              project_id: projectId,
              unit_number: unitNumber,
              sector_code: normalizedSectorCode || undefined,
              owner_name: (row.owner_name as string) || 'Unknown',
              unit_type: this.normalizeUnitType(row.unit_type),
              area_sqft: Number(row.area_sqft) || 1000, // Default if missing
              contact_number: (row.contact_number as string) || '',
              email: (row.email as string) || '',
              status: this.normalizeUnitStatus(row.status),
              penalty: Number(row.penalty) || 0,
              billing_address: (row.billing_address as string) || '',
              resident_address: (row.resident_address as string) || ''
            })
          }

          // B. Explode Year Columns into Maintenance Letters
          if (row.years && Array.isArray(row.years)) {
            for (const yearData of row.years) {
              const { financial_year, base_amount, arrears, add_ons } = yearData as {
                financial_year: string
                base_amount: number
                arrears?: number
                penalty?: number
                discount_amount?: number
                final_amount?: number
                due_date?: string
                add_ons?: { name: string; amount: number }[]
              }

              const normalizedFinancialYear = String(financial_year || '').trim()
              const normalizedBaseAmount = normalizeMoney(base_amount)
              const normalizedArrears = normalizeMoney(arrears)
              const normalizedDiscountAmount = normalizeMoney(
                (yearData as { discount_amount?: number }).discount_amount
              )
              const normalizedFinalAmountInput = Number(
                (yearData as { final_amount?: number }).final_amount
              )
              const normalizedDueDate = this.normalizeIsoDate(
                (yearData as { due_date?: string }).due_date
              )
              const normalizedYearPenalty = normalizeMoney(
                (yearData as { penalty?: number }).penalty
              )

              const normalizedAddOns = Array.isArray(add_ons)
                ? add_ons
                    .map((addon) => ({
                      name: String(addon.name || 'Add-on').trim() || 'Add-on',
                      amount: normalizeMoney(addon.amount)
                    }))
                    .filter((addon) => addon.amount > 0)
                : []

              // Append year-level penalty as an add-on if present
              if (normalizedYearPenalty > 0) {
                normalizedAddOns.push({ name: 'Penalty', amount: normalizedYearPenalty })
              }

              const totalAddons = normalizedAddOns.reduce((sum, addon) => sum + addon.amount, 0)
              if (
                normalizedBaseAmount <= 0 &&
                normalizedArrears === 0 &&
                totalAddons === 0 &&
                normalizedAddOns.length === 0 &&
                normalizedDiscountAmount === 0 &&
                (!Number.isFinite(normalizedFinalAmountInput) || normalizedFinalAmountInput <= 0)
              ) {
                continue
              }

              if (!normalizedFinancialYear) {
                continue
              }

              const calculatedFinalAmount = normalizeMoney(
                normalizedBaseAmount + normalizedArrears + totalAddons - normalizedDiscountAmount
              )
              const finalAmount =
                Number.isFinite(normalizedFinalAmountInput) && normalizedFinalAmountInput > 0
                  ? normalizeMoney(normalizedFinalAmountInput)
                  : Math.max(calculatedFinalAmount, 0)

              // Upsert one maintenance letter per unit + financial year.
              dbService.run(
                `INSERT INTO maintenance_letters (
                  project_id, unit_id, financial_year, base_amount, arrears, discount_amount, final_amount, due_date, status, is_paid, is_sent
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0, 0)
                ON CONFLICT(unit_id, financial_year) DO UPDATE SET
                  project_id = excluded.project_id,
                  base_amount = excluded.base_amount,
                  arrears = excluded.arrears,
                  discount_amount = excluded.discount_amount,
                  final_amount = excluded.final_amount,
                  due_date = excluded.due_date,
                  status = 'Pending',
                  is_paid = 0,
                  is_sent = 0`,
                [
                  projectId,
                  unitId,
                  normalizedFinancialYear,
                  normalizedBaseAmount,
                  normalizedArrears,
                  normalizedDiscountAmount,
                  finalAmount,
                  normalizedDueDate
                ]
              )

              const letter = dbService.get<{ id: number }>(
                'SELECT id FROM maintenance_letters WHERE unit_id = ? AND financial_year = ?',
                [unitId, normalizedFinancialYear]
              )

              if (!letter) {
                throw new Error(
                  `Failed to persist maintenance letter for unit ${unitNumber} (${normalizedFinancialYear})`
                )
              }
              const letterId = letter.id

              // C. Replace add-ons so repeated imports stay idempotent.
              dbService.run('DELETE FROM add_ons WHERE letter_id = ?', [letterId])

              for (const addon of normalizedAddOns) {
                dbService.run(
                  'INSERT INTO add_ons (letter_id, addon_name, addon_amount) VALUES (?, ?, ?)',
                  [letterId, addon.name, addon.amount]
                )
              }

              // Letter status is managed through explicit admin actions only
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          const unitIdentifier = row.unit_number || `Index ${index + 1}`
          console.error(`[IMPORT ERROR] Row ${index + 1} (${unitIdentifier}) failed:`, message)
          // Re-throw original error to preserve stack trace
          throw error
        }
      }
      return true
    })
  }

  public importUnits(units: Unit[]): boolean {
    this.logDebug(`[IMPORT] Starting units-only import for ${units.length} units`)

    return dbService.transaction(() => {
      for (const [index, unit] of units.entries()) {
        const projectId = Number(unit.project_id)
        const unitNumber = this.sanitizeText(unit.unit_number)
        const ownerName = this.sanitizeText(unit.owner_name)
        const areaSqft = Number(unit.area_sqft)

        if (!Number.isFinite(projectId) || projectId <= 0) {
          throw new Error(`Row ${index + 1}: invalid project selected`)
        }
        if (!unitNumber) {
          throw new Error(`Row ${index + 1}: unit number is required`)
        }
        if (!ownerName) {
          throw new Error(`Row ${index + 1}: owner name is required`)
        }
        if (!Number.isFinite(areaSqft) || areaSqft <= 0) {
          throw new Error(`Row ${index + 1}: area must be greater than 0`)
        }

        const projectExists = dbService.get('SELECT id FROM projects WHERE id = ?', [projectId])
        if (!projectExists) {
          throw new Error(`Row ${index + 1}: project ${projectId} does not exist`)
        }

        const normalizedSectorCode = this.normalizeSectorCode(unit.sector_code, unitNumber)
        const normalizedUnit: Unit = {
          project_id: projectId,
          unit_number: unitNumber,
          sector_code: normalizedSectorCode || undefined,
          owner_name: ownerName,
          unit_type: this.normalizeUnitType(unit.unit_type),
          area_sqft: areaSqft,
          contact_number: this.sanitizeText(unit.contact_number),
          email: this.sanitizeText(unit.email),
          status: this.normalizeUnitStatus(unit.status),
          billing_address: this.sanitizeText(unit.billing_address),
          resident_address: this.sanitizeText(unit.resident_address)
        }

        const existingUnit = dbService.get<{ id: number }>(
          'SELECT id FROM units WHERE project_id = ? AND unit_number = ?',
          [projectId, unitNumber]
        )

        if (existingUnit) {
          this.update(existingUnit.id, normalizedUnit)
        } else {
          this.create(normalizedUnit)
        }
      }

      return true
    })
  }

  private deleteInternal(id: number): boolean {
    // Internal delete without transaction wrapper for use in bulk operations
    const unit = dbService.get('SELECT id FROM units WHERE id = ?', [id])
    if (!unit) {
      console.warn(`[UNIT_SERVICE] Unit ${id} not found, skipping deletion`)
      return false
    }

    const result = dbService.run('DELETE FROM units WHERE id = ?', [id])
    return result.changes > 0
  }

  public bulkDelete(ids: number[]): boolean {
    // Use single transaction for atomic operation - roll back all on any failure
    return dbService.transaction(() => {
      for (const id of ids) {
        if (!this.deleteInternal(id)) {
          throw new Error(`Failed to delete unit ${id}`)
        }
      }
      return true
    })
  }

  public bulkCreate(units: Unit[]): boolean {
    this.logDebug(`[DEBUG] UnitService.bulkCreate called with ${units.length} units`)

    // Diagnostic: Check if we have any projects at all
    const projectCount = dbService.get<{ count: number }>('SELECT count(*) as count FROM projects')
    this.logDebug(`[DEBUG] Total projects in database: ${projectCount?.count}`)

    return dbService.transaction(() => {
      for (const [index, unit] of units.entries()) {
        try {
          // Ensure project_id is a number
          const projectId = Number(unit.project_id)

          if (isNaN(projectId) || projectId <= 0) {
            throw new Error(`Invalid project_id: ${unit.project_id}`)
          }

          // Verify project exists
          const projectExists = dbService.get('SELECT id FROM projects WHERE id = ?', [projectId])
          if (!projectExists) {
            const allProjects = dbService.query<{ id: number; name: string }>(
              'SELECT id, name FROM projects'
            )
            const availableIds = allProjects.map((p) => p.id).join(', ')
            throw new Error(
              `Project ID ${projectId} does not exist. Available IDs: ${availableIds}`
            )
          }

          // Update unit with numeric project_id
          const unitToCreate = { ...unit, project_id: projectId }

          try {
            this.create(unitToCreate)
          } catch (createError: unknown) {
            const message = createError instanceof Error ? createError.message : String(createError)
            if (message.includes('FOREIGN KEY constraint failed')) {
              // Try to find exactly what failed
              const tableSchema = dbService.get<{ sql: string }>(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='units'"
              )
              console.error(`[CRITICAL] units table schema:`, tableSchema?.sql)

              const foreignKeyCheck = dbService.query('PRAGMA foreign_key_check(units)')
              console.error(`[CRITICAL] Foreign key check result for units:`, foreignKeyCheck)

              const fkList = dbService.query('PRAGMA foreign_key_list(units)')
              console.error(
                `[CRITICAL] Foreign key list for units:`,
                JSON.stringify(fkList, null, 2)
              )

              const project = dbService.get('SELECT * FROM projects WHERE id = ?', [projectId])
              console.error(`[CRITICAL] Referenced project (${projectId}) state:`, project)
            }
            throw createError
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[ERROR] Failed to create unit at index ${index}:`, unit)
          console.error(`[ERROR] Error details: ${message}`)
          throw error // Re-throw to roll back transaction
        }
      }
      return true
    })
  }
}

export const unitService = new UnitService()
