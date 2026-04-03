import React, { useEffect, useState } from 'react'
import { Card, Button, Typography, Space, Divider, Alert, Modal, List, Tag } from 'antd'
import { DownloadOutlined, UploadOutlined, ToolOutlined, DatabaseOutlined } from '@ant-design/icons'
import { appMessage as message } from '../utils/appMessage'

const { Title, Paragraph, Text } = Typography

type DatabaseRepairResult = {
  success: boolean
  violations: {
    table: string
    rowid: number
    parent: string
    fkid: number
  }[]
  logs: string[]
}

type BackupConfigState = {
  enabled: boolean
  intervalDays: number
}

type BackupListItem = {
  name: string
  path: string
  timestamp: string
  size: number
  formatVersion?: number
  snapshotMethod?: string
  isVerifiedSnapshot: boolean
}

type AppInfo = {
  version: string
  isPackaged: boolean
  platform: string
}

const Settings: React.FC = () => {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true)
  const [repairResults, setRepairResults] = useState<DatabaseRepairResult | null>(null)
  const [isRepairModalOpen, setIsRepairModalOpen] = useState(false)
  const [backupConfig, setBackupConfig] = useState<BackupConfigState | null>(null)
  const [backups, setBackups] = useState<BackupListItem[]>([])
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const latestBackup = backups[0]
  const verifiedBackupCount = backups.filter((backup) => backup.isVerifiedSnapshot).length

  const loadDiagnostics = async (): Promise<void> => {
    setDiagnosticsLoading(true)
    try {
      const [config, backupList, info] = await Promise.all([
        window.api.backup.getConfig(),
        window.api.backup.listBackups(),
        window.api.system.getAppInfo()
      ])
      setBackupConfig(config)
      setBackups(backupList)
      setAppInfo(info)
    } catch (error) {
      console.error('Failed to load settings diagnostics:', error)
      message.error('Failed to load system diagnostics')
    } finally {
      setDiagnosticsLoading(false)
    }
  }

  useEffect(() => {
    void loadDiagnostics()
  }, [])

  const handleExport = async (): Promise<void> => {
    try {
      setExporting(true)

      const defaultFileName = await window.api.backup.getExportDefaultName()

      const savePath = await window.api.dialog.saveFile({
        title: 'Export Barkat Backup',
        defaultPath: defaultFileName,
        filters: [
          { name: 'Barkat Backup Files', extensions: ['barkatbackup'] },
          { name: 'SQLite Database Files', extensions: ['db', 'sqlite', 'backup'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (!savePath) {
        message.info('Export cancelled')
        return
      }

      const result = await window.api.backup.exportBackup(savePath)
      if (!result.success || !result.backupPath) {
        message.error(`Export failed: ${result.error}`)
        return
      }

      message.success('Backup exported successfully')
      void loadDiagnostics()
    } catch (err: unknown) {
      const error = err as Error
      message.error('Export failed: ' + error.message)
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      setImporting(true)
      const result = await window.api.dialog.selectLocalFile({
        title: 'Select Barkat Backup File',
        filters: [
          { name: 'Barkat Backup Files', extensions: ['barkatbackup'] },
          { name: 'SQLite Database Files', extensions: ['db', 'sqlite', 'backup'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result) {
        const importResult = await window.api.backup.restoreBackup(result)

        if (importResult.success) {
          await loadDiagnostics()
          message.success(
            importResult.requiresRestart
              ? 'Database imported successfully. Restart is required to complete restore.'
              : 'Database imported successfully. Refreshing workspace...'
          )
          if (!importResult.requiresRestart) {
            window.setTimeout(() => {
              window.location.reload()
            }, 400)
          }
        } else {
          message.error(`Import failed: ${importResult.error}`)
        }
      }
    } catch (err: unknown) {
      const error = err as Error
      message.error('Import failed: ' + error.message)
    } finally {
      setImporting(false)
    }
  }

  const handleDatabaseRepair = async (): Promise<void> => {
    setRepairing(true)
    try {
      const results = await window.api.database.repair()
      setRepairResults(results)
      setIsRepairModalOpen(true)
      if (results.success) {
        message.success('Database check completed')
      } else {
        message.error('Database repair failed')
      }
    } catch (err: unknown) {
      const error = err as Error
      message.error('Database repair failed: ' + error.message)
    } finally {
      setRepairing(false)
    }
  }

  return (
    <div className="page-screen" style={{ maxWidth: 1100 }}>
      <div className="page-hero">
        <div className="responsive-page-header">
          <div>
            <Title level={2} style={{ margin: 0 }}>System Settings</Title>
            <Text type="secondary" className="page-hero-subtitle">
              Manage backups, recovery, and database health for this desktop workspace.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Use backup first, then restore or repair only when you need recovery or integrity checks.
            </Text>
          </div>
          <Space className="responsive-action-bar">
            <Tag color="green" icon={<DatabaseOutlined />}>Local SQLite</Tag>
            <Tag color="blue">Desktop App</Tag>
          </Space>
        </div>
      </div>

        <div className="page-info-grid">
          <Card title="Export Backup" className="page-action-card">
            <Paragraph>
              Export a clean single-file Barkat backup before migrations, moving to another machine, or recovery work.
            </Paragraph>
            <Text type="secondary" className="page-helper-text">
              Recommended format: <strong>.barkatbackup</strong>. Older SQLite backup files can still be restored.
            </Text>
            <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exporting}>
              Export Backup File
            </Button>
          </Card>

          <Card title="Restore Backup" className="page-action-card">
            <Paragraph>
              Restore a previously exported Barkat backup file when you need to recover an older copy of your workspace data.
            </Paragraph>
          <Text type="secondary" className="page-helper-text">
            This replaces the current local database with the selected backup file.
          </Text>
          <Button icon={<UploadOutlined />} onClick={handleImport} loading={importing}>
            Restore from Backup
          </Button>
        </Card>

        <Card title="Repair Data" className="page-action-card">
          <Paragraph>
            Check the local database for broken links or consistency problems and try to repair common issues.
          </Paragraph>
          <Text type="secondary" className="page-helper-text">
            Use this only when records look inconsistent, or after a failed import or restore.
          </Text>
          <Button icon={<ToolOutlined />} onClick={handleDatabaseRepair} loading={repairing}>
            Check & Repair
          </Button>
        </Card>
      </div>

      <Card title="System Diagnostics" className="page-toolbar-card settings-diagnostics-card">
        <div className="page-soft-panel">
          <Space orientation="vertical">
            <Text>Version: {appInfo?.version || 'Loading...'}</Text>
            <Text>Database Type: SQLite 3 (better-sqlite3)</Text>
            <Text>
              Environment:{' '}
              {appInfo
                ? appInfo.isPackaged
                  ? `Production Desktop App (${appInfo.platform})`
                  : `Development Desktop App (${appInfo.platform})`
                : 'Loading...'}
            </Text>
            <Text>
              Auto Backup:{' '}
              {backupConfig
                ? backupConfig.enabled
                  ? `Enabled every ${backupConfig.intervalDays} day(s)`
                  : 'Disabled'
                : 'Loading...'}
            </Text>
            <Text>Available Backups: {diagnosticsLoading ? 'Loading...' : backups.length}</Text>
            <Text>
              Verified Safe Backups:{' '}
              {diagnosticsLoading ? 'Loading...' : `${verifiedBackupCount} of ${backups.length}`}
            </Text>
            <Alert
              title="Backup Readiness"
              description={
                diagnosticsLoading
                  ? 'Loading backup status...'
                  : latestBackup
                    ? latestBackup.isVerifiedSnapshot
                      ? `Latest backup available: ${new Date(latestBackup.timestamp).toLocaleString()}. This backup was created from a verified live SQLite snapshot.`
                      : `Latest backup available: ${new Date(latestBackup.timestamp).toLocaleString()}. This is a legacy backup; restore is supported, but newer verified backups are safer.`
                    : 'No backups found yet. Export a backup before doing restores or major data operations.'
              }
              type={latestBackup ? (latestBackup.isVerifiedSnapshot ? 'success' : 'warning') : 'warning'}
              showIcon
            />
            {!diagnosticsLoading && backups.length > 0 && (
              <div>
                <Text strong>Recent Backups</Text>
                <List
                  size="small"
                  style={{ marginTop: 8 }}
                  dataSource={backups.slice(0, 3)}
                  renderItem={(item) => (
                    <List.Item>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <span>{new Date(item.timestamp).toLocaleString()}</span>
                        <Tag color={item.isVerifiedSnapshot ? 'green' : 'gold'}>
                          {item.isVerifiedSnapshot ? 'Verified Backup' : 'Legacy Backup'}
                        </Tag>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Space>
        </div>
      </Card>

      <Modal
        title="Database Check Results"
        open={isRepairModalOpen}
        onOk={() => setIsRepairModalOpen(false)}
        onCancel={() => setIsRepairModalOpen(false)}
        width={700}
        className="mobile-fullscreen-modal"
      >
        {repairResults && (
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            <Alert
              title={repairResults.success ? 'Success' : 'Issues Found'}
              type={repairResults.success ? 'success' : 'warning'}
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Title level={5}>Foreign Key Violations</Title>
            {repairResults.violations && repairResults.violations.length > 0 ? (
              <List
                size="small"
                bordered
                dataSource={repairResults.violations}
                renderItem={(item) => (
                  <List.Item>
                    <Text type="danger">
                      Violation in table <b>{item.table}</b> at row <b>{item.rowid}</b>: Missing
                      parent in table <b>{item.parent}</b>
                    </Text>
                  </List.Item>
                )}
              />
            ) : (
              <Text type="success">No violations found.</Text>
            )}

            <Divider />

            <Title level={5}>System Logs</Title>
            <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: '11px' }}>
              {repairResults.logs.join('\n')}
            </pre>
          </div>
        )}
      </Modal>

      <div className="settings-footer-note" style={{ marginTop: 24, textAlign: 'center' }}>
        <Text type="secondary">Designed for property maintenance management.</Text>
      </div>
    </div>
  )
}

export default Settings
