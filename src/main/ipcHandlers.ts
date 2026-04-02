import { dialog, ipcMain, shell, app } from 'electron'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { dbService } from './db/database'
import {
  projectService,
  Project,
  ProjectSectorPaymentConfig,
  ProjectSetupSummary,
  StandardWorkbookProjectImportPayload,
  StandardWorkbookProjectImportResult
} from './services/ProjectService'
import { unitService, Unit } from './services/UnitService'
import { maintenanceLetterService, MaintenanceLetter } from './services/MaintenanceLetterService'
import { paymentService, Payment } from './services/PaymentService'
import {
  maintenanceRateService,
  MaintenanceRate,
  MaintenanceSlab
} from './services/MaintenanceRateService'
import {
  detailedMaintenanceLetterService,
  LetterCalculation
} from './services/DetailedMaintenanceLetterService'
import { reportService, FinancialReportFilters } from './services/ReportService'
import { dryRunService } from './services/DryRunService'
import { errorLogger, getSafeErrorMessage, ValidationError } from './utils/errorHandler'
import { workerPool, WorkerTask } from './utils/workerPool'
import { backupService } from './services/BackupService'
import { batchOperationsService } from './services/BatchOperationsService'
import { addonTemplateService } from './services/AddonTemplateService'
import { ProjectStatus, UnitStatus } from './types/enums'

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const toPositiveInteger = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const num = Number(value)
  return Number.isInteger(num) && num > 0 ? num : null
}

const escapePowerShellLiteral = (value: string): string => value.replace(/'/g, "''")

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0

const isPositiveIntegerAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

const isFinancialYear = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)

const sanitizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// Enum validation helpers
const isValidProjectStatus = (value: unknown): value is ProjectStatus =>
  typeof value === 'string' && Object.values(ProjectStatus).includes(value as ProjectStatus)

const isValidUnitStatus = (value: unknown): value is UnitStatus =>
  typeof value === 'string' && Object.values(UnitStatus).includes(value as UnitStatus)

