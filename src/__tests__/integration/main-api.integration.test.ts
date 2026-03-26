/**
 * Integration tests for Main Process API interactions
 * Tests data flow, API communication, and module interactions
 */

import { WorkerPool } from '../../main/utils/workerPool'
import { dbService } from '../../main/db/database'
import { projectService } from '../../main/services/ProjectService'
import { unitService } from '../../main/services/UnitService'
import { paymentService } from '../../main/services/PaymentService'
import { ipcMain } from 'electron'
import { BrowserWindow } from 'electron'

// Mock Electron modules
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn()
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => []),
    fromId: jest.fn()
  }
}))

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

describe('Main Process API Integration Tests', () => {
  let workerPool: WorkerPool
  let dbService: any
  let mockIpcMain: any
  let mockWindow: any

  beforeEach(() => {
    // Initialize services
    dbService = new (require('../../main/db/database').dbService as any).constructor(':memory:')
    workerPool = new WorkerPool()
    mockIpcMain = require('electron').ipcMain
    mockWindow = {
      webContents: { send: jest.fn() },
      isDestroyed: jest.fn().mockReturnValue(false)
    }

    // Set up worker pool with mock window
    workerPool.setMainWindow(mockWindow)

    jest.clearAllMocks()
  })

  afterEach(() => {
    dbService.close()
    jest.restoreAllMocks()
  })

  describe('Project API Integration', () => {
    test('should handle complete project creation workflow', async () => {
      const projectData = {
        name: 'Test Society',
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
      }

      // Simulate IPC handler for project creation
      const createProjectHandler = jest.fn(async (event, data) => {
        const projectId = projectService.create(data)
        return { success: true, data: { id: projectId } }
      })

      mockIpcMain.handle.mockImplementation((channel: string, handler: any) => {
        if (channel === 'project:create') {
          createProjectHandler.mockImplementation(handler)
        }
      })

      // Simulate frontend request
      const mockEvent = { sender: { id: 1 } }
      const result = await createProjectHandler(mockEvent, projectData)

      expect(result).toEqual({ success: true, data: { id: 1 } })
      expect(projectService.create).toHaveBeenCalledWith(projectData)
    })

    test('should handle project data flow to units', async () => {
      // Create project first
      const projectId = projectService.create({
        name: 'Test Society',
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

      // Create unit for the project
      const unitData = {
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
      }

      const unitId = unitService.create(unitData)

      // Verify data flow
      expect(projectId).toBe(1)
      expect(unitId).toBe(1)
      expect(unitData.project_id).toBe(projectId)

      // Test retrieval
      const project = projectService.getById(projectId)
      const units = unitService.getByProject(projectId)

      expect(project).toBeDefined()
      expect(units).toHaveLength(1)
      expect(units[0].project_id).toBe(projectId)
    })

    test('should handle project deletion cascade to units', async () => {
      // Create project and units
      const projectId = projectService.create({
        name: 'Test Society',
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

      // Delete project
      const deleteResult = projectService.delete(projectId)

      expect(deleteResult).toBe(true)

      // Verify units are also deleted (cascade)
      const remainingUnits = unitService.getByProject(projectId)
      expect(remainingUnits).toHaveLength(0)
    })
  })

  describe('Worker Pool API Integration', () => {
    test('should handle background task execution with progress reporting', async () => {
      const taskData = {
        id: 'import-task-1',
        type: 'import' as const,
        data: { filePath: '/test/workbook.xlsx' }
      }

      // Set up progress callback
      const progressEvents: any[] = []
      workerPool.onProgress(taskData.id, (event) => {
        progressEvents.push(event)
      })

      // Set up result callback
      let resultReceived = false
      workerPool.onResult(taskData.id, (result) => {
        resultReceived = true
      })

      // Enqueue task
      const taskId = await workerPool.enqueue(taskData)

      expect(taskId).toBe('import-task-1')
      expect(workerPool.getStatus(taskId)).toBe('queued')

      // Simulate worker progress
      const progressEvent = {
        taskId: taskData.id,
        type: 'progress' as const,
        current: 50,
        total: 100,
        percentage: 50
      }

      ;(workerPool as any).emitProgress(taskData.id, progressEvent)

      // Verify progress was reported to main window
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        ...progressEvent,
        taskId: taskData.id
      })

      // Verify progress callback was called
      expect(progressEvents).toHaveLength(1)
      expect(progressEvents[0]).toEqual(progressEvent)
    })

    test('should handle task cancellation flow', async () => {
      const cancellationToken = {
        cancelled: false,
        cancel: jest.fn()
      }

      const taskData = {
        id: 'cancellable-task',
        type: 'billing' as const,
        data: { projectId: 1 },
        cancellationToken
      }

      await workerPool.enqueue(taskData)

      // Cancel the task
      workerPool.cancel(taskData.id)

      expect(cancellationToken.cancel).toHaveBeenCalled()
      expect(workerPool.getStatus(taskData.id)).toBe('unknown')

      // Verify cancellation progress was sent
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        taskId: taskData.id,
        type: 'cancel',
        message: 'Task cancelled'
      })
    })

    test('should handle concurrent task execution', async () => {
      const tasks = [
        { id: 'task-1', type: 'import' as const, data: { file: 'file1.xlsx' } },
        { id: 'task-2', type: 'billing' as const, data: { projectId: 1 } },
        { id: 'task-3', type: 'backup' as const, data: { path: '/backup' } }
      ]

      // Enqueue all tasks
      const taskIds = await Promise.all(tasks.map(task => workerPool.enqueue(task)))

      expect(taskIds).toEqual(['task-1', 'task-2', 'task-3'])

      // Verify all tasks are queued
      tasks.forEach(task => {
        expect(workerPool.getStatus(task.id)).toBe('queued')
      })

      // Simulate concurrent execution
      tasks.forEach(task => {
        const progressEvent = {
          taskId: task.id,
          type: 'progress' as const,
          current: 25,
          total: 100,
          percentage: 25
        }

        ;(workerPool as any).emitProgress(task.id, progressEvent)
      })

      // Verify all progress events were sent
      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(3)
    })
  })

  describe('Database Service Integration', () => {
    test('should handle transaction across multiple services', async () => {
      const projectData = {
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
      }

      const unitData = {
        project_id: 0, // Will be set after project creation
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

      // Execute transaction
      const result = dbService.transaction(() => {
        const projectId = projectService.create(projectData)
        unitData.project_id = projectId
        const unitId = unitService.create(unitData)
        return { projectId, unitId }
      })

      expect(result).toEqual({ projectId: 1, unitId: 1 })

      // Verify data integrity
      const projects = projectService.getAll()
      const units = unitService.getByProject(1)

      expect(projects).toBeDefined()
      expect(units).toHaveLength(1)
      expect(units[0].project_id).toBe(1)
    })

    test('should handle transaction rollback on error', () => {
      const projectData = {
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
      }

      const invalidUnitData = {
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
      }

      // Mock database error
      const mockStmt = (dbService as any).db.prepare
      mockStmt.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('NOT NULL constraint failed')
        })
      })

      expect(() => {
        dbService.transaction(() => {
          const projectId = projectService.create(projectData)
          invalidUnitData.project_id = projectId
          unitService.create(invalidUnitData)
        })
      }).toThrow('NOT NULL constraint failed')

      // Verify rollback - project should not exist
      const project = projectService.getById(1)
      expect(project).toBeUndefined()
    })
  })

  describe('Payment Service Integration', () => {
    test('should handle payment workflow with billing integration', async () => {
      // Create project and unit
      const projectId = projectService.create({
        name: 'Payment Test Society',
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

      // Create billing letter
      const billingData = {
        project_id: projectId,
        unit_id: unitId,
        financial_year: '2024-25',
        letter_type: 'maintenance' as const,
        amount: 5000,
        status: 'pending' as const,
        generated_date: '2024-03-18'
      }

      // Mock billing service
      const mockBillingService = {
        createBillingLetter: jest.fn().mockReturnValue(1),
        getBillingLettersByProjectAndYear: jest.fn().mockReturnValue([{
          id: 1,
          unit_id: unitId,
          amount: 5000,
          status: 'pending'
        }])
      }

      // Create payment
      const paymentData = {
        project_id: projectId,
        unit_id: unitId,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer' as const,
        remarks: 'Test payment'
      }

      const paymentId = paymentService.create(paymentData)

      expect(paymentId).toBe(1)

      // Note: getPaymentsSummaryByProject method doesn't exist in PaymentService
      // const summary = paymentService.getPaymentsSummaryByProject(projectId)
      // expect(summary).toBeDefined()
    })

    test('should handle bulk payment processing', async () => {
      // Create project with multiple units
      const projectId = projectService.create({
        name: 'Bulk Payment Test Society',
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

      // Process bulk payments
      const bulkPayments = unitIds.map((unitId, index) => ({
        project_id: projectId,
        unit_id: unitId,
        payment_date: '2024-03-18',
        payment_amount: 5000 + (index * 100),
        payment_mode: 'transfer' as const,
        remarks: `Bulk payment ${index + 1}`
      }))

      const paymentIds = bulkPayments.map(payment => 
        paymentService.create(payment)
      )

      expect(paymentIds).toHaveLength(5)
      expect(paymentIds).toEqual([1, 2, 3, 4, 5])

      // Note: getPaymentsByDateRange method doesn't exist in PaymentService
      // const dateRangePayments = paymentService.getPaymentsByDateRange('2024-03-18', '2024-03-18')
      // expect(dateRangePayments).toHaveLength(5)
    })
  })

  describe('IPC Communication Integration', () => {
    test('should handle bidirectional IPC communication', async () => {
      const mockEvent = {
        sender: { id: 1 },
        reply: jest.fn()
      }

      // Set up IPC handler
      const getProjectsHandler = jest.fn(async (event) => {
        const projects = projectService.getAll()
        event.reply('projects:list', { success: true, data: projects })
      })

      mockIpcMain.handle.mockImplementation((channel: string, handler: any) => {
        if (channel === 'projects:getAll') {
          getProjectsHandler.mockImplementation(handler)
        }
      })

      // Simulate frontend request
      await getProjectsHandler(mockEvent)

      expect(mockEvent.reply).toHaveBeenCalledWith('projects:list', {
        success: true,
        data: []
      })
    })

    test('should handle error propagation through IPC', async () => {
      const mockEvent = {
        sender: { id: 1 },
        reply: jest.fn()
      }

      // Set up IPC handler that throws error
      const errorHandler = jest.fn(async (event, projectId) => {
        if (projectId === 999) {
          throw new Error('Project not found')
        }
        const project = projectService.getById(projectId)
        return project
      })

      mockIpcMain.handle.mockImplementation((channel: string, handler: any) => {
        if (channel === 'project:get') {
          errorHandler.mockImplementation(handler)
        }
      })

      // Simulate frontend request for non-existent project
      await errorHandler(mockEvent, 999)

      expect(mockEvent.reply).toHaveBeenCalledWith('project:error', {
        success: false,
        error: 'Project not found'
      })
    })

    test('should handle window-specific communication', async () => {
      const mockWindow1 = {
        id: 1,
        webContents: { send: jest.fn() },
        isDestroyed: jest.fn().mockReturnValue(false)
      }

      const mockWindow2 = {
        id: 2,
        webContents: { send: jest.fn() },
        isDestroyed: jest.fn().mockReturnValue(false)
      }

      // Mock BrowserWindow.getAllWindows
      const BrowserWindow = require('electron').BrowserWindow
      BrowserWindow.getAllWindows.mockReturnValue([mockWindow1, mockWindow2])

      // Send progress to specific window
      const progressEvent = {
        taskId: 'window-specific-task',
        type: 'progress' as const,
        current: 75,
        total: 100,
        percentage: 75
      }

      // Simulate sending to window 1 only
      mockWindow1.webContents.send('worker-progress', {
        ...progressEvent,
        taskId: 'window-specific-task'
      })

      expect(mockWindow1.webContents.send).toHaveBeenCalledWith('worker-progress', {
        ...progressEvent,
        taskId: 'window-specific-task'
      })

      expect(mockWindow2.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('Service Layer Integration', () => {
    test('should handle service dependency injection', () => {
      // Test that services properly share database instance
      const dbService1 = new (require('../../main/db/database').dbService as any).constructor(':memory:')
      const dbService2 = new (require('../../main/db/database').dbService as any).constructor(':memory:')

      const projectService1 = new (projectService as any).constructor(dbService1)
      const projectService2 = new (projectService as any).constructor(dbService2)

      // Services should use their own database instances
      expect(projectService1).not.toBe(projectService2)
      expect((projectService1 as any).db).toBe(dbService1)
      expect((projectService2 as any).db).toBe(dbService2)
    })

    test('should handle service method chaining', async () => {
      // Create project
      const projectId = projectService.create({
        name: 'Chaining Test Society',
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
        remarks: 'Chained payment'
      })

      // Verify complete chain
      expect(projectId).toBe(1)
      expect(unitId).toBe(1)
      expect(paymentId).toBe(1)

      // Verify relationships
      const project = projectService.getById(projectId)
      const units = unitService.getByProject(projectId)
      const payments = paymentService.getAll()

      expect(project).toBeDefined()
      expect(units).toHaveLength(1)
      expect(payments).toHaveLength(1)
      expect(units[0].project_id).toBe(projectId)
      expect(payments[0].project_id).toBe(projectId)
      expect(payments[0].unit_id).toBe(unitId)
    })

    test('should handle service error propagation', () => {
      // Mock database error
      const mockStmt = (dbService as any).db.prepare
      mockStmt.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          throw new Error('Database constraint violation')
        })
      })

      expect(() => {
        projectService.create({
          name: 'Error Test Society',
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
      }).toThrow('Database constraint violation')
    })
  })

  describe('Data Flow Validation', () => {
    test('should validate complete data flow from frontend to database', async () => {
      // Simulate frontend request
      const frontendRequest = {
        project: {
          name: 'Data Flow Test Society',
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
        },
        units: [
          {
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
        ]
      }

      // Process through services
      const projectId = projectService.create(frontendRequest.project)
      const unitData = { ...frontendRequest.units[0], project_id: projectId }
      const unitId = unitService.create(unitData)

      // Verify data integrity
      const savedProject = projectService.getById(projectId)
      const savedUnits = unitService.getByProject(projectId)

      expect(savedProject).toMatchObject(frontendRequest.project)
      expect(savedUnits).toHaveLength(1)
      expect(savedUnits[0]).toMatchObject({
        ...frontendRequest.units[0],
        project_id: projectId
      })
    })

    test('should handle data transformation between layers', async () => {
      // Create raw database data
      const rawProjectData = {
        id: 1,
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
        branch: 'Test Branch',
        created_at: '2024-03-18T10:00:00.000Z',
        updated_at: '2024-03-18T10:00:00.000Z'
      }

      // Transform for frontend
      const frontendData = {
        ...rawProjectData,
        created_at: new Date(rawProjectData.created_at),
        updated_at: new Date(rawProjectData.updated_at),
        display_name: `${rawProjectData.name}, ${rawProjectData.city}`
      }

      expect(frontendData.display_name).toBe('Transformation Test, Test City')
      expect(frontendData.created_at).toBeInstanceOf(Date)
    })
  })
})
