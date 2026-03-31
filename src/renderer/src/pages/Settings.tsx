import React, { useEffect, useState } from 'react'
import { Card, Button, Typography, Space, Divider, message, Alert, Modal, List, Tag } from 'antd'
import { DownloadOutlined, UploadOutlined, ToolOutlined, DatabaseOutlined } from '@ant-design/icons'

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

      const timestamp = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15)
      const defaultFileName = `barkat_backup_${timestamp}.db`

      const savePath = await window.api.dialog.saveFile({
        title: 'Save Database Backup',
        defaultPath: defaultFileName,
        filters: [
          { name: 'Database Files', extensions: ['db'] },
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

      message.success('Database exported successfully')
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
        title: 'Select Database Backup File',
        filters: [
          { name: 'Database Files', extensions: ['db', 'sqlite', 'backup'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result) {
        const importResult = await window.api.backup.restoreBackup(result)

        if (importResult.success) {
          message.success(
            importResult.requiresRestart
              ? 'Database imported successfully. Restart is required to complete restore.'
              : 'Database imported successfully.'
          )
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
        <Card title="Create Backup" className="page-action-card">
          <Paragraph>
            Save a backup copy before major changes, before moving to another machine, or before trying a restore.
          </Paragraph>
          <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exporting}>
            Save Backup Copy
          </Button>
        </Card>

        <Card title="Restore Backup" className="page-action-card">
          <Paragraph>
            Restore a previously saved backup file when you need to recover an older copy of your workspace data.
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
          <Space direction="vertical">
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
            <Alert
              message="Backup Readiness"
              description={
                diagnosticsLoading
                  ? 'Loading backup status...'
                  : backups.length > 0
                    ? `Latest backup available: ${new Date(backups[0].timestamp).toLocaleString()}`
                    : 'No backups found yet. Export a backup before doing restores or major data operations.'
              }
              type={backups.length > 0 ? 'success' : 'warning'}
              showIcon
            />
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
              message={repairResults.success ? 'Success' : 'Issues Found'}
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
