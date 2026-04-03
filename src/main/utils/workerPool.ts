/**
 * Background worker infrastructure for long-running operations
 * Prevents UI blocking by running heavy tasks in background thread
 */

import { Worker } from 'worker_threads'
import path from 'path'
import { BrowserWindow, app } from 'electron'

export interface CancellationToken {
  cancelled: boolean;
  cancel(): void;
}

export interface WorkerTask {
  id: string
  type: 'import' | 'billing' | 'batch-payments' | 'batch-pdf' | 'backup' | string
  data: Record<string, unknown>
  priority?: number // 0=high, 100=low
  cancellationToken?: CancellationToken
}

export interface ProgressEvent {
  taskId: string
  type: 'start' | 'progress' | 'complete' | 'error' | 'cancel'
  current?: number
  total?: number
  percentage?: number
  message?: string
  data?: unknown
  error?: { code: string; message: string }
}

export interface TaskResult {
  taskId: string
  success: boolean
  result?: unknown
  error?: { code: string; message: string }
  duration: number
}

export class WorkerPool {
  private taskQueue: WorkerTask[] = []
  private activeJobs: Map<string, WorkerTask> = new Map()
  private activeWorkers: Map<string, Worker> = new Map()
  private resultCallbacks: Map<string, (result: TaskResult) => void> = new Map()
  private progressCallbacks: Map<string, (event: ProgressEvent) => void> = new Map()
  private finishedStates: Map<string, 'complete' | 'cancel' | 'error'> = new Map()
  private cancelledTasks: Set<string> = new Set()
  private mainWindow: BrowserWindow | null = null
  private maxConcurrentTasks = 2 // CPU-bound tasks

