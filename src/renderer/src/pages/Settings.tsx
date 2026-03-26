import React, { useState } from 'react'
import { Card, Button, Typography, Space, Divider, message, Alert, Modal, List } from 'antd'
import { DownloadOutlined, UploadOutlined, ToolOutlined } from '@ant-design/icons'

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
    <div style={{ maxWidth: 800 }}>
      <Title level={2}>System Settings</Title>

      <Card title="Data Management" style={{ marginBottom: 24 }}>
        <Paragraph>
          Manage your local database. All data is stored locally on your machine.
        </Paragraph>

        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Title level={5}>Export Database</Title>
            <Text type="secondary">
              Download a copy of your database for backup or moving to another machine.
            </Text>
            <div style={{ marginTop: 8 }}>
              <Button icon={<DownloadOutlined />} onClick={handleExport}>
                Backup Database
              </Button>
            </div>
          </div>

          <Divider />

          <div>
            <Title level={5}>Import Data</Title>
            <Text type="secondary">Restore data from a previously exported backup file.</Text>
            <div style={{ marginTop: 8 }}>
              <Button icon={<UploadOutlined />} onClick={handleImport} loading={loading}>
                Restore from Backup
              </Button>
            </div>
          </div>

          <Divider />

          <div>
            <Title level={5}>Database Tools</Title>
            <Text type="secondary">
              Check for data integrity issues and repair common database errors.
            </Text>
            <div style={{ marginTop: 8 }}>
              <Button icon={<ToolOutlined />} onClick={handleDatabaseRepair} loading={loading}>
                Check & Repair Database
              </Button>
            </div>
          </div>
        </Space>
      </Card>

      <Card title="System Diagnostics" style={{ marginBottom: 24 }}>
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
      </Card>

      <Modal
        title="Database Check Results"
        open={isRepairModalOpen}
        onOk={() => setIsRepairModalOpen(false)}
        onCancel={() => setIsRepairModalOpen(false)}
        width={700}
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
