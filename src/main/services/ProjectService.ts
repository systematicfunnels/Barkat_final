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
  imported_rates: number
  imported_payments: number
  sector_configs_merged: boolean
}

class ProjectService {
  private sanitizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : String(value || '').trim()
  }

  private normalizeProjectStatus(status: unknown): string {
    const normalized = this.sanitizeText(status).toLowerCase()
    if (normalized === 'active' || normalized === 'sold') return 'Active'
    if (normalized === 'inactive' || normalized === 'unsold') return 'Inactive'
    return 'Active' // Default fallback
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
    try {
      console.log('[PROJECT_SERVICE] getAll: Querying all projects...')
      
      // Add debug info about database connection
      console.log('[PROJECT_SERVICE] getAll: Database connection status: Active')
      
      const projects = dbService.query<Project>(`
        SELECT p.*, 0 as unit_count
        FROM projects p 
        ORDER BY p.name ASC
      `)
      
      console.log(`[PROJECT_SERVICE] getAll: Found ${projects.length} projects`)
      
      // Log the actual query results for debugging
      if (projects.length === 0) {
        console.log('[PROJECT_SERVICE] getAll: No projects found. Checking if table exists...')
        
        // Check if projects table exists
        const tableCheck = dbService.query(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='projects'
        `)
        console.log(`[PROJECT_SERVICE] getAll: Projects table exists: ${tableCheck.length > 0}`)
        
        if (tableCheck.length > 0) {
          // Check table structure
          const tableInfo = dbService.query(`PRAGMA table_info(projects)`)
          console.log('[PROJECT_SERVICE] getAll: Projects table structure:', tableInfo)
          
          // Check row count with raw query
          const rawCount = dbService.query(`SELECT COUNT(*) as count FROM projects`)
          console.log('[PROJECT_SERVICE] getAll: Raw count query result:', rawCount)
        }
      }
      
      // Debug logging for projects without codes
      const projectsWithoutCodes = projects.filter(p => !p.project_code)
      if (projectsWithoutCodes.length > 0) {
        console.log(`[PROJECT_SERVICE] Found ${projectsWithoutCodes.length} projects without codes:`, projectsWithoutCodes.map(p => ({ id: p.id, name: p.name })))
      }
      
      // Log first few projects for debugging
      if (projects.length > 0) {
        console.log('[PROJECT_SERVICE] getAll: First few projects:', projects.slice(0, 3).map(p => ({ id: p.id, name: p.name, code: p.project_code })))
      }
      
      return projects
    } catch (error) {
      console.error('[PROJECT_SERVICE] getAll: Error querying projects:', error)
      console.error('[PROJECT_SERVICE] getAll: Error stack:', error instanceof Error ? error.stack : 'No stack trace')
      return []
    }
  }

  public getById(id: number): Project | undefined {
    return dbService.get<Project>('SELECT * FROM projects WHERE id = ?', [id])
  }

  public create(project: Project): number {
    console.log(`[PROJECT_SERVICE] Creating project: ${project.name}`)
    
    try {
      const result = dbService.run(
        `INSERT INTO projects (name, address, city, state, pincode, status, account_name, bank_name, account_no, ifsc_code, branch, branch_address, qr_code_path, letterhead_path, template_type, import_profile_key, contact_email, contact_phone, payment_modes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.sanitizeText(project.name),
          this.sanitizeText(project.address),
          this.sanitizeText(project.city),
          this.sanitizeText(project.state),
          this.sanitizeText(project.pincode),
          this.normalizeProjectStatus(project.status || 'Active'),
          this.sanitizeText(project.account_name),
          this.sanitizeText(project.bank_name),
          this.sanitizeText(project.account_no),
          this.sanitizeText(project.ifsc_code).toUpperCase(),
          this.sanitizeText(project.branch),
          this.sanitizeText(project.branch_address),
          this.sanitizeText(project.qr_code_path),
          this.sanitizeText(project.letterhead_path),
          this.normalizeTemplateType(project.template_type),
          this.normalizeImportProfile(project.import_profile_key),
          this.sanitizeText(project.contact_email),
          this.sanitizeText(project.contact_phone),
          this.sanitizeText(project.payment_modes)
        ]
      )
      const projectId = result.lastInsertRowid as number
      console.log(`[PROJECT_SERVICE] Project created with ID: ${projectId}`)
      
      // Ensure project code is generated for the new project
      this.ensureProjectCode(projectId)
      
      // Verify the project was actually created
      const verification = this.getById(projectId)
      if (verification) {
        console.log(`[PROJECT_SERVICE] Project verification successful: ${verification.name} (ID: ${verification.id}, Code: ${verification.project_code})`)
      } else {
        console.error(`[PROJECT_SERVICE] Project verification failed for ID: ${projectId}`)
      }
      
      return projectId
    } catch (error) {
      console.error(`[PROJECT_SERVICE] Failed to create project:`, error)
      throw error
    }
  }

  private ensureProjectCode(projectId: number): void {
    try {
      console.log(`[PROJECT_SERVICE] Ensuring project code for ID: ${projectId}`)
      
      // Use a transaction to ensure atomicity and prevent race conditions
      dbService.transaction(() => {
        // Check if project already has a code
        const existingCode = dbService.get<{ project_code: string | null }>(
          'SELECT project_code FROM projects WHERE id = ?',
          [projectId]
        )?.project_code

        if (existingCode) {
          console.log(`[PROJECT_SERVICE] Project ${projectId} already has code: ${existingCode}`)
          return
        }

        // Get the next available sequence number with proper locking
        const maxCode = dbService.get<{ max_code: string | null }>(
          `SELECT MAX(project_code) as max_code FROM projects WHERE project_code LIKE 'PRJ-%'`
        )?.max_code

        let nextSequence = 1
        if (maxCode) {
          const match = maxCode.match(/^PRJ-(\d+)$/)
          if (match) {
            nextSequence = Number(match[1]) + 1
          }
        }

        // Generate unique project code with collision detection
        let candidate = this.formatProjectCode(nextSequence)
        let attempts = 0
        while (attempts < 1000) { // Safety limit
          const existing = dbService.get<{ id: number }>(
            'SELECT id FROM projects WHERE project_code = ?',
            [candidate]
          )
          if (!existing) {
            break
          }
          nextSequence += 1
          candidate = this.formatProjectCode(nextSequence)
          attempts += 1
        }

        if (attempts >= 1000) {
          console.error(`[PROJECT_SERVICE] Failed to generate unique project code after 1000 attempts for project ${projectId}`)
          return
        }

        // Update the project with the generated code
        dbService.run('UPDATE projects SET project_code = ? WHERE id = ?', [candidate, projectId])
        console.log(`[PROJECT_SERVICE] Generated project code ${candidate} for project ${projectId}`)
        
        // Verify the update
        const verification = dbService.get<{ project_code: string }>(
          'SELECT project_code FROM projects WHERE id = ?',
          [projectId]
        )
        if (verification?.project_code === candidate) {
          console.log(`[PROJECT_SERVICE] Project code verification successful: ${candidate}`)
        } else {
          console.error(`[PROJECT_SERVICE] Project code verification failed for project ${projectId}`)
        }
      })
      
    } catch (error) {
      console.error(`[PROJECT_SERVICE] Failed to generate project code for project ${projectId}:`, error)
      // Don't throw - project creation should still succeed even if code generation fails
    }
  }

  private formatProjectCode(sequenceNumber: number): string {
    return `PRJ-${String(sequenceNumber).padStart(3, '0')}`
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
    console.log(`[PROJECT_SERVICE] Getting sector configs for project ID: ${projectId}`)
    const configs = dbService.query<ProjectSectorPaymentConfig>(
      `
      SELECT *
      FROM project_sector_payment_configs
      WHERE project_id = ?
      ORDER BY sector_code COLLATE NOCASE ASC
    `,
      [projectId]
    )
    console.log(`[PROJECT_SERVICE] Found ${configs.length} sector configs for project ${projectId}`)
    return configs
  }

  public saveSectorPaymentConfigs(
    projectId: number,
    configs: Partial<ProjectSectorPaymentConfig>[]
  ): boolean {
    console.log(`[PROJECT_SERVICE] Saving ${configs.length} sector configs for project ID: ${projectId}:`, configs)
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
    console.log(`[PROJECT_SERVICE] Starting import for project: ${payload.project?.name}`)

    let projectId: number
    let created = false

    return dbService.transaction(() => {
      const projectName = this.sanitizeText(payload?.project?.name)
      if (!projectName) {
        throw new Error('Project name is required for workbook import')
      }

      console.log(`[PROJECT_SERVICE] Looking for existing project: ${projectName}`)
      const existingProject = this.getByName(projectName)
      console.log(
        `[PROJECT_SERVICE] Existing project found:`,
        existingProject ? `ID ${existingProject.id}` : 'None'
      )

      const mergedProject = this.mergeImportedProject(existingProject, payload.project)

      if (existingProject?.id) {
        console.log(`[PROJECT_SERVICE] Updating existing project ID: ${existingProject.id}`)
        this.update(existingProject.id, mergedProject)
        projectId = existingProject.id
        console.log(`[PROJECT_SERVICE] Project updated successfully`)
      } else {
        console.log(`[PROJECT_SERVICE] Creating new project: ${projectName}`)
        projectId = this.createInline(mergedProject)
        console.log(`[PROJECT_SERVICE] New project created with ID: ${projectId}`)
        created = true
      }

      const incomingSectorConfigs = Array.isArray(payload.sector_configs)
        ? payload.sector_configs
            .map((config) => this.normalizeSectorConfig(config))
            .filter((config): config is Partial<ProjectSectorPaymentConfig> => config !== null)
        : []
      console.log(`[PROJECT_SERVICE] Normalized sector configs: ${incomingSectorConfigs.length}`)

      const incomingSectorDetailConfigs = incomingSectorConfigs.filter((config) =>
        this.hasSectorConfigDetails(config)
      )
      console.log(
        `[PROJECT_SERVICE] Sector configs with details: ${incomingSectorDetailConfigs.length}`
      )

      let sectorConfigsMerged = false
      if (incomingSectorDetailConfigs.length > 0) {
        console.log(`[PROJECT_SERVICE] Processing sector configs...`)
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
        console.log(`[PROJECT_SERVICE] Sector configs saved`)
      } else {
        console.log(`[PROJECT_SERVICE] No sector configs with details to save`)
      }

      const rows = Array.isArray(payload.rows) ? payload.rows : []
      console.log(`[PROJECT_SERVICE] Processing rows: ${rows.length}`)
      if (rows.length > 0) {
        unitService.importLedger(projectId, rows as unknown as Record<string, unknown>[])
        console.log(`[PROJECT_SERVICE] Rows imported`)
      }

      // ── Import Rates ──────────────────────────────────────────────────────────
      let importedRateCount = 0
      const rateRows = Array.isArray(payload.rates) ? payload.rates : []
      console.log(`[PROJECT_SERVICE] Processing rates: ${rateRows.length}`)
      for (const rateRow of rateRows) {
        const fy = String(rateRow.financial_year || '').trim()
        if (!fy) continue

        const unitType = this.normalizeUnitType(rateRow.unit_type)
        const ratePerSqft = Number(rateRow.rate_per_sqft || 0)
        const gstPercent = Number(rateRow.gst_percent || 0)

        const existingRate = dbService.get<{ id: number }>(
          'SELECT id FROM maintenance_rates WHERE project_id = ? AND financial_year = ? AND unit_type = ?',
          [projectId, fy, unitType]
        )

        if (existingRate) {
          dbService.run(
            `UPDATE maintenance_rates SET rate_per_sqft = ?, gst_percent = ?, updated_at = CURRENT_TIMESTAMP
             WHERE project_id = ? AND financial_year = ? AND unit_type = ?`,
            [ratePerSqft, gstPercent, projectId, fy, unitType]
          )
        } else {
          dbService.run(
            `INSERT INTO maintenance_rates (project_id, financial_year, unit_type, rate_per_sqft, gst_percent)
             VALUES (?, ?, ?, ?, ?)`,
            [projectId, fy, unitType, ratePerSqft, gstPercent]
          )
        }
        importedRateCount += 1
      }
      console.log(`[PROJECT_SERVICE] Rates imported: ${importedRateCount}`)

      // ── Import Payments ───────────────────────────────────────────────────────
      let importedPaymentCount = 0
      const paymentRows = Array.isArray(payload.payments) ? payload.payments : []
      console.log(`[PROJECT_SERVICE] Processing payments: ${paymentRows.length}`)
      for (const payRow of paymentRows) {
        try {
          const fy = String(payRow.financial_year || '').trim()
          const unitNumber = String(payRow.unit_number || '').trim()
          const paymentDate = String(payRow.payment_date || '').trim()
          const amountPaid = Number(payRow.amount_paid || 0)
          const paymentMode = String(payRow.payment_mode || '').trim()

          if (!fy || !unitNumber || !paymentDate || amountPaid <= 0) continue

          const unit = dbService.get<{ id: number }>(
            'SELECT id FROM units WHERE project_id = ? AND unit_number = ?',
            [projectId, unitNumber]
          )

          if (!unit) continue

          const letter = dbService.get<{ id: number; final_amount: number }>(
            'SELECT id, final_amount FROM maintenance_letters WHERE project_id = ? AND unit_id = ? AND financial_year = ?',
            [projectId, unit.id, fy]
          )

          const safeMode = ['cash', 'cheque', 'dd', 'neft', 'rtgs', 'upi']
            .includes(paymentMode.toLowerCase())
            ? paymentMode
            : 'Other'

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

          if (letter?.id) {
            const totalPaid =
              dbService.get<{ total: number }>(
                `SELECT COALESCE(SUM(payment_amount), 0) as total FROM payments
                 WHERE letter_id = ? AND payment_status = 'Received'`,
                [letter.id]
              )?.total || 0
            const isPaid = totalPaid + 0.01 >= letter.final_amount
            dbService.run('UPDATE maintenance_letters SET status = ?, is_paid = ? WHERE id = ?', [
              isPaid ? 'Paid' : 'Pending',
              isPaid ? 1 : 0,
              letter.id
            ])
          }

          importedPaymentCount += 1
        } catch {
          // Skip bad payment rows silently — don't abort the whole import
        }
      }
      console.log(`[PROJECT_SERVICE] Payments imported: ${importedPaymentCount}`)

      const importedLetterCount = rows.reduce((count, row) => {
        const years = Array.isArray(row.years) ? row.years : []
        return count + years.length
      }, 0)

      console.log(
        `[PROJECT_SERVICE] Import completed for project: ${projectName} (ID: ${projectId})`
      )
      console.log(
        `[PROJECT_SERVICE] Summary - Letters: ${importedLetterCount}, Rates: ${importedRateCount}, Payments: ${importedPaymentCount}, Sector Configs: ${incomingSectorConfigs.length}`
      )

      // Only generate code if it's a new project and doesn't have one
      this.ensureProjectCodeInline(projectId)

      return {
        project_id: projectId,
        project_code: this.getById(projectId)?.project_code || '',
        project_name: mergedProject.name,
        created,
        imported_units: rows.length,
        imported_letters: importedLetterCount,
        imported_rates: importedRateCount,
        imported_payments: importedPaymentCount,
        sector_configs_merged: sectorConfigsMerged
      }
    })
  }

  private createInline(project: Project): number {
    const result = dbService.run(
      `INSERT INTO projects (name, address, city, state, pincode, status, account_name, bank_name, account_no, ifsc_code, branch, branch_address, qr_code_path, letterhead_path, template_type, import_profile_key, contact_email, contact_phone, payment_modes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.sanitizeText(project.name),
        this.sanitizeText(project.address),
        this.sanitizeText(project.city),
        this.sanitizeText(project.state),
        this.sanitizeText(project.pincode),
        this.normalizeProjectStatus(project.status || 'Active'),
        this.sanitizeText(project.account_name),
        this.sanitizeText(project.bank_name),
        this.sanitizeText(project.account_no),
        this.sanitizeText(project.ifsc_code).toUpperCase(),
        this.sanitizeText(project.branch),
        this.sanitizeText(project.branch_address),
        this.sanitizeText(project.qr_code_path),
        this.sanitizeText(project.letterhead_path),
        this.normalizeTemplateType(project.template_type),
        this.normalizeImportProfile(project.import_profile_key),
        this.sanitizeText(project.contact_email),
        this.sanitizeText(project.contact_phone),
        this.sanitizeText(project.payment_modes)
      ]
    )
    return result.lastInsertRowid as number
  }

  private ensureProjectCodeInline(projectId: number): void {
    // Check if project already has a code
    const existingCode = dbService.get<{ project_code: string | null }>(
      'SELECT project_code FROM projects WHERE id = ?',
      [projectId]
    )?.project_code

    if (existingCode) return

    // Get the next available sequence number
    const maxCode = dbService.get<{ max_code: string | null }>(
      `SELECT MAX(project_code) as max_code FROM projects WHERE project_code LIKE 'PRJ-%'`
    )?.max_code

    let nextSequence = 1
    if (maxCode) {
      const match = maxCode.match(/^PRJ-(\d+)$/)
      if (match) {
        nextSequence = Number(match[1]) + 1
      }
    }

    // Generate unique project code
    let candidate = this.formatProjectCode(nextSequence)
    let attempts = 0
    while (attempts < 1000) {
      const existing = dbService.get<{ id: number }>(
        'SELECT id FROM projects WHERE project_code = ?',
        [candidate]
      )
      if (!existing) break
      nextSequence += 1
      candidate = this.formatProjectCode(nextSequence)
      attempts += 1
    }

    dbService.run('UPDATE projects SET project_code = ? WHERE id = ?', [candidate, projectId])
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
      account_name: string | null
      bank_name: string | null
      account_no: string | null
      ifsc_code: string | null
    }>(
      `
      SELECT
        UPPER(TRIM(sector_code)) as sector_code,
        CASE
          WHEN TRIM(COALESCE(qr_code_path, '')) <> ''
          THEN 1 ELSE 0
        END as has_qr,
        account_name,
        bank_name,
        account_no,
        ifsc_code
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

    // Check if any sector has individual bank details (this covers the project)
    const sectorsWithBankDetails = sectorConfigRows.filter((row) => {
      // We check if it has the core 4 fields
      return !!row.sector_code && 
             !!row.account_name && 
             !!row.bank_name && 
             !!row.account_no && 
             !!row.ifsc_code
    })

    const hasDefaultPaymentDetails =
      !!String(project.account_name || '').trim() &&
      !!String(project.bank_name || '').trim() &&
      !!String(project.account_no || '').trim() &&
      !!String(project.ifsc_code || '').trim()

    // If the project has default details OR all sectors have details, it's ready.
    // For simpler logic: if project has default, it's fine. 
    // If not, check if every detected sector in 'sectorCodes' has a corresponding config in 'sectorsWithBankDetails'
    const allSectorsConfigured = sectorCodes.length > 0 && 
      sectorCodes.every(sc => sectorsWithBankDetails.some(swb => swb.sector_code === sc))

    const isBankDetailsReady = hasDefaultPaymentDetails || allSectorsConfigured
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
    const currentYear = new Date().getFullYear()
    const currentMonth = new Date().getMonth() // 0-indexed
    const computedFY = currentMonth < 3 
      ? `${currentYear - 1}-${String(currentYear).slice(2)}`
      : `${currentYear}-${String(currentYear + 1).slice(2)}`
    
    const targetFY = effectiveFinancialYear || computedFY
    const hasRateForTargetFY = rateYears.includes(targetFY)

    let missingRateUnitTypes: string[] = []
    if (targetFY) {
      const rateTypes = dbService
        .query<{ unit_type: string | null }>(
          `
          SELECT DISTINCT unit_type
          FROM maintenance_rates
          WHERE project_id = ?
            AND financial_year = ?
        `,
          [projectId, targetFY]
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

    if (!hasRateForTargetFY) {
      blockers.push(`Add maintenance rates for FY ${targetFY}.`)
    } else if (missingRateUnitTypes.length > 0) {
      blockers.push(
        `Add FY ${targetFY} rates for unit types: ${missingRateUnitTypes.join(', ')}.`
      )
    }

    // Validate required bank details
    if (!isBankDetailsReady) {
      blockers.push(
        'Bank details are incomplete - Account Name, Bank Name, Account Number, and IFSC Code are required (at Project or Sector level)'
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
      has_rate_for_financial_year: hasRateForTargetFY,
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
