import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  Project,
  ProjectSetupSummary,
  ProjectSectorPaymentConfig,
  StandardWorkbookProjectImportPayload,
  StandardWorkbookProjectImportResult,
  Unit,
  MaintenanceLetter,
  MaintenanceRate,
  MaintenanceSlab,
  Payment,
  LetterCalculation
} from './types'

export * from './types'

// Custom APIs for renderer
const api = {
  projects: {
    getAll: () => ipcRenderer.invoke('get-projects'),
    getById: (id: number) => ipcRenderer.invoke('get-project', id),
    getSetupSummary: (projectId: number, financialYear?: string) =>
      ipcRenderer.invoke(
        'get-project-setup-summary',
        projectId,
        financialYear
      ) as Promise<ProjectSetupSummary>,
    getSetupSummaries: (financialYear?: string) =>
      ipcRenderer.invoke('get-project-setup-summaries', financialYear) as Promise<
        ProjectSetupSummary[]
      >,
    create: (project: Project) => ipcRenderer.invoke('create-project', project),
    update: (id: number, project: Partial<Project>) =>
      ipcRenderer.invoke('update-project', id, project),
    getSectorPaymentConfigs: (projectId: number) =>
      ipcRenderer.invoke('get-project-sector-configs', projectId) as Promise<
        ProjectSectorPaymentConfig[]
      >,
    saveSectorPaymentConfigs: (projectId: number, configs: Partial<ProjectSectorPaymentConfig>[]) =>
      ipcRenderer.invoke('save-project-sector-configs', projectId, configs),
    importStandardWorkbookProject: (payload: StandardWorkbookProjectImportPayload) =>
      ipcRenderer.invoke(
        'import-standard-workbook-project',
        payload
      ) as Promise<StandardWorkbookProjectImportResult>,
    delete: (id: number) => ipcRenderer.invoke('delete-project', id),
    bulkDelete: (ids: number[]) => ipcRenderer.invoke('bulk-delete-projects', ids),
    getDashboardStats: (
      projectId?: number,
      financialYear?: string,
      unitType?: string,
      status?: string
    ) => ipcRenderer.invoke('get-dashboard-stats', projectId, financialYear, unitType, status),
    getChargesConfig: (projectId: number) => ipcRenderer.invoke('get-project-charges-config', projectId),
    saveChargesConfig: (config: any) => ipcRenderer.invoke('save-project-charges-config', config),
    getAddonTemplates: (projectId: number) => ipcRenderer.invoke('get-addon-templates', projectId),
    getEnabledAddonTemplates: (projectId: number) =>
      ipcRenderer.invoke('get-enabled-addon-templates', projectId),
    createAddonTemplate: (template: any) => ipcRenderer.invoke('create-addon-template', template),
    updateAddonTemplate: (id: number, template: any) =>
      ipcRenderer.invoke('update-addon-template', id, template),
    deleteAddonTemplate: (id: number) => ipcRenderer.invoke('delete-addon-template', id),
    reorderAddonTemplates: (templates: any[]) =>
      ipcRenderer.invoke('reorder-addon-templates', templates),
    initializeDefaultAddonTemplates: (projectId: number) =>
      ipcRenderer.invoke('initialize-default-addon-templates', projectId),
    migrateAddonTemplates: (projectId: number) =>
      ipcRenderer.invoke('migrate-addon-templates', projectId)
  },
  units: {
    getAll: () => ipcRenderer.invoke('get-units'),
    getByProject: (projectId: number) => ipcRenderer.invoke('get-units-by-project', projectId),
    create: (unit: Unit) => ipcRenderer.invoke('create-unit', unit),
    update: (id: number, unit: Partial<Unit>) => ipcRenderer.invoke('update-unit', id, unit),
    delete: (id: number) => ipcRenderer.invoke('delete-unit', id),
    bulkDelete: (ids: number[]) => ipcRenderer.invoke('bulk-delete-units', ids),
    bulkCreate: (units: Unit[]) => ipcRenderer.invoke('bulk-create-units', units),
    importLedger: (params: { projectId: number; rows: Record<string, unknown>[] }) =>
      ipcRenderer.invoke('import-ledger', params)
  },
  letters: {
    getAll: () => ipcRenderer.invoke('get-letters'),
    getByProject: (projectId: number) => ipcRenderer.invoke('get-letters-by-project', projectId),
    getById: (id: number) => ipcRenderer.invoke('get-letter', id),
    update: (id: number, updates: Partial<MaintenanceLetter>) => ipcRenderer.invoke('update-letter', id, updates),
    createBatch: (params: {
      projectId: number
      unitIds?: number[]
      financialYear: string
      letterDate: string
      dueDate: string
      addOns?: { addon_name: string; addon_amount: number }[]
    }) => ipcRenderer.invoke('create-batch-letters', params),
    delete: (id: number) => ipcRenderer.invoke('delete-letter', id),
    bulkDelete: (ids: number[]) => ipcRenderer.invoke('bulk-delete-letters', ids),
    generatePdf: (id: number) => ipcRenderer.invoke('generate-letter-pdf', id),
    getAddOns: (id: number) => ipcRenderer.invoke('get-letter-addons', id),
    getAllAddOns: () => ipcRenderer.invoke('get-all-addons'),
    addAddOn: (params: {
      unit_id: number
      financial_year: string
      addon_name: string
      addon_amount: number
      remarks?: string
    }) => ipcRenderer.invoke('add-letter-addon', params),
    deleteAddOn: (id: number) => ipcRenderer.invoke('delete-letter-addon', id)
  },
  rates: {
    getAll: () => ipcRenderer.invoke('get-rates'),
    getByProject: (projectId: number) => ipcRenderer.invoke('get-rates-by-project', projectId),
    create: (rate: MaintenanceRate) => ipcRenderer.invoke('create-rate', rate),
    update: (id: number, rate: Partial<MaintenanceRate>) =>
      ipcRenderer.invoke('update-rate', id, rate),
    delete: (id: number) => ipcRenderer.invoke('delete-rate', id),
    getSlabs: (rateId: number) => ipcRenderer.invoke('get-slabs', rateId),
    addSlab: (slab: MaintenanceSlab) => ipcRenderer.invoke('add-slab', slab),
    deleteSlab: (id: number) => ipcRenderer.invoke('delete-slab', id)
  },
  payments: {
    getAll: () => ipcRenderer.invoke('get-payments'),
    getByProject: (projectId: number) => ipcRenderer.invoke('get-payments-by-project', projectId),
    create: (payment: Payment) => ipcRenderer.invoke('create-payment', payment),
    update: (id: number, payment: Partial<Payment>) => ipcRenderer.invoke('update-payment', id, payment),
    delete: (id: number) => ipcRenderer.invoke('delete-payment', id),
    bulkDelete: (ids: number[]) => ipcRenderer.invoke('bulk-delete-payments', ids),
    generateReceiptPdf: (id: number) => ipcRenderer.invoke('generate-receipt-pdf', id)
  },
  shell: {
    showItemInFolder: (path: string) => ipcRenderer.invoke('show-item-in-folder', path)
  },
  dialog: {
    selectLocalFile: (options: { title?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('select-local-file', options) as Promise<string | null>
  },
  database: {
    repair: () => ipcRenderer.invoke('database-repair')
  },
  settings: {
    getAll: () => ipcRenderer.invoke('get-settings'),
    update: (key: string, value: string) => ipcRenderer.invoke('update-setting', key, value),
    delete: (key: string) => ipcRenderer.invoke('delete-setting', key)
  },
  detailedLetters: {
    generateLetter: (projectId: number, unitId: number, financialYear: string) =>
      ipcRenderer.invoke(
        'generate-detailed-letter',
        projectId,
        unitId,
        financialYear
      ) as Promise<LetterCalculation>,
    generatePdf: (projectId: number, unitId: number, financialYear: string) =>
      ipcRenderer.invoke(
        'generate-detailed-pdf',
        projectId,
        unitId,
        financialYear
      ) as Promise<string>
  },
  dryRun: {
    previewImport: (projectId: number, rows: unknown[]) =>
      ipcRenderer.invoke('dry-run-import', projectId, rows),
    previewBilling: (projectId: number, financialYear: string, unitIds?: number[]) =>
      ipcRenderer.invoke('dry-run-billing', projectId, financialYear, unitIds),
    previewPayment: (unitId: number, projectId: number) =>
      ipcRenderer.invoke('dry-run-payment', unitId, projectId)
  },
  worker: {
    enqueueTask: (taskType: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('enqueue-worker-task', taskType, data),
    getStatus: (taskId: string) => ipcRenderer.invoke('worker-task-status', taskId),
    cancel: (taskId: string) => ipcRenderer.invoke('worker-task-cancel', taskId),
    onProgress: (callback: (event: unknown) => void) => {
      ipcRenderer.on('worker-progress', (_, event) => callback(event))
    }
  },
  logging: {
    getErrorLogs: (limit?: number) => ipcRenderer.invoke('get-error-logs', limit),
    clearErrorLogs: () => ipcRenderer.invoke('clear-error-logs')
  },
  backup: {
    createBackup: () => ipcRenderer.invoke('create-backup'),
    restoreBackup: (backupPath: string) => ipcRenderer.invoke('restore-backup', backupPath),
    listBackups: () => ipcRenderer.invoke('list-backups'),
    startAutoBackup: (intervalDays?: number) =>
      ipcRenderer.invoke('start-auto-backup', intervalDays),
    stopAutoBackup: () => ipcRenderer.invoke('stop-auto-backup'),
    getConfig: () => ipcRenderer.invoke('get-backup-config')
  },
  batch: {
    createPayments: (payments: Payment[]) => ipcRenderer.invoke('batch-create-payments', payments),
    deletePayments: (paymentIds: number[]) =>
      ipcRenderer.invoke('batch-delete-payments', paymentIds)
  },
  files: {
    copyAssetFile: (sourcePath: string, targetPath: string) =>
      ipcRenderer.invoke('copy-asset-file', sourcePath, targetPath),
    validateAssetFile: (assetPath: string) =>
      ipcRenderer.invoke('validate-asset-file', assetPath)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
