import React, { useState } from 'react'
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

const Settings: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [repairResults, setRepairResults] = useState<DatabaseRepairResult | null>(null)
  const [isRepairModalOpen, setIsRepairModalOpen] = useState(false)

  const handleExport = async (): Promise<void> => {
    try {
      setLoading(true)
      const result = await window.api.backup.createBackup()

      if (result.success) {
        message.success(`Database exported successfully to: ${result.backupPath}`)
      } else {
        message.error(`Export failed: ${result.error}`)
      }
    } catch (err: unknown) {
      const error = err as Error
      message.error('Export failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      const result = await window.api.dialog.selectLocalFile({
        title: 'Select Database Backup File',
        filters: [
          { name: 'Database Files', extensions: ['db', 'sqlite', 'backup'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result) {
        setLoading(true)
        const importResult = await window.api.backup.restoreBackup(result)

        if (importResult.success) {
          message.success('Database imported successfully. Please restart the application.')
        } else {
          message.error(`Import failed: ${importResult.error}`)
        }
      }
    } catch (err: unknown) {
      const error = err as Error
      message.error('Import failed: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDatabaseRepair = async (): Promise<void> => {
    setLoading(true)
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
      setLoading(false)
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
          </div>
          <Space className="responsive-action-bar">
            <Tag color="green" icon={<DatabaseOutlined />}>Local SQLite</Tag>
            <Tag color="blue">Desktop App</Tag>
          </Space>
        </div>
      </div>

      <div className="page-info-grid">
        <Card title="Export Database" className="page-action-card">
          <Paragraph>
            Download a backup copy before migrations, system changes, or moving to another machine.
          </Paragraph>
          <Button icon={<DownloadOutlined />} onClick={handleExport} loading={loading}>
            Backup Database
          </Button>
        </Card>

        <Card title="Restore Backup" className="page-action-card">
          <Paragraph>
            Restore a previously exported backup file to recover or move your workspace data.
          </Paragraph>
          <Button icon={<UploadOutlined />} onClick={handleImport} loading={loading}>
            Restore from Backup
          </Button>
        </Card>

        <Card title="Repair Database" className="page-action-card">
          <Paragraph>
            Run integrity checks and repair common foreign-key or relational consistency issues.
          </Paragraph>
          <Button icon={<ToolOutlined />} onClick={handleDatabaseRepair} loading={loading}>
            Check & Repair
          </Button>
        </Card>
      </div>

      <Card title="System Diagnostics" className="page-toolbar-card">
        <div className="page-soft-panel">
          <Space direction="vertical">
            <Text>Version: 1.0.0</Text>
            <Text>Database Type: SQLite 3 (better-sqlite3)</Text>
            <Text>Environment: Desktop Application (Electron)</Text>
            <Alert
              message="Foreign Key Support"
              description="Foreign key constraints are enabled to ensure data integrity."
              type="success"
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

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <Text type="secondary">Designed for property maintenance management.</Text>
      </div>
    </div>
  )
}

export default Settings
