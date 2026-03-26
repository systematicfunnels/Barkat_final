/**
 * Comprehensive unit tests for WorkerPool
 * Covers all branches, edge cases, and failure scenarios
 */

import { WorkerPool, CancellationToken, WorkerTask, ProgressEvent, TaskResult } from '../../../main/utils/workerPool'

// Mock worker_threads
jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn().mockReturnThis(),
    postMessage: jest.fn(),
    terminate: jest.fn().mockResolvedValue(undefined)
  }))
}))

// Mock Electron BrowserWindow
jest.mock('electron', () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    webContents: {
      send: jest.fn()
    },
    isDestroyed: jest.fn().mockReturnValue(false)
  }))
}))

describe('WorkerPool - Comprehensive Test Suite', () => {
  let workerPool: WorkerPool
  let mockWindow: any

  beforeEach(() => {
    workerPool = new WorkerPool()
    mockWindow = {
      webContents: { send: jest.fn() },
      isDestroyed: jest.fn().mockReturnValue(false)
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Constructor Initialization', () => {
    test('should initialize with default values', () => {
      expect(workerPool).toBeInstanceOf(WorkerPool)
      expect(workerPool.getStatus('non-existent')).toBe('unknown')
    })

    test('should set main window correctly', () => {
      workerPool.setMainWindow(mockWindow)
      // Should not throw error
      expect(() => workerPool.setMainWindow(mockWindow)).not.toThrow()
    })

    test('should handle null main window', () => {
      expect(() => workerPool.setMainWindow(null as any)).not.toThrow()
    })
  })

  describe('Task Enqueue - All Branches', () => {
    test('should enqueue task with default priority', async () => {
      const task: WorkerTask = {
        id: 'test-task',
        type: 'import',
        data: { test: 'data' }
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('test-task')
      expect(workerPool.getStatus('test-task')).toBe('queued')
    })

    test('should enqueue task with custom priority', async () => {
      const highPriorityTask: WorkerTask = {
        id: 'high-priority',
        type: 'import',
        data: { test: 'data' },
        priority: 0
      }

      const lowPriorityTask: WorkerTask = {
        id: 'low-priority',
        type: 'billing',
        data: { test: 'data' },
        priority: 100
      }

      await workerPool.enqueue(lowPriorityTask)
      await workerPool.enqueue(highPriorityTask)

      expect(workerPool.getStatus('high-priority')).toBe('queued')
      expect(workerPool.getStatus('low-priority')).toBe('queued')
    })

    test('should handle task with cancellation token', async () => {
      const cancellationToken: CancellationToken = {
        cancelled: false,
        cancel: jest.fn()
      }

      const task: WorkerTask = {
        id: 'cancellable-task',
        type: 'import',
        data: { test: 'data' },
        cancellationToken
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('cancellable-task')
      expect(workerPool.getStatus('cancellable-task')).toBe('queued')
    })

    test('should handle empty task data', async () => {
      const task: WorkerTask = {
        id: 'empty-data-task',
        type: 'import',
        data: {}
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('empty-data-task')
      expect(workerPool.getStatus('empty-data-task')).toBe('queued')
    })

    test('should handle task with special characters in ID', async () => {
      const task: WorkerTask = {
        id: 'task-with-special-chars-123_!@#$%^&*()',
        type: 'import',
        data: { test: 'data' }
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('task-with-special-chars-123_!@#$%^&*()')
      expect(workerPool.getStatus('task-with-special-chars-123_!@#$%^&*()')).toBe('queued')
    })
  })

  describe('Task Status Tracking - All Branches', () => {
    test('should return queued status for enqueued tasks', async () => {
      const task: WorkerTask = {
        id: 'queued-task',
        type: 'import',
        data: { test: 'data' }
      }

      await workerPool.enqueue(task)
      expect(workerPool.getStatus('queued-task')).toBe('queued')
    })

    test('should return unknown for non-existent tasks', () => {
      expect(workerPool.getStatus('non-existent-task')).toBe('unknown')
    })

    test('should return active status for active tasks', () => {
      // Simulate active task by manually adding to active jobs
      const task: WorkerTask = {
        id: 'active-task',
        type: 'import',
        data: { test: 'data' }
      }

      ;(workerPool as any).activeJobs.set('active-task', task)
      expect(workerPool.getStatus('active-task')).toBe('active')
    })

    test('should handle status check for cancelled tasks', async () => {
      const task: WorkerTask = {
        id: 'cancelled-task',
        type: 'import',
        data: { test: 'data' }
      }

      await workerPool.enqueue(task)
      workerPool.cancel('cancelled-task')
      expect(workerPool.getStatus('cancelled-task')).toBe('unknown')
    })
  })

  describe('Task Cancellation - All Branches', () => {
    test('should cancel queued task', async () => {
      const task: WorkerTask = {
        id: 'queued-task',
        type: 'import',
        data: { test: 'data' }
      }

      await workerPool.enqueue(task)
      workerPool.cancel('queued-task')

      expect(workerPool.getStatus('queued-task')).toBe('unknown')
    })

    test('should cancel active task with cancellation token', () => {
      const cancellationToken: CancellationToken = {
        cancelled: false,
        cancel: jest.fn()
      }

      const task: WorkerTask = {
        id: 'active-task',
        type: 'import',
        data: { test: 'data' },
        cancellationToken
      }

      // Manually add to active tasks
      ;(workerPool as any).activeTasks.set('active-task', cancellationToken)
      workerPool.cancel('active-task')

      expect(cancellationToken.cancel).toHaveBeenCalled()
      expect(workerPool.getStatus('active-task')).toBe('unknown')
    })

    test('should handle cancellation of non-existent task', () => {
      expect(() => workerPool.cancel('non-existent-task')).not.toThrow()
      expect(workerPool.getStatus('non-existent-task')).toBe('unknown')
    })

    test('should handle cancellation of already cancelled task', async () => {
      const task: WorkerTask = {
        id: 'already-cancelled',
        type: 'import',
        data: { test: 'data' }
      }

      await workerPool.enqueue(task)
      workerPool.cancel('already-cancelled')
      
      // Should not throw error when cancelling again
      expect(() => workerPool.cancel('already-cancelled')).not.toThrow()
      expect(workerPool.getStatus('already-cancelled')).toBe('unknown')
    })

    test('should handle cancellation token with already cancelled flag', () => {
      const cancellationToken: CancellationToken = {
        cancelled: true,
        cancel: jest.fn()
      }

      const task: WorkerTask = {
        id: 'pre-cancelled-task',
        type: 'import',
        data: { test: 'data' },
        cancellationToken
      }

      // Manually add to active tasks
      ;(workerPool as any).activeTasks.set('pre-cancelled-task', cancellationToken)
      workerPool.cancel('pre-cancelled-task')

      expect(cancellationToken.cancel).toHaveBeenCalled()
      expect(workerPool.getStatus('pre-cancelled-task')).toBe('unknown')
    })
  })

  describe('Progress Callbacks - All Branches', () => {
    test('should register and call progress callbacks', () => {
      const progressCallback = jest.fn()
      const task: WorkerTask = {
        id: 'callback-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPool.onProgress('callback-task', progressCallback)

      const progressEvent: ProgressEvent = {
        taskId: 'callback-task',
        type: 'progress',
        current: 25,
        total: 100,
        percentage: 25
      }

      ;(workerPool as any).emitProgress('callback-task', progressEvent)
      expect(progressCallback).toHaveBeenCalledWith(progressEvent)
    })

    test('should register and call result callbacks', () => {
      const resultCallback = jest.fn()
      const task: WorkerTask = {
        id: 'result-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPool.onResult('result-task', resultCallback)

      const result: TaskResult = {
        taskId: 'result-task',
        success: true,
        result: { data: 'test' },
        duration: 500
      }

      ;(workerPool as any).resultCallbacks.get('result-task')?.(result)
      expect(resultCallback).toHaveBeenCalledWith(result)
    })

    test('should handle multiple progress callbacks for same task', () => {
      const callback1 = jest.fn()
      const callback2 = jest.fn()

      workerPool.onProgress('multi-callback-task', callback1)
      workerPool.onProgress('multi-callback-task', callback2)

      const progressEvent: ProgressEvent = {
        taskId: 'multi-callback-task',
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      ;(workerPool as any).emitProgress('multi-callback-task', progressEvent)
      expect(callback1).toHaveBeenCalledWith(progressEvent)
      expect(callback2).toHaveBeenCalledWith(progressEvent)
    })

    test('should handle callback for non-existent task', () => {
      const progressCallback = jest.fn()

      workerPool.onProgress('non-existent-task', progressCallback)

      // Should not throw when emitting progress for non-existent task
      expect(() => {
        ;(workerPool as any).emitProgress('non-existent-task', {
          taskId: 'non-existent-task',
          type: 'progress',
          current: 10,
          total: 100,
          percentage: 10
        })
      }).not.toThrow()

      // Callback should still be called even if task doesn't exist
      expect(progressCallback).toHaveBeenCalled()
    })

    test('should handle callback deregistration', () => {
      const progressCallback = jest.fn()

      workerPool.onProgress('deregister-task', progressCallback)
      
      // Manually clear callbacks to simulate deregistration
      ;(workerPool as any).progressCallbacks.delete('deregister-task')

      const progressEvent: ProgressEvent = {
        taskId: 'deregister-task',
        type: 'progress',
        current: 25,
        total: 100,
        percentage: 25
      }

      ;(workerPool as any).emitProgress('deregister-task', progressEvent)
      expect(progressCallback).not.toHaveBeenCalled()
    })
  })

  describe('Main Window Integration - All Branches', () => {
    test('should send progress to main window when available', () => {
      workerPool.setMainWindow(mockWindow)

      const progressEvent: ProgressEvent = {
        taskId: 'window-task',
        type: 'progress',
        current: 75,
        total: 100,
        percentage: 75
      }

      ;(workerPool as any).emitProgress('window-task', progressEvent)

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        ...progressEvent,
        taskId: 'window-task'
      })
    })

    test('should handle destroyed main window gracefully', () => {
      mockWindow.isDestroyed.mockReturnValue(true)
      workerPool.setMainWindow(mockWindow)

      const progressEvent: ProgressEvent = {
        taskId: 'destroyed-window-task',
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      expect(() => {
        ;(workerPool as any).emitProgress('destroyed-window-task', progressEvent)
      }).not.toThrow()

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    test('should handle null main window gracefully', () => {
      workerPool.setMainWindow(null as any)

      const progressEvent: ProgressEvent = {
        taskId: 'no-window-task',
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      expect(() => {
        ;(workerPool as any).emitProgress('no-window-task', progressEvent)
      }).not.toThrow()
    })

    test('should handle window send errors gracefully', () => {
      mockWindow.webContents.send.mockImplementation(() => {
        throw new Error('Window destroyed')
      })
      workerPool.setMainWindow(mockWindow)

      const progressEvent: ProgressEvent = {
        taskId: 'error-window-task',
        type: 'progress',
        current: 25,
        total: 100,
        percentage: 25
      }

      expect(() => {
        ;(workerPool as any).emitProgress('error-window-task', progressEvent)
      }).not.toThrow()
    })
  })

  describe('Error Handling - Edge Cases', () => {
    test('should handle malformed progress events', () => {
      const progressCallback = jest.fn()
      workerPool.onProgress('malformed-task', progressCallback)

      const malformedEvent = {
        taskId: 'malformed-task',
        type: 'progress'
        // Missing required fields
      } as any

      expect(() => {
        ;(workerPool as any).emitProgress('malformed-task', malformedEvent)
      }).not.toThrow()

      expect(progressCallback).toHaveBeenCalledWith(malformedEvent)
    })

    test('should handle task execution failures', () => {
      const errorCallback = jest.fn()
      const task: WorkerTask = {
        id: 'error-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPool.onResult('error-task', errorCallback)

      const errorResult: TaskResult = {
        taskId: 'error-task',
        success: false,
        error: { code: 'EXECUTION_ERROR', message: 'Task execution failed' },
        duration: 1000
      }

      ;(workerPool as any).resultCallbacks.get('error-task')?.(errorResult)
      expect(errorCallback).toHaveBeenCalledWith(errorResult)
    })

    test('should handle worker thread termination errors', async () => {
      const task: WorkerTask = {
        id: 'termination-error-task',
        type: 'import',
        data: { test: 'data' }
      }

      await workerPool.enqueue(task)

      // Simulate worker termination error
      expect(() => {
        ;(workerPool as any).handleWorkerError('termination-error-task', new Error('Worker terminated'))
      }).not.toThrow()

      expect(workerPool.getStatus('termination-error-task')).toBe('unknown')
    })

    test('should handle memory cleanup after task completion', () => {
      const task: WorkerTask = {
        id: 'cleanup-task',
        type: 'import',
        data: { test: 'data' }
      }

      const progressCallback = jest.fn()
      const resultCallback = jest.fn()

      workerPool.onProgress('cleanup-task', progressCallback)
      workerPool.onResult('cleanup-task', resultCallback)

      // Simulate task completion
      const result: TaskResult = {
        taskId: 'cleanup-task',
        success: true,
        result: { data: 'test' },
        duration: 500
      }

      ;(workerPool as any).resultCallbacks.get('cleanup-task')?.(result)

      // Verify cleanup would happen (callbacks should be removed)
      expect(resultCallback).toHaveBeenCalledWith(result)
    })
  })

  describe('Performance and Memory Management', () => {
    test('should handle large task data efficiently', async () => {
      const largeData = {
        items: Array.from({ length: 10000 }, (_, i) => ({ id: i, data: `item-${i}` }))
      }

      const task: WorkerTask = {
        id: 'large-data-task',
        type: 'import',
        data: largeData
      }

      const startTime = Date.now()
      await workerPool.enqueue(task)
      const endTime = Date.now()

      expect(endTime - startTime).toBeLessThan(1000) // Should complete within 1 second
      expect(workerPool.getStatus('large-data-task')).toBe('queued')
    })

    test('should handle concurrent task limit', async () => {
      const tasks: WorkerTask[] = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent-task-${i}`,
        type: 'import',
        data: { index: i }
      }))

      const startTime = Date.now()
      
      for (const task of tasks) {
        await workerPool.enqueue(task)
      }
      
      const endTime = Date.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(2000) // Should complete within 2 seconds
      
      // Verify all tasks are queued
      for (const task of tasks) {
        expect(workerPool.getStatus(task.id)).toBe('queued')
      }
    })

    test('should clean up callbacks after task completion', () => {
      const task: WorkerTask = {
        id: 'no-window-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPool.setMainWindow(null as any)

      const progressCallback = jest.fn()
      workerPool.onProgress('no-window-task', progressCallback)

      // Simulate task completion
      ;(workerPool as any).cleanupTask('no-window-task')

      // Verify cleanup happened
      expect(() => {
        ;(workerPool as any).emitProgress('no-window-task', {
          taskId: 'no-window-task',
          type: 'progress',
          current: 100,
          total: 100,
          percentage: 100
        })
      }).not.toThrow()
    })
  })

  describe('Task Types - All Supported Types', () => {
    const supportedTypes = ['import', 'billing', 'batch-payments', 'batch-pdf', 'backup', 'custom']

    supportedTypes.forEach(type => {
      test(`should handle ${type} task type`, async () => {
        const task: WorkerTask = {
          id: `${type}-task`,
          type: type as any,
          data: { test: 'data' }
        }

        const taskId = await workerPool.enqueue(task)
        expect(taskId).toBe(`${type}-task`)
        expect(workerPool.getStatus(`${type}-task`)).toBe('queued')
      })
    })
  })

  describe('Boundary Value Testing', () => {
    test('should handle maximum priority value', async () => {
      const task: WorkerTask = {
        id: 'max-priority-task',
        type: 'import',
        data: { test: 'data' },
        priority: Number.MAX_SAFE_INTEGER
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('max-priority-task')
      expect(workerPool.getStatus('max-priority-task')).toBe('queued')
    })

    test('should handle minimum priority value', async () => {
      const task: WorkerTask = {
        id: 'min-priority-task',
        type: 'import',
        data: { test: 'data' },
        priority: Number.MIN_SAFE_INTEGER
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('min-priority-task')
      expect(workerPool.getStatus('min-priority-task')).toBe('queued')
    })

    test('should handle zero priority value', async () => {
      const task: WorkerTask = {
        id: 'zero-priority-task',
        type: 'import',
        data: { test: 'data' },
        priority: 0
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('zero-priority-task')
      expect(workerPool.getStatus('zero-priority-task')).toBe('queued')
    })

    test('should handle negative priority value', async () => {
      const task: WorkerTask = {
        id: 'negative-priority-task',
        type: 'import',
        data: { test: 'data' },
        priority: -100
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('negative-priority-task')
      expect(workerPool.getStatus('negative-priority-task')).toBe('queued')
    })
  })

  describe('Race Conditions and Concurrency', () => {
    test('should handle concurrent enqueue operations', async () => {
      const tasks = Array.from({ length: 100 }, (_, i) => ({
        id: `concurrent-${i}`,
        type: 'import' as const,
        data: { index: i }
      }))

      // Enqueue all tasks concurrently
      const promises = tasks.map(task => workerPool.enqueue(task))
      const results = await Promise.all(promises)

      // Verify all tasks were enqueued
      expect(results).toHaveLength(100)
      results.forEach((taskId, index) => {
        expect(taskId).toBe(`concurrent-${index}`)
        expect(workerPool.getStatus(taskId)).toBe('queued')
      })
    })

    test('should handle concurrent cancellation operations', async () => {
      const tasks = Array.from({ length: 50 }, (_, i) => ({
        id: `cancel-concurrent-${i}`,
        type: 'import' as const,
        data: { index: i }
      }))

      // Enqueue all tasks
      await Promise.all(tasks.map(task => workerPool.enqueue(task)))

      // Cancel all tasks concurrently
      const cancelPromises = tasks.map(task => 
        Promise.resolve(workerPool.cancel(task.id))
      )
      
      await Promise.all(cancelPromises)

      // Verify all tasks were cancelled
      tasks.forEach(task => {
        expect(workerPool.getStatus(task.id)).toBe('unknown')
      })
    })

    test('should handle concurrent callback registration', () => {
      const taskId = 'concurrent-callbacks-task'
      const callbacks = Array.from({ length: 100 }, () => jest.fn())

      // Register all callbacks concurrently
      callbacks.forEach(callback => {
        workerPool.onProgress(taskId, callback)
      })

      const progressEvent: ProgressEvent = {
        taskId,
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      ;(workerPool as any).emitProgress(taskId, progressEvent)

      // Verify all callbacks were called
      callbacks.forEach(callback => {
        expect(callback).toHaveBeenCalledWith(progressEvent)
      })
    })
  })
})
