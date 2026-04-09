/**
 * Automated database backup service
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { copyFileAsync, deleteFileAsync } from '../utils/fileAsync'
import { dbService } from '../db/database'
import { getUserDataPath } from '../utils/runtimePaths'

const SQLITE_FILE_HEADER = 'SQLite format 3\u0000'
const ZIP_FILE_HEADER = 'PK'
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

type WorkspaceBackupManifest = {
  type: 'workspace-package'
  appName: 'Barkat'
  timestamp: string
  formatVersion: number
  databaseFile: string
  includedDirectories: string[]
}

type WorkspaceDirectoryTarget = {
  archiveName: string
  absolutePath: string
}

type RestoreRollbackEntry = {
  targetPath: string
  rollbackPath?: string
}

class BackupService {
  private readonly BACKUP_FORMAT_VERSION = 2
  private readonly BACKUP_SNAPSHOT_METHOD = 'sqlite-vacuum-into'
  private readonly WORKSPACE_PACKAGE_FORMAT_VERSION = 1
  private readonly WORKSPACE_PACKAGE_TYPE = 'workspace-package'
  private readonly WORKSPACE_DATABASE_FILE = path.join('database', 'barkat.sqlite')
  private backupDir = path.join(getUserDataPath(), 'backups')
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

  private supportsWorkspacePackages(): boolean {
    return process.platform === 'win32'
  }

  private escapePowerShellLiteral(value: string): string {
    return value.replace(/'/g, "''")
  }

  private async runPowerShell(script: string): Promise<void> {
    if (!this.supportsWorkspacePackages()) {
      throw new Error('Workspace backup packages are currently supported on Windows only')
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(stderr?.trim() || error.message))
            return
          }
          resolve()
        }
      )
    })
  }

  private async createArchiveFromDirectory(sourceDir: string, destinationZipPath: string): Promise<void> {
    const sourcePattern = this.escapePowerShellLiteral(path.join(sourceDir, '*'))
    const destinationLiteral = this.escapePowerShellLiteral(destinationZipPath)
    const script = `Compress-Archive -Path '${sourcePattern}' -DestinationPath '${destinationLiteral}' -Force`
    await this.runPowerShell(script)
  }

  private async extractArchiveToDirectory(archivePath: string, destinationDir: string): Promise<void> {
    const archiveLiteral = this.escapePowerShellLiteral(archivePath)
    const destinationLiteral = this.escapePowerShellLiteral(destinationDir)
    const script = `Expand-Archive -LiteralPath '${archiveLiteral}' -DestinationPath '${destinationLiteral}' -Force`
    await this.runPowerShell(script)
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

  private async isZipArchive(filePath: string): Promise<boolean> {
    const handle = await fs.promises.open(filePath, 'r')
    try {
      const headerBuffer = Buffer.alloc(ZIP_FILE_HEADER.length)
      const { bytesRead } = await handle.read(headerBuffer, 0, ZIP_FILE_HEADER.length, 0)
      if (bytesRead < ZIP_FILE_HEADER.length) {
        return false
      }
      return headerBuffer.toString('utf8') === ZIP_FILE_HEADER
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

  private getWorkspaceDirectoryTargets(): WorkspaceDirectoryTarget[] {
    const userDataPath = getUserDataPath()
    return [
      { archiveName: 'assets', absolutePath: path.join(userDataPath, 'assets') },
      {
        archiveName: 'maintenance-letters',
        absolutePath: path.join(userDataPath, 'maintenance-letters')
      },
      { archiveName: 'receipts', absolutePath: path.join(userDataPath, 'receipts') }
    ]
  }

  private async ensureEmptyDirectory(targetPath: string): Promise<void> {
    await fs.promises.mkdir(targetPath, { recursive: true })
  }

  private async removePathIfExists(targetPath: string): Promise<void> {
    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true })
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT') {
        throw error
      }
    }
  }

  private async cleanupRollbackDirectories(entries: RestoreRollbackEntry[]): Promise<void> {
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.rollbackPath) {
          await this.removePathIfExists(entry.rollbackPath)
        }
      })
    )
  }

  private async restoreRollbackDirectories(entries: RestoreRollbackEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.removePathIfExists(entry.targetPath)
      if (entry.rollbackPath && fs.existsSync(entry.rollbackPath)) {
        await fs.promises.rename(entry.rollbackPath, entry.targetPath)
      }
    }
  }

  private async createWorkspacePackage(destinationPath: string): Promise<BackupResult> {
    const normalizedDestinationPath = this.normalizeExportPath(destinationPath)
    const tempRoot = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'barkat-workspace-'))

    try {
      const packageRoot = path.join(tempRoot, 'package')
      const databaseDir = path.join(packageRoot, 'database')
      const stagedZipPath = path.join(tempRoot, 'workspace.zip')
      const timestamp = new Date().toISOString()

      await fs.promises.mkdir(databaseDir, { recursive: true })
      await this.createConsistentBackupFile(path.join(packageRoot, this.WORKSPACE_DATABASE_FILE))

      for (const directoryTarget of this.getWorkspaceDirectoryTargets()) {
        const packageDirectory = path.join(packageRoot, directoryTarget.archiveName)
        if (fs.existsSync(directoryTarget.absolutePath)) {
          await fs.promises.cp(directoryTarget.absolutePath, packageDirectory, { recursive: true })
        } else {
          await this.ensureEmptyDirectory(packageDirectory)
        }
      }

      const manifest: WorkspaceBackupManifest = {
        type: 'workspace-package',
        appName: 'Barkat',
        timestamp,
        formatVersion: this.WORKSPACE_PACKAGE_FORMAT_VERSION,
        databaseFile: this.WORKSPACE_DATABASE_FILE,
        includedDirectories: this.getWorkspaceDirectoryTargets().map((entry) => entry.archiveName)
      }

      await fs.promises.writeFile(
        path.join(packageRoot, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      )

      await this.createArchiveFromDirectory(packageRoot, stagedZipPath)

      const copyResult = await copyFileAsync(stagedZipPath, normalizedDestinationPath)
      if (!copyResult.success) {
        return {
          success: false,
          error: copyResult.error || 'Failed to write workspace backup package'
        }
      }

      return {
        success: true,
        backupPath: normalizedDestinationPath,
        timestamp,
        size: copyResult.size
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: `Export failed: ${message}`
      }
    } finally {
      await this.removePathIfExists(tempRoot)
    }
  }

  private async restoreLegacyDatabaseBackup(
    backupPath: string
  ): Promise<BackupResult & { requiresRestart?: boolean; criticalFailure?: boolean }> {
    let dbWasClosed = false
    let safetyBackupPath: string | undefined

    try {
      const safetyBackup = await this.createBackup()
      if (!safetyBackup.success || !safetyBackup.backupPath) {
        return { success: false, error: `Safety backup failed: ${safetyBackup.error}` }
      }
      safetyBackupPath = safetyBackup.backupPath

      this.logInfo('[BACKUP] Closing database connection for restore...')
      dbService.close()
      dbWasClosed = true

      await new Promise((resolve) => setTimeout(resolve, this.RESTORE_DELAY_MS))
      await this.cleanupDbSidecars(this.dbPath)

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
          if (safetyBackupPath) {
            await this.cleanupDbSidecars(this.dbPath)
            await copyFileAsync(safetyBackupPath, this.dbPath)
          }
          dbService.reopenConnection()
          dbWasClosed = false
          return {
            success: false,
            error: `Restore failed: ${message}. Previous database snapshot was restored.`
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

  private async restoreWorkspacePackage(
    backupPath: string
  ): Promise<BackupResult & { requiresRestart?: boolean; criticalFailure?: boolean }> {
    let dbWasClosed = false
    let safetyBackupPath: string | undefined
    let tempRoot: string | null = null
    const rollbackEntries: RestoreRollbackEntry[] = []

    try {
      if (!this.supportsWorkspacePackages()) {
        return {
          success: false,
          error: 'Workspace backup packages are currently supported on Windows only'
        }
      }

      tempRoot = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'barkat-restore-'))
      const tempArchivePath = path.join(tempRoot, 'workspace-package.zip')
      const extractedRoot = path.join(tempRoot, 'extracted')

      const archiveCopyResult = await copyFileAsync(backupPath, tempArchivePath)
      if (!archiveCopyResult.success) {
        return { success: false, error: archiveCopyResult.error }
      }

      await this.extractArchiveToDirectory(tempArchivePath, extractedRoot)

      const manifestPath = path.join(extractedRoot, 'manifest.json')
      const manifest = JSON.parse(
        await fs.promises.readFile(manifestPath, 'utf8')
      ) as WorkspaceBackupManifest

      if (
        manifest.type !== this.WORKSPACE_PACKAGE_TYPE ||
        manifest.formatVersion !== this.WORKSPACE_PACKAGE_FORMAT_VERSION
      ) {
        return {
          success: false,
          error: 'Selected file is not a supported Barkat workspace backup package'
        }
      }

      const extractedDatabasePath = path.join(extractedRoot, manifest.databaseFile)
      await fs.promises.access(extractedDatabasePath)

      const safetyBackup = await this.createBackup()
      if (!safetyBackup.success || !safetyBackup.backupPath) {
        return { success: false, error: `Safety backup failed: ${safetyBackup.error}` }
      }
      safetyBackupPath = safetyBackup.backupPath

      this.logInfo('[BACKUP] Closing database connection for workspace restore...')
      dbService.close()
      dbWasClosed = true

      await new Promise((resolve) => setTimeout(resolve, this.RESTORE_DELAY_MS))
      await this.cleanupDbSidecars(this.dbPath)

      const restoreToken = `restore-backup-${Date.now()}`
      for (const directoryTarget of this.getWorkspaceDirectoryTargets()) {
        const rollbackPath = `${directoryTarget.absolutePath}.${restoreToken}`
        const extractedDirectoryPath = path.join(extractedRoot, directoryTarget.archiveName)

        if (fs.existsSync(directoryTarget.absolutePath)) {
          await this.removePathIfExists(rollbackPath)
          await fs.promises.rename(directoryTarget.absolutePath, rollbackPath)
          rollbackEntries.push({
            targetPath: directoryTarget.absolutePath,
            rollbackPath
          })
        } else {
          rollbackEntries.push({ targetPath: directoryTarget.absolutePath })
        }

        if (fs.existsSync(extractedDirectoryPath)) {
          await fs.promises.cp(extractedDirectoryPath, directoryTarget.absolutePath, {
            recursive: true
          })
        } else {
          await this.ensureEmptyDirectory(directoryTarget.absolutePath)
        }
      }

      const dbCopyResult = await copyFileAsync(extractedDatabasePath, this.dbPath)
      if (!dbCopyResult.success) {
        throw new Error(dbCopyResult.error || 'Failed to restore workspace database')
      }

      dbService.reopenConnection()
      dbWasClosed = false

      await this.cleanupRollbackDirectories(rollbackEntries)

      return {
        success: true,
        backupPath: this.dbPath,
        timestamp: manifest.timestamp,
        size: archiveCopyResult.size
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (dbWasClosed) {
        try {
          await this.restoreRollbackDirectories(rollbackEntries)
          if (safetyBackupPath) {
            await this.cleanupDbSidecars(this.dbPath)
            await copyFileAsync(safetyBackupPath, this.dbPath)
          }
          dbService.reopenConnection()
          dbWasClosed = false
          return {
            success: false,
            error: `Restore failed: ${message}. Previous workspace data was restored.`
          }
        } catch (reopenError) {
          const reopenMessage =
            reopenError instanceof Error ? reopenError.message : String(reopenError)
          this.logError(
            '[BACKUP] Workspace restore failed and automatic recovery also failed:',
            message,
            reopenMessage
          )
          return {
            success: false,
            error: `Restore failed: ${message}. CRITICAL: Previous workspace could not be fully recovered (${reopenMessage}). Application restart required.`,
            requiresRestart: true,
            criticalFailure: true
          }
        }
      }

      return {
        success: false,
        error: `Restore failed: ${message}`
      }
    } finally {
      if (tempRoot) {
        await this.removePathIfExists(tempRoot)
      }
    }
  }

  /**
   * Create a backup of the database
   */
  async createBackup(): Promise<BackupResult> {
    try {
      this.logInfo('[BACKUP] Starting backup creation...')
      await this.ensureBackupDir()

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
   * Supports legacy database-only backups and full workspace packages.
   */
  async restoreBackup(
    backupPath: string
  ): Promise<BackupResult & { requiresRestart?: boolean; criticalFailure?: boolean }> {
    try {
      try {
        await fs.promises.access(backupPath)
      } catch {
        return { success: false, error: 'Backup file not found' }
      }

      const isZipBackup = await this.isZipArchive(backupPath)
      if (isZipBackup) {
        return await this.restoreWorkspacePackage(backupPath)
      }

      const isValidBackupFile = await this.isSQLiteDatabaseFile(backupPath)
      if (!isValidBackupFile) {
        return {
          success: false,
          error:
            'Selected file is not a valid Barkat backup. Choose a workspace backup package or legacy SQLite backup file.'
        }
      }

      return await this.restoreLegacyDatabaseBackup(backupPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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

      if (this.supportsWorkspacePackages()) {
        return await this.createWorkspacePackage(destinationPath)
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
  async listBackups(): Promise<
    Array<{
      name: string
      path: string
      timestamp: string
      size: number
      formatVersion?: number
      snapshotMethod?: string
      isVerifiedSnapshot: boolean
    }>
  > {
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
      return results.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
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

    this.createBackup().catch((e) => this.logError('Initial backup failed:', e))

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
