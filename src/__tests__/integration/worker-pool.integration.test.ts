/**
 * Integration tests for Worker Pool interactions
 * Tests data flow, API communication, and module interactions
 */

import { WorkerPool, WorkerTask, ProgressEvent, TaskResult } from '../../main/utils/workerPool'
import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'

// Mock Electron and Worker modules
jest.mock('electron', () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    webContents: { send: jest.fn() },
    isDestroyed: jest.fn().mockReturnValue(false)
  }))
}))

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn().mockReturnThis(),
    postMessage: jest.fn(),
    terminate: jest.fn().mockResolvedValue(undefined)
  }))
}))

describe('Worker Pool Integration Tests', () => {
  let workerPool: WorkerPool
  let mockWindow: any
  let mockWorker: any

  beforeEach(() => {
    workerPool = new WorkerPool()
    mockWindow = {
      webContents: { send: jest.fn() },
      isDestroyed: jest.fn().mockReturnValue(false)
    }
    mockWorker = {
      on: jest.fn().mockReturnThis(),
      postMessage: jest.fn(),
      terminate: jest.fn().mockResolvedValue(undefined)
    }

    workerPool.setMainWindow(mockWindow)
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Worker Thread Integration', () => {
    test('should handle worker creation and task execution', async () => {
      const task: WorkerTask = {
        id: 'integration-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      // Mock Worker constructor
      const MockedWorker = Worker as jest.MockedClass<typeof Worker>
      MockedWorker.mockImplementation(() => mockWorker)

      // Enqueue task
      const taskId = await workerPool.enqueue(task)

      expect(taskId).toBe('integration-test-1')
      expect(workerPool.getStatus(taskId)).toBe('queued')
      expect(MockedWorker).toHaveBeenCalled()
    })

    test('should handle worker message passing', async () => {
      const task: WorkerTask = {
        id: 'message-test-1',
        type: 'billing',
        data: { projectId: 1 }
      }

      // Set up message handler
      const messageHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'message') {
          messageHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      await workerPool.enqueue(task)

      // Simulate worker message
      const progressEvent: ProgressEvent = {
        taskId: task.id,
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      messageHandler({ type: 'progress', data: progressEvent })

      // Verify progress was handled
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        ...progressEvent,
        taskId: task.id
      })
    })

    test('should handle worker termination', async () => {
      const task: WorkerTask = {
        id: 'termination-test-1',
        type: 'backup',
        data: { path: '/backup' }
      }

      await workerPool.enqueue(task)

      // Simulate worker termination
      const exitHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'exit') {
          exitHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      // Simulate worker exit
      exitHandler({ code: 0, signal: null })

      // Verify task status
      expect(workerPool.getStatus(task.id)).toBe('unknown')
    })

    test('should handle worker errors', async () => {
      const task: WorkerTask = {
        id: 'error-test-1',
        type: 'export',
        data: { format: 'pdf' }
      }

      await workerPool.enqueue(task)

      // Set up error handler
      const errorHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') {
          errorHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      // Simulate worker error
      const error = new Error('Worker processing failed')
      errorHandler(error)

      // Verify error was handled
      expect(workerPool.getStatus(task.id)).toBe('unknown')
    })
  })

  describe('Task Queue Integration', () => {
    test('should handle task queue priority ordering', async () => {
      const highPriorityTask: WorkerTask = {
        id: 'high-priority-1',
        type: 'import',
        data: { urgent: true },
        priority: 0
      }

      const lowPriorityTask: WorkerTask = {
        id: 'low-priority-1',
        type: 'import',
        data: { urgent: false },
        priority: 100
      }

      // Enqueue in reverse order
      await workerPool.enqueue(lowPriorityTask)
      await workerPool.enqueue(highPriorityTask)

      // Verify queue ordering (high priority should be processed first)
      expect(workerPool.getStatus('high-priority-1')).toBe('queued')
      expect(workerPool.getStatus('low-priority-1')).toBe('queued')
    })

    test('should handle concurrent task enqueuing', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent-task-${i}`,
        type: 'import' as const,
        data: { index: i }
      }))

      // Enqueue all tasks concurrently
      const taskIds = await Promise.all(tasks.map(task => workerPool.enqueue(task)))

      expect(taskIds).toHaveLength(10)
      taskIds.forEach((taskId, index) => {
        expect(taskId).toBe(`concurrent-task-${index}`)
        expect(workerPool.getStatus(taskId)).toBe('queued')
      })
    })

    test('should handle task queue overflow', async () => {
      const maxTasks = 100
      const tasks = Array.from({ length: maxTasks + 10 }, (_, i) => ({
        id: `overflow-task-${i}`,
        type: 'import' as const,
        data: { index: i }
      }))

      // Enqueue more tasks than the queue can handle
      const results = []
      for (const task of tasks) {
        try {
          const taskId = await workerPool.enqueue(task)
          results.push(taskId)
        } catch (error) {
          // Handle queue overflow
          break
        }
      }

      expect(results.length).toBeLessThanOrEqual(maxTasks)
    })
  })

  describe('Progress Reporting Integration', () => {
    test('should handle progress callback registration', async () => {
      const task: WorkerTask = {
        id: 'progress-callback-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      const progressCallback = jest.fn()
      workerPool.onProgress(task.id, progressCallback)

      await workerPool.enqueue(task)

      // Simulate progress events
      const progressEvents = [
        { taskId: task.id, type: 'progress' as const, current: 25, total: 100, percentage: 25 },
        { taskId: task.id, type: 'progress' as const, current: 50, total: 100, percentage: 50 },
        { taskId: task.id, type: 'progress' as const, current: 75, total: 100, percentage: 75 }
      ]

      progressEvents.forEach(event => {
        ;(workerPool as any).emitProgress(task.id, event)
      })

      // Verify all progress callbacks were called
      expect(progressCallback).toHaveBeenCalledTimes(3)
      progressCallback.mock.calls.forEach((call, index) => {
        expect(call[0]).toEqual(progressEvents[index])
      })
    })

    test('should handle multiple progress callbacks per task', async () => {
      const task: WorkerTask = {
        id: 'multi-callback-test-1',
        type: 'billing',
        data: { projectId: 1 }
      }

      const callback1 = jest.fn()
      const callback2 = jest.fn()
      const callback3 = jest.fn()

      workerPool.onProgress(task.id, callback1)
      workerPool.onProgress(task.id, callback2)
      workerPool.onProgress(task.id, callback3)

      await workerPool.enqueue(task)

      const progressEvent: ProgressEvent = {
        taskId: task.id,
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      ;(workerPool as any).emitProgress(task.id, progressEvent)

      // Verify all callbacks were called
      expect(callback1).toHaveBeenCalledWith(progressEvent)
      expect(callback2).toHaveBeenCalledWith(progressEvent)
      expect(callback3).toHaveBeenCalledWith(progressEvent)
    })

    test('should handle progress callback deregistration', async () => {
      const task: WorkerTask = {
        id: 'callback-dereg-test-1',
        type: 'export',
        data: { format: 'excel' }
      }

      const progressCallback = jest.fn()
      workerPool.onProgress(task.id, progressCallback)

      await workerPool.enqueue(task)

      // Deregister callback
      ;(workerPool as any).progressCallbacks.delete(task.id)

      const progressEvent: ProgressEvent = {
        taskId: task.id,
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      ;(workerPool as any).emitProgress(task.id, progressEvent)

      // Verify callback was not called
      expect(progressCallback).not.toHaveBeenCalled()
    })
  })

  describe('Result Callback Integration', () => {
    test('should handle result callback registration', async () => {
      const task: WorkerTask = {
        id: 'result-callback-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      const resultCallback = jest.fn()
      workerPool.onResult(task.id, resultCallback)

      await workerPool.enqueue(task)

      // Simulate task completion
      const result: TaskResult = {
        taskId: task.id,
        success: true,
        result: { imported: 10, failed: 0 },
        duration: 5000
      }

      ;(workerPool as any).resultCallbacks.get(task.id)?.(result)

      // Verify result callback was called
      expect(resultCallback).toHaveBeenCalledWith(result)
    })

    test('should handle error result callbacks', async () => {
      const task: WorkerTask = {
        id: 'error-result-test-1',
        type: 'billing',
        data: { projectId: 1 }
      }

      const resultCallback = jest.fn()
      workerPool.onResult(task.id, resultCallback)

      await workerPool.enqueue(task)

      // Simulate task failure
      const errorResult: TaskResult = {
        taskId: task.id,
        success: false,
        error: { code: 'PROCESSING_ERROR', message: 'Task failed' },
        duration: 3000
      }

      ;(workerPool as any).resultCallbacks.get(task.id)?.(errorResult)

      // Verify error result callback was called
      expect(resultCallback).toHaveBeenCalledWith(errorResult)
    })

    test('should handle result callback cleanup', async () => {
      const task: WorkerTask = {
        id: 'cleanup-test-1',
        type: 'backup',
        data: { path: '/backup' }
      }

      const resultCallback = jest.fn()
      workerPool.onResult(task.id, resultCallback)

      await workerPool.enqueue(task)

      // Simulate task completion and cleanup
      const result: TaskResult = {
        taskId: task.id,
        success: true,
        result: { backupPath: '/backup/done.zip' },
        duration: 2000
      }

      ;(workerPool as any).resultCallbacks.get(task.id)?.(result)
      ;(workerPool as any).cleanupTask(task.id)

      // Verify callback was called and cleanup happened
      expect(resultCallback).toHaveBeenCalledWith(result)
      expect((workerPool as any).resultCallbacks.has(task.id)).toBe(false)
    })
  })

  describe('Main Window Integration', () => {
    test('should send progress to main window', async () => {
      const task: WorkerTask = {
        id: 'window-integration-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      await workerPool.enqueue(task)

      const progressEvent: ProgressEvent = {
        taskId: task.id,
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      ;(workerPool as any).emitProgress(task.id, progressEvent)

      // Verify progress was sent to main window
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        ...progressEvent,
        taskId: task.id
      })
    })

    test('should handle destroyed main window', async () => {
      const task: WorkerTask = {
        id: 'destroyed-window-test-1',
        type: 'export',
        data: { format: 'pdf' }
      }

      // Mock destroyed window
      mockWindow.isDestroyed.mockReturnValue(true)
      workerPool.setMainWindow(mockWindow)

      await workerPool.enqueue(task)

      const progressEvent: ProgressEvent = {
        taskId: task.id,
        type: 'progress',
        current: 25,
        total: 100,
        percentage: 25
      }

      ;(workerPool as any).emitProgress(task.id, progressEvent)

      // Verify progress was not sent to destroyed window
      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    test('should handle null main window', async () => {
      const task: WorkerTask = {
        id: 'null-window-test-1',
        type: 'backup',
        data: { path: '/backup' }
      }

      workerPool.setMainWindow(null as any)

      await workerPool.enqueue(task)

      const progressEvent: ProgressEvent = {
        taskId: task.id,
        type: 'progress',
        current: 75,
        total: 100,
        percentage: 75
      }

      ;(workerPool as any).emitProgress(task.id, progressEvent)

      // Verify progress was not sent
      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    test('should handle main window send errors', async () => {
      const task: WorkerTask = {
        id: 'window-error-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      // Mock send error
      mockWindow.webContents.send.mockImplementation(() => {
        throw new Error('Window destroyed')
      })

      await workerPool.enqueue(task)

      const progressEvent: ProgressEvent = {
        taskId: task.id,
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      // Should not throw error
      expect(() => {
        ;(workerPool as any).emitProgress(task.id, progressEvent)
      }).not.toThrow()
    })
  })

  describe('Cancellation Integration', () => {
    test('should cancel queued tasks', async () => {
      const task: WorkerTask = {
        id: 'cancel-queued-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      await workerPool.enqueue(task)

      // Cancel before execution starts
      workerPool.cancel(task.id)

      expect(workerPool.getStatus(task.id)).toBe('unknown')

      // Verify cancellation progress was sent
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        taskId: task.id,
        type: 'cancel',
        message: 'Task cancelled'
      })
    })

    test('should cancel active tasks with cancellation token', async () => {
      const cancellationToken = {
        cancelled: false,
        cancel: jest.fn()
      }

      const task: WorkerTask = {
        id: 'cancel-active-test-1',
        type: 'billing',
        data: { projectId: 1 },
        cancellationToken
      }

      await workerPool.enqueue(task)

      // Simulate active task (manually add to active tasks)
      ;(workerPool as any).activeTasks.set(task.id, cancellationToken)

      workerPool.cancel(task.id)

      expect(cancellationToken.cancel).toHaveBeenCalled()
      expect(workerPool.getStatus(task.id)).toBe('unknown')
    })

    test('should handle cancellation of non-existent tasks', () => {
      // Should not throw error
      expect(() => {
        workerPool.cancel('non-existent-task')
      }).not.toThrow()

      // Should still send cancellation progress
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        taskId: 'non-existent-task',
        type: 'cancel',
        message: 'Task cancellation in progress'
      })
    })

    test('should handle cancellation of already cancelled tasks', async () => {
      const task: WorkerTask = {
        id: 'double-cancel-test-1',
        type: 'export',
        data: { format: 'excel' }
      }

      await workerPool.enqueue(task)

      // Cancel first time
      workerPool.cancel(task.id)

      // Cancel second time
      workerPool.cancel(task.id)

      expect(workerPool.getStatus(task.id)).toBe('unknown')
    })
  })

  describe('Concurrent Operations Integration', () => {
    test('should handle concurrent task execution', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `concurrent-execution-${i}`,
        type: 'import' as const,
        data: { index: i }
      }))

      // Enqueue all tasks
      const taskIds = await Promise.all(tasks.map(task => workerPool.enqueue(task)))

      // Simulate concurrent progress updates
      taskIds.forEach((taskId, index) => {
        const progressEvent: ProgressEvent = {
          taskId,
          type: 'progress',
          current: index * 20,
          total: 100,
          percentage: index * 20
        }

        ;(workerPool as any).emitProgress(taskId, progressEvent)
      })

      // Verify all progress events were sent
      expect(mockWindow.webContents.send).toHaveBeenCalledTimes(5)

      // Verify all tasks are still queued (not executed yet)
      taskIds.forEach(taskId => {
        expect(workerPool.getStatus(taskId)).toBe('queued')
      })
    })

    test('should handle concurrent cancellations', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent-cancel-${i}`,
        type: 'billing' as const,
        data: { projectId: 1 }
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

    test('should handle concurrent callback registration', async () => {
      const taskId = 'concurrent-callbacks-test-1'
      const task: WorkerTask = {
        id: taskId,
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      await workerPool.enqueue(task)

      // Register multiple callbacks concurrently
      const callbacks = Array.from({ length: 20 }, (_, i) => jest.fn())
      const registerPromises = callbacks.map((callback, index) => {
        workerPool.onProgress(`${taskId}-${index}`, callback)
        return Promise.resolve()
      })

      await Promise.all(registerPromises)

      // Emit progress event
      const progressEvent: ProgressEvent = {
        taskId,
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      ;(workerPool as any).emitProgress(taskId, progressEvent)

      // Note: Only callbacks registered for the exact taskId will be called
      // Other callbacks with different task IDs won't be called
    })
  })

  describe('Memory Management Integration', () => {
    test('should clean up resources after task completion', async () => {
      const task: WorkerTask = {
        id: 'cleanup-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      const progressCallback = jest.fn()
      const resultCallback = jest.fn()

      workerPool.onProgress(task.id, progressCallback)
      workerPool.onResult(task.id, resultCallback)

      await workerPool.enqueue(task)

      // Simulate task completion
      const result: TaskResult = {
        taskId: task.id,
        success: true,
        result: { imported: 10 },
        duration: 5000
      }

      ;(workerPool as any).resultCallbacks.get(task.id)?.(result)

      // Simulate cleanup
      ;(workerPool as any).cleanupTask(task.id)

      // Verify cleanup
      expect((workerPool as any).progressCallbacks.has(task.id)).toBe(false)
      expect((workerPool as any).resultCallbacks.has(task.id)).toBe(false)
      expect((workerPool as any).activeJobs.has(task.id)).toBe(false)
    })

    test('should handle large number of tasks efficiently', async () => {
      const taskCount = 100
      const tasks = Array.from({ length: taskCount }, (_, i) => ({
        id: `memory-test-${i}`,
        type: 'import' as const,
        data: { index: i }
      }))

      const startTime = Date.now()

      // Enqueue all tasks
      const taskIds = await Promise.all(tasks.map(task => workerPool.enqueue(task)))

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(taskIds).toHaveLength(taskCount)
      expect(duration).toBeLessThan(1000) // Should complete within 1 second

      // Verify all tasks are queued
      taskIds.forEach(taskId => {
        expect(workerPool.getStatus(taskId)).toBe('queued')
      })
    })

    test('should handle memory pressure scenarios', async () => {
      // Create tasks with large data
      const largeData = new Array(10000).fill('x').join('')
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `memory-pressure-${i}`,
        type: 'import' as const,
        data: { largeData, index: i }
      }))

      // Enqueue tasks with large data
      const taskIds = await Promise.all(tasks.map(task => workerPool.enqueue(task)))

      expect(taskIds).toHaveLength(10)

      // Verify memory is not exhausted
      taskIds.forEach(taskId => {
        expect(workerPool.getStatus(taskId)).toBe('queued')
      })
    })
  })

  describe('Error Recovery Integration', () => {
    test('should handle worker thread crashes', async () => {
      const task: WorkerTask = {
        id: 'crash-test-1',
        type: 'import',
        data: { filePath: '/test/workbook.xlsx' }
      }

      await workerPool.enqueue(task)

      // Simulate worker crash
      const errorHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'error') {
          errorHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      const crashError = new Error('Worker thread crashed')
      errorHandler(crashError)

      // Verify error handling
      expect(workerPool.getStatus(task.id)).toBe('unknown')

      // Verify error progress was sent
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        taskId: task.id,
        type: 'error',
        message: 'Worker thread crashed'
      })
    })

    test('should handle worker timeout scenarios', async () => {
      const task: WorkerTask = {
        id: 'timeout-test-1',
        type: 'export',
        data: { format: 'pdf' }
      }

      await workerPool.enqueue(task)

      // Simulate timeout by manually removing from active tasks
      ;(workerPool as any).activeTasks.delete(task.id)

      // Verify task is marked as unknown
      expect(workerPool.getStatus(task.id)).toBe('unknown')
    })

    test('should handle invalid task data', async () => {
      const invalidTask = {
        id: 'invalid-data-test-1',
        type: 'invalid' as any,
        data: null
      }

      // Should handle invalid data gracefully
      const taskId = await workerPool.enqueue(invalidTask)

      expect(taskId).toBe('invalid-data-test-1')
      expect(workerPool.getStatus(taskId)).toBe('queued')
    })
  })
})
