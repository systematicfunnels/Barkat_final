import { dbService } from '../db/database'
import { unitService } from './UnitService'

export interface Project {
  id?: number
  project_code?: string
  name: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  status?: string
  letterhead_path?: string
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  branch_address?: string
  qr_code_path?: string
  template_type?: string
  payment_modes?: string
  contact_email?: string
  contact_phone?: string
  import_profile_key?: string
  created_at?: string
  unit_count?: number
}

export interface ProjectSectorPaymentConfig {
  id?: number
  project_id: number
  sector_code: string
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  qr_code_path?: string
  created_at?: string
  updated_at?: string
}

export interface ProjectChargesConfig {
  id?: number
  project_id: number
  na_tax_rate_per_sqft: number
  solar_contribution: number
  cable_charges: number
  penalty_percentage: number
  early_payment_discount_percentage: number
  created_at?: string
  updated_at?: string
}

export interface ProjectSetupSummary {
  project_id: number
  project_name: string
  template_type?: string
  import_profile_key?: string
  unit_count: number
  sector_codes: string[]
  configured_sector_codes: string[]
  sectors_missing_core_payment_config: string[]
  sectors_without_qr_coverage: string[]
  unit_types: string[]
  rate_years: string[]
  has_default_payment_details: boolean
  has_default_qr: boolean
  has_rate_for_financial_year: boolean
  missing_rate_unit_types: string[]
  blockers: string[]
  warnings: string[]
  ready_for_letters: boolean
}

export interface StandardWorkbookImportYear {
  financial_year: string
  base_amount: number
  arrears?: number
  discount_amount?: number
  final_amount?: number
  due_date?: string
  penalty?: number
  add_ons?: { name: string; amount: number }[]
}

export interface StandardWorkbookImportRow {
  unit_number: string
  sector_code?: string
  owner_name?: string
  area_sqft?: number
  unit_type?: string
  status?: string
  contact_number?: string
  email?: string
  penalty?: number
  years?: StandardWorkbookImportYear[]
}

export interface StandardWorkbookProjectImportPayload {
  project: Project
  sector_configs?: Partial<ProjectSectorPaymentConfig>[]
  rows: StandardWorkbookImportRow[]
  rates?: any[]
  payments?: any[]
}

export interface StandardWorkbookProjectImportResult {
  project_id: number
  project_code: string
  project_name: string
  created: boolean
  imported_units: number
  imported_letters: number
  sector_configs_merged: boolean
}

