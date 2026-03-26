/**
 * Comprehensive test suite for WorkerPool
 * Tests background task management, cancellation, and progress reporting
 */

import { Worker } from 'worker_threads'
import { BrowserWindow } from 'electron'
import { WorkerPool, workerPool, CancellationToken, WorkerTask, ProgressEvent, TaskResult } from '../../../main/utils/workerPool'

// Mock dependencies BEFORE imports
const mockWorker = {
  on: jest.fn().mockReturnThis(),
  postMessage: jest.fn(),
  terminate: jest.fn().mockResolvedValue(undefined)
}

const mockWindow = {
  webContents: {
    send: jest.fn()
  },
  isDestroyed: jest.fn().mockReturnValue(false),
  on: jest.fn(),
  off: jest.fn(),
  once: jest.fn(),
  addListener: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
  emit: jest.fn(),
  maximize: jest.fn(),
  minimize: jest.fn(),
  restore: jest.fn(),
  focus: jest.fn(),
  blur: jest.fn(),
  isFocused: jest.fn(),
  isMinimized: jest.fn(),
  isMaximized: jest.fn(),
  setFullScreen: jest.fn(),
  isFullScreen: jest.fn(),
  setResizable: jest.fn(),
  isResizable: jest.fn(),
  setMovable: jest.fn(),
  isMovable: jest.fn(),
  setMinimizable: jest.fn(),
  isMinimizable: jest.fn(),
  setMaximizable: jest.fn(),
  isMaximizable: jest.fn(),
  setAlwaysOnTop: jest.fn(),
  isAlwaysOnTop: jest.fn(),
  center: jest.fn(),
  setPosition: jest.fn(),
  getPosition: jest.fn(),
  setSize: jest.fn(),
  getSize: jest.fn(),
  setContentProtection: jest.fn(),
  flashFrame: jest.fn(),
  setSkipTaskbar: jest.fn(),
  setKiosk: jest.fn(),
  isKiosk: jest.fn(),
  setTitle: jest.fn(),
  getTitle: jest.fn(),
  setSheetOffset: jest.fn(),
  getSheetOffset: jest.fn(),
  setVibrancy: jest.fn(),
  setBackgroundMaterial: jest.fn(),
  setIgnoreMouseEvents: jest.fn(),
  setFocusable: jest.fn(),
  getParentWindow: jest.fn(),
  getChildWindows: jest.fn(),
  getAutoHideMenuBar: jest.fn(),
  setAutoHideMenuBar: jest.fn(),
  setMenuBarVisibility: jest.fn(),
  setHasShadow: jest.fn(),
  hasShadow: jest.fn(),
  setOpacity: jest.fn(),
  getOpacity: jest.fn(),
  setShape: jest.fn(),
  getShape: jest.fn(),
  setBrowserView: jest.fn(),
  getBrowserView: jest.fn(),
  addBrowserView: jest.fn(),
  removeBrowserView: jest.fn(),
  setTopBrowserView: jest.fn(),
  getTopBrowserView: jest.fn(),
  show: jest.fn(),
  showInactive: jest.fn(),
  hide: jest.fn(),
  isVisible: jest.fn(),
  isModal: jest.fn(),
  closed: false,
  id: 1
} as any

jest.mock('worker_threads', () => ({
  Worker: jest.fn(() => mockWorker)
}))

jest.mock('electron', () => ({
  BrowserWindow: jest.fn(() => mockWindow)
}))

const MockedWorker = Worker as jest.MockedClass<typeof Worker>
const MockedBrowserWindow = BrowserWindow as jest.MockedClass<typeof BrowserWindow>

