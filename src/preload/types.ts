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
  import_profile_key?: string
  payment_modes?: string
  contact_email?: string
  contact_phone?: string
  unit_count?: number
  created_at?: string
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

export interface Unit {
  id?: number
  project_id: number
  unit_number: string
  sector_code?: string
  owner_name: string
  area_sqft: number
  unit_type?: string
  floor?: number
  project_name?: string
  status?: string
  contact_number?: string
  email?: string
  penalty?: number
  penalty_percentage?: number
  billing_address?: string
  resident_address?: string
}

export interface MaintenanceLetter {
  id?: number
  project_id: number
  unit_id: number
  financial_year: string
  base_amount: number
  snapshot_discount_percentage?: number
  discount_amount: number
  final_amount: number
  due_date: string
  status: string
  generated_date: string
  unit_number?: string
  owner_name?: string
  project_name?: string
  sector_code?: string
  unit_type?: string
  is_paid?: boolean
  add_ons_total?: number
  letterhead_path?: string
  sector_letterhead_path?: string
}

export interface BatchLetterResult {
  success: boolean
  createdCount: number
  skippedCount: number
  createdLetterIds: number[]
  skippedUnitIds: number[]
}

export interface FinancialReportYearlyData {
  billed: number
  paid: number
  balance: number
}

export interface FinancialReportRow {
  key: string
  unit_id: number
  unit_number: string
  owner_name: string
  project_name: string
  unit_type: string
  unit_status: string
  total_billed: number
  total_paid: number
  outstanding: number
  [year: string]: string | number | FinancialReportYearlyData
}

export interface FinancialReportYearlyTotal {
  year: string
  billed: number
  paid: number
  balance: number
  unitCount: number
}

export interface FinancialReportSummary {
  rows: FinancialReportRow[]
  years: string[]
  stats: {
    totalBilled: number
    totalCollected: number
    outstanding: number
  }
  yearlyTotals: FinancialReportYearlyTotal[]
}

export interface FinancialReportFilters {
  searchText?: string
  selectedUnitType?: string | null
  selectedStatus?: string | null
  outstandingRange?: [number | null, number | null]
}

export interface MaintenanceRate {
  id?: number
  project_id: number
  financial_year: string
  unit_type?: string
  rate_per_sqft: number
  gst_percent?: number
  penalty_percentage?: number | null
  billing_frequency?: string
  project_name?: string
}

export interface ProjectAddonTemplate {
  id?: number
  project_id: number
  addon_name: string
  addon_type: 'fixed' | 'rate_per_sqft'
  amount: number
  is_enabled: boolean
  sort_order: number
  created_at?: string
  updated_at?: string
}

export interface ProjectChargesConfig {
  project_id: number
  id?: number
  na_tax_rate_per_sqft: number
  solar_contribution: number
  cable_charges: number
  penalty_percentage: number
  penalty_label: 'Penalty' | 'Late Payment Charges'
  early_payment_discount_percentage: number
  created_at?: string
  updated_at?: string
}

export interface ProjectAddonTemplateInput {
  project_id: number
  addon_name: string
  addon_type: 'fixed' | 'rate_per_sqft'
  amount: number
  is_enabled: boolean
  sort_order?: number
}

export interface ProjectAddonTemplateReorderItem {
  id: number
  sort_order: number
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
  letterhead_path?: string
  created_at?: string
  updated_at?: string
}

export interface StandardWorkbookImportAddOn {
  name: string
  amount: number
}

export interface StandardWorkbookImportYear {
  financial_year: string
  base_amount: number
  arrears?: number
  discount_amount?: number
  final_amount?: number
  due_date?: string
  penalty?: number
  add_ons?: StandardWorkbookImportAddOn[]
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
  billing_address?: string
  resident_address?: string
  years?: StandardWorkbookImportYear[]
}

export interface StandardWorkbookRateRow {
  financial_year: string
  unit_type: string
  rate_per_sqft: number
  na_tax_per_sqft?: number
  road_na_flat?: number
  cable_flat?: number
  gst_percent?: number
  penalty_percent?: number
  penalty_percentage?: number
  discount_percent?: number
  discount_percentage?: number
  due_date?: string
}

export interface StandardWorkbookPaymentRow {
  unit_number: string
  sector_code?: string
  payment_date: string
  financial_year: string
  amount_paid: number
  payment_mode?: string
  cheque_number?: string
  receipt_number?: string
  remarks?: string
}

