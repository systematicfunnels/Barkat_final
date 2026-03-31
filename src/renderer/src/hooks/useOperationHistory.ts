import { useState, useCallback, useRef, useEffect } from 'react'
import { message } from 'antd'

export type OperationType = 'delete' | 'create' | 'update' | 'import'

export interface Operation<T> {
  id: string
  type: OperationType
  timestamp: number
  description: string
  data: T[]
  restoreFn: (data: T[]) => Promise<void>
}

export interface UseOperationHistoryOptions<T> {
  maxHistory?: number
  onRestore?: (operation: Operation<T>) => void
}

export interface UseOperationHistoryResult<T> {
  history: Operation<T>[]
  currentIndex: number
  canUndo: boolean
  canRedo: boolean
  addOperation: (operation: Omit<Operation<T>, 'id' | 'timestamp'>) => void
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
  clear: () => void
}

export function useOperationHistory<T>(
  options: UseOperationHistoryOptions<T> = {}
): UseOperationHistoryResult<T> {
  const { maxHistory = 10 } = options
  const [history, setHistory] = useState<Operation<T>[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const historyRef = useRef(history)
  const currentIndexRef = useRef(currentIndex)

  // Keep refs in sync for async operations
  useEffect(() => {
    historyRef.current = history
    currentIndexRef.current = currentIndex
  }, [history, currentIndex])

  const canUndo = currentIndex >= 0
  const canRedo = currentIndex < history.length - 1

  const addOperation = useCallback((operation: Omit<Operation<T>, 'id' | 'timestamp'>) => {
    const newOp: Operation<T> = {
      ...operation,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    }

    setHistory((prev) => {
      // Remove any redo operations
      const trimmed = prev.slice(0, currentIndexRef.current + 1)
      // Add new operation
      const newHistory = [...trimmed, newOp]
      // Limit history size
      if (newHistory.length > maxHistory) {
        return newHistory.slice(newHistory.length - maxHistory)
      }
      return newHistory
    })

    setCurrentIndex((prev) => Math.min(prev + 1, maxHistory - 1))
  }, [maxHistory])

  const undo = useCallback(async (): Promise<boolean> => {
    if (!canUndo) {
      message.info('Nothing to undo')
      return false
    }

    const operation = historyRef.current[currentIndexRef.current]
    if (!operation) {
      message.error('Undo failed: operation not found')
      return false
    }

    try {
      await operation.restoreFn(operation.data)
      setCurrentIndex((prev) => prev - 1)
      message.success(`Undid: ${operation.description}`)
      return true
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      message.error(`Undo failed: ${errorMsg}`)
      return false
    }
  }, [canUndo])

  const redo = useCallback(async (): Promise<boolean> => {
    if (!canRedo) {
      message.info('Nothing to redo')
      return false
    }

    const operation = historyRef.current[currentIndexRef.current + 1]
    if (!operation) {
      message.error('Redo failed: operation not found')
      return false
    }

    try {
      // For redo, we typically need to re-apply the operation
      // This is operation-specific, so we pass a redoFn if needed
      message.info('Redo not yet implemented for this operation')
      return false
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      message.error(`Redo failed: ${errorMsg}`)
      return false
    }
  }, [canRedo])

  const clear = useCallback(() => {
    setHistory([])
    setCurrentIndex(-1)
  }, [])

  return {
    history,
    currentIndex,
    canUndo,
    canRedo,
    addOperation,
    undo,
    redo,
    clear
  }
}
