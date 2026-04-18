import fs from 'fs'
import path from 'path'

const TEST_DATA_DIR = path.join(process.cwd(), '.test-production-smoke', String(Date.now()))
process.env.BARKAT_DB_PATH = path.join(TEST_DATA_DIR, 'barkat.test.db')
process.env.BARKAT_USER_DATA_PATH = TEST_DATA_DIR

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue(TEST_DATA_DIR),
    isPackaged: false,
    getVersion: jest.fn().mockReturnValue('1.1.0')
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn()
  },
  shell: {
    openPath: jest.fn(),
    showItemInFolder: jest.fn()
  },
  dialog: {
    showMessageBox: jest.fn().mockResolvedValue({ response: 1 })
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}))

import { backupService } from '../../main/services/BackupService'
import { dbService } from '../../main/db/database'
import { projectService } from '../../main/services/ProjectService'
import { unitService } from '../../main/services/UnitService'
import { maintenanceRateService } from '../../main/services/MaintenanceRateService'
import { maintenanceLetterService } from '../../main/services/MaintenanceLetterService'
import { paymentService } from '../../main/services/PaymentService'

describe('Barkat production smoke integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DATA_DIR)) {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true })
    }
  })

  afterAll(() => {
    dbService.close()
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
    }
  })

  test('completes the production workflow from project setup to receipt PDF and backup export', async () => {
    const projectId = projectService.create({
      name: `Prod Smoke ${Date.now()}`,
      city: 'Ahmedabad',
      status: 'Active',
      template_type: 'standard',
      import_profile_key: 'standard_normalized',
      account_name: 'Barkat Welfare Fund',
      bank_name: 'Test Bank',
      account_no: '123456789012',
      ifsc_code: 'TEST0001234',
      branch: 'Main Branch',
      branch_address: 'Test Branch Address',
      contact_email: 'office@example.com',
      contact_phone: '+91-9000000000'
    } as any)

    expect(projectId).toBeGreaterThan(0)

    const unitId = unitService.create({
      project_id: projectId,
      unit_number: 'A-101',
      sector_code: 'A',
      owner_name: 'Ravi Shah',
      area_sqft: 1200,
      unit_type: 'Bungalow',
      status: 'Sold',
      billing_address: '123 Billing Street',
      resident_address: '123 Billing Street'
    } as any)

    expect(unitId).toBeGreaterThan(0)

    const rateId = maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2025-26',
      unit_type: 'Bungalow',
      rate_per_sqft: 10,
      gst_percent: 5,
      billing_frequency: 'YEARLY'
    } as any)

    expect(rateId).toBeGreaterThan(0)

    const slabId = maintenanceRateService.addSlab({
      rate_id: rateId,
      due_date: '2025-06-30',
      discount_percentage: 10,
      is_early_payment: true
    } as any)

    expect(slabId).toBeGreaterThan(0)

    const batchCreated = maintenanceLetterService.createBatch(
      projectId,
      '2025-26',
      '2025-04-01',
      '2025-06-30',
      [unitId],
      [{ addon_name: 'Cable Charges', addon_amount: 1000 }]
    )

    expect(batchCreated).toBe(true)

    const letter = maintenanceLetterService
      .getAll()
      .find((item) => item.project_id === projectId && item.unit_id === unitId && item.financial_year === '2025-26')

    expect(letter).toBeDefined()
    expect(letter?.base_amount).toBe(12000)
    expect(letter?.discount_amount).toBeCloseTo(1200, 1)
    expect(letter?.final_amount).toBeCloseTo(12400, 1)
    expect(letter?.status).toBe('Generated')

    const addOns = maintenanceLetterService.getAddOns(letter!.id!)
    expect(addOns.some((addon) => addon.addon_name === 'GST (5%)')).toBe(true)
    expect(addOns.some((addon) => addon.addon_name === 'Cable Charges')).toBe(true)

    const letterPdfPath = await maintenanceLetterService.generatePdf(letter!.id!)
    expect(fs.existsSync(letterPdfPath)).toBe(true)

    const partialPaymentId = paymentService.create({
      project_id: projectId,
      unit_id: unitId,
      letter_id: letter!.id,
      payment_date: '2025-05-01',
      payment_amount: 4000,
      payment_mode: 'Transfer',
      financial_year: '2025-26',
      payment_status: 'Received'
    } as any)

    expect(partialPaymentId).toBeGreaterThan(0)
    expect(maintenanceLetterService.getById(letter!.id!)?.status).toBe('Generated')

    const finalPaymentId = paymentService.create({
      project_id: projectId,
      unit_id: unitId,
      letter_id: letter!.id,
      payment_date: '2025-05-15',
      payment_amount: letter!.final_amount - 4000,
      payment_mode: 'UPI',
      financial_year: '2025-26',
      payment_status: 'Received'
    } as any)

    expect(finalPaymentId).toBeGreaterThan(0)

    const paidLetter = maintenanceLetterService.getById(letter!.id!)
    expect(paidLetter?.is_paid).toBeTruthy()
    expect(paidLetter?.status).toBe('Paid')

    const receiptPdfPath = await paymentService.generateReceiptPdf(finalPaymentId)
    expect(fs.existsSync(receiptPdfPath)).toBe(true)

    const exportedBackupPath = path.join(
      TEST_DATA_DIR,
      'exports',
      backupService.getDefaultExportFileName()
    )
    const exportResult = await backupService.exportBackup(exportedBackupPath)
    expect(exportResult.success).toBe(true)
    expect(exportResult.backupPath).toBe(exportedBackupPath)
    expect(fs.existsSync(exportedBackupPath)).toBe(true)

    const createdBackup = await backupService.createBackup()
    expect(createdBackup.success).toBe(true)

    const availableBackups = await backupService.listBackups()
    expect(availableBackups.length).toBeGreaterThan(0)

    const backupConfig = backupService.getConfig()
    expect(backupConfig.enabled).toBe(true)
    expect(backupConfig.intervalDays).toBeGreaterThan(0)
  }, 30000)

  test('fails billing when no maintenance rate exists for the selected unit type and year', () => {
    const projectId = projectService.create({
      name: `Missing Rate ${Date.now()}`,
      city: 'Surat',
      status: 'Active'
    } as any)

    const unitId = unitService.create({
      project_id: projectId,
      unit_number: 'P-001',
      owner_name: 'Plot Owner',
      area_sqft: 800,
      unit_type: 'Plot',
      status: 'Sold'
    } as any)

    maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2026-27',
      unit_type: 'Bungalow',
      rate_per_sqft: 8
    } as any)

    expect(() =>
      maintenanceLetterService.createBatch(
        projectId,
        '2026-27',
        '2026-04-01',
        '2026-06-30',
        [unitId],
        []
      )
    ).toThrow()
  })

  test('fails payment creation when the project and unit relationship is invalid', () => {
    const projectA = projectService.create({ name: `Project A ${Date.now()}`, status: 'Active' } as any)
    const projectB = projectService.create({ name: `Project B ${Date.now()}`, status: 'Active' } as any)

    const unitId = unitService.create({
      project_id: projectA,
      unit_number: 'X-001',
      owner_name: 'Mismatch Owner',
      area_sqft: 900,
      unit_type: 'Bungalow',
      status: 'Sold'
    } as any)

    expect(() =>
      paymentService.create({
        project_id: projectB,
        unit_id: unitId,
        payment_date: '2026-05-01',
        payment_amount: 2500,
        payment_mode: 'Cash',
        financial_year: '2026-27',
        payment_status: 'Received'
      } as any)
    ).toThrow()
  })

  test('uses scan-friendly PDF names for single-digit unit numbers and padded receipt sequences', async () => {
    const projectId = projectService.create({
      name: `Filename Smoke ${Date.now()}`,
      city: 'Vadodara',
      status: 'Active',
      template_type: 'standard',
      account_name: 'Scan Friendly Fund',
      bank_name: 'Naming Bank',
      account_no: '998877665544',
      ifsc_code: 'NAME0001234',
      branch: 'File Branch'
    } as any)

    const unitId = unitService.create({
      project_id: projectId,
      unit_number: 'B-1',
      sector_code: 'B',
      owner_name: 'Naming Owner',
      area_sqft: 1000,
      unit_type: 'Bungalow',
      status: 'Sold'
    } as any)

    maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2026-27',
      unit_type: 'Bungalow',
      rate_per_sqft: 12,
      billing_frequency: 'YEARLY'
    } as any)

    expect(
      maintenanceLetterService.createBatch(
        projectId,
        '2026-27',
        '2026-04-01',
        '2026-06-30',
        [unitId],
        []
      )
    ).toBe(true)

    const letter = maintenanceLetterService
      .getAll()
      .find((item) => item.project_id === projectId && item.unit_id === unitId && item.financial_year === '2026-27')

    expect(letter).toBeDefined()
    const projectRecord = projectService.getById(projectId)
    const projectCode = projectRecord?.project_code
    const projectFolderName = `${projectCode}_${String(projectRecord?.name || '').replace(/\s+/g, '_')}`
    expect(projectCode).toBeDefined()

    const letterPdfPath = await maintenanceLetterService.generatePdf(letter!.id!)
    expect(path.basename(letterPdfPath)).toBe('MaintenanceLetter_B-001_2026-27.pdf')
    expect(letterPdfPath).toContain(path.join('maintenance-letters', projectFolderName))
    expect(letterPdfPath).toContain(path.join(projectFolderName, '2026-27'))

    const paymentId = paymentService.create({
      project_id: projectId,
      unit_id: unitId,
      letter_id: letter!.id,
      payment_date: '2026-04-15',
      payment_amount: letter!.final_amount,
      payment_mode: 'UPI',
      financial_year: '2026-27',
      payment_status: 'Received'
    } as any)

    const receiptPdfPath = await paymentService.generateReceiptPdf(paymentId)
    const receiptBaseName = path.basename(receiptPdfPath)

    expect(receiptBaseName).toMatch(/^Receipt_B-001_REC-\d{4}\.pdf$/)
    expect(receiptPdfPath).toContain(path.join('receipts', projectFolderName))
    expect(receiptPdfPath).toContain(path.join(projectFolderName, '2026-27'))
  })
})