export function registerIpcHandlers(): void {
  // Projects
  ipcMain.handle('get-projects', (): Project[] => {
    return projectService.getAll()
  })

  ipcMain.handle('get-project', (_, id: number): Project | undefined => {
    return projectService.getById(id)
  })

  ipcMain.handle(
    'get-project-setup-summary',
    (_, projectId: number, financialYear?: string): ProjectSetupSummary => {
      if (!isPositiveInteger(projectId)) {
        throw new Error('Invalid project selected')
      }
      if (
        financialYear !== undefined &&
        financialYear !== null &&
        !isFinancialYear(financialYear)
      ) {
        throw new Error('Invalid financial year format (expected YYYY-YY)')
      }
      return projectService.getSetupSummary(projectId, financialYear)
    }
  )

  ipcMain.handle(
    'get-project-setup-summaries',
    (_, financialYear?: string): ProjectSetupSummary[] => {
      if (
        financialYear !== undefined &&
        financialYear !== null &&
        !isFinancialYear(financialYear)
      ) {
        throw new Error('Invalid financial year format (expected YYYY-YY)')
      }
      return projectService.getSetupSummaries(financialYear)
    }
  )

  ipcMain.handle('create-project', (_, project: Project): number => {
    if (!sanitizeText(project?.name)) {
      throw new Error('Project name is required')
    }
    return projectService.create(project)
  })

  ipcMain.handle(
    'import-standard-workbook-project',
    (_, payload: StandardWorkbookProjectImportPayload): StandardWorkbookProjectImportResult => {
      if (!payload || !sanitizeText(payload.project?.name)) {
        throw new Error('Project name is required for workbook import')
      }
      if (!Array.isArray(payload.rows)) {
        throw new Error('Invalid workbook import rows payload')
      }
      if (payload.sector_configs !== undefined && !Array.isArray(payload.sector_configs)) {
        throw new Error('Invalid workbook sector config payload')
      }
      if (payload.rates !== undefined && !Array.isArray(payload.rates)) {
        throw new Error('Invalid workbook rate payload')
      }
      if (Array.isArray(payload.rates)) {
        for (const rate of payload.rates) {
          if (!isFinancialYear(rate?.financial_year)) {
            throw new Error('Each imported rate requires a valid financial year (YYYY-YY)')
          }
          if (!sanitizeText(rate?.unit_type)) {
            throw new Error('Each imported rate requires a unit type')
          }
          if (!isPositiveNumber(rate?.rate_per_sqft)) {
            throw new Error('Each imported rate requires a rate per sqft greater than 0')
          }
          if (
            rate?.gst_percent !== undefined &&
            (!isNonNegativeNumber(rate.gst_percent) || rate.gst_percent > 100)
          ) {
            throw new Error('Imported GST percentage must be between 0 and 100')
          }

          const importedPenalty =
            rate?.penalty_percentage !== undefined ? rate.penalty_percentage : rate?.penalty_percent
          if (
            importedPenalty !== undefined &&
            importedPenalty !== null &&
            (!isNonNegativeNumber(importedPenalty) || importedPenalty > 100)
          ) {
            throw new Error('Imported penalty percentage must be between 0 and 100')
          }

          const importedDiscount =
            rate?.discount_percentage !== undefined
              ? rate.discount_percentage
              : rate?.discount_percent
          if (
            importedDiscount !== undefined &&
            importedDiscount !== null &&
            (!isNonNegativeNumber(importedDiscount) || importedDiscount > 100)
          ) {
            throw new Error('Imported discount percentage must be between 0 and 100')
          }

          if (rate?.due_date !== undefined && sanitizeText(rate.due_date) && !isIsoDate(rate.due_date)) {
            throw new Error('Imported rate due date must be in YYYY-MM-DD format')
          }
        }
      }
      return projectService.importStandardWorkbookProject(payload)
    }
  )

  ipcMain.handle('update-project', (_, id: number, project: Partial<Project>): boolean => {
    if (project.status !== undefined && !isValidProjectStatus(project.status)) {
      throw new Error(
        `Invalid project status. Expected: ${Object.values(ProjectStatus).join(', ')}`
      )
    }
    return projectService.update(id, project)
  })

  ipcMain.handle(
    'get-project-sector-configs',
    (_, projectId: number): ProjectSectorPaymentConfig[] => {
      if (!isPositiveInteger(projectId)) {
        throw new Error('Invalid project selected')
      }
      return projectService.getSectorPaymentConfigs(projectId)
    }
  )

  ipcMain.handle(
    'save-project-sector-configs',
    (_, projectId: number, configs: Partial<ProjectSectorPaymentConfig>[]): boolean => {
      if (!isPositiveInteger(projectId)) {
        throw new Error('Invalid project selected')
      }
      if (!Array.isArray(configs)) {
        throw new Error('Invalid sector payment configs payload')
      }

      const seenSectors = new Set<string>()
      for (const config of configs) {
        const hasAnyValue = [config.sector_code, config.qr_code_path].some(
          (value) => sanitizeText(value).length > 0
        )
        if (!hasAnyValue) continue

        const normalizedSector = sanitizeText(config.sector_code).toUpperCase()
        if (!normalizedSector) {
          throw new Error('Sector code is required for each sector payment config row')
        }
        if (seenSectors.has(normalizedSector)) {
          throw new Error(`Duplicate sector code: ${normalizedSector}`)
        }
        seenSectors.add(normalizedSector)
      }

      return projectService.saveSectorPaymentConfigs(projectId, configs)
    }
  )

  ipcMain.handle('get-project-charges-config', (_, projectId: number) => {
    if (!isPositiveInteger(projectId)) {
      throw new Error('Invalid project selected')
    }
    return projectService.getChargesConfig(projectId)
  })

  ipcMain.handle('save-project-charges-config', (_, config) => {
    if (!isPositiveInteger(config?.project_id)) {
      throw new Error('Invalid project selected')
    }
    if (!isNonNegativeNumber(config?.na_tax_rate_per_sqft)) {
      throw new Error('N.A. tax rate must be >= 0')
    }
    if (!isNonNegativeNumber(config?.solar_contribution)) {
      throw new Error('Solar contribution must be >= 0')
    }
    if (!isNonNegativeNumber(config?.cable_charges)) {
      throw new Error('Cable charges must be >= 0')
    }
    if (!isNonNegativeNumber(config?.penalty_percentage) || config?.penalty_percentage > 100) {
      throw new Error('Penalty percentage must be between 0 and 100')
    }
    if (
      !isNonNegativeNumber(config?.early_payment_discount_percentage) ||
      config?.early_payment_discount_percentage > 100
    ) {
      throw new Error('Early payment discount percentage must be between 0 and 100')
    }
    return projectService.saveChargesConfig(config)
  })

  ipcMain.handle('delete-project', (_, id: number): boolean => {
    return projectService.delete(id)
  })

  ipcMain.handle('bulk-delete-projects', (_, ids: number[]): boolean => {
    return projectService.bulkDelete(ids)
  })

  ipcMain.handle(
    'get-dashboard-stats',
    (_, projectId?: number, financialYear?: string, unitType?: string, status?: string) => {
      return projectService.getDashboardStats(projectId, financialYear, unitType, status)
    }
  )

  // Units
  ipcMain.handle('get-units', (): Unit[] => {
    return unitService.getAll()
  })

  ipcMain.handle('get-units-by-project', (_, projectId: number): Unit[] => {
    return unitService.getByProject(projectId)
  })

  ipcMain.handle('create-unit', (_, unit: Unit): number => {
    if (!isPositiveInteger(unit?.project_id)) {
      throw new Error('Invalid project selected for unit')
    }
    if (!sanitizeText(unit?.unit_number)) {
      throw new Error('Unit number is required')
    }
    if (!sanitizeText(unit?.owner_name)) {
      throw new Error('Owner name is required')
    }
    if (!isPositiveNumber(unit?.area_sqft)) {
      throw new Error('Area must be greater than 0')
    }
    return unitService.create(unit)
  })

  ipcMain.handle('update-unit', (_, id: number, unit: Partial<Unit>): boolean => {
    if (unit.status !== undefined && !isValidUnitStatus(unit.status)) {
      throw new Error(`Invalid unit status. Expected: ${Object.values(UnitStatus).join(', ')}`)
    }
    return unitService.update(id, unit)
  })

  ipcMain.handle('delete-unit', (_, id: number): boolean => {
    return unitService.delete(id)
  })

  ipcMain.handle('bulk-delete-units', (_, ids: number[]): boolean => {
    return unitService.bulkDelete(ids)
  })

  ipcMain.handle('bulk-create-units', (_, units: Unit[]): boolean => {
    return unitService.bulkCreate(units)
  })

  ipcMain.handle('import-units', (_, units: Unit[]): boolean => {
    if (!Array.isArray(units) || units.length === 0) {
      throw new Error('No units provided for import')
    }

    units.forEach((unit, index) => {
      if (!isPositiveInteger(unit?.project_id)) {
        throw new Error(`Row ${index + 1}: invalid project selected`)
      }
      if (!sanitizeText(unit?.unit_number)) {
        throw new Error(`Row ${index + 1}: unit number is required`)
      }
      if (!sanitizeText(unit?.owner_name)) {
        throw new Error(`Row ${index + 1}: owner name is required`)
      }
      if (!isPositiveNumber(unit?.area_sqft)) {
        throw new Error(`Row ${index + 1}: area must be greater than 0`)
      }
    })

    return unitService.importUnits(units)
  })

  ipcMain.handle('import-ledger', (_, { projectId, rows }): boolean => {
    return unitService.importLedger(projectId, rows)
  })

  // Maintenance Letters (formerly Invoices)
  ipcMain.handle('get-letters', (): MaintenanceLetter[] => {
    return maintenanceLetterService.getAll()
  })

  ipcMain.handle('get-letters-by-project', (_, projectId: number): MaintenanceLetter[] => {
    if (!isPositiveInteger(projectId)) {
      throw new Error('Invalid project selected')
    }
    return maintenanceLetterService.getByProject(projectId)
  })

  ipcMain.handle('get-letter', (_, id: number): MaintenanceLetter | undefined => {
    return maintenanceLetterService.getById(id)
  })

  ipcMain.handle(
    'create-batch-letters',
    (_, { projectId, unitIds, financialYear, letterDate, dueDate, addOns }) => {
      if (!isPositiveInteger(projectId)) {
        throw new Error('Invalid project selected')
      }
      if (!isFinancialYear(financialYear)) {
        throw new Error('Invalid financial year format (expected YYYY-YY)')
      }
      if (!isIsoDate(letterDate) || !isIsoDate(dueDate)) {
        throw new Error('Invalid letter/due date format (expected YYYY-MM-DD)')
      }
      if (unitIds !== undefined && !Array.isArray(unitIds)) {
        throw new Error('Invalid units selection')
      }
      if (Array.isArray(unitIds) && unitIds.some((id) => !isPositiveInteger(id))) {
        throw new Error('Invalid unit id in selection')
      }
      if (addOns !== undefined && !Array.isArray(addOns)) {
        throw new Error('Invalid add-ons payload')
      }
      if (
        Array.isArray(addOns) &&
        addOns.some(
          (addon) =>
            !sanitizeText(addon?.addon_name) || !isNonNegativeInteger(addon?.addon_amount)
        )
      ) {
        throw new Error('Each add-on requires a valid name and a whole non-negative amount')
      }

      return maintenanceLetterService.createBatchDetailed(
        projectId,
        financialYear,
        letterDate,
        dueDate,
        unitIds,
        addOns
      )
    }
  )

  ipcMain.handle('get-financial-report-summary', (_, projectId?: number, filters?: FinancialReportFilters) => {
    if (projectId !== undefined && projectId !== null && !isPositiveInteger(projectId)) {
      throw new Error('Invalid project selected')
    }
    return reportService.getFinancialSummary(projectId, filters)
  })

  ipcMain.handle('get-available-financial-years', (_, projectId?: number) => {
    if (projectId !== undefined && projectId !== null && !isPositiveInteger(projectId)) {
      throw new Error('Invalid project selected')
    }
    return reportService.getAvailableFinancialYears(projectId)
  })

  ipcMain.handle('update-letter', (_, id: number, updates: Partial<MaintenanceLetter>): boolean => {
    return maintenanceLetterService.update(id, updates)
  })

  ipcMain.handle('delete-letter', (_, id: number): boolean => {
    return maintenanceLetterService.delete(id)
  })

  ipcMain.handle('bulk-delete-letters', (_, ids: number[]): boolean => {
    return maintenanceLetterService.bulkDelete(ids)
  })

  ipcMain.handle('generate-letter-pdf', async (_, id: number): Promise<string> => {
    return await maintenanceLetterService.generatePdf(id)
  })

  ipcMain.handle('get-letter-addons', (_, id: number) => {
    return maintenanceLetterService.getAddOns(id)
  })

  ipcMain.handle('get-all-addons', () => {
    return maintenanceLetterService.getAllAddOns()
  })

  ipcMain.handle(
    'add-letter-addon',
    (
      _,
      params: {
        unit_id: number
        financial_year: string
        addon_name: string
        addon_amount: number
        remarks?: string
      }
    ): boolean => {
      if (!isPositiveInteger(params?.unit_id)) {
        throw new Error('Invalid unit selected')
      }
      if (!isFinancialYear(params?.financial_year)) {
        throw new Error('Invalid financial year format (expected YYYY-YY)')
      }
      if (!sanitizeText(params?.addon_name) || !isNonNegativeInteger(params?.addon_amount)) {
        throw new Error('Add-on requires a valid name and a whole non-negative amount')
      }
      return maintenanceLetterService.addAddOn(params)
    }
  )

  ipcMain.handle('delete-letter-addon', (_, id: number): boolean => {
    return maintenanceLetterService.deleteAddOn(id)
  })

  // Detailed Maintenance Letters
  ipcMain.handle(
    'generate-detailed-letter',
    async (
      _,
      projectId: number,
      unitId: number,
      financialYear: string
    ): Promise<LetterCalculation> => {
      if (!isPositiveInteger(projectId)) {
        throw new Error('Invalid project selected')
      }
      if (!isPositiveInteger(unitId)) {
        throw new Error('Invalid unit selected')
      }
      if (!isFinancialYear(financialYear)) {
        throw new Error('Invalid financial year format (expected YYYY-YY)')
      }
      return await detailedMaintenanceLetterService.generateDetailedLetter(
        projectId,
        unitId,
        financialYear
      )
    }
  )

  ipcMain.handle(
    'generate-detailed-pdf',
    async (_, projectId: number, unitId: number, financialYear: string): Promise<string> => {
      if (!isPositiveInteger(projectId)) {
        throw new Error('Invalid project selected')
      }
      if (!isPositiveInteger(unitId)) {
        throw new Error('Invalid unit selected')
      }
      if (!isFinancialYear(financialYear)) {
        throw new Error('Invalid financial year format (expected YYYY-YY)')
      }
      // Look up the letter ID first
      const letterId = maintenanceLetterService.getLetterIdByProjectUnitAndYear(
        projectId,
        unitId,
        financialYear
      )
      if (!letterId) {
        throw new Error('Maintenance letter not found for the specified project, unit, and financial year')
      }
      // Use the unified renderer
      return await maintenanceLetterService.generatePdf(letterId)
    }
  )

  const validatePath = (filePath: string): void => {
    if (!filePath) return
    const userDataPath = app.getPath('userData')
    if (!filePath.startsWith(userDataPath)) {
      throw new Error('Access denied: Path is outside of application data directory.')
    }
  }

  ipcMain.handle('open-pdf', (_, filePath: string): void => {
    validatePath(filePath)
    if (filePath && filePath.endsWith('.pdf')) {
      shell.openPath(filePath)
    }
  })

  ipcMain.handle(
    'select-local-file',
    async (
      _,
      options?: {
        title?: string
        filters?: { name: string; extensions: string[] }[]
      }
    ): Promise<string | null> => {      
      try {
        // Use dialog without parent window - simpler approach
        const result = await dialog.showOpenDialog({
          title: sanitizeText(options?.title) || 'Select File',
          properties: ['openFile'],
          filters: Array.isArray(options?.filters) ? options.filters : undefined
        })
        if (result.canceled || result.filePaths.length === 0) {          return null
        }        return result.filePaths[0]
      } catch (error) {        if (process.env.NODE_ENV !== 'production') {
          console.error('[select-local-file] Dialog error:', error)
        }
        throw error
      }
    }
  )

  ipcMain.handle(
    'save-file',
    async (
      _,
      options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      }
    ): Promise<string | null> => {      
      try {
        // Validate filters if provided
        let validatedFilters = [{ name: 'Database', extensions: ['db'] }]
        if (Array.isArray(options?.filters)) {
          validatedFilters = options.filters.filter(f => 
            f && typeof f.name === 'string' && Array.isArray(f.extensions) && 
            f.extensions.every(e => typeof e === 'string')
          )
          if (validatedFilters.length === 0) {
            validatedFilters = [{ name: 'Database', extensions: ['db'] }]
          }
        }

        const result = await dialog.showSaveDialog({
          title: sanitizeText(options?.title) || 'Save File',
          defaultPath: options?.defaultPath || 'barkat_backup.db',
          filters: validatedFilters
        })
        if (result.canceled || !result.filePath) {          return null
        }        return result.filePath
      } catch (error) {        if (process.env.NODE_ENV !== 'production') {
          console.error('[save-file] Dialog error:', error)
        }
        throw error
      }
    }
  )

  // Payments
  ipcMain.handle('get-payments', (): Payment[] => {
    return paymentService.getAll()
  })

  ipcMain.handle('get-payments-by-project', (_, projectId: number): Payment[] => {
    if (!isPositiveInteger(projectId)) {
      throw new Error('Invalid project selected')
    }
    return paymentService.getByProject(projectId)
  })

  ipcMain.handle('create-payment', (_, payment: Payment): number => {
    const projectId = toPositiveInteger(payment?.project_id)
    const unitId = toPositiveInteger(payment?.unit_id)
    
    if (!projectId) {
      throw new Error('Invalid project selected. Please select a valid project.')
    }
    if (!unitId) {
      throw new Error('Invalid unit selected. Please select a valid unit.')
    }

    // Validate unit belongs to project
    const unitExists = dbService.get(
      'SELECT id FROM units WHERE id = ? AND project_id = ?',
      [unitId, projectId]
    )
    if (!unitExists) {
      throw new Error('Selected unit does not belong to the selected project')
    }

    if (
      payment?.letter_id !== undefined &&
      payment.letter_id !== null &&
      !isPositiveInteger(payment.letter_id)
    ) {
      throw new Error('Invalid maintenance letter selected')
    }
    if (!isIsoDate(payment?.payment_date)) {
      throw new Error('Invalid payment date format (expected YYYY-MM-DD)')
    }
    if (!isPositiveIntegerAmount(payment?.payment_amount)) {
      throw new Error('Payment amount must be a whole number greater than 0')
    }
    if (!/^\d{4}-\d{2}$/.test(payment?.financial_year || '')) {
      throw new Error('Financial year must be in YYYY-YY format (e.g., 2024-25)')
    }
    const mode = sanitizeText(payment?.payment_mode)
    if (!['Transfer', 'Cheque', 'Cash', 'UPI'].includes(mode)) {
      throw new Error('Invalid payment mode')
    }

    // Update payment object with converted IDs
    payment.project_id = projectId
    payment.unit_id = unitId

    const paymentId = paymentService.create(payment)
    errorLogger.log(new Error(`Payment created: ${paymentId}`), { 
      projectId, 
      unitId, 
      amount: payment.payment_amount 
    })
    return paymentId
  })

  ipcMain.handle('update-payment', (_, id: number, payment: Partial<Payment>): boolean => {
    if (!isPositiveInteger(id)) {
      throw new Error('Invalid payment ID')
    }
    if (
      payment.payment_amount !== undefined &&
      !isPositiveIntegerAmount(payment.payment_amount)
    ) {
      throw new Error('Payment amount must be a whole number greater than 0')
    }
    return paymentService.update(id, payment)
  })

  ipcMain.handle('delete-payment', (_, id: number): boolean => {
    return paymentService.delete(id)
  })

  ipcMain.handle('bulk-delete-payments', (_, ids: number[]): boolean => {
    return paymentService.bulkDelete(ids)
  })

  ipcMain.handle('generate-receipt-pdf', async (_, id: number): Promise<string> => {
    return await paymentService.generateReceiptPdf(id)
  })

  // Maintenance Rates & Slabs
  ipcMain.handle('get-rates', (): MaintenanceRate[] => {
    return maintenanceRateService.getAll()
  })

  ipcMain.handle('get-rates-by-project', (_, projectId: number): MaintenanceRate[] => {
    return maintenanceRateService.getByProject(projectId)
  })

  ipcMain.handle('create-rate', (_, rate: MaintenanceRate): number => {
    if (!isPositiveInteger(rate?.project_id)) {
      throw new Error('Invalid project selected')
    }
    if (!isFinancialYear(rate?.financial_year)) {
      throw new Error('Invalid financial year format (expected YYYY-YY)')
    }
    if (!isPositiveNumber(rate?.rate_per_sqft)) {
      throw new Error('Rate per sqft must be greater than 0')
    }
    if (!isNonNegativeNumber(rate?.gst_percent ?? 0) || (rate?.gst_percent ?? 0) > 100) {
      throw new Error('GST percentage must be between 0 and 100')
    }
    if (
      rate?.penalty_percentage !== undefined &&
      rate?.penalty_percentage !== null &&
      (!isNonNegativeNumber(rate.penalty_percentage) || rate.penalty_percentage > 100)
    ) {
      throw new Error('Penalty percentage must be between 0 and 100')
    }
    return maintenanceRateService.create(rate)
  })

  ipcMain.handle('update-rate', (_, id: number, rate: Partial<MaintenanceRate>): boolean => {
    if (rate.financial_year !== undefined && !isFinancialYear(rate.financial_year)) {
      throw new Error('Invalid financial year format (expected YYYY-YY)')
    }
    if (rate.rate_per_sqft !== undefined && !isPositiveNumber(rate.rate_per_sqft)) {
      throw new Error('Rate per sqft must be greater than 0')
    }
    if (
      rate.gst_percent !== undefined &&
      (!isNonNegativeNumber(rate.gst_percent) || rate.gst_percent > 100)
    ) {
      throw new Error('GST percentage must be between 0 and 100')
    }
    if (
      rate.penalty_percentage !== undefined &&
      rate.penalty_percentage !== null &&
      (!isNonNegativeNumber(rate.penalty_percentage) || rate.penalty_percentage > 100)
    ) {
      throw new Error('Penalty percentage must be between 0 and 100')
    }
    return maintenanceRateService.update(id, rate)
  })

  ipcMain.handle('delete-rate', (_, id: number): boolean => {
    return maintenanceRateService.delete(id)
  })

  ipcMain.handle('get-slabs', (_, rateId: number): MaintenanceSlab[] => {
    return maintenanceRateService.getSlabs(rateId)
  })

  ipcMain.handle('add-slab', (_, slab: MaintenanceSlab): number => {
    if (!isPositiveInteger(slab?.rate_id)) {
      throw new Error('Invalid maintenance rate selected')
    }
    if (!isIsoDate(slab?.due_date)) {
      throw new Error('Invalid due date format (expected YYYY-MM-DD)')
    }
    if (
      !isNonNegativeNumber(slab?.discount_percentage) ||
      slab.discount_percentage > 100
    ) {
      throw new Error('Discount percentage must be between 0 and 100')
    }
    return maintenanceRateService.addSlab(slab)
  })

  ipcMain.handle('delete-slab', (_, id: number): boolean => {
    return maintenanceRateService.deleteSlab(id)
  })

  // Settings
  ipcMain.handle('get-settings', (): unknown[] => {
    return dbService.query('SELECT * FROM settings')
  })

  ipcMain.handle('update-setting', (_, key: string, value: string): unknown => {
    return dbService.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  })

  ipcMain.handle('delete-setting', (_, key: string): unknown => {
    return dbService.run('DELETE FROM settings WHERE key = ?', [key])
  })

  // Shell
  ipcMain.handle('show-item-in-folder', (_, filePath: string): void => {
    validatePath(filePath)
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('open-output-folder', async (_, folderType: 'maintenance-letters' | 'receipts'): Promise<void> => {
    const userDataPath = app.getPath('userData')
    const targetFolder =
      folderType === 'maintenance-letters'
        ? path.join(userDataPath, 'maintenance-letters')
        : path.join(userDataPath, 'receipts')

    if (!fs.existsSync(targetFolder)) {
      await fs.promises.mkdir(targetFolder, { recursive: true })
    }

    await shell.openPath(targetFolder)
  })

  ipcMain.handle(
    'export-output-zip',
    async (
      _,
      folderType: 'maintenance-letters' | 'receipts',
      destinationPath: string
    ): Promise<{ zipPath: string; fileCount: number }> => {
      const userDataPath = app.getPath('userData')
      const sourceFolder =
        folderType === 'maintenance-letters'
          ? path.join(userDataPath, 'maintenance-letters')
          : path.join(userDataPath, 'receipts')

      if (!fs.existsSync(sourceFolder)) {
        throw new Error(`No ${folderType} folder found yet.`)
      }

      const files = (await fs.promises.readdir(sourceFolder))
        .filter((file) => file.toLowerCase().endsWith('.pdf'))
        .map((file) => path.join(sourceFolder, file))

      if (files.length === 0) {
        throw new Error(`No PDF files found in ${folderType}.`)
      }

      const normalizedDestination = destinationPath.toLowerCase().endsWith('.zip')
        ? destinationPath
        : `${destinationPath}.zip`

      const sourcePattern = `${escapePowerShellLiteral(path.join(sourceFolder, '*.pdf'))}`
      const destinationLiteral = escapePowerShellLiteral(normalizedDestination)
      const script = `Compress-Archive -Path '${sourcePattern}' -DestinationPath '${destinationLiteral}' -Force`

      await new Promise<void>((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          (error, _stdout, stderr) => {
            if (error) {
              reject(new Error(stderr?.trim() || error.message))
              return
            }
            resolve()
          }
        )
      })

      return { zipPath: normalizedDestination, fileCount: files.length }
    }
  )

  // Database Repair
  ipcMain.handle('database-repair', () => {
    const logs: string[] = []
    try {
      logs.push('Starting database check...')

      // 1. Check foreign key status
      const fkStatus = dbService.get('PRAGMA foreign_keys')
      logs.push(`Foreign Keys status: ${JSON.stringify(fkStatus)}`)

      // 2. Check for violations
      const violations = dbService.query('PRAGMA foreign_key_check')
      if (violations.length > 0) {
        logs.push(`Found ${violations.length} foreign key violations!`)
      } else {
        logs.push('No foreign key violations found.')
      }

      // 3. Log all table schemas for debugging
      const tables = dbService.query("SELECT name, sql FROM sqlite_master WHERE type='table'")
      logs.push('Table structures:')
      ;(tables as { name: string; sql: string }[]).forEach((t) => {
        logs.push(`- Table ${t.name}: ${t.sql}`)
        const fks = dbService.query(`PRAGMA foreign_key_list(${t.name})`)
        if ((fks as unknown[]).length > 0) {
          logs.push(`  FKs for ${t.name}: ${JSON.stringify(fks)}`)
        }
      })

      // 4. Try to fix orphaned records in payments (most common issue)
      logs.push('Checking for orphaned payments...')
      const orphanedPayments = dbService.query(
        'SELECT id FROM payments WHERE unit_id NOT IN (SELECT id FROM units)'
      )
      if ((orphanedPayments as unknown[]).length > 0) {
        logs.push(`Cleaning up ${(orphanedPayments as unknown[]).length} orphaned payments...`)
        dbService.run('DELETE FROM payments WHERE unit_id NOT IN (SELECT id FROM units)')
      }

      logs.push('Checking for orphaned maintenance letters...')
      const orphanedLetters = dbService.query(
        'SELECT id FROM maintenance_letters WHERE unit_id NOT IN (SELECT id FROM units)'
      )
      if ((orphanedLetters as unknown[]).length > 0) {
        logs.push(
          `Cleaning up ${(orphanedLetters as unknown[]).length} orphaned maintenance letters...`
        )
        dbService.run('DELETE FROM maintenance_letters WHERE unit_id NOT IN (SELECT id FROM units)')
      }

      // 5. Run deep cleanup methods (exposed from database.ts)
      logs.push('Running deep cleanup tasks...')
      dbService.cleanupOldTables()
      dbService.fixBrokenForeignKeys()
      dbService.cleanupOrphanData()
      logs.push('Deep cleanup tasks completed.')

      logs.push('Database check completed successfully.')
      return {
        success: true,
        violations,
        logs
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logs.push(`FATAL ERROR during repair: ${message}`)
      console.error('Database repair failed:', error)
      return {
        success: false,
        violations: [],
        logs
      }
    }
  })

  // Dry-run endpoints (preview before commit)
  ipcMain.handle('dry-run-import', (_, projectId: number, rows: unknown[]) => {
    try {
      if (!isPositiveInteger(projectId)) {
        throw new ValidationError('Invalid project selected')
      }
      if (!Array.isArray(rows)) {
        throw new ValidationError('Invalid rows payload')
      }
      return dryRunService.previewImport(projectId, rows)
    } catch (error: unknown) {
      errorLogger.log(error as Error, { operation: 'dry-run-import' })
      throw new Error(getSafeErrorMessage(error))
    }
  })

  ipcMain.handle(
    'dry-run-billing',
    (_, projectId: number, financialYear: string, unitIds?: number[]) => {
      try {
        if (!isPositiveInteger(projectId)) {
          throw new ValidationError('Invalid project selected')
        }
        if (!isFinancialYear(financialYear)) {
          throw new ValidationError('Invalid financial year format')
        }
        return dryRunService.previewBilling(projectId, financialYear, unitIds)
      } catch (error: unknown) {
        errorLogger.log(error as Error, { operation: 'dry-run-billing' })
        throw new Error(getSafeErrorMessage(error))
      }
    }
  )

  ipcMain.handle('dry-run-payment', (_, unitId: number, projectId: number) => {
    try {
      if (!isPositiveInteger(unitId) || !isPositiveInteger(projectId)) {
        throw new ValidationError('Invalid unit or project')
      }
      return dryRunService.previewPayment(unitId, projectId)
    } catch (error: unknown) {
      errorLogger.log(error as Error, { operation: 'dry-run-payment' })
      throw new Error(getSafeErrorMessage(error))
    }
  })

  // Worker/background task endpoints
  ipcMain.handle(
    'enqueue-worker-task',
    async (_, taskType: string, data: Record<string, unknown>) => {
      try {
        const enrichedData =
          taskType === 'batch-pdf' && !data.dbPath
            ? { ...data, dbPath: dbService.getDbPath() }
            : data
        const taskId = `${taskType}_${randomUUID()}`
        const task: WorkerTask = {
          id: taskId,
          type: taskType,
          data: enrichedData,
          priority: enrichedData.priority as number | undefined
        }
        await workerPool.enqueue(task)
        return { taskId, status: 'queued' }
      } catch (error: unknown) {
        errorLogger.log(error as Error, { operation: 'enqueue-worker-task' })
        throw new Error(getSafeErrorMessage(error))
      }
    }
  )

  ipcMain.handle('worker-task-status', (_, taskId: string) => {
    return workerPool.getStatus(taskId)
  })

  ipcMain.handle('worker-task-cancel', (_, taskId: string) => {
    workerPool.cancel(taskId)
    return { taskId, cancelled: true }
  })

  // Error logging (for renderer to send error logs)
  ipcMain.handle('get-error-logs', (_, limit: number = 100) => {
    return errorLogger.getLogs(limit)
  })

  ipcMain.handle('clear-error-logs', () => {
    errorLogger.clear()
    return { cleared: true }
  })

  // Backup & Restore endpoints
  ipcMain.handle('create-backup', async () => {
    try {
      const result = await backupService.createBackup()
      if (!result.success) {
        throw new Error(result.error)
      }
      return result
    } catch (error: unknown) {
      errorLogger.log(error as Error, { operation: 'create-backup' })
      throw new Error(getSafeErrorMessage(error))
    }
  })

  ipcMain.handle('export-backup', async (_, destinationPath: string) => {
    try {
      if (!destinationPath) {
        throw new ValidationError('Destination path required')
      }
      const result = await backupService.exportBackup(destinationPath)
      if (!result.success) {
        throw new Error(result.error)
      }
      return result
    } catch (error: unknown) {
      errorLogger.log(error as Error, { operation: 'export-backup', destinationPath })
      throw new Error(getSafeErrorMessage(error))
    }
  })

  ipcMain.handle('restore-backup', async (_, backupPath: string) => {
    try {
      if (!backupPath) {
        throw new ValidationError('Backup path required')
      }
      const result = await backupService.restoreBackup(backupPath)
      if (!result.success) {
        throw new Error(result.error)
      }
      // Show restart dialog if restore requires restart (success or critical failure)
      if (result.requiresRestart) {
        const isCriticalFailure = result.criticalFailure === true
        const { response } = await dialog.showMessageBox({
          type: isCriticalFailure ? 'error' : 'info',
          title: isCriticalFailure ? 'Restore Failed - Restart Required' : 'Restore Complete',
          message: isCriticalFailure 
            ? 'Database restore failed and connection was lost.' 
            : 'Database restored successfully.',
          detail: isCriticalFailure
            ? 'The database connection was closed but restore failed. Application must restart to recover.'
            : 'Please restart the application to complete the restore process.',
          buttons: ['Restart Now', 'Later'],
          defaultId: 0
        })
        if (response === 0) {
          app.relaunch()
          app.quit()
        }
      }
      return result
    } catch (error: unknown) {
      errorLogger.log(error as Error, { operation: 'restore-backup', backupPath })
      throw new Error(getSafeErrorMessage(error))
    }
  })

  ipcMain.handle('list-backups', async () => {
    return await backupService.listBackups()
  })

  ipcMain.handle('start-auto-backup', (_, intervalDays: number = 7) => {
    backupService.startAutoBackup(intervalDays)
    return { enabled: true, intervalDays }
  })

  ipcMain.handle('stop-auto-backup', () => {
    backupService.stopAutoBackup()
    return { enabled: false }
  })

  ipcMain.handle('get-backup-config', () => {
    return backupService.getConfig()
  })

  ipcMain.handle('get-backup-export-default-name', () => {
    return backupService.getDefaultExportFileName()
  })

  ipcMain.handle('get-app-info', () => {
    return {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform
    }
  })

  // Batch operations endpoints
  ipcMain.handle('batch-create-payments', (_, payments: Payment[]) => {
    try {
      if (!Array.isArray(payments)) {
        throw new ValidationError('Invalid payments array')
      }
      return batchOperationsService.createBulkPayments(payments)
    } catch (error: unknown) {
      errorLogger.log(error as Error, { operation: 'batch-create-payments' })
      throw new Error(getSafeErrorMessage(error))
    }
  })

  ipcMain.handle('batch-delete-payments', (_, paymentIds: number[]) => {
    try {
      if (!Array.isArray(paymentIds)) {
        throw new ValidationError('Invalid payment IDs array')
      }
      return batchOperationsService.bulkDeletePayments(paymentIds)
    } catch (error: unknown) {
      errorLogger.log(error as Error, { operation: 'batch-delete-payments' })
      throw new Error(getSafeErrorMessage(error))
    }
  })

  // Addon Template Management
  ipcMain.handle('get-addon-templates', (_, projectId: number) => {
    return addonTemplateService.getProjectTemplates(projectId)
  })

  ipcMain.handle('get-enabled-addon-templates', (_, projectId: number) => {
    return addonTemplateService.getEnabledTemplates(projectId)
  })

  ipcMain.handle('create-addon-template', (_, template) => {
    if (!isPositiveInteger(template?.project_id)) {
      throw new Error('Invalid project selected')
    }
    if (!template?.addon_name || typeof template.addon_name !== 'string') {
      throw new Error('Addon name is required')
    }
    if (!['fixed', 'rate_per_sqft'].includes(template?.addon_type)) {
      throw new Error('Addon type must be "fixed" or "rate_per_sqft"')
    }
    if (!isPositiveNumber(template?.amount)) {
      throw new Error('Addon amount must be greater than 0')
    }
    if (typeof template?.is_enabled !== 'boolean') {
      throw new Error('Addon enabled status must be true or false')
    }
    if (!isPositiveInteger(template?.sort_order)) {
      throw new Error('Sort order must be a positive integer')
    }

    return addonTemplateService.createTemplate(template)
  })

  ipcMain.handle('update-addon-template', (_, id: number, template) => {
    if (!isPositiveInteger(id)) {
      throw new Error('Invalid template ID')
    }
    
    // Validate the template data
    if (template.addon_name !== undefined && (!template.addon_name || typeof template.addon_name !== 'string')) {
      throw new Error('Addon name must be a valid string')
    }
    if (template.addon_type !== undefined && !['fixed', 'rate_per_sqft'].includes(template.addon_type)) {
      throw new Error('Addon type must be "fixed" or "rate_per_sqft"')
    }
    if (template.amount !== undefined && (!isPositiveNumber(template.amount) && template.amount !== 0)) {
      throw new Error('Addon amount must be greater than or equal to 0')
    }
    if (template.is_enabled !== undefined && typeof template.is_enabled !== 'boolean') {
      throw new Error('Addon enabled status must be true or false')
    }
    if (template.sort_order !== undefined && !isPositiveInteger(template.sort_order)) {
      throw new Error('Sort order must be a positive integer')
    }

    return addonTemplateService.updateTemplate(id, template)
  })

  ipcMain.handle('delete-addon-template', (_, id: number) => {
    if (!isPositiveInteger(id)) {
      throw new Error('Invalid template ID')
    }
    return addonTemplateService.deleteTemplate(id)
  })

  ipcMain.handle('reorder-addon-templates', (_, templates) => {
    if (!Array.isArray(templates)) {
      throw new Error('Templates must be an array')
    }
    
    // Validate each template
    for (const template of templates) {
      if (!isPositiveInteger(template.id) || !isPositiveInteger(template.sort_order)) {
        throw new Error('Each template must have valid id and sort_order')
      }
    }

    return addonTemplateService.reorderTemplates(templates)
  })

  ipcMain.handle('initialize-default-addon-templates', (_, projectId: number) => {
    if (!isPositiveInteger(projectId)) {
      throw new Error('Invalid project selected')
    }
    return addonTemplateService.initializeDefaultTemplates(projectId)
  })

  ipcMain.handle('migrate-addon-templates', (_, projectId: number) => {
    if (!isPositiveInteger(projectId)) {
      throw new Error('Invalid project selected')
    }
    return addonTemplateService.migrateFromChargesConfig(projectId)
  })

  ipcMain.handle('copy-asset-file', (_, sourcePath: string, targetPath: string) => {
    try {
      if (!sourcePath || !targetPath) {
        throw new Error('Source and target paths are required')
      }

      const resolvedSourcePath = path.resolve(sourcePath)
      if (!fs.existsSync(resolvedSourcePath)) {
        throw new Error(`Source file not found: ${resolvedSourcePath}`)
      }

      const sourceExt = path.extname(resolvedSourcePath).toLowerCase()
      if (!['.png', '.jpg', '.jpeg'].includes(sourceExt)) {
        throw new Error('Unsupported file format. Please select an image file (PNG, JPG, JPEG).')
      }

      const stats = fs.statSync(resolvedSourcePath)
      if (stats.size > 5 * 1024 * 1024) {
        throw new Error('File size too large. Maximum allowed size is 5MB.')
      }

      const resolvedTargetPath = path.join(app.getPath('userData'), targetPath)
      const targetDir = path.dirname(resolvedTargetPath)
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }

      fs.copyFileSync(resolvedSourcePath, resolvedTargetPath)

      if (!fs.existsSync(resolvedTargetPath)) {
        throw new Error('File copy failed - target file not created')
      }

      return { success: true, targetPath, sourcePath: resolvedSourcePath, size: stats.size }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('validate-asset-file', (_, assetPath: string) => {
    try {
      if (!assetPath) throw new Error('Asset path is required')

      const resolvedPath = path.join(app.getPath('userData'), assetPath)
      const exists = fs.existsSync(resolvedPath)

      if (!exists) {
        return { exists: false, isValidImage: false, path: resolvedPath, error: 'File does not exist' }
      }

      const ext = path.extname(resolvedPath).toLowerCase()
      const isValidImage = ['.png', '.jpg', '.jpeg'].includes(ext)
      const stats = fs.statSync(resolvedPath)

      return { exists, isValidImage, path: resolvedPath, size: stats.size, extension: ext, lastModified: stats.mtime }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { exists: false, isValidImage: false, path: assetPath, error: errorMessage }
    }
  })
}

