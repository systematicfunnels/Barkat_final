import { message } from 'antd'

export interface AsyncOperationResult<T> {
  data?: T
  error?: string
  success: boolean
}

export class AsyncOperationManager {
  private static instance: AsyncOperationManager

  private constructor() {}

  public static getInstance(): AsyncOperationManager {
    if (!AsyncOperationManager.instance) {
      AsyncOperationManager.instance = new AsyncOperationManager()
    }
    return AsyncOperationManager.instance
  }

  public async execute<T>(
    operation: () => Promise<T>,
    options: {
      successMessage?: string
      errorMessage?: string
      loadingMessage?: string
      silent?: boolean
    } = {}
  ): Promise<AsyncOperationResult<T>> {
    const { successMessage, errorMessage = 'Operation failed', silent = false } = options

    try {
      if (!silent && options.loadingMessage) {
        message.loading(options.loadingMessage, 0)
      }

      // logger.debug('Starting async operation', context)
      const result = await operation()

      if (!silent) {
        message.destroy()
        if (successMessage) {
          message.success(successMessage)
        }
      }

      // logger.debug('Async operation completed successfully', context)
      return { data: result, success: true }
    } catch (error) {
      if (!silent) {
        message.destroy()
        const userMessage = this.getSafeErrorMessage(error)
        message.error(errorMessage + ': ' + userMessage)
      }

      // logger.error('Async operation failed', error as Error, context)
      return { error: this.getSafeErrorMessage(error), success: false }
    }
  }

  private getSafeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    if (typeof error === 'string') {
      return error
    }
    return 'An unexpected error occurred'
  }
}

export const asyncOperationManager = AsyncOperationManager.getInstance()

// Custom hook for async operations
export const useAsyncOperation = () => {
  const execute = asyncOperationManager.execute.bind(asyncOperationManager)
  return { execute }
}
