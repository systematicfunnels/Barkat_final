export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: string
  error?: Error
}

export class Logger {
  private static instance: Logger
  private logs: LogEntry[] = []
  private maxLogSize = 1000
  private currentLogLevel = process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.currentLogLevel
  }

  private formatMessage(level: LogLevel, message: string, context?: string): string {
    const timestamp = new Date().toISOString()
    const levelName = LogLevel[level]
    const contextStr = context ? ` [${context}]` : ''
    return `${timestamp} ${levelName}${contextStr}: ${message}`
  }

  public debug(message: string, context?: string): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return

    const formattedMessage = this.formatMessage(LogLevel.DEBUG, message, context)
    console.debug(formattedMessage)

    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      message,
      context
    })
  }

  public info(message: string, context?: string): void {
    if (!this.shouldLog(LogLevel.INFO)) return

    const formattedMessage = this.formatMessage(LogLevel.INFO, message, context)
    console.info(formattedMessage)

    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message,
      context
    })
  }

  public warn(message: string, context?: string): void {
    if (!this.shouldLog(LogLevel.WARN)) return

    const formattedMessage = this.formatMessage(LogLevel.WARN, message, context)
    console.warn(formattedMessage)

    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      message,
      context
    })
  }

  public error(message: string, error?: Error, context?: string): void {
    if (!this.shouldLog(LogLevel.ERROR)) return

    const formattedMessage = this.formatMessage(LogLevel.ERROR, message, context)
    console.error(formattedMessage)
    if (error) console.error(error)

    this.addLog({
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      message,
      context,
      error
    })
  }

  private addLog(entry: LogEntry): void {
    this.logs.push(entry)

    // Keep only the last maxLogSize entries
    if (this.logs.length > this.maxLogSize) {
      this.logs = this.logs.slice(-this.maxLogSize)
    }
  }

  public getLogs(level?: LogLevel): LogEntry[] {
    if (level === undefined) {
      return [...this.logs]
    }
    return this.logs.filter((log) => log.level >= level)
  }

  public clearLogs(): void {
    this.logs = []
  }

  public setLogLevel(level: LogLevel): void {
    this.currentLogLevel = level
  }
}

export const logger = Logger.getInstance()
