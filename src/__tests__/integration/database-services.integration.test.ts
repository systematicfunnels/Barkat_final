/**
 * Integration tests for Database Services interactions
 * Tests data flow, service communication, and module interactions
 */

import { dbService } from '../../main/db/database'
import { projectService } from '../../main/services/ProjectService'
import { unitService } from '../../main/services/UnitService'
import { paymentService } from '../../main/services/PaymentService'

// Mock better-sqlite3
jest.mock('better-sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    prepare: jest.fn().mockReturnValue({
      run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
      all: jest.fn().mockReturnValue([]),
      get: jest.fn().mockReturnValue(null)
    }),
    exec: jest.fn(),
    close: jest.fn(),
    pragma: jest.fn()
  }))
}))

describe('Database Services Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Service Interdependency Integration', () => {
    test('should handle project-unit-payment workflow', () => {
      // Create project
      const projectId = projectService.create({
        name: 'Integration Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit
      const unitId = unitService.create({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Create payment
      const paymentId = paymentService.create({
        project_id: projectId,
        unit_id: unitId,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer',
        remarks: 'Integration test payment'
      })

      // Verify complete workflow
      expect(projectId).toBe(1)
      expect(unitId).toBe(1)
      expect(paymentId).toBe(1)

      // Verify data relationships
      const project = projectService.getById(projectId)
      const units = unitService.getByProject(projectId)
      const payments = paymentService.getByProject(projectId)

      expect(project).toBeDefined()
      expect(units).toHaveLength(1)
      expect(payments).toHaveLength(1)

      expect(units[0].project_id).toBe(projectId)
      expect(payments[0].project_id).toBe(projectId)
      expect(payments[0].unit_id).toBe(unitId)
    })

    test('should handle cascading delete operations', () => {
      // Create project with multiple units and payments
      const projectId = projectService.create({
        name: 'Cascade Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create multiple units
      const unitIds = []
      for (let i = 1; i <= 3; i++) {
        const unitId = unitService.create({
          project_id: projectId,
          unit_number: `A-00${i}`,
          sector_code: 'A',
          owner_name: `Owner ${i}`,
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: `owner${i}@example.com`,
          status: 'active',
          penalty: 500
        })
        unitIds.push(unitId)
      }

      // Create payments
      unitIds.forEach((unitId, index) => {
        paymentService.create({
          project_id: projectId,
          unit_id: unitId,
          payment_date: '2024-03-18',
          payment_amount: 5000 + (index * 100),
          payment_mode: 'transfer',
          remarks: `Payment ${index + 1}`
        })
      })

      // Verify data exists before deletion
      expect(unitService.getByProject(projectId)).toHaveLength(3)
      expect(paymentService.getByProject(projectId)).toHaveLength(3)

      // Delete project (should cascade delete related data)
      const deleteResult = projectService.delete(projectId)
      expect(deleteResult).toBe(true)

      // Verify cascading deletion
      expect(projectService.getById(projectId)).toBeUndefined()
      expect(unitService.getByProject(projectId)).toHaveLength(0)
      expect(paymentService.getByProject(projectId)).toHaveLength(0)
    })
  })

  describe('Transaction Integration', () => {
    test('should handle multi-service transaction success', () => {
      const result = dbService.transaction(() => {
        const projectId = projectService.create({
          name: 'Transaction Test Society',
          address: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: '123456',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })

        const unitId = unitService.create({
          project_id: projectId,
          unit_number: 'A-001',
          sector_code: 'A',
          owner_name: 'John Doe',
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: 'john@example.com',
          status: 'active',
          penalty: 500
        })

        const paymentId = paymentService.create({
          project_id: projectId,
          unit_id: unitId,
          payment_date: '2024-03-18',
          payment_amount: 5000,
          payment_mode: 'transfer',
          remarks: 'Transaction test payment'
        })

        return { projectId, unitId, paymentId }
      })

      expect(result).toEqual({
        projectId: 1,
        unitId: 1,
        paymentId: 1
      })

      // Verify all data was committed
      expect(projectService.getById(1)).toBeDefined()
      expect(unitService.getByProject(1)).toHaveLength(1)
      expect(paymentService.getByProject(1)).toHaveLength(1)
    })

    test('should handle multi-service transaction rollback', () => {
      // Mock database error on unit creation
      const mockStmt = (dbService as any).db.prepare
      const originalRun = mockStmt().run
      let callCount = 0

      mockStmt.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          callCount++
          if (callCount === 2) { // Second call (unit creation)
            throw new Error('NOT NULL constraint failed')
          }
          return originalRun()
        }),
        all: jest.fn().mockReturnValue([]),
        get: jest.fn().mockReturnValue(null)
      })

      expect(() => {
        dbService.transaction(() => {
          projectService.create({
            name: 'Rollback Test Society',
            address: '123 Test Street',
            city: 'Test City',
            state: 'Test State',
            pincode: '123456',
            status: 'active',
            account_name: 'Test Account',
            bank_name: 'Test Bank',
            account_no: '1234567890',
            ifsc_code: 'TEST123',
            branch: 'Test Branch'
          })

          unitService.create({
            project_id: 1,
            unit_number: '', // Invalid - will cause error
            sector_code: 'A',
            owner_name: 'John Doe',
            area_sqft: 1200,
            unit_type: 'flat',
            contact_number: '9876543210',
            email: 'john@example.com',
            status: 'active',
            penalty: 500
          })
        })
      }).toThrow('NOT NULL constraint failed')

      // Verify rollback - no data should exist
      expect(projectService.getById(1)).toBeUndefined()
      expect(unitService.getByProject(1)).toHaveLength(0)
    })
  })

  describe('Data Consistency Integration', () => {
    test('should maintain data consistency across services', () => {
      // Create project
      const projectId = projectService.create({
        name: 'Consistency Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit
      const unitId = unitService.create({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Update project status
      const updateResult = projectService.update(projectId, {
        status: 'inactive'
      })
      expect(updateResult).toBe(true)

      // Verify consistency
      const updatedProject = projectService.getById(projectId)
      const units = unitService.getByProject(projectId)

      expect(updatedProject?.status).toBe('inactive')
      expect(units).toHaveLength(1)
      expect(units[0].project_id).toBe(projectId)
    })

    test('should handle concurrent data modifications', () => {
      // Create project
      const projectId = projectService.create({
        name: 'Concurrent Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create multiple units
      const unitIds = []
      for (let i = 1; i <= 5; i++) {
        const unitId = unitService.create({
          project_id: projectId,
          unit_number: `A-00${i}`,
          sector_code: 'A',
          owner_name: `Owner ${i}`,
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: `owner${i}@example.com`,
          status: 'active',
          penalty: 500
        })
        unitIds.push(unitId)
      }

      // Update all units concurrently
      const updateResults = unitIds.map((unitId, index) => {
        return unitService.update(unitId, {
          owner_name: `Updated Owner ${index + 1}`,
          status: index % 2 === 0 ? 'inactive' : 'active'
        })
      })

      expect(updateResults.every(result => result === true)).toBe(true)

      // Verify all updates were applied
      const updatedUnits = unitService.getByProject(projectId)
      expect(updatedUnits).toHaveLength(5)

      updatedUnits.forEach((unit, index) => {
        expect(unit.owner_name).toBe(`Updated Owner ${index + 1}`)
        expect(unit.status).toBe(index % 2 === 0 ? 'inactive' : 'active')
      })
    })
  })

  describe('Performance Integration', () => {
    test('should handle bulk operations efficiently', () => {
      const startTime = Date.now()

      // Create project
      const projectId = projectService.create({
        name: 'Bulk Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create bulk units
      const unitIds = []
      for (let i = 1; i <= 100; i++) {
        const unitId = unitService.create({
          project_id: projectId,
          unit_number: `A-${i.toString().padStart(3, '0')}`,
          sector_code: 'A',
          owner_name: `Owner ${i}`,
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: `owner${i}@example.com`,
          status: 'active',
          penalty: 500
        })
        unitIds.push(unitId)
      }

      // Create bulk payments
      unitIds.forEach((unitId, index) => {
        paymentService.create({
          project_id: projectId,
          unit_id: unitId,
          payment_date: '2024-03-18',
          payment_amount: 5000,
          payment_mode: 'transfer',
          remarks: `Bulk payment ${index + 1}`
        })
      })

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(2000) // Should complete within 2 seconds
      expect(unitIds).toHaveLength(100)

      // Verify data integrity
      const units = unitService.getByProject(projectId)
      const payments = paymentService.getByProject(projectId)

      expect(units).toHaveLength(100)
      expect(payments).toHaveLength(100)
    })

    test('should handle large dataset queries efficiently', () => {
      // Create large dataset
      const projectIds = []
      for (let i = 1; i <= 50; i++) {
        const projectId = projectService.create({
          name: `Large Test Project ${i}`,
          address: `${i} Test Street`,
          city: 'Test City',
          state: 'Test State',
          pincode: '123456',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
        projectIds.push(projectId)
      }

      const startTime = Date.now()
      const allProjects = projectService.getAll()
      const endTime = Date.now()

      expect(allProjects).toHaveLength(50)
      expect(endTime - startTime).toBeLessThan(500) // Should complete within 500ms
    })
  })

  describe('Error Handling Integration', () => {
    test('should handle foreign key constraint violations', () => {
      // Try to create unit with non-existent project
      expect(() => {
        unitService.create({
          project_id: 999, // Non-existent project
          unit_number: 'A-001',
          sector_code: 'A',
          owner_name: 'John Doe',
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: 'john@example.com',
          status: 'active',
          penalty: 500
        })
      }).toThrow()
    })

    test('should handle unique constraint violations', () => {
      // Create project
      const projectId = projectService.create({
        name: 'Unique Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Try to create another project with same name
      expect(() => {
        projectService.create({
          name: 'Unique Test Society', // Duplicate name
          address: '456 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: '123456',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
      }).toThrow()
    })

    test('should handle check constraint violations', () => {
      // Try to create project with invalid pincode
      expect(() => {
        projectService.create({
          name: 'Constraint Test Society',
          address: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: 'invalid', // Invalid pincode format
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
      }).toThrow()
    })
  })

  describe('Data Flow Integration', () => {
    test('should handle complete billing workflow', () => {
      // Create project
      const projectId = projectService.create({
        name: 'Billing Workflow Test',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit
      const unitId = unitService.create({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Record payment
      const paymentId = paymentService.create({
        project_id: projectId,
        unit_id: unitId,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer',
        remarks: 'Billing workflow payment'
      })

      // Verify complete workflow
      const project = projectService.getById(projectId)
      const units = unitService.getByProject(projectId)
      const payments = paymentService.getByProject(projectId)

      expect(project).toBeDefined()
      expect(units).toHaveLength(1)
      expect(payments).toHaveLength(1)
      expect(payments[0].payment_amount).toBe(5000)
    })

    test('should handle data transformation between services', () => {
      // Create project with specific data
      const projectId = projectService.create({
        name: 'Transformation Test',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit with calculated penalty
      const unitId = unitService.create({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Record payment
      const paymentId = paymentService.create({
        project_id: projectId,
        unit_id: unitId,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer',
        remarks: 'Transformation test payment'
      })

      // Verify data flow
      const project = projectService.getById(projectId)
      const unit = unitService.getByProject(projectId)[0]
      const payment = paymentService.getById(paymentId)

      expect(project?.name).toBe('Transformation Test')
      expect(unit.penalty).toBe(500)
      expect(payment?.payment_amount).toBe(5000)
      expect(payment?.project_id).toBe(projectId)
      expect(payment?.unit_id).toBe(unitId)
    })
  })
})