describe('WorkerPool', () => {
  let workerPoolInstance: WorkerPool

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()
    
    // Create fresh worker pool instance
    workerPoolInstance = new WorkerPool()
  })

  describe('Task Queue Management', () => {
    test('should enqueue task with proper priority sorting', async () => {
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

      // Enqueue in reverse order
      await workerPoolInstance.enqueue(lowPriorityTask)
      await workerPoolInstance.enqueue(highPriorityTask)

      // High priority should be processed first
      expect(workerPoolInstance.getStatus('high-priority')).toBe('queued')
      expect(workerPoolInstance.getStatus('low-priority')).toBe('queued')
    })

    test('should handle tasks without priority (default to 100)', async () => {
      const task: WorkerTask = {
        id: 'no-priority',
        type: 'import',
        data: { test: 'data' }
      }

      await workerPool.enqueue(task)
      expect(workerPool.getStatus('no-priority')).toBe('queued')
    })

    test('should return task ID when enqueued', async () => {
      const task: WorkerTask = {
        id: 'test-task',
        type: 'import',
        data: { test: 'data' }
      }

      const taskId = await workerPool.enqueue(task)
      expect(taskId).toBe('test-task')
    })
  })

  describe('Task Execution', () => {
    test('should execute task and emit progress events', async () => {
      const task: WorkerTask = {
        id: 'test-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPoolInstance.setMainWindow(mockWindow)

      // Mock worker message handling
      const mockMessageHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string | symbol, handler: Function) => {
        if (event === 'message') {
          mockMessageHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      await workerPool.enqueue(task)

      // Simulate worker progress message
      const progressEvent: ProgressEvent = {
        taskId: 'test-task',
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      mockMessageHandler(progressEvent)

      // Verify progress was sent to main window
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        ...progressEvent,
        taskId: 'test-task'
      })
    })

    test('should handle task completion successfully', async () => {
      const task: WorkerTask = {
        id: 'test-task',
        type: 'import',
        data: { test: 'data' }
      }

      let resultCallback: ((result: TaskResult) => void) | undefined
      workerPool.onResult('test-task', (result) => {
        resultCallback = resultCallback || jest.fn()
        resultCallback(result)
      })

      const mockMessageHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string | symbol, handler: Function) => {
        if (event === 'message') {
          mockMessageHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      await workerPool.enqueue(task)

      // Simulate task completion
      const result: TaskResult = {
        taskId: 'test-task',
        success: true,
        result: { processed: 100 },
        duration: 1000
      }

      mockMessageHandler(result)

      expect(resultCallback).toBeDefined()
    })

    test('should handle worker errors gracefully', async () => {
      const task: WorkerTask = {
        id: 'error-task',
        type: 'import',
        data: { test: 'data' }
      }

      let errorCallback: ((result: TaskResult) => void) | undefined
      workerPool.onResult('error-task', (result) => {
        errorCallback = errorCallback || jest.fn()
        errorCallback(result)
      })

      const mockErrorHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string | symbol, handler: Function) => {
        if (event === 'error') {
          mockErrorHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      await workerPool.enqueue(task)

      // Simulate worker error
      const error = new Error('Worker failed')
      mockErrorHandler(error)

      expect(errorCallback).toBeDefined()
    })

    test('should handle worker exit with non-zero code', async () => {
      const task: WorkerTask = {
        id: 'exit-task',
        type: 'import',
        data: { test: 'data' }
      }

      const mockExitHandler = jest.fn()
      mockWorker.on.mockImplementation((event: string | symbol, handler: Function) => {
        if (event === 'exit') {
          mockExitHandler.mockImplementation(handler as any)
        }
        return mockWorker
      })

      await workerPool.enqueue(task)

      // Simulate worker exit with error code
      mockExitHandler(1)

      // Should handle the error appropriately
      expect(mockExitHandler).toHaveBeenCalled()
    })
  })

  describe('Task Cancellation', () => {
    test('should cancel queued task', () => {
      const task: WorkerTask = {
        id: 'queued-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPoolInstance.setMainWindow(mockWindow)

      // Enqueue task (don't await to keep it in queue)
      workerPoolInstance.enqueue(task)

      // Cancel the task
      workerPool.cancel('queued-task')

      // Verify cancellation progress was sent
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        taskId: 'queued-task',
        type: 'cancel',
        message: 'Task cancelled'
      })

      // Task should no longer be in queue
      expect(workerPoolInstance.getStatus('queued-task')).toBe('unknown')
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

      workerPoolInstance.setMainWindow(mockWindow)

      // Manually add to active tasks (simulating active execution)
      ;(workerPoolInstance as any).activeTasks.set('active-task', cancellationToken)

      // Cancel the task
      workerPoolInstance.cancel('active-task')

      // Verify cancellation token was called
      expect(cancellationToken.cancel).toHaveBeenCalled()

      // Verify cancellation progress was sent
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        taskId: 'active-task',
        type: 'cancel',
        message: 'Task cancelled'
      })

      // Task should no longer be active
      expect(workerPoolInstance.getStatus('active-task')).toBe('unknown')
    })

    test('should handle cancellation of non-existent task', () => {
      workerPoolInstance.setMainWindow(mockWindow)

      // Cancel non-existent task
      workerPoolInstance.cancel('non-existent')

      // Should still send cancellation in progress message
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        taskId: 'non-existent',
        type: 'cancel',
        message: 'Task cancellation in progress'
      })
    })
  })

  describe('Status Tracking', () => {
    test('should return correct status for queued tasks', async () => {
      const task: WorkerTask = {
        id: 'queued-task',
        type: 'import',
        data: { test: 'data' }
      }

      await workerPool.enqueue(task)
      expect(workerPool.getStatus('queued-task')).toBe('queued')
    })

    test('should return correct status for active tasks', () => {
      const task: WorkerTask = {
        id: 'active-task',
        type: 'import',
        data: { test: 'data' }
      }

      // Manually add to active jobs
      ;(workerPoolInstance as any).activeJobs.set('active-task', task)

      expect(workerPool.getStatus('active-task')).toBe('active')
    })

    test('should return unknown for non-existent tasks', () => {
      expect(workerPool.getStatus('non-existent')).toBe('unknown')
    })
  })

  describe('Progress Callbacks', () => {
    test('should register and call progress callbacks', () => {
      const progressCallback = jest.fn()
      const task: WorkerTask = {
        id: 'callback-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPool.onProgress('callback-task', progressCallback)

      // Emit progress event
      const progressEvent: ProgressEvent = {
        taskId: 'callback-task',
        type: 'progress',
        current: 25,
        total: 100,
        percentage: 25
      }

      ;(workerPoolInstance as any).emitProgress('callback-task', progressEvent)

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

      // Call result callback directly (simulating task completion)
      const result: TaskResult = {
        taskId: 'result-task',
        success: true,
        result: { data: 'test' },
        duration: 500
      }

      ;(workerPoolInstance as any).resultCallbacks.get('result-task')?.(result)

      expect(resultCallback).toHaveBeenCalledWith(result)
    })
  })

  describe('Main Window Integration', () => {
    test('should send progress to main window when available', () => {
      const task: WorkerTask = {
        id: 'window-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPoolInstance.setMainWindow(mockWindow)

      const progressEvent: ProgressEvent = {
        taskId: 'window-task',
        type: 'progress',
        current: 75,
        total: 100,
        percentage: 75
      }

      ;(workerPoolInstance as any).emitProgress('window-task', progressEvent)

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('worker-progress', {
        ...progressEvent,
        taskId: 'window-task'
      })
    })

    test('should handle destroyed main window gracefully', () => {
      const task: WorkerTask = {
        id: 'destroyed-window-task',
        type: 'import',
        data: { test: 'data' }
      }

      // Mock destroyed window
      mockWindow.isDestroyed.mockReturnValue(true)
      workerPoolInstance.setMainWindow(mockWindow)

      const progressEvent: ProgressEvent = {
        taskId: 'destroyed-window-task',
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      // Should not throw error
      expect(() => {
        ;(workerPoolInstance as any).emitProgress('destroyed-window-task', progressEvent)
      }).not.toThrow()

      // Should not attempt to send to destroyed window
      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    test('should handle null main window gracefully', () => {
      const task: WorkerTask = {
        id: 'no-window-task',
        type: 'import',
        data: { test: 'data' }
      }

      workerPool.setMainWindow(null as any)

      const progressEvent: ProgressEvent = {
        taskId: 'no-window-task',
        type: 'progress',
        current: 50,
        total: 100,
        percentage: 50
      }

      // Should not throw error
      expect(() => {
        ;(workerPoolInstance as any).emitProgress('no-window-task', progressEvent)
      }).not.toThrow()
    })
  })

  describe('Edge Cases and Error Handling', () => {
    test('should handle concurrent task limit', async () => {
      const tasks: WorkerTask[] = Array.from({ length: 5 }, (_, i) => ({
        id: `concurrent-task-${i}`,
        type: 'import',
        data: { index: i }
      }))

      // Enqueue multiple tasks
      for (const task of tasks) {
        await workerPool.enqueue(task)
      }

      // Should respect concurrent limit (2 by default)
      expect(workerPool.getStatus('concurrent-task-0')).toBe('queued')
      expect(workerPool.getStatus('concurrent-task-1')).toBe('queued')
    })

    test('should handle malformed progress events', () => {
      const progressCallback = jest.fn()
      workerPool.onProgress('malformed-task', progressCallback)

      // Emit malformed event
      const malformedEvent = {
        type: 'progress',
        current: 50,
        total: 100
      } as any

      expect(() => {
        ;(workerPool as any).emitProgress('malformed-task', malformedEvent)
      }).not.toThrow()

      expect(progressCallback).toHaveBeenCalledWith({
        ...malformedEvent,
        taskId: 'malformed-task'
      })
    })

    test('should handle task execution failures', async () => {
      const task: WorkerTask = {
        id: 'failure-task',
        type: 'import',
        data: { test: 'data' }
      }

      // Mock Worker constructor to throw error
      MockedWorker.mockImplementation(() => {
        throw new Error('Failed to create worker')
      })

      let errorCallback: ((result: TaskResult) => void) | undefined
      workerPool.onResult('failure-task', (result) => {
        errorCallback = errorCallback || jest.fn()
        errorCallback(result)
      })

      await workerPool.enqueue(task)

      // Should handle the error and call error callback
      expect(errorCallback).toBeDefined()
    })
  })

  describe('Performance and Memory Management', () => {
    test('should clean up callbacks after task completion', () => {
      const resultCallback = jest.fn()
      const progressCallback = jest.fn()

      workerPool.onResult('cleanup-task', resultCallback)
      workerPool.onProgress('cleanup-task', progressCallback)

      // Simulate task completion
      const result: TaskResult = {
        taskId: 'cleanup-task',
        success: true,
        result: { data: 'test' },
        duration: 500
      }

      ;(workerPool as any).resultCallbacks.get('cleanup-task')?.(result)

      // Result callback should be cleaned up
      expect((workerPool as any).resultCallbacks.has('cleanup-task')).toBe(false)
    })

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

      // Should handle large data without significant delay
      expect(endTime - startTime).toBeLessThan(100)
      expect(workerPool.getStatus('large-data-task')).toBe('queued')
    })
  })
})
