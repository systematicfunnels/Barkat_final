/**
 * Centralized error handling & logging for backend operations
 */

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, 404, details)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details)
    this.name = 'ConflictError'
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super('DATABASE_ERROR', message, 500, details)
    this.name = 'DatabaseError'
  }
}

export interface ErrorLog {
  timestamp: string
  code: string
  message: string
  stack?: string
  context?: Record<string, unknown>
  statusCode: number
}

class ErrorLogger {
  private logs: ErrorLog[] = []
  private maxLogs = 1000

  log(error: Error | AppError, context?: Record<string, unknown>): ErrorLog {
    const entry: ErrorLog = {
      timestamp: new Date().toISOString(),
      code: error instanceof AppError ? error.code : 'UNKNOWN_ERROR',
      message: error.message,
      stack: error.stack,
      context,
      statusCode: error instanceof AppError ? error.statusCode : 500
    }

    this.logs.push(entry)
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    // Console log in dev
    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1') {
      console.error(`[ERROR] ${entry.code}:`, entry.message, context)
    }

    return entry
  }

  getLogs(limit: number = 100): ErrorLog[] {
    return this.logs.slice(-limit)
  }

  clear(): void {
    this.logs = []
  }
}

export const errorLogger = new ErrorLogger()

// Safe error message for sending to renderer
export function getSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error) || 'An unknown error occurred'
}

// Wrap async operations with consistent error handling
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  operationName: string,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    errorLogger.log(error as Error, { operation: operationName, ...context })
    throw error
  }
}
