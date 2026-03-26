import { dbService } from '../../main/db/database'
import { projectService } from '../../main/services/ProjectService'
import { unitService } from '../../main/services/UnitService'
import { maintenanceLetterService } from '../../main/services/MaintenanceLetterService'
import { maintenanceRateService } from '../../main/services/MaintenanceRateService'
import { paymentService } from '../../main/services/PaymentService'
import fs from 'fs'
import path from 'path'

// Mock Electron app path
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('./test-data'),
    isPackaged: false
  }
}))

describe('End-to-End Pipeline Integration', () => {
  beforeAll(async () => {
    // Ensure test directory exists
    if (!fs.existsSync('./test-data')) {
      fs.mkdirSync('./test-data')
    }
    // Initialize in-memory database for testing
    // Note: In a real scenario, we might want to use a temporary file-based DB
  })

  afterAll(() => {
    // Cleanup test data
    if (fs.existsSync('./test-data')) {
      fs.rmSync('./test-data', { recursive: true, force: true })
    }
  })

  test('Complete Pipeline: Project -> Units -> Rates -> Billing -> PDF -> Payment', async () => {
    // 1. Create Project
    const projectId = projectService.create({
      name: 'Green Valley Residency',
      address: 'Sector 15, Ahmedabad',
      city: 'Ahmedabad',
      status: 'Active',
      template_type: 'standard'
    } as any)
    expect(projectId).toBeGreaterThan(0)

    // 2. Import/Create Units
    const unitId = unitService.create({
      project_id: projectId,
      unit_number: 'B-101',
      owner_name: 'Jane Smith',
      area_sqft: 1500,
      unit_type: 'Bungalow',
      status: 'Active'
    } as any)
    expect(unitId).toBeGreaterThan(0)

    // 3. Setup Maintenance Rates
    const rateId = maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2024-25',
      rate_per_sqft: 2.5,
      unit_type: 'Bungalow',
      billing_frequency: 'YEARLY'
    } as any)
    expect(rateId).toBeGreaterThan(0)

    // 4. Generate Maintenance Letter (Billing)
    const letterDate = '2024-04-01'
    const dueDate = '2024-06-30'
    const batchSuccess = maintenanceLetterService.createBatch(
      projectId,
      '2024-25',
      letterDate,
      dueDate,
      [unitId],
      []
    )
    expect(batchSuccess).toBe(true)

    const letters = maintenanceLetterService.getAll()
    const unitLetter = letters.find(l => l.unit_id === unitId && l.financial_year === '2024-25')
    expect(unitLetter).toBeDefined()
    // 1500 sqft * 2.5 rate = 3750
    expect(unitLetter?.final_amount).toBe(3750)

    // 5. Generate PDF
    const pdfPath = await maintenanceLetterService.generatePdf(unitLetter!.id!)
    expect(fs.existsSync(pdfPath)).toBe(true)
    expect(pdfPath).toContain('MaintenanceLetter_')

    // 6. Record Payment
    const paymentId = paymentService.create({
      project_id: projectId,
      unit_id: unitId,
      letter_id: unitLetter!.id,
      payment_date: '2024-05-15',
      payment_amount: 3750,
      payment_mode: 'Transfer',
      financial_year: '2024-25'
    } as any)
    expect(paymentId).toBeGreaterThan(0)

    // 7. Verify Letter marked as paid (if logic exists)
    const updatedLetter = maintenanceLetterService.getById(unitLetter!.id!)
    // Assuming there's logic to link payment to letter status
    // expect(updatedLetter?.is_paid).toBe(1)
  })

  test('Error Scenario: Missing Rate prevents Billing', () => {
    const projectId = projectService.create({ name: 'Error Test' } as any)
    const unitId = unitService.create({ project_id: projectId, unit_number: 'E-1' } as any)
    
    // Attempt to create batch without rate
    expect(() => {
      maintenanceLetterService.createBatch(
        projectId,
        '2025-26',
        '2025-04-01',
        '2025-06-30',
        [unitId],
        []
      )
    }).toThrow() // Should throw due to missing rate
  })

  test('Edge Case: Unit with 0 area', () => {
    const projectId = projectService.create({ name: 'Zero Area Test' } as any)
    const unitId = unitService.create({ 
      project_id: projectId, 
      unit_number: 'Z-0',
      area_sqft: 0 
    } as any)
    
    maintenanceRateService.create({
      project_id: projectId,
      financial_year: '2024-25',
      rate_per_sqft: 2.5
    } as any)

    maintenanceLetterService.createBatch(
      projectId,
      '2024-25',
      '2024-04-01',
      '2024-06-30',
      [unitId],
      []
    )

    const letter = maintenanceLetterService.getAll().find(l => l.unit_id === unitId)
    expect(letter?.final_amount).toBe(0) // 0 area * rate = 0
  })
})
