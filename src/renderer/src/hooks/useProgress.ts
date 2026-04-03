import { useState, useCallback, useRef } from 'react'
import { appMessage as message } from '../utils/appMessage'

export interface ProgressState {
  current: number
  total: number
  status: string
  isVisible: boolean
}

export interface ProgressOptions {
  title?: string
  showPercentage?: boolean
  onCancel?: () => void
}

export interface UseProgressResult {
  progress: ProgressState
  startProgress: (total: number, title?: string) => void
  updateProgress: (current: number, status?: string) => void
  completeProgress: (successMessage?: string) => void
  failProgress: (errorMessage?: string) => void
  cancelProgress: () => void
}

export const useProgress = (options: ProgressOptions = {}): UseProgressResult => {
  const { title: defaultTitle, onCancel } = options
  const [progress, setProgress] = useState<ProgressState>({
    current: 0,
    total: 100,
    status: 'Initializing...',
    isVisible: false
  })

  const progressKeyRef = useRef<string | null>(null)

  const startProgress = useCallback(
    (total: number, title?: string) => {
      setProgress({
        current: 0,
        total,
        status: title || defaultTitle || 'Processing...',
        isVisible: true
      })

      if (progressKeyRef.current) {
        message.destroy(progressKeyRef.current)
      }
      progressKeyRef.current = message.loading(
        `${title || defaultTitle || 'Processing...'}`,
        0
      ) as unknown as string
    },
    [defaultTitle]
  )

  const updateProgress = useCallback(
    (current: number, status?: string) => {
      setProgress((prev) => ({
        ...prev,
        current,
        status: status || prev.status
      }))

      const percentage = Math.round((current / progress.total) * 100)
      if (progressKeyRef.current) {
        message.destroy(progressKeyRef.current)
        progressKeyRef.current = message.loading(
          `${status || progress.status} - ${percentage}%`,
          0
        ) as unknown as string
      }

      // logger.debug(`Progress updated: ${current}/${progress.total} (${percentage}%)`, 'Progress')
    },
    [progress.total, progress.status]
  )

  const completeProgress = useCallback((successMessage?: string) => {
    setProgress((prev) => ({
      ...prev,
      current: prev.total,
      status: 'Completed',
      isVisible: false
    }))

    if (progressKeyRef.current) {
      message.destroy(progressKeyRef.current)
      if (successMessage) {
        message.success(successMessage)
      }
    }

    // logger.info('Progress completed successfully', 'Progress')
  }, [])

  const failProgress = useCallback((errorMessage?: string) => {
    setProgress((prev) => ({
      ...prev,
      status: 'Failed',
      isVisible: false
    }))

    if (progressKeyRef.current) {
      message.destroy(progressKeyRef.current)
      if (errorMessage) {
        message.error(errorMessage)
      }
    }

    // logger.error('Progress failed', new Error(errorMessage), 'Progress')
  }, [])

  const cancelProgress = (): void => {
    setProgress((prev) => ({
      ...prev,
      status: 'Cancelled',
      isVisible: false
    }))

    if (progressKeyRef.current) {
      message.destroy(progressKeyRef.current)
    }

    if (onCancel) {
      onCancel()
    }

    // logger.warn('Progress cancelled by user', 'Progress')
  }

  return {
    progress,
    startProgress,
    updateProgress,
    completeProgress,
    failProgress,
    cancelProgress
  }
}
