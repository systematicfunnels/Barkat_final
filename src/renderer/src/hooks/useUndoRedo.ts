import { useState, useCallback } from 'react'
import { message } from 'antd'

export interface OperationHistory<T> {
  id: string
  operation: string
  data: T
  timestamp: Date
  type: 'create' | 'update' | 'delete'
}

export interface UndoRedoOptions<T> {
  maxHistory?: number
  onUndo?: (operation: OperationHistory<T>) => void
  onRedo?: (operation: OperationHistory<T>) => void
}

export interface UseUndoRedoResult<T> {
  addToHistory: (operation: string, data: T, type?: OperationHistory<T>['type']) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  clearHistory: () => void
  history: OperationHistory<T>[]
  currentIndex: number
}

export const useUndoRedo = <T extends Record<string, unknown>>(
  options: UndoRedoOptions<T> = {}
): UseUndoRedoResult<T> => {
  const { maxHistory = 50, onUndo, onRedo } = options

  const [history, setHistory] = useState<OperationHistory<T>[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)

  const addToHistory = useCallback(
    (operation: string, data: T, type: OperationHistory<T>['type'] = 'update') => {
      const newOperation: OperationHistory<T> = {
        id: Date.now().toString(),
        operation,
        data,
        timestamp: new Date(),
        type
      }

      // Remove any operations after current index (for new operations after undo)
      const newHistory = [...history.slice(0, currentIndex + 1), newOperation].slice(-maxHistory)

      setHistory(newHistory)
      setCurrentIndex(newHistory.length - 1)

      // logger.debug(`Added to history: ${operation} (${type})`, 'UndoRedo')
    },
    [history, currentIndex, maxHistory]
  )

  const undo = useCallback(() => {
    if (currentIndex <= 0) {
      message.warning('Nothing to undo')
      return
    }

    const previousIndex = currentIndex - 1
    const operation = history[previousIndex]

    if (onUndo) {
      try {
        onUndo(operation)
        setCurrentIndex(previousIndex)
        // logger.info(`Undid: ${operation.operation}`, 'UndoRedo')
        message.success(`Undid: ${operation.operation}`)
      } catch {
        // logger.error('Undo operation failed', error as Error, 'UndoRedo')
        message.error('Failed to undo operation')
      }
    }
  }, [currentIndex, history, onUndo])

  const redo = useCallback(() => {
    if (currentIndex >= history.length - 1) {
      message.warning('Nothing to redo')
      return
    }

    const nextIndex = currentIndex + 1
    const operation = history[nextIndex]

    if (onRedo) {
      try {
        onRedo(operation)
        setCurrentIndex(nextIndex)
        // logger.info(`Redid: ${operation.operation}`, 'UndoRedo')
        message.success(`Redid: ${operation.operation}`)
      } catch {
        // logger.error('Redo operation failed', error as Error, 'UndoRedo')
        message.error('Failed to redo operation')
      }
    }
  }, [currentIndex, history, onRedo])

  const canUndo = currentIndex > 0
  const canRedo = currentIndex < history.length - 1

  const clearHistory = useCallback(() => {
    setHistory([])
    setCurrentIndex(-1)
    // logger.info('History cleared', 'UndoRedo')
  }, [])

  return {
    addToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    history: history.slice(0, currentIndex + 1),
    currentIndex
  }
}
