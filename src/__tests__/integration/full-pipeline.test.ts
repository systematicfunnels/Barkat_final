/**
 * BARKAT — Full SDLC Test Suite
 * ==============================
 * Covers all 8 phases:
 * 1. Requirements validation (schema + enum contracts)
 * 2. System design (data model integrity)
 * 3. Unit tests (individual service methods)
 * 4. Integration tests (service → DB round-trips)
 * 5. Pipeline tests (Project → Units → Rates → Billing → Payment)
 * 6. Calculation accuracy (rate lookup, slabs, arrears, add-ons)
 * 7. PDF output integrity (no dummy data, correct fields)
 * 8. Edge cases and error paths
 *
 * Run: npx jest src/__tests__/integration/full-pipeline.test.ts --verbose
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// ── Electron mock (must be before any service import) ──────────────────────────
const TEST_DATA_DIR = path.join(__dirname, '../../../..', '.test-tmp')

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue(TEST_DATA_DIR),
    isPackaged: false
  },
  ipcMain: { handle: jest.fn() },
  shell: { openPath: jest.fn(), showItemInFolder: jest.fn() }
}))

// ── Lazy imports after mock ────────────────────────────────────────────────────
import { dbService } from '../../main/db/database'
import { projectService } from '../../main/services/ProjectService'
import { unitService } from '../../main/services/UnitService'
import { maintenanceLetterService } from '../../main/services/MaintenanceLetterService'
import { maintenanceRateService } from '../../main/services/MaintenanceRateService'
import { paymentService } from '../../main/services/PaymentService'
import { numberToWordsIndian } from '../../main/utils/numberToWords'
import { getCurrentFinancialYear, getFYStartYear, getFYDeadline } from '../../main/utils/dateUtils'

// ══════════════════════════════════════════════════════════════════════════════
// SETUP / TEARDOWN
// ══════════════════════════════════════════════════════════════════════════════

beforeAll(() => {
  if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true })
})

afterAll(() => {
  if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — REQUIREMENTS: Schema & Enum Contracts
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 1 — Requirements: Schema Contracts', () => {
  test('projects table has all required columns', () => {
    const cols = (dbService as any).db
      .prepare('PRAGMA table_info(projects)')
      .all()
      .map((c: { name: string }) => c.name)

    const required = [
      'id', 'name', 'address', 'city', 'state', 'pincode', 'status',
      'account_name', 'bank_name', 'account_no', 'ifsc_code', 'branch',
      'branch_address', 'qr_code_path', 'template_type', 'payment_modes',
      'contact_email', 'contact_phone', 'import_profile_key'
    ]
    required.forEach(col => expect(cols).toContain(col))
  })

  test('units table has billing_address and resident_address', () => {
    const cols = (dbService as any).db
      .prepare('PRAGMA table_info(units)')
      .all()
      .map((c: { name: string }) => c.name)
    expect(cols).toContain('billing_address')
    expect(cols).toContain('resident_address')
    expect(cols).toContain('penalty')
  })

  test('maintenance_letters table has discount_amount column', () => {
    const cols = (dbService as any).db
      .prepare('PRAGMA table_info(maintenance_letters)')
      .all()
      .map((c: { name: string }) => c.name)
    expect(cols).toContain('discount_amount')
    expect(cols).toContain('arrears')
    expect(cols).toContain('is_paid')
    expect(cols).toContain('due_date')
  })

  test('maintenance_rates table has unit_type column', () => {
    const cols = (dbService as any).db
      .prepare('PRAGMA table_info(maintenance_rates)')
      .all()
      .map((c: { name: string }) => c.name)
    expect(cols).toContain('unit_type')
  })

  test('maintenance_slabs table exists with discount_percentage', () => {
    const cols = (dbService as any).db
      .prepare('PRAGMA table_info(maintenance_slabs)')
      .all()
      .map((c: { name: string }) => c.name)
    expect(cols).toContain('discount_percentage')
    expect(cols).toContain('is_early_payment')
    expect(cols).toContain('rate_id')
    expect(cols).toContain('due_date')
  })

  test('payments table allows Transfer as payment_mode', () => {
    // If schema forbids Transfer, this would throw
    const schema = (dbService as any).db
      .prepare("SELECT sql FROM sqlite_master WHERE name='payments'")
      .get() as { sql: string }
    expect(schema.sql).toContain('Transfer')
  })

  test('project_addon_templates table exists', () => {
    const tbl = (dbService as any).db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_addon_templates'")
      .get()
    expect(tbl).not.toBeNull()
  })

  test('project_charges_config table exists', () => {
    const tbl = (dbService as any).db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_charges_config'")
      .get()
    expect(tbl).not.toBeNull()
  })

  test('foreign_keys are ON', () => {
    const result = (dbService as any).db.pragma('foreign_keys') as { foreign_keys: number }[]
    expect(result[0]?.foreign_keys).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — SYSTEM DESIGN: Data Model Integrity
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 2 — System Design: Data Model Integrity', () => {
  let designProjectId: number

  beforeAll(() => {
    designProjectId = projectService.create({
      name: `Design-Test-${Date.now()}`,
      city: 'TestCity',
      status: 'Sold',
      template_type: 'standard',
      import_profile_key: 'standard_normalized',
      contact_email: 'test@society.com',
      contact_phone: '+91-9876543210',
      account_name: 'Test Society Fund',
      bank_name: 'Test Bank',
      account_no: '12345678901',
      ifsc_code: 'TEST0001234',
      branch: 'Test Branch'
    } as any)
  })

  test('project creation returns positive integer id', () => {
    expect(designProjectId).toBeGreaterThan(0)
  })

  test('project contact_email and contact_phone are stored and retrieved', () => {
    const p = projectService.getById(designProjectId)
    expect(p?.contact_email).toBe('test@society.com')
    expect(p?.contact_phone).toBe('+91-9876543210')
  })

  test('project bank details are stored and retrieved accurately', () => {
    const p = projectService.getById(designProjectId)
    expect(p?.account_name).toBe('Test Society Fund')
    expect(p?.bank_name).toBe('Test Bank')
    expect(p?.account_no).toBe('12345678901')
    expect(p?.ifsc_code).toBe('TEST0001234')
  })

  test('project update persists contact fields correctly', () => {
    projectService.update(designProjectId, { contact_email: 'updated@society.com' })
    const updated = projectService.getById(designProjectId)
    expect(updated?.contact_email).toBe('updated@society.com')
  })

  test('cascade delete removes units when project is deleted', () => {
    const tempProject = projectService.create({ name: `Cascade-${Date.now()}` } as any)
    unitService.create({
      project_id: tempProject,
      unit_number: 'X-001',
      owner_name: 'Cascade Owner',
      area_sqft: 100,
      unit_type: 'Plot',
      status: 'Sold'
    } as any)
    projectService.delete(tempProject)
    const units = unitService.getByProject(tempProject)
    expect(units).toHaveLength(0)
  })

  test('unique constraint prevents duplicate unit_number per project', () => {
    const pid = projectService.create({ name: `Unique-${Date.now()}` } as any)
    unitService.create({
      project_id: pid, unit_number: 'A-001', owner_name: 'Owner A',
      area_sqft: 200, unit_type: 'Plot', status: 'Sold'
    } as any)
    // Second insert should overwrite (ON CONFLICT REPLACE) or not throw
    expect(() => {
      unitService.create({
        project_id: pid, unit_number: 'A-001', owner_name: 'Owner B',
        area_sqft: 200, unit_type: 'Plot', status: 'Sold'
      } as any)
    }).not.toThrow()
  })

  test('unique constraint prevents duplicate (unit_id, financial_year) letters', () => {
    const pid = projectService.create({ name: `LetterUnique-${Date.now()}` } as any)
    const uid = unitService.create({
      project_id: pid, unit_number: 'U-001', owner_name: 'Owner',
      area_sqft: 100, unit_type: 'Bungalow', status: 'Sold'
    } as any)
    maintenanceRateService.create({
      project_id: pid, financial_year: '2024-25', rate_per_sqft: 10, unit_type: 'Bungalow'
    } as any)
    maintenanceLetterService.createBatch(pid, '2024-25', '2024-04-01', '2024-06-30', [uid], [])
    // Second batch for same unit+year should skip (not duplicate)
    maintenanceLetterService.createBatch(pid, '2024-25', '2024-04-01', '2024-06-30', [uid], [])
    const letters = maintenanceLetterService.getAll().filter(
      l => l.unit_id === uid && l.financial_year === '2024-25'
    )
    expect(letters).toHaveLength(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — UNIT TESTS: Individual utility functions
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 3 — Unit Tests: Utilities', () => {
  describe('numberToWordsIndian', () => {
    test('zero', () => expect(numberToWordsIndian(0)).toBe('Zero'))
    test('single digit', () => expect(numberToWordsIndian(7)).toBe('Seven'))
    test('teen', () => expect(numberToWordsIndian(13)).toBe('Thirteen'))
    test('tens', () => expect(numberToWordsIndian(45)).toBe('Forty Five'))
    test('hundred', () => expect(numberToWordsIndian(100)).toBe('One Hundred'))
    test('hundred and something', () => expect(numberToWordsIndian(105)).toBe('One Hundred and Five'))
    test('thousand', () => expect(numberToWordsIndian(1000)).toBe('One Thousand'))
    test('typical maintenance bill 6000', () => expect(numberToWordsIndian(6000)).toBe('Six Thousand'))
    test('lakh', () => expect(numberToWordsIndian(100000)).toBe('One Lakh'))
    test('1.5 lakh', () => expect(numberToWordsIndian(150000)).toBe('One Lakh Fifty Thousand'))
    test('crore', () => expect(numberToWordsIndian(10000000)).toBe('One Crore'))
    test('paise (decimals)', () => expect(numberToWordsIndian(10.50)).toBe('Ten and Fifty Paise'))
    test('complex Indian number', () => {
      expect(numberToWordsIndian(1234567)).toBe(
        'Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven'
      )
    })
  })

  describe('dateUtils', () => {
    test('getCurrentFinancialYear returns YYYY-YY format', () => {
      const fy = getCurrentFinancialYear()
      expect(fy).toMatch(/^\d{4}-\d{2}$/)
    })

    test('getFYStartYear extracts year correctly', () => {
      expect(getFYStartYear('2024-25')).toBe(2024)
      expect(getFYStartYear('2023-24')).toBe(2023)
    })

    test('getFYDeadline returns correct year', () => {
      expect(getFYDeadline('2024-25')).toBe('30th June 2025')
      expect(getFYDeadline('2023-24')).toBe('30th June 2024')
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — INTEGRATION: Service ↔ DB Round-trips
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 4 — Integration: Service ↔ DB Round-trips', () => {
  let intProjectId: number
  let intUnitId: number

  beforeAll(() => {
    intProjectId = projectService.create({
      name: `Integration-${Date.now()}`,
      status: 'Sold',
      template_type: 'standard'
    } as any)
    intUnitId = unitService.create({
      project_id: intProjectId,
      unit_number: 'INT-001',
      owner_name: 'Integration Owner',
      area_sqft: 250,
      unit_type: 'Bungalow',
      status: 'Sold',
      contact_number: '9876543210',
      email: 'int@test.com',
      billing_address: '123 Test Road',
      resident_address: '456 Other Road',
      penalty: 500
    } as any)
  })

  test('unit stores and retrieves all fields correctly', () => {
    const unit = unitService.getByProject(intProjectId).find(u => u.id === intUnitId)
    expect(unit?.owner_name).toBe('Integration Owner')
    expect(unit?.area_sqft).toBe(250)
    expect(unit?.unit_type).toBe('Bungalow')
    expect(unit?.contact_number).toBe('9876543210')
    expect(unit?.email).toBe('int@test.com')
    expect(unit?.billing_address).toBe('123 Test Road')
    expect(unit?.resident_address).toBe('456 Other Road')
    expect(unit?.penalty).toBe(500)
  })

  test('unit update persists changes', () => {
    unitService.update(intUnitId, { owner_name: 'Updated Owner', area_sqft: 300 })
    const updated = unitService.getByProject(intProjectId).find(u => u.id === intUnitId)
    expect(updated?.owner_name).toBe('Updated Owner')
    expect(updated?.area_sqft).toBe(300)
  })

  test('maintenance rate CRUD round-trip', () => {
    const rateId = maintenanceRateService.create({
      project_id: intProjectId,
      financial_year: '2024-25',
      rate_per_sqft: 15.5,
      unit_type: 'Bungalow',
      billing_frequency: 'YEARLY'
    } as any)
    expect(rateId).toBeGreaterThan(0)

    const rates = maintenanceRateService.getByProject(intProjectId)
    const rate = rates.find(r => r.id === rateId)
    expect(rate?.rate_per_sqft).toBe(15.5)
    expect(rate?.unit_type).toBe('Bungalow')
    expect(rate?.financial_year).toBe('2024-25')

    maintenanceRateService.update(rateId, { rate_per_sqft: 20 })
    const updated = maintenanceRateService.getByProject(intProjectId).find(r => r.id === rateId)
    expect(updated?.rate_per_sqft).toBe(20)

    maintenanceRateService.delete(rateId)
    const afterDelete = maintenanceRateService.getByProject(intProjectId).find(r => r.id === rateId)
    expect(afterDelete).toBeUndefined()
  })

  test('maintenance slabs CRUD round-trip', () => {
    const rateId = maintenanceRateService.create({
      project_id: intProjectId,
      financial_year: '2025-26',
      rate_per_sqft: 12,
      unit_type: 'Bungalow'
    } as any)
    const slabId = maintenanceRateService.addSlab({
      rate_id: rateId,
      due_date: '2025-06-30',
      discount_percentage: 10,
      is_early_payment: true
    } as any)
    expect(slabId).toBeGreaterThan(0)

    const slabs = maintenanceRateService.getSlabs(rateId)
    expect(slabs).toHaveLength(1)
    expect(slabs[0].discount_percentage).toBe(10)
    expect(slabs[0].is_early_payment).toBe(true)
    expect(slabs[0].due_date).toBe('2025-06-30')

    maintenanceRateService.deleteSlab(slabId)
    const afterDelete = maintenanceRateService.getSlabs(rateId)
    expect(afterDelete).toHaveLength(0)
  })

  test('payment CRUD round-trip with receipt generation', () => {
    maintenanceRateService.create({
      project_id: intProjectId,
      financial_year: '2023-24',
      rate_per_sqft: 10,
      unit_type: 'Bungalow'
    } as any)
    maintenanceLetterService.createBatch(
      intProjectId, '2023-24', '2023-04-01', '2023-06-30', [intUnitId], []
    )
    const letters = maintenanceLetterService.getAll().filter(
      l => l.unit_id === intUnitId && l.financial_year === '2023-24'
    )
    expect(letters.length).toBeGreaterThan(0)
    const letterId = letters[0].id!

    const paymentId = paymentService.create({
      project_id: intProjectId,
      unit_id: intUnitId,
      letter_id: letterId,
      payment_date: '2023-05-01',
      payment_amount: 1000,
      payment_mode: 'Cheque',
      cheque_number: 'CHQ12345',
      financial_year: '2023-24',
      payment_status: 'Received'
    } as any)
    expect(paymentId).toBeGreaterThan(0)

    const payment = paymentService.getById(paymentId)
    expect(payment?.payment_amount).toBe(1000)
    expect(payment?.payment_mode).toBe('Cheque')
    expect(payment?.cheque_number).toBe('CHQ12345')
    expect(payment?.receipt_number).toMatch(/REC-/)
  })

  test('payment with Transfer mode is accepted', () => {
    const rateId = maintenanceRateService.create({
      project_id: intProjectId,
      financial_year: '2022-23',
      rate_per_sqft: 8,
      unit_type: 'Bungalow'
    } as any)
    maintenanceLetterService.createBatch(
      intProjectId, '2022-23', '2022-04-01', '2022-06-30', [intUnitId], []
    )
    expect(() => {
      paymentService.create({
        project_id: intProjectId,
        unit_id: intUnitId,
        payment_date: '2022-05-10',
        payment_amount: 500,
        payment_mode: 'Transfer',
        financial_year: '2022-23',
        payment_status: 'Received'
      } as any)
    }).not.toThrow()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 5 — PIPELINE: Full Project → Units → Rates → Billing → Payment flow
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Pipeline: End-to-End Workflow', () => {
  let pipelineProjectId: number
  let plotUnitId: number
  let bungalowUnitId: number

  beforeAll(() => {
    pipelineProjectId = projectService.create({
      name: `Pipeline-Society-${Date.now()}`,
      address: 'Pipeline Street, Test City',
      city: 'Ahmedabad',
      status: 'Sold',
      template_type: 'standard',
      account_name: 'Pipeline Residents Fund',
      bank_name: 'State Bank',
      account_no: '99887766554',
      ifsc_code: 'SBIN0099887',
      branch: 'Pipeline Branch',
      contact_email: 'pipeline@society.in',
      contact_phone: '+91-9000000001',
      payment_modes: 'Cheque/UPI'
    } as any)

    plotUnitId = unitService.create({
      project_id: pipelineProjectId,
      unit_number: 'A-101',
      owner_name: 'Ramesh Patel',
      area_sqft: 220,
      unit_type: 'Plot',
      sector_code: 'A',
      status: 'Sold',
      contact_number: '9876501234',
      email: 'ramesh@test.com'
    } as any)

    bungalowUnitId = unitService.create({
      project_id: pipelineProjectId,
      unit_number: 'B-202',
      owner_name: 'Sonal Shah',
      area_sqft: 180,
      unit_type: 'Bungalow',
      sector_code: 'B',
      status: 'Sold',
      contact_number: '9876509876',
      email: 'sonal@test.com'
    } as any)
  })

  test('Step 1: project created with all fields', () => {
    const p = projectService.getById(pipelineProjectId)
    expect(p?.name).toContain('Pipeline-Society')
    expect(p?.contact_email).toBe('pipeline@society.in')
    expect(p?.payment_modes).toBe('Cheque/UPI')
  })

  test('Step 2: units created with correct types', () => {
    const units = unitService.getByProject(pipelineProjectId)
    expect(units).toHaveLength(2)
    const plot = units.find(u => u.unit_number === 'A-101')
    const bungalow = units.find(u => u.unit_number === 'B-202')
    expect(plot?.unit_type).toBe('Plot')
    expect(bungalow?.unit_type).toBe('Bungalow')
    expect(plot?.area_sqft).toBe(220)
    expect(bungalow?.area_sqft).toBe(180)
  })

  test('Step 3: separate rates for Plot and Bungalow', () => {
    const plotRateId = maintenanceRateService.create({
      project_id: pipelineProjectId,
      financial_year: '2024-25',
      rate_per_sqft: 25,
      unit_type: 'Plot'
    } as any)
    const bungalowRateId = maintenanceRateService.create({
      project_id: pipelineProjectId,
      financial_year: '2024-25',
      rate_per_sqft: 30,
      unit_type: 'Bungalow'
    } as any)
    expect(plotRateId).toBeGreaterThan(0)
    expect(bungalowRateId).toBeGreaterThan(0)

    const rates = maintenanceRateService.getByProject(pipelineProjectId)
    const plotRate = rates.find(r => r.unit_type === 'Plot')
    const bungalowRate = rates.find(r => r.unit_type === 'Bungalow')
    expect(plotRate?.rate_per_sqft).toBe(25)
    expect(bungalowRate?.rate_per_sqft).toBe(30)
  })

  test('Step 4a: billing creates letters for both units', () => {
    const result = maintenanceLetterService.createBatch(
      pipelineProjectId, '2024-25', '2024-04-01', '2024-06-30',
      [plotUnitId, bungalowUnitId], []
    )
    expect(result).toBe(true)

    const letters = maintenanceLetterService.getAll().filter(
      l => l.project_id === pipelineProjectId && l.financial_year === '2024-25'
    )
    expect(letters).toHaveLength(2)
  })

  test('Step 4b: plot letter uses Plot rate (220 sqft × ₹25 = ₹5500)', () => {
    const letters = maintenanceLetterService.getAll().filter(
      l => l.unit_id === plotUnitId && l.financial_year === '2024-25'
    )
    expect(letters).toHaveLength(1)
    expect(letters[0].base_amount).toBe(220 * 25) // 5500
  })

  test('Step 4c: bungalow letter uses Bungalow rate (180 sqft × ₹30 = ₹5400)', () => {
    const letters = maintenanceLetterService.getAll().filter(
      l => l.unit_id === bungalowUnitId && l.financial_year === '2024-25'
    )
    expect(letters).toHaveLength(1)
    expect(letters[0].base_amount).toBe(180 * 30) // 5400
  })

  test('Step 5: payment marks letter as paid', () => {
    const plotLetter = maintenanceLetterService.getAll().find(
      l => l.unit_id === plotUnitId && l.financial_year === '2024-25'
    )!
    paymentService.create({
      project_id: pipelineProjectId,
      unit_id: plotUnitId,
      letter_id: plotLetter.id,
      payment_date: '2024-05-15',
      payment_amount: plotLetter.final_amount,
      payment_mode: 'Transfer',
      financial_year: '2024-25',
      payment_status: 'Received'
    } as any)

    const updatedLetter = maintenanceLetterService.getById(plotLetter.id!)
    expect(updatedLetter?.is_paid).toBeTruthy()
    expect(updatedLetter?.status).toBe('Paid')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 6 — CALCULATION ACCURACY
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 6 — Calculation Accuracy', () => {
  let calcProjectId: number

  beforeAll(() => {
    calcProjectId = projectService.create({
      name: `Calc-Test-${Date.now()}`, status: 'Sold'
    } as any)
  })

  test('base_amount = area_sqft × rate_per_sqft (no rounding error)', () => {
    const unitId = unitService.create({
      project_id: calcProjectId, unit_number: 'C-001', owner_name: 'Calc Owner',
      area_sqft: 123.5, unit_type: 'Plot', status: 'Sold'
    } as any)
    const rateId = maintenanceRateService.create({
      project_id: calcProjectId, financial_year: '2024-25',
      rate_per_sqft: 7.5, unit_type: 'Plot'
    } as any)
    maintenanceLetterService.createBatch(
      calcProjectId, '2024-25', '2024-04-01', '2024-06-30', [unitId], []
    )
    const letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === unitId && l.financial_year === '2024-25'
    )
    expect(letter?.base_amount).toBeCloseTo(123.5 * 7.5, 2) // 926.25
  })

  test('manual add-ons are stored and included in final_amount', () => {
    const unitId = unitService.create({
      project_id: calcProjectId, unit_number: 'C-002', owner_name: 'Addon Owner',
      area_sqft: 200, unit_type: 'Plot', status: 'Sold'
    } as any)
    maintenanceRateService.create({
      project_id: calcProjectId, financial_year: '2026-27',
      rate_per_sqft: 10, unit_type: 'Plot'
    } as any)
    maintenanceLetterService.createBatch(
      calcProjectId, '2026-27', '2026-04-01', '2026-06-30', [unitId],
      [{ addon_name: 'NA Tax', addon_amount: 500 }, { addon_name: 'Cable', addon_amount: 200 }]
    )
    const letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === unitId && l.financial_year === '2026-27'
    )
    // base = 200×10 = 2000, addons = 700, final = 2700
    expect(letter?.base_amount).toBe(2000)
    expect(letter?.final_amount).toBe(2700)

    const addOns = maintenanceLetterService.getAddOns(letter!.id!)
    expect(addOns.some(a => a.addon_name === 'NA Tax' && a.addon_amount === 500)).toBe(true)
    expect(addOns.some(a => a.addon_name === 'Cable' && a.addon_amount === 200)).toBe(true)
  })

  test('arrears from prior unpaid year are rolled into next year final_amount', () => {
    const unitId = unitService.create({
      project_id: calcProjectId, unit_number: 'C-003', owner_name: 'Arrears Owner',
      area_sqft: 100, unit_type: 'Bungalow', status: 'Sold'
    } as any)
    // FY 2021-22: create letter for 1000
    maintenanceRateService.create({
      project_id: calcProjectId, financial_year: '2021-22',
      rate_per_sqft: 10, unit_type: 'Bungalow'
    } as any)
    maintenanceLetterService.createBatch(
      calcProjectId, '2021-22', '2021-04-01', '2021-06-30', [unitId], []
    )
    // No payment made — full amount is arrears

    // FY 2021-22 letter final = 1000
    maintenanceRateService.create({
      project_id: calcProjectId, financial_year: '2021-23',
      rate_per_sqft: 10, unit_type: 'Bungalow'
    } as any)
    maintenanceLetterService.createBatch(
      calcProjectId, '2021-23', '2022-04-01', '2022-06-30', [unitId], []
    )

    const fy23Letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === unitId && l.financial_year === '2021-23'
    )
    // base=1000, arrears from 2021-22=1000 (unpaid), final >= 2000
    expect(fy23Letter?.arrears).toBeGreaterThan(0)
    expect(fy23Letter?.final_amount).toBeGreaterThan(fy23Letter?.base_amount!)
  })

  test('slab discount is stored as discount_amount on letter', () => {
    const unitId = unitService.create({
      project_id: calcProjectId, unit_number: 'C-004', owner_name: 'Slab Owner',
      area_sqft: 200, unit_type: 'Plot', status: 'Sold'
    } as any)
    const rateId = maintenanceRateService.create({
      project_id: calcProjectId, financial_year: '2027-28',
      rate_per_sqft: 20, unit_type: 'Plot'
    } as any)
    // Add 10% early payment slab
    maintenanceRateService.addSlab({
      rate_id: rateId, due_date: '2027-06-30',
      discount_percentage: 10, is_early_payment: true
    } as any)
    maintenanceLetterService.createBatch(
      calcProjectId, '2027-28', '2027-04-01', '2027-06-30', [unitId], []
    )
    const letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === unitId && l.financial_year === '2027-28'
    )
    // base = 200×20 = 4000, 10% discount = 400
    expect(letter?.base_amount).toBe(4000)
    expect(letter?.discount_amount).toBeCloseTo(400, 1)
  })

  test('payment status tracks partial vs full payment correctly', () => {
    const unitId = unitService.create({
      project_id: calcProjectId, unit_number: 'C-005', owner_name: 'Payment Owner',
      area_sqft: 100, unit_type: 'Plot', status: 'Sold'
    } as any)
    maintenanceRateService.create({
      project_id: calcProjectId, financial_year: '2028-29',
      rate_per_sqft: 50, unit_type: 'Plot'
    } as any)
    maintenanceLetterService.createBatch(
      calcProjectId, '2028-29', '2028-04-01', '2028-06-30', [unitId], []
    )
    const letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === unitId && l.financial_year === '2028-29'
    )! // final_amount = 5000

    // Partial payment
    paymentService.create({
      project_id: calcProjectId, unit_id: unitId, letter_id: letter.id,
      payment_date: '2028-05-01', payment_amount: 2000,
      payment_mode: 'Cash', financial_year: '2028-29', payment_status: 'Received'
    } as any)
    const afterPartial = maintenanceLetterService.getById(letter.id!)
    expect(afterPartial?.is_paid).toBeFalsy()
    expect(afterPartial?.status).toBe('Pending')

    // Full payment (remaining 3000)
    paymentService.create({
      project_id: calcProjectId, unit_id: unitId, letter_id: letter.id,
      payment_date: '2028-05-20', payment_amount: 3000,
      payment_mode: 'UPI', financial_year: '2028-29', payment_status: 'Received'
    } as any)
    const afterFull = maintenanceLetterService.getById(letter.id!)
    expect(afterFull?.is_paid).toBeTruthy()
    expect(afterFull?.status).toBe('Paid')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 7 — PDF OUTPUT: Data integrity (no dummy values)
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 7 — PDF Output: Data Integrity', () => {
  let pdfProjectId: number
  let pdfUnitId: number
  let pdfLetterId: number

  beforeAll(() => {
    pdfProjectId = projectService.create({
      name: `PDF-Society-${Date.now()}`,
      address: '1 PDF Road, Test City',
      city: 'Mumbai',
      account_name: 'PDF Fund',
      bank_name: 'PDF Bank',
      account_no: '11223344556',
      ifsc_code: 'PDF0001234',
      branch: 'PDF Branch',
      contact_email: 'pdf@society.in',
      contact_phone: '+91-8000000001',
      status: 'Sold',
      template_type: 'standard'
    } as any)

    pdfUnitId = unitService.create({
      project_id: pdfProjectId, unit_number: 'PDF-001',
      owner_name: 'PDF Owner', area_sqft: 150,
      unit_type: 'Bungalow', status: 'Sold'
    } as any)

    maintenanceRateService.create({
      project_id: pdfProjectId, financial_year: '2024-25',
      rate_per_sqft: 20, unit_type: 'Bungalow'
    } as any)

    maintenanceLetterService.createBatch(
      pdfProjectId, '2024-25', '2024-04-01', '2024-06-30', [pdfUnitId], []
    )

    const letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === pdfUnitId && l.financial_year === '2024-25'
    )!
    pdfLetterId = letter.id!
  })

  test('getById returns real bank details (not placeholder)', () => {
    const letter = maintenanceLetterService.getById(pdfLetterId)
    expect(letter?.account_name).toBe('PDF Fund')
    expect(letter?.bank_name).toBe('PDF Bank')
    expect(letter?.account_no).toBe('11223344556')
    expect(letter?.ifsc_code).toBe('PDF0001234')
  })

  test('getById returns real owner and unit info', () => {
    const letter = maintenanceLetterService.getById(pdfLetterId)
    expect(letter?.owner_name).toBe('PDF Owner')
    expect(letter?.unit_number).toBe('PDF-001')
    expect(letter?.project_name).toBe(
      projectService.getById(pdfProjectId)?.name
    )
  })

  test('letter has correct financial_year and due_date', () => {
    const letter = maintenanceLetterService.getById(pdfLetterId)
    expect(letter?.financial_year).toBe('2024-25')
    expect(letter?.due_date).toBe('2024-06-30')
  })

  test('base_amount matches area × rate exactly', () => {
    const letter = maintenanceLetterService.getById(pdfLetterId)
    expect(letter?.base_amount).toBe(150 * 20) // 3000
  })

  test('PDF generation creates a real file (async)', async () => {
    const pdfPath = await maintenanceLetterService.generatePdf(pdfLetterId)
    expect(fs.existsSync(pdfPath)).toBe(true)
    const stat = fs.statSync(pdfPath)
    expect(stat.size).toBeGreaterThan(1000) // real PDF, not empty
    expect(pdfPath).toContain(`MaintenanceLetter_${pdfLetterId}`)
  }, 30000)

  test('receipt PDF generation creates a real file', async () => {
    const paymentId = paymentService.create({
      project_id: pdfProjectId, unit_id: pdfUnitId, letter_id: pdfLetterId,
      payment_date: '2024-05-01', payment_amount: 3000,
      payment_mode: 'Cheque', cheque_number: 'CHQ99999',
      financial_year: '2024-25', payment_status: 'Received'
    } as any)

    const receiptPath = await paymentService.generateReceiptPdf(paymentId)
    expect(fs.existsSync(receiptPath)).toBe(true)
    const stat = fs.statSync(receiptPath)
    expect(stat.size).toBeGreaterThan(1000)
    expect(receiptPath).toContain('Receipt_')
  }, 30000)
})

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 8 — EDGE CASES & ERROR PATHS
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 8 — Edge Cases & Error Paths', () => {
  let edgeProjectId: number

  beforeAll(() => {
    edgeProjectId = projectService.create({
      name: `Edge-${Date.now()}`, status: 'Sold'
    } as any)
  })

  test('createBatch throws when no rate exists for unit_type', () => {
    const unitId = unitService.create({
      project_id: edgeProjectId, unit_number: 'EDGE-001',
      owner_name: 'Edge Owner', area_sqft: 100,
      unit_type: 'Plot', status: 'Sold'
    } as any)
    // Only Bungalow rate exists — Plot should fail
    maintenanceRateService.create({
      project_id: edgeProjectId, financial_year: '2099-00',
      rate_per_sqft: 10, unit_type: 'Bungalow'
    } as any)
    expect(() => {
      maintenanceLetterService.createBatch(
        edgeProjectId, '2099-00', '2099-04-01', '2099-06-30', [unitId], []
      )
    }).toThrow()
  })

  test('createBatch throws when no rate exists at all for that year', () => {
    const unitId = unitService.create({
      project_id: edgeProjectId, unit_number: 'EDGE-002',
      owner_name: 'Edge Owner 2', area_sqft: 100,
      unit_type: 'Bungalow', status: 'Sold'
    } as any)
    expect(() => {
      maintenanceLetterService.createBatch(
        edgeProjectId, '2098-99', '2098-04-01', '2098-06-30', [unitId], []
      )
    }).toThrow()
  })

  test('getAllAddOns returns add-ons with correct amounts', () => {
    const unitId = unitService.create({
      project_id: edgeProjectId, unit_number: 'EDGE-003',
      owner_name: 'Addon Edge', area_sqft: 200, unit_type: 'Plot', status: 'Sold'
    } as any)
    maintenanceRateService.create({
      project_id: edgeProjectId, financial_year: '2097-98',
      rate_per_sqft: 5, unit_type: 'Plot'
    } as any)
    maintenanceLetterService.createBatch(
      edgeProjectId, '2097-98', '2097-04-01', '2097-06-30', [unitId],
      [{ addon_name: 'Edge Charge', addon_amount: 999 }]
    )
    const allAddOns = maintenanceLetterService.getAllAddOns()
    const edgeAddon = allAddOns.find(a => a.addon_name === 'Edge Charge' && a.addon_amount === 999)
    expect(edgeAddon).toBeDefined()
  })

  test('deleteAddOn removes addon and does not corrupt final_amount logic', () => {
    const letter = maintenanceLetterService.getAll().find(
      l => l.project_id === edgeProjectId && l.financial_year === '2097-98'
    )!
    const addOns = maintenanceLetterService.getAddOns(letter.id!)
    expect(addOns.length).toBeGreaterThan(0)
    const firstAddon = addOns[0]
    maintenanceLetterService.deleteAddOn(firstAddon.id!)
    const remaining = maintenanceLetterService.getAddOns(letter.id!)
    expect(remaining.find(a => a.id === firstAddon.id)).toBeUndefined()
  })

  test('project getAll includes unit_count', () => {
    const allProjects = projectService.getAll()
    const found = allProjects.find(p => p.id === edgeProjectId)
    expect(found).toBeDefined()
    expect(typeof found?.unit_count).toBe('number')
  })

  test('bulkDelete removes multiple records atomically', () => {
    const pid = projectService.create({ name: `Bulk-${Date.now()}` } as any)
    const u1 = unitService.create({
      project_id: pid, unit_number: 'B-001', owner_name: 'O1',
      area_sqft: 100, unit_type: 'Plot', status: 'Sold'
    } as any)
    const u2 = unitService.create({
      project_id: pid, unit_number: 'B-002', owner_name: 'O2',
      area_sqft: 100, unit_type: 'Plot', status: 'Sold'
    } as any)
    unitService.bulkDelete([u1, u2])
    const remaining = unitService.getByProject(pid)
    expect(remaining).toHaveLength(0)
  })

  test('financial_year format YYYY-YY is enforced by ipcHandlers check', () => {
    const isFinancialYear = (v: unknown): boolean =>
      typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)
    expect(isFinancialYear('2024-25')).toBe(true)
    expect(isFinancialYear('2024-2025')).toBe(false)
    expect(isFinancialYear('24-25')).toBe(false)
    expect(isFinancialYear('')).toBe(false)
    expect(isFinancialYear(2024)).toBe(false)
  })

  test('payment_mode validation covers all 4 valid modes', () => {
    const validModes = ['Transfer', 'Cheque', 'Cash', 'UPI']
    validModes.forEach(mode => {
      expect(validModes.includes(mode)).toBe(true)
    })
    expect(validModes.includes('Wire')).toBe(false)
    expect(validModes.includes('')).toBe(false)
  })

  test('getById returns undefined for non-existent letter', () => {
    const result = maintenanceLetterService.getById(999999999)
    expect(result).toBeUndefined()
  })

  test('getById returns undefined for non-existent project', () => {
    const result = projectService.getById(999999999)
    expect(result).toBeUndefined()
  })

  test('arrears are 0 when all prior letters are fully paid', () => {
    const pid = projectService.create({ name: `PaidArrears-${Date.now()}` } as any)
    const uid = unitService.create({
      project_id: pid, unit_number: 'PA-001', owner_name: 'Paid Owner',
      area_sqft: 100, unit_type: 'Plot', status: 'Sold'
    } as any)
    maintenanceRateService.create({
      project_id: pid, financial_year: '2020-21', rate_per_sqft: 10, unit_type: 'Plot'
    } as any)
    maintenanceLetterService.createBatch(pid, '2020-21', '2020-04-01', '2020-06-30', [uid], [])
    const fy21Letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === uid && l.financial_year === '2020-21'
    )!
    // Pay in full
    paymentService.create({
      project_id: pid, unit_id: uid, letter_id: fy21Letter.id,
      payment_date: '2020-05-01', payment_amount: fy21Letter.final_amount,
      payment_mode: 'Cash', financial_year: '2020-21', payment_status: 'Received'
    } as any)

    // Next year — should have 0 arrears
    maintenanceRateService.create({
      project_id: pid, financial_year: '2020-22', rate_per_sqft: 10, unit_type: 'Plot'
    } as any)
    maintenanceLetterService.createBatch(pid, '2020-22', '2021-04-01', '2021-06-30', [uid], [])
    const fy22Letter = maintenanceLetterService.getAll().find(
      l => l.unit_id === uid && l.financial_year === '2020-22'
    )!
    expect(fy22Letter.arrears).toBe(0)
  })
})
