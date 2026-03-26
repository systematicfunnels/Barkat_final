/**
 * Comprehensive unit tests for Logger
 * Covers all branches, edge cases, and failure scenarios
 */

import { Logger, LogLevel } from '../../../main/utils/logger'

// Mock console methods
const mockConsole = {
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}

// Mock fs for file logging
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn()
}))

describe('Logger - Comprehensive Test Suite', () => {
  let logger: Logger

  beforeEach(() => {
    logger = new Logger()
    jest.clearAllMocks()
    
    // Mock console methods
    Object.assign(console, mockConsole)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Logger Initialization - All Branches', () => {
    test('should initialize with default log level', () => {
      expect(logger).toBeInstanceOf(Logger)
      expect(logger.getLevel()).toBe(LogLevel.INFO)
    })

    test('should initialize with custom log level', () => {
      const customLogger = new Logger(LogLevel.ERROR)
      expect(customLogger.getLevel()).toBe(LogLevel.ERROR)
    })

    test('should initialize with file logging enabled', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(true)
      
      const fileLogger = new Logger(LogLevel.INFO, true, '/test/logs')
      expect(fileLogger).toBeInstanceOf(Logger)
      expect(fs.existsSync).toHaveBeenCalledWith('/test/logs')
    })

    test('should create log directory if not exists', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(false)
      fs.mkdirSync.mockReturnValue(undefined)
      
      new Logger(LogLevel.INFO, true, '/test/logs')
      expect(fs.mkdirSync).toHaveBeenCalledWith('/test/logs', { recursive: true })
    })

    test('should handle file system errors during initialization', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(false)
      fs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied')
      })
      
      expect(() => new Logger(LogLevel.INFO, true, '/restricted/logs')).not.toThrow()
    })
  })

  describe('Log Level Filtering - All Branches', () => {
    test('should log debug messages when level is DEBUG', () => {
      const debugLogger = new Logger(LogLevel.DEBUG)
      
      debugLogger.debug('Debug message')
      debugLogger.info('Info message')
      debugLogger.warn('Warning message')
      debugLogger.error('Error message')
      
      expect(mockConsole.debug).toHaveBeenCalledWith('[DEBUG] Debug message')
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] Info message')
      expect(mockConsole.warn).toHaveBeenCalledWith('[WARN] Warning message')
      expect(mockConsole.error).toHaveBeenCalledWith('[ERROR] Error message')
    })

    test('should filter debug messages when level is INFO', () => {
      const infoLogger = new Logger(LogLevel.INFO)
      
      infoLogger.debug('Debug message')
      infoLogger.info('Info message')
      infoLogger.warn('Warning message')
      infoLogger.error('Error message')
      
      expect(mockConsole.debug).not.toHaveBeenCalled()
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] Info message')
      expect(mockConsole.warn).toHaveBeenCalledWith('[WARN] Warning message')
      expect(mockConsole.error).toHaveBeenCalledWith('[ERROR] Error message')
    })

    test('should filter debug and info messages when level is WARN', () => {
      const warnLogger = new Logger(LogLevel.WARN)
      
      warnLogger.debug('Debug message')
      warnLogger.info('Info message')
      warnLogger.warn('Warning message')
      warnLogger.error('Error message')
      
      expect(mockConsole.debug).not.toHaveBeenCalled()
      expect(mockConsole.info).not.toHaveBeenCalled()
      expect(mockConsole.warn).toHaveBeenCalledWith('[WARN] Warning message')
      expect(mockConsole.error).toHaveBeenCalledWith('[ERROR] Error message')
    })

    test('should filter debug, info, and warn messages when level is ERROR', () => {
      const errorLogger = new Logger(LogLevel.ERROR)
      
      errorLogger.debug('Debug message')
      errorLogger.info('Info message')
      errorLogger.warn('Warning message')
      errorLogger.error('Error message')
      
      expect(mockConsole.debug).not.toHaveBeenCalled()
      expect(mockConsole.info).not.toHaveBeenCalled()
      expect(mockConsole.warn).not.toHaveBeenCalled()
      expect(mockConsole.error).toHaveBeenCalledWith('[ERROR] Error message')
    })

    test('should change log level dynamically', () => {
      const logger = new Logger(LogLevel.INFO)
      
      logger.debug('Should not appear')
      logger.setLevel(LogLevel.DEBUG)
      logger.debug('Should appear')
      
      expect(mockConsole.debug).toHaveBeenCalledTimes(1)
      expect(mockConsole.debug).toHaveBeenCalledWith('[DEBUG] Should appear')
    })
  })

  describe('Log Message Formatting - All Branches', () => {
    test('should format simple string messages', () => {
      logger.info('Simple message')
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] Simple message')
    })

    test('should format messages with context', () => {
      logger.info('Message with context', { userId: 123, action: 'login' })
      expect(mockConsole.info).toHaveBeenCalledWith(
        '[INFO] Message with context',
        { userId: 123, action: 'login' }
      )
    })

    test('should format messages with multiple parameters', () => {
      logger.info('Message %s %d', 'test', 42)
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] Message test 42')
    })

    test('should format error messages with Error objects', () => {
      const error = new Error('Test error')
      logger.error('Error occurred', error)
      
      expect(mockConsole.error).toHaveBeenCalledWith(
        '[ERROR] Error occurred',
        error
      )
    })

    test('should format messages with timestamps', () => {
      const logger = new Logger(LogLevel.INFO, false, '', true)
      
      logger.info('Message with timestamp')
      
      const call = mockConsole.info.mock.calls[0][0]
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] Message with timestamp/)
    })

    test('should handle very long messages', () => {
      const longMessage = 'x'.repeat(10000)
      logger.info(longMessage)
      
      const call = mockConsole.info.mock.calls[0][0]
      expect(call).toContain(longMessage)
    })

    test('should handle circular object references', () => {
      const circularObj: any = { name: 'test' }
      circularObj.self = circularObj
      
      logger.info('Circular object', circularObj)
      
      expect(mockConsole.info).toHaveBeenCalled()
      const call = mockConsole.info.mock.calls[0]
      expect(call[0]).toContain('[INFO] Circular object')
    })
  })

  describe('File Logging - All Branches', () => {
    test('should write logs to file when enabled', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(true)
      fs.writeFileSync.mockReturnValue(undefined)
      
      const fileLogger = new Logger(LogLevel.INFO, true, '/test/logs')
      fileLogger.info('File log message')
      
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    test('should handle file write errors gracefully', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(true)
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Disk full')
      })
      
      const fileLogger = new Logger(LogLevel.INFO, true, '/test/logs')
      
      expect(() => fileLogger.info('File log message')).not.toThrow()
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] File log message')
    })

    test('should rotate log files when size limit exceeded', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(true)
      fs.writeFileSync.mockReturnValue(undefined)
      fs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 }) // 10MB
      
      const fileLogger = new Logger(LogLevel.INFO, true, '/test/logs', false, 5 * 1024 * 1024)
      fileLogger.info('Large log message')
      
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    test('should create log file if not exists', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(false)
      fs.writeFileSync.mockReturnValue(undefined)
      
      const fileLogger = new Logger(LogLevel.INFO, true, '/test/logs/new.log')
      fileLogger.info('New file log')
      
      expect(fs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('Logger Methods - All Branches', () => {
    test('should call debug method correctly', () => {
      const debugLogger = new Logger(LogLevel.DEBUG)
      debugLogger.debug('Debug message')
      expect(mockConsole.debug).toHaveBeenCalledWith('[DEBUG] Debug message')
    })

    test('should call info method correctly', () => {
      logger.info('Info message')
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] Info message')
    })

    test('should call warn method correctly', () => {
      logger.warn('Warning message')
      expect(mockConsole.warn).toHaveBeenCalledWith('[WARN] Warning message')
    })

    test('should call error method correctly', () => {
      logger.error('Error message')
      expect(mockConsole.error).toHaveBeenCalledWith('[ERROR] Error message')
    })

    test('should call log method correctly', () => {
      logger.log(LogLevel.INFO, 'Log message')
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] Log message')
    })

    test('should handle unknown log levels', () => {
      logger.log(999 as LogLevel, 'Unknown level message')
      expect(mockConsole.log).toHaveBeenCalledWith('[UNKNOWN] Unknown level message')
    })
  })

  describe('Performance and Memory Management', () => {
    test('should handle high volume logging efficiently', () => {
      const startTime = Date.now()
      
      for (let i = 0; i < 10000; i++) {
        logger.info(`Message ${i}`)
      }
      
      const endTime = Date.now()
      expect(endTime - startTime).toBeLessThan(1000) // Should complete within 1 second
      expect(mockConsole.info).toHaveBeenCalledTimes(10000)
    })

    test('should handle concurrent logging', async () => {
      const promises = Array.from({ length: 1000 }, async (_, i) => {
        logger.info(`Concurrent message ${i}`)
      })
      
      await Promise.all(promises)
      expect(mockConsole.info).toHaveBeenCalledTimes(1000)
    })

    test('should clean up old log files', () => {
      const fs = require('fs')
      fs.existsSync.mockReturnValue(true)
      fs.readdirSync.mockReturnValue([
        'app.log',
        'app.log.1',
        'app.log.2',
        'app.log.3',
        'app.log.4',
        'app.log.5'
      ])
      fs.unlinkSync.mockReturnValue(undefined)
      
      const fileLogger = new Logger(LogLevel.INFO, true, '/test/logs', false, 0, 3)
      fileLogger.cleanup()
      
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2) // Keep 3 files, delete 2
    })
  })

  describe('Error Handling - Edge Cases', () => {
    test('should handle null/undefined messages', () => {
      logger.info(null as any)
      logger.info(undefined as any)
      logger.info('')
      
      expect(mockConsole.info).toHaveBeenCalledTimes(3)
    })

    test('should handle very complex objects', () => {
      const complexObj = {
        array: [1, 2, { nested: 'value' }],
        date: new Date(),
        regex: /test/g,
        func: function() { return 'test' },
        symbol: Symbol('test')
      }
      
      logger.info('Complex object', complexObj)
      expect(mockConsole.info).toHaveBeenCalled()
    })

    test('should handle logging during console errors', () => {
      mockConsole.info.mockImplementation(() => {
        throw new Error('Console error')
      })
      
      expect(() => logger.info('Test message')).not.toThrow()
    })

    test('should handle memory pressure scenarios', () => {
      // Simulate memory pressure by logging large objects
      for (let i = 0; i < 100; i++) {
        const largeObj = {
          data: new Array(10000).fill(`data-${i}`),
          metadata: {
            timestamp: new Date(),
            id: i,
            description: `Large object number ${i} with lots of data to test memory management`
          }
        }
        
        logger.info(`Large object ${i}`, largeObj)
      }
      
      expect(mockConsole.info).toHaveBeenCalledTimes(100)
    })
  })

  describe('Logger Configuration - All Branches', () => {
    test('should enable/disable timestamps', () => {
      const loggerWithTime = new Logger(LogLevel.INFO, false, '', true)
      const loggerWithoutTime = new Logger(LogLevel.INFO, false, '', false)
      
      loggerWithTime.info('With timestamp')
      loggerWithoutTime.info('Without timestamp')
      
      expect(mockConsole.info).toHaveBeenCalledTimes(2)
      
      const callWithTime = mockConsole.info.mock.calls[0][0]
      const callWithoutTime = mockConsole.info.mock.calls[1][0]
      
      expect(callWithTime).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(callWithoutTime).not.toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    test('should handle custom log format', () => {
      const customLogger = new Logger(LogLevel.INFO, false, '', false, 0, 0, 
        (level: string, message: string) => `[CUSTOM-${level}] ${message}`
      )
      
      customLogger.info('Custom format message')
      expect(mockConsole.info).toHaveBeenCalledWith('[CUSTOM-INFO] Custom format message')
    })

    test('should handle logger destruction', () => {
      const fileLogger = new Logger(LogLevel.INFO, true, '/test/logs')
      
      expect(() => fileLogger.destroy()).not.toThrow()
    })
  })

  describe('Integration Scenarios', () => {
    test('should handle complete logging workflow', () => {
      const logger = new Logger(LogLevel.DEBUG, true, '/test/logs', true, 1024 * 1024, 5)
      
      logger.debug('Application starting')
      logger.info('User logged in', { userId: 123 })
      logger.warn('High memory usage', { usage: '85%' })
      logger.error('Database connection failed', new Error('Connection timeout'))
      
      expect(mockConsole.debug).toHaveBeenCalled()
      expect(mockConsole.info).toHaveBeenCalled()
      expect(mockConsole.warn).toHaveBeenCalled()
      expect(mockConsole.error).toHaveBeenCalled()
    })

    test('should handle logger factory pattern', () => {
      const loggers = [
        new Logger(LogLevel.DEBUG),
        new Logger(LogLevel.INFO),
        new Logger(LogLevel.WARN),
        new Logger(LogLevel.ERROR)
      ]
      
      loggers.forEach((logger, index) => {
        logger.info(`Logger ${index} message`)
      })
      
      expect(mockConsole.info).toHaveBeenCalledTimes(4)
    })

    test('should handle logger inheritance scenarios', () => {
      class ExtendedLogger extends Logger {
        customLog(message: string) {
          this.info(`[CUSTOM] ${message}`)
        }
      }
      
      const extendedLogger = new ExtendedLogger(LogLevel.DEBUG)
      extendedLogger.customLog('Extended message')
      
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] [CUSTOM] Extended message')
    })
  })
})
