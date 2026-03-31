import { ElectronAPI } from '@electron-toolkit/preload'
import {
  Project,
  ProjectSetupSummary,
  ProjectSectorPaymentConfig,
  ProjectAddonTemplate,
  StandardWorkbookProjectImportPayload,
  StandardWorkbookProjectImportResult,
  Unit,
  MaintenanceLetter,
  BatchLetterResult,
  MaintenanceRate,
  MaintenanceSlab,
  Payment,
  RepairResult,
  LetterAddOn,
  LetterCalculation,
  FinancialReportSummary,
  FinancialReportFilters
} from './types'

export * from './types'

declare global {
  interface Window {
    Buffer: typeof Buffer
    electron: ElectronAPI
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
        getChargesConfig: (projectId: number) => Promise<Record<string, unknown> | null>
        saveChargesConfig: (config: Record<string, unknown>) => Promise<boolean>
        getAddonTemplates: (projectId: number) => Promise<ProjectAddonTemplate[]>
        getEnabledAddonTemplates: (projectId: number) => Promise<ProjectAddonTemplate[]>
        createAddonTemplate: (template: Partial<ProjectAddonTemplate>) => Promise<number>
        updateAddonTemplate: (id: number, template: Partial<ProjectAddonTemplate>) => Promise<boolean>
        deleteAddonTemplate: (id: number) => Promise<boolean>
        reorderAddonTemplates: (templates: Partial<ProjectAddonTemplate>[]) => Promise<boolean>
        initializeDefaultAddonTemplates: (projectId: number) => Promise<boolean>
        migrateAddonTemplates: (projectId: number) => Promise<boolean>
      }
      units: {
        getAll: () => Promise<Unit[]>
        getByProject: (projectId: number) => Promise<Unit[]>
        create: (unit: Unit) => Promise<number>
        update: (id: number, unit: Partial<Unit>) => Promise<boolean>
        delete: (id: number) => Promise<boolean>
        bulkDelete: (ids: number[]) => Promise<boolean>
        bulkCreate: (units: Unit[]) => Promise<boolean>
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
        getFinancialSummary: (projectId?: number, filters?: FinancialReportFilters) => Promise<FinancialReportSummary>
        getAvailableFinancialYears: (projectId?: number) => Promise<string[]>
      }
      shell: {
        showItemInFolder: (path: string) => void
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
        repair: () => Promise<RepairResult>
      }
      settings: {
        getAll: () => Promise<Record<string, unknown>[]>
        update: (key: string, value: string) => Promise<Record<string, unknown>>
        delete: (key: string) => Promise<Record<string, unknown>>
      }
      detailedLetters: {
        generateLetter: (
          projectId: number,
          unitId: number,
          financialYear: string
        ) => Promise<LetterCalculation>
        generatePdf: (projectId: number, unitId: number, financialYear: string) => Promise<string>
      }
      dryRun: {
        previewImport: (projectId: number, rows: unknown[]) => Promise<unknown>
        previewBilling: (
          projectId: number,
          financialYear: string,
          unitIds?: number[]
        ) => Promise<unknown>
        previewPayment: (unitId: number, projectId: number) => Promise<unknown>
      }
      worker: {
        enqueueTask: (
          taskType: string,
          data: Record<string, unknown>
        ) => Promise<{ taskId: string }>
        getStatus: (taskId: string) => Promise<unknown>
        cancel: (taskId: string) => Promise<boolean>
        onProgress: (callback: (event: unknown) => void) => void
      }
      logging: {
        getErrorLogs: (limit?: number) => Promise<unknown[]>
        clearErrorLogs: () => Promise<boolean>
      }
      backup: {
        createBackup: () => Promise<{ success: boolean; backupPath?: string; error?: string }>
        exportBackup: (destinationPath: string) => Promise<{
          success: boolean
          backupPath?: string
          error?: string
          size?: number
          timestamp?: string
        }>
        restoreBackup: (backupPath: string) => Promise<{ success: boolean; error?: string }>
        listBackups: () => Promise<
          Array<{ name: string; path: string; timestamp: string; size: number }>
        >
        getExportDefaultName: () => Promise<string>
        startAutoBackup: (intervalDays?: number) => Promise<{ enabled: boolean; intervalDays: number }>
        stopAutoBackup: () => Promise<{ enabled: boolean }>
        getConfig: () => Promise<{ enabled: boolean; intervalDays: number }>
      }
      batch: {
        createPayments: (payments: Payment[]) => Promise<boolean>
        deletePayments: (paymentIds: number[]) => Promise<boolean>
      }
      files: {
        copyAssetFile: (sourcePath: string, targetPath: string) => Promise<boolean>
        validateAssetFile: (assetPath: string) => Promise<boolean>
      }
    }
  }
}
