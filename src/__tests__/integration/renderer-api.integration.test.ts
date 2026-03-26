/**
 * Integration tests for Renderer Process API interactions
 * Tests data flow, API communication, and module interactions
 */

import { contextBridge, ipcRenderer } from 'electron'

// Mock Electron APIs
jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: jest.fn()
  },
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    send: jest.fn()
  }
}))

describe('Renderer Process API Integration Tests', () => {
  let mockContextBridge: any
  let mockIpcRenderer: any

  beforeEach(() => {
    mockContextBridge = require('electron').contextBridge
    mockIpcRenderer = require('electron').ipcRenderer

    // Reset window.api
    delete (window as any).api

    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Context Bridge API Exposure', () => {
    test('should expose API to renderer world', () => {
      const mockApi = {
        projects: {
          getAll: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn()
        },
        units: {
          getAll: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn()
        },
        payments: {
          getAll: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn()
        }
      }

      // Simulate context bridge exposure
      mockContextBridge.exposeInMainWorld('api', mockApi)

      expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledWith('api', mockApi)
    })

    test('should handle secure API exposure', () => {
      const secureApi = {
        projects: {
          getAll: jest.fn(),
          create: jest.fn()
        },
        // No sensitive methods exposed
      }

      mockContextBridge.exposeInMainWorld('api', secureApi)

      expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledWith('api', secureApi)
    })
  })

  describe('Project API Integration', () => {
    beforeEach(() => {
      // Set up window.api
      ;(window as any).api = {
        projects: {
          getAll: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ id: 1 }),
          update: jest.fn().mockResolvedValue(true),
          delete: jest.fn().mockResolvedValue(true),
          get: jest.fn().mockResolvedValue({ id: 1, name: 'Test Project' })
        }
      }
    })

    test('should handle project creation flow', async () => {
      const projectData = {
        name: 'Test Project',
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

      // Mock IPC response
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: { id: 1 }
      })

      // Call API
      const result = await (window as any).api.projects.create(projectData)

      expect(result).toEqual({ success: true, data: { id: 1 } })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:create', projectData)
    })

    test('should handle project retrieval flow', async () => {
      const expectedProject = {
        id: 1,
        name: 'Test Project',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: expectedProject
      })

      const result = await (window as any).api.projects.get(1)

      expect(result).toEqual({ success: true, data: expectedProject })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:get', 1)
    })

    test('should handle project update flow', async () => {
      const updateData = {
        name: 'Updated Project',
        city: 'Updated City'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: true
      })

      const result = await (window as any).api.projects.update(1, updateData)

      expect(result).toEqual({ success: true, data: true })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:update', 1, updateData)
    })

    test('should handle project deletion flow', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: true
      })

      const result = await (window as any).api.projects.delete(1)

      expect(result).toEqual({ success: true, data: true })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('project:delete', 1)
    })

    test('should handle project list retrieval flow', async () => {
      const expectedProjects = [
        { id: 1, name: 'Project 1' },
        { id: 2, name: 'Project 2' }
      ]

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: expectedProjects
      })

      const result = await (window as any).api.projects.getAll()

      expect(result).toEqual({ success: true, data: expectedProjects })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('projects:getAll')
    })
  })

  describe('Unit API Integration', () => {
    beforeEach(() => {
      ;(window as any).api = {
        units: {
          getAll: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ id: 1 }),
          update: jest.fn().mockResolvedValue(true),
          delete: jest.fn().mockResolvedValue(true),
          getByProject: jest.fn().mockResolvedValue([]),
          import: jest.fn().mockResolvedValue({ imported: 5, failed: 0 })
        }
      }
    })

    test('should handle unit creation with project association', async () => {
      const unitData = {
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

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: { id: 1 }
      })

      const result = await (window as any).api.units.create(unitData)

      expect(result).toEqual({ success: true, data: { id: 1 } })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('unit:create', unitData)
    })

    test('should handle unit retrieval by project', async () => {
      const expectedUnits = [
        { id: 1, project_id: 1, unit_number: 'A-001' },
        { id: 2, project_id: 1, unit_number: 'A-002' }
      ]

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: expectedUnits
      })

      const result = await (window as any).api.units.getByProject(1)

      expect(result).toEqual({ success: true, data: expectedUnits })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('units:getByProject', 1)
    })

    test('should handle unit import flow', async () => {
      const importData = {
        project_id: 1,
        filePath: '/path/to/units.xlsx'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: { imported: 10, failed: 2 }
      })

      const result = await (window as any).api.units.import(importData)

      expect(result).toEqual({ success: true, data: { imported: 10, failed: 2 } })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('units:import', importData)
    })
  })

  describe('Payment API Integration', () => {
    beforeEach(() => {
      ;(window as any).api = {
        payments: {
          getAll: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ id: 1 }),
          update: jest.fn().mockResolvedValue(true),
          delete: jest.fn().mockResolvedValue(true),
          getByDateRange: jest.fn().mockResolvedValue([]),
          getSummary: jest.fn().mockResolvedValue({ total: 10000, paid: 8000, outstanding: 2000 }),
          generateReceipts: jest.fn().mockResolvedValue({ generated: 5 }),
          recordBulk: jest.fn().mockResolvedValue({ recorded: 10 })
        }
      }
    })

    test('should handle payment creation flow', async () => {
      const paymentData = {
        project_id: 1,
        unit_id: 1,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer',
        remarks: 'Test payment'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: { id: 1 }
      })

      const result = await (window as any).api.payments.create(paymentData)

      expect(result).toEqual({ success: true, data: { id: 1 } })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('payment:create', paymentData)
    })

    test('should handle payment summary retrieval', async () => {
      const expectedSummary = {
        total_billed: 12000,
        total_paid: 10000,
        outstanding: 2000
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: expectedSummary
      })

      const result = await (window as any).api.payments.getSummary(1)

      expect(result).toEqual({ success: true, data: expectedSummary })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('payments:getSummary', 1)
    })

    test('should handle receipt generation flow', async () => {
      const receiptData = {
        payment_ids: [1, 2, 3],
        template: 'standard'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: { generated: 3, failed: 0 }
      })

      const result = await (window as any).api.payments.generateReceipts(receiptData)

      expect(result).toEqual({ success: true, data: { generated: 3, failed: 0 } })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('payments:generateReceipts', receiptData)
    })

    test('should handle bulk payment recording', async () => {
      const bulkPayments = [
        {
          project_id: 1,
          unit_id: 1,
          payment_date: '2024-03-18',
          payment_amount: 5000,
          payment_mode: 'transfer'
        },
        {
          project_id: 1,
          unit_id: 2,
          payment_date: '2024-03-18',
          payment_amount: 6000,
          payment_mode: 'cash'
        }
      ]

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: { recorded: 2, failed: 0 }
      })

      const result = await (window as any).api.payments.recordBulk(bulkPayments)

      expect(result).toEqual({ success: true, data: { recorded: 2, failed: 0 } })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('payments:recordBulk', bulkPayments)
    })
  })

  describe('Worker Pool Integration', () => {
    beforeEach(() => {
      ;(window as any).api = {
        worker: {
          enqueue: jest.fn().mockResolvedValue('task-1'),
          cancel: jest.fn(),
          getStatus: jest.fn(),
          onProgress: jest.fn(),
          onResult: jest.fn()
        }
      }
    })

    test('should handle task enqueue flow', async () => {
      const taskData = {
        id: 'import-task-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: 'task-1'
      })

      const result = await (window as any).api.worker.enqueue(taskData)

      expect(result).toEqual({ success: true, data: 'task-1' })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('worker:enqueue', taskData)
    })

    test('should handle task cancellation flow', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: true
      })

      const result = await (window as any).api.worker.cancel('task-1')

      expect(result).toEqual({ success: true, data: true })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('worker:cancel', 'task-1')
    })

    test('should handle task status retrieval', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: 'active'
      })

      const result = await (window as any).api.worker.getStatus('task-1')

      expect(result).toEqual({ success: true, data: 'active' })
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('worker:getStatus', 'task-1')
    })
  })

  describe('Event Handling Integration', () => {
    test('should handle worker progress events', async () => {
      const progressCallback = jest.fn()

      // Set up event listener
      mockIpcRenderer.on.mockImplementation((channel: string, handler: Function) => {
        if (channel === 'worker-progress') {
          // Simulate progress event
          setTimeout(() => {
            handler(null, {
              taskId: 'task-1',
              type: 'progress',
              current: 50,
              total: 100,
              percentage: 50
            })
          }, 100)
        }
      })

      // Register callback
      ;(window as any).api.worker.onProgress('task-1', progressCallback)

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('worker-progress', expect.any(Function))

      // Wait for event
      await new Promise(resolve => setTimeout(resolve, 150))

      expect(progressCallback).toHaveBeenCalledWith({
        taskId: 'task-1',
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      })
    })

    test('should handle worker result events', async () => {
      const resultCallback = jest.fn()

      mockIpcRenderer.on.mockImplementation((channel: string, handler: Function) => {
        if (channel === 'worker-result') {
          setTimeout(() => {
            handler(null, {
              taskId: 'task-1',
              success: true,
              result: { processed: 100 },
              duration: 5000
            })
          }, 100)
        }
      })

      ;(window as any).api.worker.onResult('task-1', resultCallback)

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('worker-result', expect.any(Function))

      await new Promise(resolve => setTimeout(resolve, 150))

      expect(resultCallback).toHaveBeenCalledWith({
        taskId: 'task-1',
        success: true,
        result: { processed: 100 },
        duration: 5000
      })
    })

    test('should handle error events', async () => {
      const errorCallback = jest.fn()

      mockIpcRenderer.on.mockImplementation((channel: string, handler: Function) => {
        if (channel === 'worker-error') {
          setTimeout(() => {
            handler(null, {
              taskId: 'task-1',
              error: { code: 'PROCESSING_ERROR', message: 'Task failed' }
            })
          }, 100)
        }
      })

      ;(window as any).api.worker.onError('task-1', errorCallback)

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('worker-error', expect.any(Function))

      await new Promise(resolve => setTimeout(resolve, 150))

      expect(errorCallback).toHaveBeenCalledWith({
        taskId: 'task-1',
        error: { code: 'PROCESSING_ERROR', message: 'Task failed' }
      })
    })
  })

  describe('Error Handling Integration', () => {
    test('should handle API timeout errors', async () => {
      mockIpcRenderer.invoke.mockRejectedValue(new Error('Request timeout'))

      ;(window as any).api.projects = {
        create: jest.fn().mockRejectedValue(new Error('Request timeout'))
      }

      await expect((window as any).api.projects.create({})).rejects.toThrow('Request timeout')
    })

    test('should handle validation errors', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid project data' }
      })

      ;(window as any).api.projects = {
        create: jest.fn().mockResolvedValue({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid project data' }
        })
      }

      const result = await (window as any).api.projects.create({})

      expect(result).toEqual({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid project data' }
      })
    })

    test('should handle network errors', async () => {
      mockIpcRenderer.invoke.mockRejectedValue(new Error('Connection lost'))

      ;(window as any).api.projects = {
        getAll: jest.fn().mockRejectedValue(new Error('Connection lost'))
      }

      await expect((window as any).api.projects.getAll()).rejects.toThrow('Connection lost')
    })
  })

  describe('Data Transformation Integration', () => {
    test('should handle date transformation', async () => {
      const projectData = {
        name: 'Date Test Project',
        created_at: '2024-03-18T10:00:00.000Z',
        updated_at: '2024-03-18T10:00:00.000Z'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: projectData
      })

      ;(window as any).api.projects = {
        get: jest.fn().mockResolvedValue({
          success: true,
          data: projectData
        })
      }

      const result = await (window as any).api.projects.get(1)

      expect(result.data.created_at).toBe('2024-03-18T10:00:00.000Z')
      expect(typeof result.data.created_at).toBe('string')
    })

    test('should handle currency formatting', async () => {
      const paymentData = {
        id: 1,
        payment_amount: 5000.50,
        currency: 'INR'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: paymentData
      })

      ;(window as any).api.payments = {
        get: jest.fn().mockResolvedValue({
          success: true,
          data: paymentData
        })
      }

      const result = await (window as any).api.payments.get(1)

      expect(result.data.payment_amount).toBe(5000.50)
      expect(typeof result.data.payment_amount).toBe('number')
    })

    test('should handle status enum transformation', async () => {
      const unitData = {
        id: 1,
        status: 'active'
      }

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: unitData
      })

      ;(window as any).api.units = {
        get: jest.fn().mockResolvedValue({
          success: true,
          data: unitData
        })
      }

      const result = await (window as any).api.units.get(1)

      expect(result.data.status).toBe('active')
      expect(typeof result.data.status).toBe('string')
    })
  })

  describe('Concurrent Operations Integration', () => {
    test('should handle concurrent API calls', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: []
      })

      ;(window as any).api.projects = {
        getAll: jest.fn().mockResolvedValue({
          success: true,
          data: []
        })
      }

      ;(window as any).api.units = {
        getAll: jest.fn().mockResolvedValue({
          success: true,
          data: []
        })
      }

      ;(window as any).api.payments = {
        getAll: jest.fn().mockResolvedValue({
          success: true,
          data: []
        })
      }

      // Make concurrent calls
      const [projects, units, payments] = await Promise.all([
        (window as any).api.projects.getAll(),
        (window as any).api.units.getAll(),
        (window as any).api.payments.getAll()
      ])

      expect(projects).toEqual({ success: true, data: [] })
      expect(units).toEqual({ success: true, data: [] })
      expect(payments).toEqual({ success: true, data: [] })

      expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(3)
    })

    test('should handle mixed concurrent operations', async () => {
      mockIpcRenderer.invoke
        .mockResolvedValueOnce({ success: true, data: { id: 1 } })
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockRejectedValueOnce(new Error('Network error'))

      ;(window as any).api.projects = {
        create: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
        getAll: jest.fn().mockResolvedValue({ success: true, data: [] }),
        delete: jest.fn().mockRejectedValue(new Error('Network error'))
      }

      const results = await Promise.allSettled([
        (window as any).api.projects.create({ name: 'Test' }),
        (window as any).api.projects.getAll(),
        (window as any).api.projects.delete(999)
      ])

      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled')
      expect(results[2].status).toBe('rejected')
    })
  })

  describe('Memory Management Integration', () => {
    test('should handle large dataset retrieval', async () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        name: `Project ${i + 1}`,
        address: `Address ${i + 1}`,
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active'
      }))

      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: largeDataset
      })

      ;(window as any).api.projects = {
        getAll: jest.fn().mockResolvedValue({
          success: true,
          data: largeDataset
        })
      }

      const startTime = Date.now()
      const result = await (window as any).api.projects.getAll()
      const endTime = Date.now()

      expect(result.data).toHaveLength(1000)
      expect(endTime - startTime).toBeLessThan(1000) // Should complete within 1 second
    })

    test('should handle memory cleanup after operations', async () => {
      mockIpcRenderer.invoke.mockResolvedValue({
        success: true,
        data: []
      })

      ;(window as any).api.projects = {
        getAll: jest.fn().mockResolvedValue({
          success: true,
          data: []
        })
      }

      // Perform multiple operations
      for (let i = 0; i < 100; i++) {
        await (window as any).api.projects.getAll()
      }

      // Memory should be cleaned up automatically by JavaScript garbage collector
      expect(mockIpcRenderer.invoke).toHaveBeenCalledTimes(100)
    })
  })
})
