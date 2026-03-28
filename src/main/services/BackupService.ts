/**
 * Automated database backup service
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { copyFileAsync, deleteFileAsync } from '../utils/fileAsync'
import { dbService } from '../db/database'

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

class BackupService {
  private backupDir = path.join(app.getPath('userData'), 'backups')
  private dbPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'barkat.db')
    : path.join(__dirname, '../../barkat.db')
  private readonly RESTORE_DELAY_MS = 100
  private config: BackupConfig = {
    enabled: true,
    intervalDays: 7,
    maxBackups: 10,
    retentionDays: 90
  }
  private scheduleId: NodeJS.Timeout | null = null

  constructor() {
    // Use electron-log if available, fallback to console
    const log = (global as { log?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void } }).log || console
    log.info?.('[BACKUP] Backup service initialized') ?? console.log('[BACKUP] Backup service initialized')
    log.info?.(`[BACKUP] Database path: ${this.dbPath}`) ?? console.log(`[BACKUP] Database path: ${this.dbPath}`)
    log.info?.(`[BACKUP] Backup directory: ${this.backupDir}`) ?? console.log(`[BACKUP] Backup directory: ${this.backupDir}`)
  }

  private async ensureBackupDir(): Promise<void> {
    try {
      await fs.promises.access(this.backupDir)
    } catch {
      await fs.promises.mkdir(this.backupDir, { recursive: true })
    }
  }

  /**
   * Create a backup of the database
   */
  async createBackup(): Promise<BackupResult> {
    try {
      console.log('[BACKUP] Starting backup creation...')
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

      const timestamp = new Date().toISOString().replace(/[:\-]/g, '').slice(0, 15)
      const backupName = `barkat_${timestamp}.db.bak`
      const backupPath = path.join(this.backupDir, backupName)

      console.log('[BACKUP] Creating backup:', backupPath)

      // Copy the DB file
      const result = await copyFileAsync(this.dbPath, backupPath)
      if (!result.success) {
        return { success: false, error: result.error }
      }

      // Create a metadata file
      const metadataPath = backupPath + '.json'
      const metadata = {
        timestamp: new Date().toISOString(),
        dbPath: this.dbPath,
        size: result.size,
        version: '1'
      }
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2))

      // Cleanup old backups
      await this.cleanupOldBackups()

      return {
        success: true,
        backupPath,
        timestamp,
        size: result.size
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

      // Create a safety backup of current DB
      const safetyBackup = await this.createBackup()
      if (!safetyBackup.success) {
        return { success: false, error: `Safety backup failed: ${safetyBackup.error}` }
      }

      // Close DB connection before restore (required on Windows to release file lock)
      const log = (global as { log?: { info: (...args: unknown[]) => void } }).log || console
      log.info?.('[BACKUP] Closing database connection for restore...') ?? console.log('[BACKUP] Closing database connection for restore...')
      dbService.close()
      dbWasClosed = true

      // Wait a moment to ensure connection is fully closed
      await new Promise((resolve) => setTimeout(resolve, this.RESTORE_DELAY_MS))

      // Restore the backup file
      const result = await copyFileAsync(backupPath, this.dbPath)
      if (!result.success) {
        return { success: false, error: result.error }
      }

      // Verify integrity (optional: run PRAGMA integrity_check)
      return {
        success: true,
        backupPath: this.dbPath,
        timestamp: new Date().toISOString(),
        size: result.size,
        requiresRestart: true
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // If DB was closed but restore failed, we can't recover here - requires manual intervention
      if (dbWasClosed) {
        const logErr = (global as { log?: { error: (...args: unknown[]) => void } }).log || { error: (...args: unknown[]) => console.error(...args) }
        logErr.error?.('[BACKUP] Database was closed but restore failed. Manual restart required:', message) ?? console.error('[BACKUP] Database was closed but restore failed. Manual restart required:', message)
        return {
          success: false,
          error: `Restore failed: ${message}. CRITICAL: Database connection was closed. Application restart required.`,
          requiresRestart: true,
          criticalFailure: true
        }
      }
      return {
        success: false,
        error: `Restore failed: ${message}`
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
            try {
              await fs.promises.access(metadataPath)
              const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf-8'))
              timestamp = metadata.timestamp
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
              size: stat.size
            }
          })
      )
      return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    } catch (error) {
      const logErr = (global as { log?: { error: (msg: string, err: unknown) => void } }).log || { error: (msg: string) => console.error(msg) }
      logErr.error?.('Error listing backups:', error) ?? console.error('Error listing backups:', error)
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
      console.error('Error cleaning up backups:', error)
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
    this.createBackup().catch((e) => console.error('Initial backup failed:', e))

    // Then schedule recurring backups
    this.scheduleId = setInterval(() => {
      this.createBackup().catch((e) => console.error('Scheduled backup failed:', e))
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