  private getWorkerFileName(taskType: string): string {
    const workerFileMap: Record<string, string> = {
      billing: 'billing.worker.js',
      import: 'import.worker.js',
      'batch-pdf': 'pdf.worker.js',
      'report-export': 'report-export.worker.js'
    }

    return workerFileMap[taskType] || `${taskType}.worker.js`
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  async enqueue(task: WorkerTask): Promise<string> {
    this.taskQueue.push(task)
    // Sort by priority (lower number = higher priority)
    this.taskQueue.sort((a, b) => (a.priority || 100) - (b.priority || 100))
    this.processQueue()
    return task.id
  }

  private processQueue(): void {
    if (this.activeJobs.size >= this.maxConcurrentTasks || this.taskQueue.length === 0) {
      return
    }

    const task = this.taskQueue.shift()
    if (!task) return

    this.activeJobs.set(task.id, task)
    this.executeTask(task).finally(() => {
      this.activeJobs.delete(task.id)
      this.processQueue() // Process next in queue
    })
  }

  private async executeTask(task: WorkerTask): Promise<void> {
    const startTime = Date.now()
    const workerFileName = this.getWorkerFileName(task.type)
    const workerPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'workers', workerFileName)
      : path.join(app.getAppPath(), 'out', 'main', 'workers', workerFileName)

    try {
      const worker = new Worker(workerPath)
      this.activeWorkers.set(task.id, worker)
      this.emitProgress(task.id, {
        taskId: task.id,
        type: 'start',
        message: `Task ${task.type} started`
      })

      await new Promise<void>((resolve, reject) => {
        // Handle worker messages (progress updates)
        worker.on('message', (event: ProgressEvent | TaskResult) => {
          if (
            'type' in event &&
            (event.type === 'progress' || event.type === 'start' || event.type === 'complete')
          ) {
            this.emitProgress(task.id, event as ProgressEvent)
          } else if ('success' in event) {
            // Task completed
            const duration = Date.now() - startTime
            const result = { ...(event as TaskResult), duration, taskId: task.id }
            this.resultCallbacks.get(task.id)?.(result)
            this.resultCallbacks.delete(task.id)
            if (result.success) {
              this.finishedStates.set(task.id, 'complete')
              this.emitProgress(task.id, {
                taskId: task.id,
                type: 'complete',
                message: 'Task completed',
                data: result
              })
            } else {
              this.finishedStates.set(task.id, 'error')
              this.emitProgress(task.id, {
                taskId: task.id,
                type: 'error',
                message: result.error?.message || 'Task failed',
                error: result.error,
                data: result
              })
            }
            resolve()
          }
        })

        worker.on('error', (error) => {
          if (this.cancelledTasks.has(task.id)) {
            resolve()
            return
          }
          const duration = Date.now() - startTime
          const result: TaskResult = {
            taskId: task.id,
            success: false,
            error: { code: 'WORKER_ERROR', message: error.message },
            duration
          }
          this.finishedStates.set(task.id, 'error')
          this.resultCallbacks.get(task.id)?.(result)
          this.resultCallbacks.delete(task.id)
          this.emitProgress(task.id, {
            taskId: task.id,
            type: 'error',
            error: { code: 'WORKER_ERROR', message: error.message }
          })
          reject(error)
        })

        worker.on('exit', (code) => {
          if (this.cancelledTasks.has(task.id)) {
            this.cancelledTasks.delete(task.id)
            this.finishedStates.set(task.id, 'cancel')
            this.resultCallbacks.delete(task.id)
            resolve()
            return
          }
          if (code !== 0 && !this.resultCallbacks.has(task.id)) {
            reject(new Error(`Worker exited with code ${code}`))
          }
        })

        // Send task to worker
        worker.postMessage({ task })
      })

      this.activeWorkers.delete(task.id)
      worker.terminate()
    } catch (error) {
      if (this.cancelledTasks.has(task.id)) {
        this.cancelledTasks.delete(task.id)
        this.finishedStates.set(task.id, 'cancel')
        this.resultCallbacks.delete(task.id)
        return
      }
      const duration = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)
      const result: TaskResult = {
        taskId: task.id,
        success: false,
        error: { code: 'TASK_ERROR', message: errorMsg },
        duration
      }
      this.finishedStates.set(task.id, 'error')
      this.resultCallbacks.get(task.id)?.(result)
      this.resultCallbacks.delete(task.id)
      this.emitProgress(task.id, {
        taskId: task.id,
        type: 'error',
        error: { code: 'TASK_ERROR', message: errorMsg }
      })
    } finally {
      this.activeWorkers.delete(task.id)
    }
  }

  private emitProgress(taskId: string, event: ProgressEvent): void {
    event.taskId = taskId

    // Send to renderer via IPC if main window exists
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('worker-progress', event)
    }

    // Call registered progress callback
    this.progressCallbacks.get(taskId)?.(event)
  }

  onProgress(taskId: string, callback: (event: ProgressEvent) => void): void {
    this.progressCallbacks.set(taskId, callback)
  }

  onResult(taskId: string, callback: (result: TaskResult) => void): void {
    this.resultCallbacks.set(taskId, callback)
  }

  cancel(taskId: string): void {
    // Remove from queue if not started
    const queueIndex = this.taskQueue.findIndex((t) => t.id === taskId)
    if (queueIndex >= 0) {
      this.taskQueue.splice(queueIndex, 1)
      this.finishedStates.set(taskId, 'cancel')
      this.emitProgress(taskId, {
        taskId,
        type: 'cancel',
        message: 'Task cancelled'
      })
      return
    }

    const activeWorker = this.activeWorkers.get(taskId)
    if (activeWorker) {
      this.cancelledTasks.add(taskId)
      this.finishedStates.set(taskId, 'cancel')
      void activeWorker.terminate()
      this.activeWorkers.delete(taskId)
      this.resultCallbacks.delete(taskId)
      this.emitProgress(taskId, {
        taskId,
        type: 'cancel',
        message: 'Task cancelled'
      })
      return
    }

    // If active, will need worker message handler (cancellation tokens implemented)
    this.emitProgress(taskId, {
      taskId,
      type: 'cancel',
      message: 'Task cancellation in progress'
    })
  }

  getStatus(taskId: string): 'queued' | 'active' | 'complete' | 'cancel' | 'error' | 'unknown' {
    if (this.taskQueue.some((t) => t.id === taskId)) return 'queued'
    if (this.activeJobs.has(taskId)) return 'active'
    const finishedState = this.finishedStates.get(taskId)
    if (finishedState) return finishedState
    return 'unknown'
  }
}

export const workerPool = new WorkerPool()