export interface StandardWorkbookProjectImportPayload {
  project: Project
  sector_configs?: Partial<ProjectSectorPaymentConfig>[]
  rates?: StandardWorkbookRateRow[]
  payments?: StandardWorkbookPaymentRow[]
  rows: StandardWorkbookImportRow[]
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

export interface MaintenanceSlab {
  id?: number
  rate_id: number
  due_date: string
  discount_percentage: number
  is_early_payment: boolean
}

export interface Payment {
  id?: number
  project_id: number
  unit_id: number
  letter_id?: number
  payment_date: string
  payment_amount: number
  payment_mode: string
  cheque_number?: string
  remarks?: string
  payment_status?: string
  unit_number?: string
  owner_name?: string
  project_name?: string
  receipt_number?: string
  financial_year?: string
}

export interface RepairResult {
  success: boolean
  violations: {
    table: string
    rowid: number
    parent: string
    fkid: number
  }[]
  logs: string[]
}

export interface LetterAddOn {
  id: number
  letter_id: number
  addon_name: string
  addon_amount: number
  remarks?: string
}

export interface ArrearsEntry {
  financial_year: string
  amount: number
  penalty: number
  total_with_penalty: number
}

export interface ChargeEntry {
  description: string
  amount: number
}

export interface DetailedLetterPreviewRow {
  key: string
  particulars: string
  plot_area: number | null
  rate: number | null
  amount: number | null
  penalty: number | null
  discount: number | null
  before_due: number | null
  after_due: number | null
  isTotal?: boolean
}

export interface LetterCalculation {
  unit_details: {
    unit_number: string
    owner_name: string
    plot_area: number
    rate_per_sqft: number
  }
  arrears_breakdown: ArrearsEntry[]
  penalty_percentage: number
  penalty_label?: 'Penalty' | 'Late Payment Charges'
  discount_percentage: number
  due_date: string
  current_year_charges: {
    base_amount: number
    na_tax: number
    solar_contribution: number
    cable_charges: number
  }
  charges_breakdown: ChargeEntry[]
  preview_rows: DetailedLetterPreviewRow[]
  totals: {
    total_arrears_with_penalty: number
    total_current_charges: number
    grand_total_before_discount: number
    early_payment_discount: number
    amount_payable_before_due: number
    amount_payable_after_due: number
    penalty_percentage?: number
    penalty_label?: 'Penalty' | 'Late Payment Charges'
  }
  bank_details: {
    name: string
    account_no: string
    ifsc_code: string
    bank_name: string
    branch: string
    branch_address: string
    qr_code_path: string
  }
}

export interface DetailedLettersAPI {
  generateLetter: (
    projectId: number,
    unitId: number,
    financialYear: string
  ) => Promise<LetterCalculation>
  generatePdf: (projectId: number, unitId: number, financialYear: string) => Promise<string>
}

// Extend the main API interface to include detailedLetters
declare global {
  interface Window {
    api: {
      projects: {
        getAll: () => Promise<Project[]>
        getById: (id: number) => Promise<Project | undefined>
        getSetupSummary: (projectId: number, financialYear?: string) => Promise<ProjectSetupSummary>
        getSetupSummaries: (financialYear?: string) => Promise<ProjectSetupSummary[]>
        create: (project: Project) => Promise<number>
        update: (id: number, project: Partial<Project>) => Promise<boolean>
        getSectorPaymentConfigs: (projectId: number) => Promise<ProjectSectorPaymentConfig[]>
        saveSectorPaymentConfigs: (
          projectId: number,
          configs: Partial<ProjectSectorPaymentConfig>[]
        ) => Promise<boolean>
        importStandardWorkbookProject: (
          payload: StandardWorkbookProjectImportPayload
        ) => Promise<StandardWorkbookProjectImportResult>
        delete: (id: number) => Promise<boolean>
        bulkDelete: (ids: number[]) => Promise<boolean>
        getDashboardStats: (
          projectId?: number,
          financialYear?: string,
          unitType?: string,
          status?: string
        ) => Promise<{
          projects: number
          units: number
          pendingUnits: number
          collectedThisYear: number
          totalBilled: number
          totalOutstanding: number
        }>
        getChargesConfig: (projectId: number) => Promise<ProjectChargesConfig | null>
        saveChargesConfig: (config: ProjectChargesConfig) => Promise<boolean>
        getAddonTemplates: (projectId: number) => Promise<ProjectAddonTemplate[]>
        getEnabledAddonTemplates: (projectId: number) => Promise<ProjectAddonTemplate[]>
        createAddonTemplate: (template: ProjectAddonTemplateInput) => Promise<ProjectAddonTemplate>
        updateAddonTemplate: (id: number, template: Partial<ProjectAddonTemplateInput>) => Promise<ProjectAddonTemplate>
        deleteAddonTemplate: (id: number) => Promise<boolean>
        reorderAddonTemplates: (templates: ProjectAddonTemplateReorderItem[]) => Promise<boolean>
        initializeDefaultAddonTemplates: (projectId: number) => Promise<boolean>
        migrateAddonTemplates: (projectId: number) => Promise<{ migrated: number; templates: ProjectAddonTemplate[] }>
      }
      units: {
        getAll: () => Promise<Unit[]>
        getByProject: (projectId: number) => Promise<Unit[]>
        create: (unit: Unit) => Promise<number>
        update: (id: number, unit: Partial<Unit>) => Promise<boolean>
        delete: (id: number) => Promise<boolean>
        bulkDelete: (ids: number[]) => Promise<boolean>
        bulkCreate: (units: Unit[]) => Promise<boolean>
        importUnits: (units: Unit[]) => Promise<boolean>
        importLedger: (params: {
          projectId: number
          rows: Record<string, unknown>[]
        }) => Promise<boolean>
      }
      letters: {
        getAll: () => Promise<MaintenanceLetter[]>
        getByProject: (projectId: number) => Promise<MaintenanceLetter[]>
        getById: (id: number) => Promise<MaintenanceLetter | undefined>
        update: (id: number, updates: Partial<MaintenanceLetter>) => Promise<boolean>
        createBatch: (params: {
          projectId: number
          unitIds?: number[]
          financialYear: string
          letterDate: string
          dueDate: string
          addOns?: { addon_name: string; addon_amount: number }[]
        }) => Promise<BatchLetterResult>
        delete: (id: number) => Promise<boolean>
        bulkDelete: (ids: number[]) => Promise<boolean>
        generatePdf: (id: number) => Promise<string>
        getAddOns: (id: number) => Promise<LetterAddOn[]>
        getAllAddOns: () => Promise<
          (LetterAddOn & {
            unit_id: number
            financial_year: string
            unit_number?: string
            owner_name?: string
            project_id?: number
          })[]
        >
        addAddOn: (params: {
          unit_id: number
          financial_year: string
          addon_name: string
          addon_amount: number
          remarks?: string
        }) => Promise<boolean>
        deleteAddOn: (id: number) => Promise<boolean>
      }
      rates: {
        getAll: () => Promise<MaintenanceRate[]>
        getByProject: (projectId: number) => Promise<MaintenanceRate[]>
        create: (rate: MaintenanceRate) => Promise<number>
        update: (id: number, rate: Partial<MaintenanceRate>) => Promise<boolean>
        delete: (id: number) => Promise<boolean>
        getSlabs: (rateId: number) => Promise<MaintenanceSlab[]>
        addSlab: (slab: MaintenanceSlab) => Promise<number>
        updateSlab: (id: number, slab: Partial<MaintenanceSlab>) => Promise<boolean>
        deleteSlab: (id: number) => Promise<boolean>
      }
      payments: {
        getAll: () => Promise<Payment[]>
        getByProject: (projectId: number) => Promise<Payment[]>
        create: (payment: Payment) => Promise<number>
        update: (id: number, payment: Partial<Payment>) => Promise<boolean>
        delete: (id: number) => Promise<boolean>
        bulkDelete: (ids: number[]) => Promise<boolean>
        generateReceiptPdf: (id: number) => Promise<string>
      }
      reports: {
        getFinancialSummary: (
          projectId?: number,
          filters?: FinancialReportFilters
        ) => Promise<FinancialReportSummary>
        getAvailableFinancialYears: (projectId?: number) => Promise<string[]>
        exportFinancialReportExcel: (payload: {
          savePath: string
          rows: FinancialReportSummary['rows']
          years: FinancialReportSummary['years']
          yearlyTotals: FinancialReportSummary['yearlyTotals']
          stats: FinancialReportSummary['stats']
          selectedProjectName?: string
          hasActiveFilters: boolean
          selectedUnitType?: string | null
          selectedStatus?: string | null
          searchText?: string
          outstandingRange?: [number | null, number | null]
          generatedAt: string
        }) => Promise<{ savePath: string }>
      }
      shell: {
        showItemInFolder: (path: string) => void
        openOutputFolder: (folderType: 'maintenance-letters' | 'receipts') => Promise<void>
        exportOutputZip: (
          folderType: 'maintenance-letters' | 'receipts',
          destinationPath: string
        ) => Promise<{ zipPath: string; fileCount: number }>
      }
      dialog: {
        selectLocalFile: (options: {
          title?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | null>
        saveFile: (options: {
          title?: string
          defaultPath?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | null>
      }
      database: {
        repair: () => Promise<{
          success: boolean
          violations: {
            table: string
            rowid: number
            parent: string
            fkid: number
          }[]
          logs: string[]
        }>
      }
      backup: {
        createBackup: () => Promise<{
          success: boolean
          backupPath?: string
          error?: string
        }>
        exportBackup: (destinationPath: string) => Promise<{
          success: boolean
          backupPath?: string
          error?: string
          size?: number
          timestamp?: string
        }>
        restoreBackup: (backupPath: string) => Promise<{
          success: boolean
          error?: string
          requiresRestart?: boolean
          criticalFailure?: boolean
        }>
        listBackups: () => Promise<
          Array<{
            name: string
            path: string
            timestamp: string
            size: number
            formatVersion?: number
            snapshotMethod?: string
            isVerifiedSnapshot: boolean
          }>
        >
        getExportDefaultName: () => Promise<string>
        startAutoBackup: (intervalDays?: number) => Promise<{
          enabled: boolean
          intervalDays: number
        }>
        stopAutoBackup: () => Promise<{
          enabled: boolean
        }>
        getConfig: () => Promise<{
          enabled: boolean
          intervalDays: number
        }>
      }
      system: {
        getAppInfo: () => Promise<{
          version: string
          isPackaged: boolean
          platform: string
        }>
      }
      settings: {
        getAll: () => Promise<unknown[]>
        update: (key: string, value: string) => Promise<unknown>
        delete: (key: string) => Promise<unknown>
      }
      batch: {
        createPayments: (payments: Payment[]) => Promise<{
          successful: number
          failed: number
          results: Array<{
            index: number
            paymentId?: number
            error?: string
          }>
        }>
        deletePayments: (paymentIds: number[]) => Promise<{
          successful: number
          failed: number
          results: Array<{
            index: number
            paymentId?: number
            error?: string
          }>
        }>
      }
      files: {
        copyAssetFile: (sourcePath: string, targetPath: string) => Promise<{
          success: boolean
          targetPath?: string
          error?: string
        }>
        validateAssetFile: (assetPath: string) => Promise<{
          exists: boolean
          isValidImage: boolean
          path: string
          error?: string
        }>
      }
      dryRun: {
        previewImport: (projectId: number, rows: unknown[]) => Promise<{
          valid: boolean
          conflicts: Array<{
            type: string
            severity: 'error' | 'warning'
            message: string
            data?: unknown
          }>
          summary: {
            entities: Record<string, number>
            warnings: string[]
          }
        }>
        previewBilling: (projectId: number, financialYear: string, unitIds?: number[]) => Promise<{
          valid: boolean
          conflicts: Array<{
            type: string
            severity: 'error' | 'warning'
            message: string
            data?: unknown
          }>
          summary: {
            entities: Record<string, number>
            warnings: string[]
          }
        }>
        previewPayment: (unitId: number, projectId: number) => Promise<{
          valid: boolean
          conflicts: Array<{
            type: string
            severity: 'error' | 'warning'
            message: string
            data?: unknown
          }>
          summary: {
            entities: Record<string, number>
            warnings: string[]
          }
        }>
      }
      worker: {
        enqueueTask: (taskType: string, data: Record<string, unknown>) => Promise<unknown>
        getStatus: (taskId: string) => Promise<unknown>
        cancel: (taskId: string) => Promise<unknown>
        onProgress: (callback: (event: unknown) => void) => () => void
      }
      logging: {
        getErrorLogs: (limit?: number) => Promise<unknown[]>
        clearErrorLogs: () => Promise<unknown>
      }
      detailedLetters: DetailedLettersAPI
    }
  }
}
