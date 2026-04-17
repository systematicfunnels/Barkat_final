import fs from 'fs'
import path from 'path'

const TEST_DATA_DIR = path.join(process.cwd(), '.test-arrears-consistency', String(Date.now()))
process.env.BARKAT_DB_PATH = path.join(TEST_DATA_DIR, 'barkat.test.db')
process.env.BARKAT_USER_DATA_PATH = TEST_DATA_DIR

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue(TEST_DATA_DIR),
    isPackaged: false,
    getVersion: jest.fn().mockReturnValue('1.2.0')
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

import { projectService } from '../../main/services/ProjectService'
import { unitService } from '../../main/services/UnitService'
import { maintenanceRateService } from '../../main/services/MaintenanceRateService'
import { maintenanceLetterService } from '../../main/services/MaintenanceLetterService'
import { detailedMaintenanceLetterService } from '../../main/services/DetailedMaintenanceLetterService'
import { paymentService } from '../../main/services/PaymentService'

function createProjectWithBank(name: string): number {
  return projectService.create({
    name,
    city: 'Surat',
    status: 'Active',
    account_name: 'Barkat Welfare Fund',
    bank_name: 'Test Bank',
    account_no: '123456789012',
    ifsc_code: 'TEST0001234',
    branch: 'Main Branch',
    branch_address: 'Test Branch Address'
  } as any)
}

describe('arrears consistency integration', () => {
  beforeAll(() => {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true })
  })

  test('rolled-forward arrears and detailed preview stay aligned', async () => {
    const projectId = createProjectWithBank(`Arrears Sync ${Date.now()}`)
    const unitId = unitService.create({
      project_id: projectId,
      unit_number: 'ARR-001',
      owner_name: 'Arrears Owner',
      area_sqft: 100,
      unit_type: 'Bungalow',
      status: 'Sold'
    } as any)

    maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2024-25',
      rate_per_sqft: 10,
      penalty_percentage: 0,
      unit_type: 'Bungalow'
    } as any)
    maintenanceLetterService.createBatch(projectId, '2024-25', '2024-04-01', '2024-06-30', [unitId], [])

    maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2025-26',
      rate_per_sqft: 10,
      penalty_percentage: 12,
      unit_type: 'Bungalow'
    } as any)
    maintenanceLetterService.createBatch(projectId, '2025-26', '2025-04-01', '2025-06-30', [unitId], [])

    const currentLetter = maintenanceLetterService
      .getAll()
      .find((letter) => letter.unit_id === unitId && letter.financial_year === '2025-26')

    expect(currentLetter?.arrears).toBe(1120)

    const preview = await detailedMaintenanceLetterService.generateDetailedLetter(
      projectId,
      unitId,
      '2025-26'
    )

    expect(preview.totals.total_arrears_with_penalty).toBe(1120)
    expect(preview.arrears_breakdown).toEqual([
      {
        financial_year: '2024-25',
        amount: 1000,
        penalty: 120,
        total_with_penalty: 1120
      }
    ])
  })

  test('payment create and delete keep generated letters in sync', () => {
    const projectId = createProjectWithBank(`Payment Sync ${Date.now()}`)
    const unitId = unitService.create({
      project_id: projectId,
      unit_number: 'PAY-001',
      owner_name: 'Payment Owner',
      area_sqft: 100,
      unit_type: 'Plot',
      status: 'Sold'
    } as any)

    maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2028-29',
      rate_per_sqft: 50,
      unit_type: 'Plot'
    } as any)
    maintenanceLetterService.createBatch(projectId, '2028-29', '2028-04-01', '2028-06-30', [unitId], [])

    const letter = maintenanceLetterService
      .getAll()
      .find((item) => item.unit_id === unitId && item.financial_year === '2028-29')

    const partialPaymentId = paymentService.create({
      project_id: projectId,
      unit_id: unitId,
      letter_id: letter!.id,
      payment_date: '2028-05-01',
      payment_amount: 2000,
      payment_mode: 'Cash',
      financial_year: '2028-29',
      payment_status: 'Received'
    } as any)

    expect(partialPaymentId).toBeGreaterThan(0)
    expect(maintenanceLetterService.getById(letter!.id!)?.status).toBe('Generated')
    expect(maintenanceLetterService.getById(letter!.id!)?.is_paid).toBeFalsy()

    const finalPaymentId = paymentService.create({
      project_id: projectId,
      unit_id: unitId,
      letter_id: letter!.id,
      payment_date: '2028-05-20',
      payment_amount: 3000,
      payment_mode: 'UPI',
      financial_year: '2028-29',
      payment_status: 'Received'
    } as any)

    expect(finalPaymentId).toBeGreaterThan(0)
    expect(maintenanceLetterService.getById(letter!.id!)?.status).toBe('Paid')
    expect(maintenanceLetterService.getById(letter!.id!)?.is_paid).toBeTruthy()

    expect(paymentService.delete(finalPaymentId)).toBe(true)
    expect(maintenanceLetterService.getById(letter!.id!)?.status).toBe('Generated')
    expect(maintenanceLetterService.getById(letter!.id!)?.is_paid).toBeFalsy()
  })

  test('detailed preview honors stored imported arrears', async () => {
    const projectId = createProjectWithBank(`Imported Arrears ${Date.now()}`)

    expect(
      unitService.importLedger(projectId, [
        {
          unit_number: 'IMP-001',
          owner_name: 'Imported Owner',
          unit_type: 'Plot',
          area_sqft: 100,
          status: 'Sold',
          years: [
            {
              financial_year: '2030-31',
              base_amount: 2500,
              arrears: 750,
              final_amount: 3250,
              due_date: '2030-06-30'
            }
          ]
        }
      ])
    ).toBe(true)

    const importedUnit = unitService
      .getByProject(projectId)
      .find((unit) => unit.unit_number === 'IMP-001')

    const preview = await detailedMaintenanceLetterService.generateDetailedLetter(
      projectId,
      importedUnit!.id!,
      '2030-31'
    )

    expect(preview.totals.total_arrears_with_penalty).toBe(750)
    expect(preview.totals.amount_payable_before_due).toBe(3250)
    expect(preview.arrears_breakdown).toEqual([
      {
        financial_year: 'Brought Forward',
        amount: 750,
        penalty: 0,
        total_with_penalty: 750
      }
    ])
  })
})
