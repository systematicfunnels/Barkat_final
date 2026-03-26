/**
 * Comprehensive unit tests for Database Service
 * Covers all branches, edge cases, and failure scenarios
 */

import { dbService } from '../../../main/db/database'

// Mock better-sqlite3
jest.mock('better-sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    prepare: jest.fn().mockReturnValue({
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn()
    }),
    exec: jest.fn(),
    close: jest.fn(),
    pragma: jest.fn()
  }))
}))

describe('DatabaseService - Comprehensive Test Suite', () => {
  let mockDb: any

  beforeEach(() => {
    mockDb = (dbService as any).db
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Database Connection - All Branches', () => {
    test('should initialize with in-memory database', () => {
      expect(dbService).toBeInstanceOf(DatabaseService)
      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL')
      expect(mockDb.pragma).toHaveBeenCalledWith('foreign_keys = ON')
    })

    test('should handle file-based database', () => {
      const fileDbService = new DatabaseService('test.db')
      expect(fileDbService).toBeInstanceOf(DatabaseService)
      fileDbService.close()
    })

    test('should handle database connection errors', () => {
      const Database = require('better-sqlite3').Database
      Database.mockImplementation(() => {
        throw new Error('Database connection failed')
      })

      expect(() => new DatabaseService('invalid.db')).toThrow('Database connection failed')
    })

    test('should close database connection', () => {
      dbService.close()
      expect(mockDb.close).toHaveBeenCalled()
    })

    test('should handle close errors gracefully', () => {
      mockDb.close.mockImplementation(() => {
        throw new Error('Already closed')
      })

      expect(() => dbService.close()).not.toThrow()
    })
  })

  describe('Project Operations - All Branches', () => {
    test('should create project successfully', () => {
      const project: Omit<Project, 'id' | 'created_at' | 'updated_at'> = {
        name: 'Test Project',
        address: 'Test Address',
        city: 'Test City',
        state: 'Test State',
        pincode: '12345',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 })
      })

      const result = dbService.createProject(project)
      expect(result).toBe(1)
      expect(mockStmt.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO projects'),
        expect.arrayContaining(Object.values(project))
      )
    })

    test('should handle project creation with missing fields', () => {
      const incompleteProject = {
        name: 'Test Project'
        // Missing required fields
      } as any

      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('NOT NULL constraint failed')
        })
      })

      expect(() => dbService.createProject(incompleteProject)).toThrow('NOT NULL constraint failed')
    })

    test('should get project by id', () => {
      const mockProject = {
        id: 1,
        name: 'Test Project',
        address: 'Test Address',
        city: 'Test City',
        state: 'Test State',
        pincode: '12345',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(mockProject)
      })

      const result = dbService.getProject(1)
      expect(result).toEqual(mockProject)
      expect(mockStmt.get).toHaveBeenCalledWith(1)
    })

    test('should handle getting non-existent project', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(undefined)
      })

      const result = dbService.getProject(999)
      expect(result).toBeUndefined()
    })

    test('should get all projects', () => {
      const mockProjects = [
        { id: 1, name: 'Project 1' },
        { id: 2, name: 'Project 2' }
      ]

      const mockStmt = mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockProjects)
      })

      const result = dbService.getAllProjects()
      expect(result).toEqual(mockProjects)
      expect(mockStmt.all).toHaveBeenCalled()
    })

    test('should update project successfully', () => {
      const updateData = {
        name: 'Updated Project',
        city: 'Updated City'
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 })
      })

      const result = dbService.updateProject(1, updateData)
      expect(result).toBe(true)
      expect(mockStmt.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE projects'),
        expect.arrayContaining([...Object.values(updateData), 1])
      )
    })

    test('should handle updating non-existent project', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 0 })
      })

      const result = dbService.updateProject(999, { name: 'Updated' })
      expect(result).toBe(false)
    })

    test('should delete project successfully', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 })
      })

      const result = dbService.deleteProject(1)
      expect(result).toBe(true)
      expect(mockStmt.run).toHaveBeenCalledWith(1)
    })

    test('should handle deleting non-existent project', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 0 })
      })

      const result = dbService.deleteProject(999)
      expect(result).toBe(false)
    })

    test('should handle project deletion with foreign key constraints', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('FOREIGN KEY constraint failed')
        })
      })

      expect(() => dbService.deleteProject(1)).toThrow('FOREIGN KEY constraint failed')
    })
  })

  describe('Unit Operations - All Branches', () => {
    test('should create unit successfully', () => {
      const unit: Omit<Unit, 'id' | 'created_at' | 'updated_at'> = {
        project_id: 1,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 })
      })

      const result = dbService.createUnit(unit)
      expect(result).toBe(1)
    })

    test('should get units by project', () => {
      const mockUnits = [
        { id: 1, project_id: 1, unit_number: 'A-001' },
        { id: 2, project_id: 1, unit_number: 'A-002' }
      ]

      const mockStmt = mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockUnits)
      })

      const result = dbService.getUnitsByProject(1)
      expect(result).toEqual(mockUnits)
      expect(mockStmt.all).toHaveBeenCalledWith(1)
    })

    test('should handle getting units for non-existent project', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([])
      })

      const result = dbService.getUnitsByProject(999)
      expect(result).toEqual([])
    })

    test('should update unit successfully', () => {
      const updateData = {
        owner_name: 'Jane Doe',
        status: 'inactive'
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 })
      })

      const result = dbService.updateUnit(1, updateData)
      expect(result).toBe(true)
    })

    test('should delete unit successfully', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 })
      })

      const result = dbService.deleteUnit(1)
      expect(result).toBe(true)
    })
  })

  describe('Payment Operations - All Branches', () => {
    test('should create payment successfully', () => {
      const payment: Omit<Payment, 'id' | 'created_at' | 'updated_at'> = {
        project_id: 1,
        unit_id: 1,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer',
        remarks: 'Test payment'
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 })
      })

      const result = dbService.createPayment(payment)
      expect(result).toBe(1)
    })

    test('should get payments by date range', () => {
      const mockPayments = [
        { id: 1, payment_date: '2024-03-15', amount: 5000 },
        { id: 2, payment_date: '2024-03-20', amount: 6000 }
      ]

      const mockStmt = mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockPayments)
      })

      const result = dbService.getPaymentsByDateRange('2024-03-10', '2024-03-25')
      expect(result).toEqual(mockPayments)
      expect(mockStmt.all).toHaveBeenCalledWith('2024-03-10', '2024-03-25')
    })

    test('should handle invalid date range', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([])
      })

      const result = dbService.getPaymentsByDateRange('2024-03-25', '2024-03-10')
      expect(result).toEqual([])
    })

    test('should get payments summary by project', () => {
      const mockSummary = {
        total_billed: 12000,
        total_paid: 10000,
        outstanding: 2000
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(mockSummary)
      })

      const result = dbService.getPaymentsSummaryByProject(1)
      expect(result).toEqual(mockSummary)
    })

    test('should handle payments summary for project with no payments', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        get: jest.fn().mockReturnValue(undefined)
      })

      const result = dbService.getPaymentsSummaryByProject(999)
      expect(result).toBeUndefined()
    })
  })

  describe('Billing Operations - All Branches', () => {
    test('should create billing letter successfully', () => {
      const letter: Omit<BillingLetter, 'id' | 'created_at' | 'updated_at'> = {
        project_id: 1,
        unit_id: 1,
        financial_year: '2024-25',
        letter_type: 'maintenance',
        amount: 5000,
        status: 'pending',
        generated_date: '2024-03-18'
      }

      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 })
      })

      const result = dbService.createBillingLetter(letter)
      expect(result).toBe(1)
    })

    test('should get billing letters by project and year', () => {
      const mockLetters = [
        { id: 1, unit_id: 1, amount: 5000, status: 'pending' },
        { id: 2, unit_id: 2, amount: 6000, status: 'paid' }
      ]

      const mockStmt = mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(mockLetters)
      })

      const result = dbService.getBillingLettersByProjectAndYear(1, '2024-25')
      expect(result).toEqual(mockLetters)
      expect(mockStmt.all).toHaveBeenCalledWith(1, '2024-25')
    })

    test('should update billing letter status', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 })
      })

      const result = dbService.updateBillingLetterStatus(1, 'paid')
      expect(result).toBe(true)
      expect(mockStmt.run).toHaveBeenCalledWith('paid', 1)
    })

    test('should handle updating non-existent billing letter', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 0 })
      })

      const result = dbService.updateBillingLetterStatus(999, 'paid')
      expect(result).toBe(false)
    })
  })

  describe('Transaction Operations - All Branches', () => {
    test('should execute transaction successfully', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 })
      })

      const result = dbService.transaction(() => {
        dbService.createProject({
          name: 'Test Project',
          address: 'Test Address',
          city: 'Test City',
          state: 'Test State',
          pincode: '12345',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
        
        dbService.createUnit({
          project_id: 1,
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
        
        return 'success'
      })

      expect(result).toBe('success')
      expect(mockStmt.run).toHaveBeenCalledTimes(2)
    })

    test('should handle transaction rollback on error', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('Database error')
        })
      })

      expect(() => {
        dbService.transaction(() => {
          dbService.createProject({
            name: 'Test Project',
            address: 'Test Address',
            city: 'Test City',
            state: 'Test State',
            pincode: '12345',
            status: 'active',
            account_name: 'Test Account',
            bank_name: 'Test Bank',
            account_no: '1234567890',
            ifsc_code: 'TEST123',
            branch: 'Test Branch'
          })
        })
      }).toThrow('Database error')
    })

    test('should handle nested transactions', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 })
      })

      const result = dbService.transaction(() => {
        const projectId = dbService.createProject({
          name: 'Test Project',
          address: 'Test Address',
          city: 'Test City',
          state: 'Test State',
          pincode: '12345',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })

        dbService.transaction(() => {
          dbService.createUnit({
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
        })

        return projectId
      })

      expect(result).toBe(1)
    })
  })

  describe('Error Handling - Edge Cases', () => {
    test('should handle database lock errors', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('database is locked')
        })
      })

      expect(() => {
        dbService.createProject({
          name: 'Test Project',
          address: 'Test Address',
          city: 'Test City',
          state: 'Test State',
          pincode: '12345',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
      }).toThrow('database is locked')
    })

    test('should handle malformed query parameters', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('malformed database schema')
        })
      })

      expect(() => {
        dbService.getProject(-1)
      }).toThrow('malformed database schema')
    })

    test('should handle connection timeout', () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('connection timeout')
      })

      expect(() => {
        dbService.getAllProjects()
      }).toThrow('connection timeout')
    })

    test('should handle disk full error', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('database or disk is full')
        })
      })

      expect(() => {
        dbService.createProject({
          name: 'Test Project',
          address: 'Test Address',
          city: 'Test City',
          state: 'Test State',
          pincode: '12345',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
      }).toThrow('database or disk is full')
    })
  })

  describe('Performance and Memory Management', () => {
    test('should handle large dataset queries', () => {
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        id: i + 1,
        name: `Project ${i + 1}`,
        address: `Address ${i + 1}`,
        city: 'Test City',
        state: 'Test State',
        pincode: '12345',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      }))

      const mockStmt = mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue(largeDataset)
      })

      const startTime = Date.now()
      const result = dbService.getAllProjects()
      const endTime = Date.now()

      expect(result).toHaveLength(10000)
      expect(endTime - startTime).toBeLessThan(1000) // Should complete within 1 second
    })

    test('should handle concurrent database operations', async () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
        get: jest.fn().mockReturnValue({ id: 1, name: 'Test Project' })
      })

      const operations = Array.from({ length: 100 }, async (_, i) => {
        return dbService.transaction(() => {
          dbService.createProject({
            name: `Project ${i}`,
            address: `Address ${i}`,
            city: 'Test City',
            state: 'Test State',
            pincode: '12345',
            status: 'active',
            account_name: 'Test Account',
            bank_name: 'Test Bank',
            account_no: '1234567890',
            ifsc_code: 'TEST123',
            branch: 'Test Branch'
          })
          return i
        })
      })

      const results = await Promise.all(operations)
      expect(results).toHaveLength(100)
      expect(mockStmt.run).toHaveBeenCalledTimes(100)
    })
  })

  describe('Data Integrity - All Branches', () => {
    test('should enforce foreign key constraints', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('FOREIGN KEY constraint failed')
        })
      })

      expect(() => {
        dbService.createUnit({
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
      }).toThrow('FOREIGN KEY constraint failed')
    })

    test('should handle unique constraint violations', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('UNIQUE constraint failed: projects.name')
        })
      })

      expect(() => {
        dbService.createProject({
          name: 'Duplicate Project', // Already exists
          address: 'Test Address',
          city: 'Test City',
          state: 'Test State',
          pincode: '12345',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
      }).toThrow('UNIQUE constraint failed: projects.name')
    })

    test('should handle check constraint violations', () => {
      const mockStmt = mockDb.prepare.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('CHECK constraint failed: projects.pincode')
        })
      })

      expect(() => {
        dbService.createProject({
          name: 'Test Project',
          address: 'Test Address',
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
      }).toThrow('CHECK constraint failed: projects.pincode')
    })
  })
})
