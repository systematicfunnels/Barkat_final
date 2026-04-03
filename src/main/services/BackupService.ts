/**
 * Automated database backup service
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { copyFileAsync, deleteFileAsync } from '../utils/fileAsync'
import { dbService } from '../db/database'

const SQLITE_FILE_HEADER = 'SQLite format 3\u0000'
const EXPORT_BACKUP_EXTENSION = '.barkatbackup'

export interface BackupConfig {
  enabled: boolean
  intervalDays: number
  maxBackups: number
  retentionDays: number
}

export interface BackupResult {
  success: boolean
  backupPath?: string
  timestamp?: string
  size?: number
  error?: string
}

type BackupMetadata = {
  timestamp: string
  dbPath: string
  size: number
  version: string
  formatVersion?: number
  snapshotMethod?: string
}

class BackupService {
  private readonly BACKUP_FORMAT_VERSION = 2
  private readonly BACKUP_SNAPSHOT_METHOD = 'sqlite-vacuum-into'
  private backupDir = path.join(app.getPath('userData'), 'backups')
  private dbPath = dbService.getDbPath()
  private readonly RESTORE_DELAY_MS = 100
  private config: BackupConfig = {
    enabled: true,
    intervalDays: 7,
    maxBackups: 10,
    retentionDays: 90
  }
  private scheduleId: NodeJS.Timeout | null = null
  private readonly isDevelopment =
    process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1'

  private logInfo(message: string, ...args: unknown[]): void {
    if (this.isDevelopment) {
      console.log(message, ...args)
    }
  }

  private logError(message: string, ...args: unknown[]): void {
    if (this.isDevelopment) {
      console.error(message, ...args)
    }
  }

  constructor() {
    this.logInfo('[BACKUP] Backup service initialized')
  }

  private buildTimestamp(date: Date = new Date()): string {
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    const hours = `${date.getHours()}`.padStart(2, '0')
    const minutes = `${date.getMinutes()}`.padStart(2, '0')
    const seconds = `${date.getSeconds()}`.padStart(2, '0')
    return `${year}${month}${day}_${hours}${minutes}${seconds}`
  }

  getDefaultExportFileName(date: Date = new Date()): string {
    return `barkat_backup_${this.buildTimestamp(date)}${EXPORT_BACKUP_EXTENSION}`
  }

  private normalizeExportPath(destinationPath: string): string {
    const trimmedPath = destinationPath.trim()
    const currentExtension = path.extname(trimmedPath).toLowerCase()
    if (!currentExtension) {
      return `${trimmedPath}${EXPORT_BACKUP_EXTENSION}`
    }
    return trimmedPath
  }

  private async isSQLiteDatabaseFile(filePath: string): Promise<boolean> {
    const handle = await fs.promises.open(filePath, 'r')
    try {
      const headerBuffer = Buffer.alloc(SQLITE_FILE_HEADER.length)
      const { bytesRead } = await handle.read(
        headerBuffer,
        0,
        SQLITE_FILE_HEADER.length,
        0
      )
      if (bytesRead < SQLITE_FILE_HEADER.length) {
        return false
      }
      return headerBuffer.toString('utf8') === SQLITE_FILE_HEADER
    } finally {
      await handle.close()
    }
  }

  private async ensureBackupDir(): Promise<void> {
    try {
      await fs.promises.access(this.backupDir)
    } catch {
      await fs.promises.mkdir(this.backupDir, { recursive: true })
    }
  }

  private escapeSqlitePath(filePath: string): string {
    return filePath.replace(/'/g, "''")
  }

  private async createConsistentBackupFile(destinationPath: string): Promise<number> {
    const normalizedDestinationPath = path.resolve(destinationPath)
    const sqlitePath = this.escapeSqlitePath(normalizedDestinationPath)
    const db = dbService.getDb()

    if (fs.existsSync(normalizedDestinationPath)) {
      await fs.promises.unlink(normalizedDestinationPath)
    }

    // Flush WAL pages first, then create a self-contained backup snapshot.
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.exec(`VACUUM INTO '${sqlitePath}'`)

    const stats = await fs.promises.stat(normalizedDestinationPath)
    return stats.size
  }

  private async cleanupDbSidecars(targetDbPath: string): Promise<void> {
    await Promise.all(
      ['-wal', '-shm'].map(async (suffix) => {
        const sidecarPath = `${targetDbPath}${suffix}`
        try {
          await fs.promises.unlink(sidecarPath)
        } catch (error) {
          const nodeError = error as NodeJS.ErrnoException
          if (nodeError.code !== 'ENOENT') {
            throw error
          }
        }
      })
    )
  }

  /**
   * Create a backup of the database
   */
  async createBackup(): Promise<BackupResult> {
    try {
      this.logInfo('[BACKUP] Starting backup creation...')
      await this.ensureBackupDir()

      // Check if database exists before attempting backup
      try {
        await fs.promises.access(this.dbPath)
      } catch {
        return {
          success: false,
          error: `Database file not found at: ${this.dbPath}`
        }
      }

      const timestamp = new Date().toISOString().replace(/[:-]/g, '').slice(0, 15)
      const backupName = `barkat_${timestamp}.db.bak`
      const backupPath = path.join(this.backupDir, backupName)

      this.logInfo('[BACKUP] Creating backup:', backupPath)

      const size = await this.createConsistentBackupFile(backupPath)

      // Create a metadata file
      const metadataPath = backupPath + '.json'
      const metadata: BackupMetadata = {
        timestamp: new Date().toISOString(),
        dbPath: this.dbPath,
        size,
        version: String(this.BACKUP_FORMAT_VERSION),
        formatVersion: this.BACKUP_FORMAT_VERSION,
        snapshotMethod: this.BACKUP_SNAPSHOT_METHOD
      }
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2))

      // Cleanup old backups
      await this.cleanupOldBackups()

      return {
        success: true,
        backupPath,
        timestamp,
        size
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: `Backup failed: ${message}`
      }
    }
  }

  /**
   * Restore from a backup
   * Note: This closes the database connection and requires app restart
   */
  async restoreBackup(backupPath: string): Promise<BackupResult & { requiresRestart?: boolean; criticalFailure?: boolean }> {
    let dbWasClosed = false
    try {
      // Validate backup file exists
      try {
        await fs.promises.access(backupPath)
      } catch {
        return { success: false, error: 'Backup file not found' }
      }

      const isValidBackupFile = await this.isSQLiteDatabaseFile(backupPath)
      if (!isValidBackupFile) {
        return {
          success: false,
          error:
            'Selected file is not a valid Barkat backup or SQLite database file'
        }
      }

      // Create a safety backup of current DB
      const safetyBackup = await this.createBackup()
      if (!safetyBackup.success) {
        return { success: false, error: `Safety backup failed: ${safetyBackup.error}` }
      }

      // Close DB connection before restore (required on Windows to release file lock)
      this.logInfo('[BACKUP] Closing database connection for restore...')
      dbService.close()
      dbWasClosed = true

      // Wait a moment to ensure connection is fully closed
      await new Promise((resolve) => setTimeout(resolve, this.RESTORE_DELAY_MS))

      await this.cleanupDbSidecars(this.dbPath)

      // Restore the backup file
      const result = await copyFileAsync(backupPath, this.dbPath)
      if (!result.success) {
        return { success: false, error: result.error }
      }

      dbService.reopenConnection()
      dbWasClosed = false

      return {
        success: true,
        backupPath: this.dbPath,
        timestamp: new Date().toISOString(),
        size: result.size
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (dbWasClosed) {
        try {
          dbService.reopenConnection()
          dbWasClosed = false
          return {
            success: false,
            error: `Restore failed: ${message}. Database connection was reopened; please verify your data before continuing.`
          }
        } catch (reopenError) {
          const reopenMessage =
            reopenError instanceof Error ? reopenError.message : String(reopenError)
          this.logError(
            '[BACKUP] Database was closed, restore failed, and reopen also failed:',
            message,
            reopenMessage
          )
          return {
            success: false,
            error: `Restore failed: ${message}. CRITICAL: Database connection could not be reopened (${reopenMessage}). Application restart required.`,
            requiresRestart: true,
            criticalFailure: true
          }
        }
      }
      return {
        success: false,
        error: `Restore failed: ${message}`
      }
    }
  }

  async exportBackup(destinationPath: string): Promise<BackupResult> {
    try {
      if (!destinationPath) {
        return { success: false, error: 'Destination path is required' }
      }

      const normalizedDestinationPath = this.normalizeExportPath(destinationPath)

      const backupResult = await this.createBackup()
      if (!backupResult.success || !backupResult.backupPath) {
        return {
          success: false,
          error: backupResult.error || 'Failed to create temporary backup'
        }
      }

      const result = await copyFileAsync(backupResult.backupPath, normalizedDestinationPath)
      if (!result.success) {
        return {
          success: false,
          error: result.error
        }
      }

        return {
          success: true,
          backupPath: normalizedDestinationPath,
          size: result.size,
          timestamp: new Date().toISOString()
        }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: `Export failed: ${message}`
      }
    }
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<Array<{
    name: string
    path: string
    timestamp: string
    size: number
    formatVersion?: number
    snapshotMethod?: string
    isVerifiedSnapshot: boolean
  }>> {
    try {
      const files = await fs.promises.readdir(this.backupDir)
      const results = await Promise.all(
        files
          .filter((f) => f.endsWith('.db.bak'))
          .map(async (f) => {
            const fullPath = path.join(this.backupDir, f)
            const stat = await fs.promises.stat(fullPath)
            const metadataPath = fullPath + '.json'
            let timestamp = ''
            let formatVersion: number | undefined
            let snapshotMethod: string | undefined
            try {
              await fs.promises.access(metadataPath)
              const metadata = JSON.parse(
                await fs.promises.readFile(metadataPath, 'utf-8')
              ) as BackupMetadata
              timestamp = metadata.timestamp
              formatVersion = metadata.formatVersion
              snapshotMethod = metadata.snapshotMethod
            } catch {
              timestamp = new Date(stat.mtimeMs).toISOString()
            }
            if (!timestamp) {
              timestamp = new Date(stat.mtimeMs).toISOString()
            }
            return {
              name: f,
              path: fullPath,
              timestamp,
              size: stat.size,
              formatVersion,
              snapshotMethod,
              isVerifiedSnapshot:
                typeof formatVersion === 'number' &&
                formatVersion >= this.BACKUP_FORMAT_VERSION &&
                snapshotMethod === this.BACKUP_SNAPSHOT_METHOD
            }
          })
      )
      return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    } catch (error) {
      this.logError('Error listing backups:', error)
      return []
    }
  }

  /**
   * Cleanup old backups based on retention policy
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backups = await this.listBackups()

      // Remove by count
      if (backups.length > this.config.maxBackups) {
        for (let i = this.config.maxBackups; i < backups.length; i++) {
          await deleteFileAsync(backups[i].path)
          const metadataPath = backups[i].path + '.json'
          try {
            await fs.promises.access(metadataPath)
            await deleteFileAsync(metadataPath)
          } catch {
            // Metadata doesn't exist, ignore
          }
        }
      }

      // Remove by age
      const cutoffTime = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000
      for (const backup of backups) {
        if (new Date(backup.timestamp).getTime() < cutoffTime) {
          await deleteFileAsync(backup.path)
          const metadataPath = backup.path + '.json'
          try {
            await fs.promises.access(metadataPath)
            await deleteFileAsync(metadataPath)
          } catch {
            // Metadata doesn't exist, ignore
          }
        }
      }
    } catch (error) {
      this.logError('Error cleaning up backups:', error)
    }
  }

  /**
   * Enable automatic backups
   */
  startAutoBackup(intervalDays: number = 7): void {
    if (this.scheduleId) {
      clearInterval(this.scheduleId)
    }

    this.config.intervalDays = intervalDays
    const intervalMs = intervalDays * 24 * 60 * 60 * 1000

    // Run first backup immediately (async, non-blocking)
    this.createBackup().catch((e) => this.logError('Initial backup failed:', e))

    // Then schedule recurring backups
    this.scheduleId = setInterval(() => {
      this.createBackup().catch((e) => this.logError('Scheduled backup failed:', e))
    }, intervalMs)
  }

  /**
   * Disable automatic backups
   */
  stopAutoBackup(): void {
    if (this.scheduleId) {
      clearInterval(this.scheduleId)
      this.scheduleId = null
    }
  }

  /**
   * Get backup configuration
   */
  getConfig(): BackupConfig {
    return { ...this.config }
  }

  /**
   * Update backup configuration
   */
  updateConfig(partial: Partial<BackupConfig>): void {
    this.config = { ...this.config, ...partial }
  }
}

export const backupService = new BackupService()