class ProjectService {
  private sanitizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : String(value || '').trim()
  }

  private normalizeProjectStatus(status: unknown): string {
    const normalized = this.sanitizeText(status).toLowerCase()
    if (!normalized || normalized === 'sold' || normalized === 'active') return 'Sold'
    if (normalized === 'unsold' || normalized === 'inactive') return 'Unsold'
    return this.sanitizeText(status) || 'Sold'
  }

  private normalizeTemplateType(templateType: unknown): string {
    const normalized = this.sanitizeText(templateType).toLowerCase()
    if (!normalized || normalized === 'maintenance' || normalized === 'standard') return 'standard'
    if (normalized === 'sector_legacy' || normalized === 'sector legacy') return 'sector_legacy'
    if (
      normalized === 'reminder_legacy' ||
      normalized === 'reminder legacy' ||
      normalized === 'reminder'
    ) {
      return 'reminder_legacy'
    }
    return this.sanitizeText(templateType) || 'standard'
  }

  private normalizeImportProfile(importProfileKey: unknown): string {
    const normalized = this.sanitizeText(importProfileKey).toLowerCase()
    if (!normalized || normalized === 'standard' || normalized === 'maintenance') {
      return 'standard_normalized'
    }
    if (
      normalized === 'standard_normalized' ||
      normalized === 'beverly_abc_v1' ||
      normalized === 'banjara_numeric_v1'
    ) {
      return normalized
    }
    return this.sanitizeText(importProfileKey) || 'standard_normalized'
  }

  private generateNextProjectCode(): string {
    const existingCodes = dbService.query<{ project_code: string | null }>(
      "SELECT project_code FROM projects WHERE project_code IS NOT NULL AND TRIM(project_code) <> ''"
    )
    let maxSequence = 0
    for (const row of existingCodes) {
      const normalizedCode = this.sanitizeText(row.project_code).toUpperCase()
      const match = normalizedCode.match(/^PRJ-(\d+)$/)
      if (match) {
        maxSequence = Math.max(maxSequence, Number(match[1]))
      }
    }
    return `PRJ-${String(maxSequence + 1).padStart(3, '0')}`
  }

  private getByName(name: string): Project | undefined {
    return dbService.get<Project>(
      'SELECT * FROM projects WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))',
      [name]
    )
  }

  private mergeImportedProject(
    existingProject: Project | undefined,
    incomingProject: Project
  ): Project {
    const mergedProject: Project = existingProject
      ? { ...existingProject }
      : { name: incomingProject.name }
    type TextProjectField =
      | 'name'
      | 'address'
      | 'city'
      | 'state'
      | 'pincode'
      | 'letterhead_path'
      | 'account_name'
      | 'bank_name'
      | 'account_no'
      | 'ifsc_code'
      | 'branch'
      | 'branch_address'
      | 'qr_code_path'
      | 'contact_email'
      | 'contact_phone'
      | 'payment_modes'
    const textFields: TextProjectField[] = [
      'name',
      'address',
      'city',
      'state',
      'pincode',
      'letterhead_path',
      'account_name',
      'bank_name',
      'account_no',
      'ifsc_code',
      'branch',
      'branch_address',
      'qr_code_path',
      'contact_email',
      'contact_phone',
      'payment_modes'
    ]

    for (const field of textFields) {
      const normalized = this.sanitizeText(incomingProject[field])
      if (normalized) {
        ;(mergedProject as Record<TextProjectField, string | undefined>)[field] =
          field === 'ifsc_code' ? normalized.toUpperCase() : normalized
      }
    }

    mergedProject.status = this.normalizeProjectStatus(
      incomingProject.status || existingProject?.status
    )
    mergedProject.template_type = this.normalizeTemplateType(
      incomingProject.template_type || existingProject?.template_type
    )
    mergedProject.import_profile_key = this.normalizeImportProfile(
      incomingProject.import_profile_key || existingProject?.import_profile_key
    )

    return mergedProject
  }

  private normalizeSectorConfig(
    config: Partial<ProjectSectorPaymentConfig>
  ): Partial<ProjectSectorPaymentConfig> | null {
    const sectorCode = this.sanitizeText(config.sector_code).toUpperCase()
    if (!sectorCode) return null

    return {
      sector_code: sectorCode,
      account_name: this.sanitizeText(config.account_name) || undefined,
      bank_name: this.sanitizeText(config.bank_name) || undefined,
      account_no: this.sanitizeText(config.account_no) || undefined,
      ifsc_code: this.sanitizeText(config.ifsc_code).toUpperCase() || undefined,
      branch: this.sanitizeText(config.branch) || undefined,
      qr_code_path: this.sanitizeText(config.qr_code_path) || undefined
    }
  }

  private hasSectorConfigDetails(config: Partial<ProjectSectorPaymentConfig>): boolean {
    return [
      config.account_name,
      config.bank_name,
      config.account_no,
      config.ifsc_code,
      config.branch,
      config.qr_code_path
    ].some((v) => this.sanitizeText(v).length > 0)
  }

  private normalizeUnitType(unitType: unknown): string {
    const normalized = String(unitType || '')
      .trim()
      .toLowerCase()
    if (!normalized || normalized === 'flat' || normalized === 'bungalow') return 'Bungalow'
    if (normalized === 'plot') return 'Plot'
    if (normalized === 'garden') return 'Garden'
    if (normalized === 'bmf') return 'BMF'
    if (normalized === 'all' || normalized === 'all units') return 'All'
    return String(unitType || '').trim() || 'Bungalow'
  }

  private logDebug(message: string, ...args: unknown[]): void {
    const isDevelopment =
      process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1'
    if (isDevelopment) {
      console.log(`[PROJECTS] ${message}`, ...args)
    }
  }

  public getAll(): Project[] {
    return dbService.query<Project>(`
      SELECT p.*, (SELECT COUNT(*) FROM units u WHERE u.project_id = p.id) as unit_count
      FROM projects p 
      ORDER BY p.name ASC
    `)
  }

  public getById(id: number): Project | undefined {
    return dbService.get<Project>('SELECT * FROM projects WHERE id = ?', [id])
  }

  public create(project: Project): number {
    const result = dbService.run(
      `INSERT INTO projects (
        project_code, name, address, city, state, pincode, status, letterhead_path,
        account_name, bank_name, account_no, ifsc_code, branch, branch_address,
        qr_code_path, template_type, payment_modes, contact_email, contact_phone, import_profile_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.sanitizeText(project.project_code).toUpperCase() || this.generateNextProjectCode(),
        project.name,
        project.address,
        project.city,
        project.state,
        project.pincode,
        project.status || 'Sold',
        project.letterhead_path,
        project.account_name,
        project.bank_name,
        project.account_no,
        project.ifsc_code,
        project.branch,
        project.branch_address,
        project.qr_code_path,
        project.template_type || 'standard',
        project.payment_modes || 'Cheque/Cash/Online Transfer',
        project.contact_email || null,
        project.contact_phone || null,
        project.import_profile_key
      ]
    )
    return result.lastInsertRowid as number
  }

  public update(id: number, project: Partial<Project>): boolean {
    const allowedColumns = [
      'name',
      'address',
      'city',
      'state',
      'pincode',
      'status',
      'letterhead_path',
      'account_name',
      'bank_name',
      'account_no',
      'ifsc_code',
      'branch',
      'branch_address',
      'qr_code_path',
      'template_type',
      'payment_modes',
      'contact_email',
      'contact_phone',
      'import_profile_key'
    ]
    const keys = Object.keys(project).filter(
      (key) => allowedColumns.includes(key) && key !== 'id' && key !== 'created_at'
    )

    if (keys.length === 0) return false

    const fields = keys.map((key) => `${key} = ?`).join(', ')
    const values = keys.map((key) => project[key as keyof Project])

    const result = dbService.run(`UPDATE projects SET ${fields} WHERE id = ?`, [...values, id])
    return result.changes > 0
  }

  public delete(id: number): boolean {
    return dbService.transaction(() => {
      try {
        this.logDebug(`[PROJECT_SERVICE] Starting deletion for project ID: ${id}`)

        // 1. Delete the project - let ON DELETE CASCADE handle the rest
        // Tables handled by CASCADE in schema.ts:
        // - units
        // - maintenance_rates
        // - maintenance_letters
        // - payments
        // - receipts (via payments)
        // - add_ons (via maintenance_letters)
        // - maintenance_slabs (via maintenance_rates)

        const result = dbService.run('DELETE FROM projects WHERE id = ?', [id])

        if (result.changes > 0) {
          this.logDebug(
            `[PROJECT_SERVICE] Successfully deleted project ${id} and all related data via cascade.`
          )
          return true
        } else {
          console.warn(`[PROJECT_SERVICE] No project found with ID ${id}.`)
          return false
        }
      } catch (error) {
        console.error(`[PROJECT_SERVICE] Error deleting project ${id}:`, error)
        throw error
      }
    })
  }

  public bulkDelete(ids: number[]): boolean {
    return dbService.transaction(() => {
      let allDeleted = true
      for (const id of ids) {
        if (!this.delete(id)) {
          allDeleted = false
        }
      }
      return allDeleted
    })
  }

  public getDashboardStats(
    projectId?: number,
    financialYear?: string,
    unitType?: string,
    status?: string
  ): {
    projects: number
    units: number
    pendingUnits: number
    collectedThisYear: number
    totalBilled: number
    totalOutstanding: number
  } {
    // Project filter
    const projectWhere: string[] = []
    const projectParams: (string | number)[] = []
    if (projectId) {
      projectWhere.push('id = ?')
      projectParams.push(projectId)
    }
    if (status) {
      projectWhere.push('status = ?')
      projectParams.push(status)
    }
    const projectFilterStr = projectWhere.length > 0 ? `WHERE ${projectWhere.join(' AND ')}` : ''

    // Unit filter
    const unitWhere: string[] = []
    const unitParams: (string | number)[] = []
    if (projectId) {
      unitWhere.push('project_id = ?')
      unitParams.push(projectId)
    }
    if (unitType) {
      unitWhere.push('unit_type = ?')
      unitParams.push(unitType)
    }
    if (status) {
      unitWhere.push('project_id IN (SELECT id FROM projects WHERE status = ?)')
      unitParams.push(status)
    }
    const unitFilterStr = unitWhere.length > 0 ? `WHERE ${unitWhere.join(' AND ')}` : ''

    // Letter filter
    const letterWhere: string[] = []
    const letterParams: (string | number)[] = []
    if (projectId) {
      letterWhere.push('project_id = ?')
      letterParams.push(projectId)
    }
    if (financialYear) {
      letterWhere.push('financial_year = ?')
      letterParams.push(financialYear)
    }
    if (unitType) {
      letterWhere.push('unit_id IN (SELECT id FROM units WHERE unit_type = ?)')
      letterParams.push(unitType)
    }
    if (status) {
      letterWhere.push('project_id IN (SELECT id FROM projects WHERE status = ?)')
      letterParams.push(status)
    }
    const letterFilterStr = letterWhere.length > 0 ? `WHERE ${letterWhere.join(' AND ')}` : ''

    // Payment filter
    const paymentWhere: string[] = []
    const paymentParams: (string | number)[] = []
    if (projectId) {
      paymentWhere.push('p.project_id = ?')
      paymentParams.push(projectId)
    }
    if (financialYear) {
      paymentWhere.push('COALESCE(p.financial_year, l.financial_year) = ?')
      paymentParams.push(financialYear)
    }
    if (unitType) {
      paymentWhere.push('p.unit_id IN (SELECT id FROM units WHERE unit_type = ?)')
      paymentParams.push(unitType)
    }
    if (status) {
      paymentWhere.push('p.project_id IN (SELECT id FROM projects WHERE status = ?)')
      paymentParams.push(status)
    }
    const paymentFilterStr = paymentWhere.length > 0 ? `WHERE ${paymentWhere.join(' AND ')}` : ''
    const paymentFromStr = 'FROM payments p LEFT JOIN maintenance_letters l ON p.letter_id = l.id'

    const projectsCount =
      dbService.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM projects ${projectFilterStr}`,
        projectParams
      )?.count || 0

    const unitsCount =
      dbService.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM units ${unitFilterStr}`,
        unitParams
      )?.count || 0

    const totalBilled =
      dbService.get<{ total: number }>(
        `SELECT SUM(final_amount) as total FROM maintenance_letters ${letterFilterStr}`,
        letterParams
      )?.total || 0

    const totalCollected =
      dbService.get<{ total: number }>(
        `SELECT SUM(p.payment_amount) as total ${paymentFromStr} ${paymentFilterStr}`,
        paymentParams
      )?.total || 0

    const collectedThisYear = totalCollected

    // Calculate pending units
    const pendingUnits =
      dbService.get<{ count: number }>(
        `
      SELECT COUNT(*) as count FROM (
        SELECT b.unit_id
        FROM (
          SELECT unit_id, SUM(final_amount) as billed FROM maintenance_letters ${letterFilterStr} GROUP BY unit_id
        ) b
        LEFT JOIN (
          SELECT p.unit_id, SUM(p.payment_amount) as paid ${paymentFromStr} ${paymentFilterStr} GROUP BY p.unit_id
        ) p ON b.unit_id = p.unit_id
        WHERE billed > COALESCE(paid, 0) + 0.01
      )
    `,
        [...letterParams, ...paymentParams]
      )?.count || 0

    return {
      projects: projectsCount,
      units: unitsCount,
      pendingUnits,
      collectedThisYear,
      totalBilled,
      totalOutstanding: totalBilled - totalCollected
    }
  }

  public getSectorPaymentConfigs(projectId: number): ProjectSectorPaymentConfig[] {
    return dbService.query<ProjectSectorPaymentConfig>(
      `
      SELECT *
      FROM project_sector_payment_configs
      WHERE project_id = ?
      ORDER BY sector_code COLLATE NOCASE ASC
    `,
      [projectId]
    )
  }

  public saveSectorPaymentConfigs(
    projectId: number,
    configs: Partial<ProjectSectorPaymentConfig>[]
  ): boolean {
    return dbService.transaction(() => {
      dbService.run('DELETE FROM project_sector_payment_configs WHERE project_id = ?', [projectId])

      for (const config of configs) {
        const sectorCode = String(config.sector_code || '')
          .trim()
          .toUpperCase()
        if (!sectorCode) continue

        dbService.run(
          `INSERT INTO project_sector_payment_configs (
            project_id, sector_code, account_name, bank_name, account_no, ifsc_code, branch, qr_code_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            sectorCode,
            config.account_name || null,
            config.bank_name || null,
            config.account_no || null,
            config.ifsc_code ? config.ifsc_code.toUpperCase() : null,
            config.branch || null,
            config.qr_code_path || null
          ]
        )
      }

      return true
    })
  }

  public getChargesConfig(projectId: number): ProjectChargesConfig {
    const result = dbService.query<ProjectChargesConfig>(
      `SELECT * FROM project_charges_config WHERE project_id = ?`,
      [projectId]
    )

    if (result.length > 0) {
      return result[0]
    }

    // Return defaults if no config exists
    return {
      project_id: projectId,
      na_tax_rate_per_sqft: 0.09,
      solar_contribution: 3000,
      cable_charges: 1000,
      penalty_percentage: 21,
      early_payment_discount_percentage: 10
    }
  }

  /**
   * Validate that all unit IDs belong to the specified project
   */
  public validateUnitsInProject(unitIds: number[], projectId: number): boolean {
    if (unitIds.length === 0) return false
    
    const validUnits = dbService.query<{ id: number }>(
      `SELECT id FROM units WHERE id IN (${unitIds.map(() => '?').join(',')}) AND project_id = ?`,
      [...unitIds, projectId]
    )
    
    return validUnits.length === unitIds.length
  }

  public saveChargesConfig(config: ProjectChargesConfig): boolean {
    return dbService.transaction(() => {
      const existing = dbService.query<ProjectChargesConfig>(
        `SELECT id FROM project_charges_config WHERE project_id = ?`,
        [config.project_id]
      )

      if (existing.length > 0) {
        dbService.run(
          `UPDATE project_charges_config
           SET na_tax_rate_per_sqft = ?,
               solar_contribution = ?,
               cable_charges = ?,
               penalty_percentage = ?,
               early_payment_discount_percentage = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ?`,
          [
            config.na_tax_rate_per_sqft,
            config.solar_contribution,
            config.cable_charges,
            config.penalty_percentage,
            config.early_payment_discount_percentage,
            config.project_id
          ]
        )
      } else {
        dbService.run(
          `INSERT INTO project_charges_config (
            project_id, na_tax_rate_per_sqft, solar_contribution,
            cable_charges, penalty_percentage, early_payment_discount_percentage
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            config.project_id,
            config.na_tax_rate_per_sqft,
            config.solar_contribution,
            config.cable_charges,
            config.penalty_percentage,
            config.early_payment_discount_percentage
          ]
        )
      }

      return true
    })
  }

  public importStandardWorkbookProject(
    payload: StandardWorkbookProjectImportPayload
  ): StandardWorkbookProjectImportResult {
    return dbService.transaction(() => {
      const projectName = this.sanitizeText(payload?.project?.name)
      if (!projectName) {
        throw new Error('Project name is required for workbook import')
      }

      const existingProject = this.getByName(projectName)
      const mergedProject = this.mergeImportedProject(existingProject, {
        ...payload.project,
        name: projectName
      })

      let projectId: number
      if (existingProject?.id) {
        this.update(existingProject.id, mergedProject)
        projectId = existingProject.id
      } else {
        projectId = this.create(mergedProject)
      }

      const incomingSectorConfigs = Array.isArray(payload.sector_configs)
        ? payload.sector_configs
            .map((config) => this.normalizeSectorConfig(config))
            .filter((config): config is Partial<ProjectSectorPaymentConfig> => config !== null)
        : []
      const incomingSectorDetailConfigs = incomingSectorConfigs.filter((config) =>
        this.hasSectorConfigDetails(config)
      )

      let sectorConfigsMerged = false
      if (incomingSectorDetailConfigs.length > 0) {
        const existingSectorConfigMap = new Map<string, Partial<ProjectSectorPaymentConfig>>(
          this.getSectorPaymentConfigs(projectId).map((config) => [
            this.sanitizeText(config.sector_code).toUpperCase(),
            {
              sector_code: this.sanitizeText(config.sector_code).toUpperCase(),
              account_name: config.account_name,
              bank_name: config.bank_name,
              account_no: config.account_no,
              ifsc_code: config.ifsc_code,
              branch: config.branch,
              qr_code_path: config.qr_code_path
            }
          ])
        )

        for (const config of incomingSectorDetailConfigs) {
          existingSectorConfigMap.set(String(config.sector_code), config)
        }

        this.saveSectorPaymentConfigs(projectId, Array.from(existingSectorConfigMap.values()))
        sectorConfigsMerged = true
      }

      const rows = Array.isArray(payload.rows) ? payload.rows : []
      if (rows.length > 0) {
        unitService.importLedger(projectId, rows as unknown as Record<string, unknown>[])
      }

      // ── Import Rates ──────────────────────────────────────────────────────────
      // For each rate row: upsert maintenance_rates record
      // Also derive per-year project_charges_config from the rate metadata
      let importedRateCount = 0
      const rateRows = Array.isArray(payload.rates) ? payload.rates : []
      for (const rateRow of rateRows) {
        const fy = String(rateRow.financial_year || '').trim()
        const unitType = String(rateRow.unit_type || 'All').trim()
        const ratePsf = Number(rateRow.rate_per_sqft) || 0
        if (!fy || ratePsf <= 0) continue

        // Upsert rate — if same project+year+unit_type exists, update it
        const existingRate = dbService.get<{ id: number }>(
          `SELECT id FROM maintenance_rates
           WHERE project_id = ? AND financial_year = ? AND unit_type = ?`,
          [projectId, fy, unitType]
        )
        if (existingRate) {
          dbService.run(
            'UPDATE maintenance_rates SET rate_per_sqft = ?, gst_percent = ? WHERE id = ?',
            [ratePsf, Number(rateRow.gst_percent) || 0, existingRate.id]
          )
        } else {
          dbService.run(
            `INSERT INTO maintenance_rates
               (project_id, financial_year, unit_type, rate_per_sqft, gst_percent, billing_frequency)
             VALUES (?, ?, ?, ?, ?, 'YEARLY')`,
            [projectId, fy, unitType, ratePsf, Number(rateRow.gst_percent) || 0]
          )
        }
        importedRateCount += 1

        // Derive project_charges_config from the rate row (use latest FY values)
        const naTax = Number(rateRow.na_tax_per_sqft) || 0
        const roadNa = Number(rateRow.road_na_flat) || 0
        const cable = Number(rateRow.cable_flat) || 0
        const gstPct = Number(rateRow.gst_percent) || 0
        const penaltyPct = Number(rateRow.penalty_percent) || 0
        const discountPct = Number(rateRow.discount_percent) || 0

        const hasChargeData = naTax > 0 || roadNa > 0 || cable > 0 || gstPct > 0 || penaltyPct > 0 || discountPct > 0
        if (hasChargeData) {
          const existingCharges = dbService.get<{ id: number }>(
            'SELECT id FROM project_charges_config WHERE project_id = ?',
            [projectId]
          )
          if (existingCharges) {
            dbService.run(
              `UPDATE project_charges_config SET
                 na_tax_rate_per_sqft = MAX(na_tax_rate_per_sqft, ?),
                 cable_charges = MAX(cable_charges, ?),
                 penalty_percentage = MAX(penalty_percentage, ?),
                 early_payment_discount_percentage = MAX(early_payment_discount_percentage, ?)
               WHERE project_id = ?`,
              [naTax, cable, penaltyPct, discountPct, projectId]
            )
          } else {
            dbService.run(
              `INSERT INTO project_charges_config
                 (project_id, na_tax_rate_per_sqft, solar_contribution, cable_charges,
                  penalty_percentage, early_payment_discount_percentage)
               VALUES (?, ?, 0, ?, ?, ?)`,
              [projectId, naTax, cable, penaltyPct, discountPct]
            )
          }
        }
      }

      // ── Import Payments ───────────────────────────────────────────────────────
      // For each payment row: look up unit by unit_number, find letter, create payment
      let importedPaymentCount = 0
      const paymentRows = Array.isArray(payload.payments) ? payload.payments : []
      for (const payRow of paymentRows) {
        try {
          const unitNumber = String(payRow.unit_number || '').trim().toUpperCase()
          if (!unitNumber || !payRow.payment_date || payRow.amount_paid <= 0) continue

          const unit = dbService.get<{ id: number }>(
            `SELECT id FROM units
             WHERE project_id = ? AND UPPER(TRIM(unit_number)) = ?`,
            [projectId, unitNumber]
          )
          if (!unit) continue

          const fy = String(payRow.financial_year || '').trim()
          const letter = dbService.get<{ id: number; final_amount: number }>(
            `SELECT id, final_amount FROM maintenance_letters
             WHERE unit_id = ? AND financial_year = ?`,
            [unit.id, fy]
          )

          const mode = String(payRow.payment_mode || 'Transfer')
          const validModes = ['Cash', 'Cheque', 'UPI', 'Transfer']
          const safeMode = validModes.includes(mode) ? mode : 'Transfer'

          const result = dbService.run(
            `INSERT INTO payments
               (project_id, unit_id, letter_id, payment_date, payment_amount,
                financial_year, payment_mode, cheque_number, remarks, payment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Received')`,
            [
              projectId,
              unit.id,
              letter?.id || null,
              payRow.payment_date,
              payRow.amount_paid,
              fy,
              safeMode,
              payRow.cheque_number || null,
              payRow.remarks || null
            ]
          )

          const paymentId = result.lastInsertRowid as number

          // Auto-generate receipt record
          const receiptNumber = payRow.receipt_number || `REC-${paymentId}`
          try {
            dbService.run(
              `INSERT OR IGNORE INTO receipts (payment_id, receipt_number, receipt_date)
               VALUES (?, ?, ?)`,
              [paymentId, receiptNumber, payRow.payment_date]
            )
          } catch {
            // receipt already exists — skip
          }

          // Sync letter paid status if linked
          if (letter?.id) {
            const totalPaid = dbService.get<{ total: number }>(
              `SELECT COALESCE(SUM(payment_amount), 0) as total FROM payments
               WHERE letter_id = ? AND payment_status = 'Received'`,
              [letter.id]
            )?.total || 0
            const isPaid = totalPaid + 0.01 >= letter.final_amount
            dbService.run(
              'UPDATE maintenance_letters SET status = ?, is_paid = ? WHERE id = ?',
              [isPaid ? 'Paid' : 'Pending', isPaid ? 1 : 0, letter.id]
            )
          }

          importedPaymentCount += 1
        } catch {
          // Skip bad payment rows silently — don't abort the whole import
        }
      }

      const importedLetterCount = rows.reduce((count, row) => {
        const years = Array.isArray(row.years) ? row.years : []
        return count + years.length
      }, 0)

      return {
        project_id: projectId,
        project_code: this.getById(projectId)?.project_code || '',
        project_name: mergedProject.name,
        created: !existingProject?.id,
        imported_units: rows.length,
        imported_letters: importedLetterCount,
        imported_rates: importedRateCount,
        imported_payments: importedPaymentCount,
        sector_configs_merged: sectorConfigsMerged
      }
    })
  }

  public getSetupSummary(projectId: number, financialYear?: string): ProjectSetupSummary {
    const project = this.getById(projectId)
    if (!project) {
      throw new Error(`Project ${projectId} not found`)
    }

    const unitCount =
      dbService.get<{ count: number }>('SELECT COUNT(*) as count FROM units WHERE project_id = ?', [
        projectId
      ])?.count || 0

    const sectorCodes = dbService
      .query<{ sector_code: string }>(
        `
        SELECT DISTINCT UPPER(TRIM(sector_code)) as sector_code
        FROM units
        WHERE project_id = ?
          AND sector_code IS NOT NULL
          AND TRIM(sector_code) <> ''
        ORDER BY sector_code COLLATE NOCASE ASC
      `,
        [projectId]
      )
      .map((row) => row.sector_code)

    const unitTypes = dbService
      .query<{ unit_type: string | null }>(
        `
        SELECT DISTINCT unit_type
        FROM units
        WHERE project_id = ?
      `,
        [projectId]
      )
      .map((row) => this.normalizeUnitType(row.unit_type))
      .filter((value, index, arr) => value && arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))

    const sectorConfigRows = dbService.query<{
      sector_code: string
      has_qr: number
    }>(
      `
      SELECT
        UPPER(TRIM(sector_code)) as sector_code,
        CASE
          WHEN TRIM(COALESCE(qr_code_path, '')) <> ''
          THEN 1 ELSE 0
        END as has_qr
      FROM project_sector_payment_configs
      WHERE project_id = ?
    `,
      [projectId]
    )

    const configuredSectorCodes = sectorConfigRows
      .filter((row) => row.has_qr === 1)
      .map((row) => row.sector_code)
      .filter((value, index, arr) => value && arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))

    const sectorsWithQr = new Set(
      sectorConfigRows.filter((row) => row.has_qr === 1).map((row) => row.sector_code)
    )

    const hasDefaultPaymentDetails =
      !!String(project.account_name || '').trim() &&
      !!String(project.bank_name || '').trim() &&
      !!String(project.account_no || '').trim() &&
      !!String(project.ifsc_code || '').trim()
    const hasDefaultQr = !!String(project.qr_code_path || '').trim()

    const sectorsWithoutQrCoverage = sectorCodes.filter(
      (sectorCode) => !hasDefaultQr && !sectorsWithQr.has(sectorCode)
    )

    const rateYears = dbService
      .query<{ financial_year: string }>(
        `
        SELECT DISTINCT financial_year
        FROM maintenance_rates
        WHERE project_id = ?
        ORDER BY financial_year DESC
      `,
        [projectId]
      )
      .map((row) => row.financial_year)

    const effectiveFinancialYear = String(financialYear || '').trim()
    const hasRateForFinancialYear = effectiveFinancialYear
      ? rateYears.includes(effectiveFinancialYear)
      : rateYears.length > 0

    let missingRateUnitTypes: string[] = []
    if (effectiveFinancialYear) {
      const rateTypes = dbService
        .query<{ unit_type: string | null }>(
          `
          SELECT DISTINCT unit_type
          FROM maintenance_rates
          WHERE project_id = ?
            AND financial_year = ?
        `,
          [projectId, effectiveFinancialYear]
        )
        .map((row) => this.normalizeUnitType(row.unit_type))
        .filter(Boolean)

      const rateTypeSet = new Set(rateTypes)
      const coversAllUnits = rateTypeSet.has('All')
      missingRateUnitTypes = coversAllUnits
        ? []
        : unitTypes.filter((unitType) => unitType !== 'All' && !rateTypeSet.has(unitType))
    }

    const blockers: string[] = []
    const warnings: string[] = []

    if (unitCount === 0) {
      blockers.push('Import units before generating maintenance letters.')
    }

    if (effectiveFinancialYear) {
      if (!hasRateForFinancialYear) {
        blockers.push(`Add maintenance rates for FY ${effectiveFinancialYear}.`)
      } else if (missingRateUnitTypes.length > 0) {
        blockers.push(
          `Add FY ${effectiveFinancialYear} rates for unit types: ${missingRateUnitTypes.join(', ')}.`
        )
      }
    } else if (rateYears.length === 0) {
      warnings.push('No maintenance rates are configured yet.')
    }

    // Validate required bank details
    if (!hasDefaultPaymentDetails) {
      blockers.push(
        'Bank details are incomplete - Account Name, Bank Name, Account Number, and IFSC Code are required'
      )
    }

    if (!project.import_profile_key) {
      warnings.push('Import profile is not selected. Excel parsing may be inconsistent.')
    }

    if (!project.template_type) {
      warnings.push(
        'Template type is not selected. Standard maintenance letter layout will be used.'
      )
    }

    if (sectorCodes.length > 1 && configuredSectorCodes.length === 0) {
      warnings.push(
        'Multiple sectors detected. Add sector payment configs if different sectors use different bank accounts or barcodes.'
      )
    }

    if (sectorsWithoutQrCoverage.length > 0) {
      warnings.push(
        `QR/barcode image is missing for: ${sectorsWithoutQrCoverage.join(', ')}. Letters will generate without a scannable code for those sectors.`
      )
    }

    return {
      project_id: projectId,
      project_name: project.name,
      template_type: project.template_type,
      import_profile_key: project.import_profile_key,
      unit_count: unitCount,
      sector_codes: sectorCodes,
      configured_sector_codes: configuredSectorCodes,
      sectors_missing_core_payment_config: [],
      sectors_without_qr_coverage: sectorsWithoutQrCoverage,
      unit_types: unitTypes,
      rate_years: rateYears,
      has_default_payment_details: hasDefaultPaymentDetails,
      has_default_qr: hasDefaultQr,
      has_rate_for_financial_year: hasRateForFinancialYear,
      missing_rate_unit_types: missingRateUnitTypes,
      blockers,
      warnings,
      ready_for_letters: blockers.length === 0
    }
  }

  public getSetupSummaries(financialYear?: string): ProjectSetupSummary[] {
    return this.getAll().map((project) => this.getSetupSummary(project.id as number, financialYear))
  }
}

export const projectService = new ProjectService()
