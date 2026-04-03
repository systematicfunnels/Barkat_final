import React, { useState, useMemo, useCallback } from 'react'
import {
  Modal,
  Steps,
  Button,
  Table,
  Alert,
  Tag,
  Space,
  Typography,
  Card,
  Select,
  Upload,
  Progress,
  InputNumber,
  Input,
  Divider,
  Grid
} from 'antd'
import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  FileExcelOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  EditOutlined
} from '@ant-design/icons'
import { appMessage as message } from '../../utils/appMessage'

const { Title, Text, Paragraph } = Typography
const { Option } = Select
const { useBreakpoint } = Grid

export type ImportStep = 'upload' | 'validate' | 'preview' | 'import'

export interface ImportColumn {
  key: string
  label: string
  required?: boolean
  type: 'string' | 'number' | 'select'
  options?: { value: string; label: string }[]
}

export interface ValidationError {
  row: number
  column: string
  message: string
  severity: 'error' | 'warning'
  value?: unknown
}

export interface ImportPreview {
  id: string
  rowNumber: number
  data: Record<string, unknown>
  mappedData: Record<string, unknown>
  errors: ValidationError[]
  warnings: ValidationError[]
  status: 'valid' | 'invalid' | 'warning'
}

export interface ImportWizardProps {
  open: boolean
  onClose: () => void
  onImport: (data: ImportPreview[]) => Promise<void>
  columns: ImportColumn[]
  title?: string
  maxPreviewRows?: number
  uploadAccept?: string
  sampleData?: Record<string, unknown>[]
  onUpload?: (file: File) => Promise<Record<string, unknown>[]>
  onValidate?: (data: Record<string, unknown>[]) => Promise<ValidationError[]>
  onMap?: (data: Record<string, unknown>[]) => Promise<ImportPreview[]>
  loading?: boolean
}

export const ImportWizard: React.FC<ImportWizardProps> = ({
  open,
  onClose,
  onImport,
  columns,
  title = 'Import Data',
  maxPreviewRows = 100,
  uploadAccept = '.xlsx,.xls,.csv',
  sampleData,
  onUpload,
  onValidate,
  onMap,
  loading = false
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [rawData, setRawData] = useState<Record<string, unknown>[]>([])
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [previewData, setPreviewData] = useState<ImportPreview[]>([])
  const [selectedRows, setSelectedRows] = useState<React.Key[]>([])
  const [importProgress, setImportProgress] = useState<number>(0)
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle')
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: ValidationError[] }>({ success: 0, failed: 0, errors: [] })
  const [editingRow, setEditingRow] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, unknown>>({})
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const isTiny = !screens.sm

  const steps = useMemo(() => [
    { title: 'Upload', description: 'Select file' },
    { title: 'Validate', description: 'Check data' },
    { title: 'Preview', description: 'Review & fix' },
    { title: 'Import', description: 'Import data' }
  ], [])

  const handleUpload = useCallback(async (file: File): Promise<boolean> => {
    setUploadedFile(file)
    try {
      let data: Record<string, unknown>[]
      if (onUpload) {
        data = await onUpload(file)
      } else {
        // Default: read as JSON/csv rows
        const text = await file.text()
        data = text.split('\n').slice(1).map((line, i) => ({
          rowNumber: i + 2,
          raw: line
        }))
      }
      setRawData(data.slice(0, maxPreviewRows))
      setCurrentStep(1)
      return false // Prevent auto-upload
    } catch {
      message.error('Failed to read file')
      return false
    }
  }, [onUpload, maxPreviewRows])

  async function handleMap() {
    try {
      let mapped: ImportPreview[]
      if (onMap) {
        mapped = await onMap(rawData)
      } else {
        // Default mapping
        mapped = rawData.map((row, idx) => ({
          id: `row-${idx}`,
          rowNumber: idx + 2,
          data: row,
          mappedData: row,
          errors: validationErrors.filter((e) => e.row === idx + 2 && e.severity === 'error'),
          warnings: validationErrors.filter((e) => e.row === idx + 2 && e.severity === 'warning'),
          status: validationErrors.some((e) => e.row === idx + 2 && e.severity === 'error')
            ? 'invalid'
            : validationErrors.some((e) => e.row === idx + 2)
              ? 'warning'
              : 'valid'
        }))
      }
      setPreviewData(mapped)
      setSelectedRows(mapped.filter((p) => p.status !== 'invalid').map((p) => p.id))
    } catch {
      message.error('Data mapping failed')
    }
  }

  const handleValidate = useCallback(async () => {
    try {
      let errors: ValidationError[] = []
      if (onValidate) {
        errors = await onValidate(rawData)
      } else {
        // Default validation
        errors = rawData.flatMap((row, idx) => {
          const rowErrors: ValidationError[] = []
          columns.forEach((col) => {
            if (col.required && !row[col.key]) {
              rowErrors.push({
                row: idx + 2,
                column: col.key,
                message: `${col.label} is required`,
                severity: 'error'
              })
            }
          })
          return rowErrors
        })
      }
      setValidationErrors(errors)
      
      // Auto-advance if no errors, or go to preview
      if (errors.filter((e) => e.severity === 'error').length === 0) {
        await handleMap()
        setCurrentStep(2)
      } else {
        setCurrentStep(1)
      }
    } catch {
      message.error('Validation failed')
    }
  }, [rawData, columns, onValidate, handleMap])

  const handleImport = useCallback(async () => {
    const validRows = previewData.filter(p => selectedRows.includes(p.id) && p.status !== 'invalid')
    if (validRows.length === 0) {
      message.warning('No valid rows selected for import')
      return
    }

    setImportStatus('importing')
    setImportProgress(0)
    
    try {
      await onImport(validRows)
      setImportStatus('success')
      setImportResults({
        success: validRows.length,
        failed: 0,
        errors: []
      })
    } catch (error) {
      setImportStatus('error')
      setImportResults({
        success: 0,
        failed: validRows.length,
        errors: [{
          row: 0,
          column: 'import',
          message: error instanceof Error ? error.message : 'Import failed',
          severity: 'error'
        }]
      })
    }
  }, [previewData, selectedRows, onImport])

  const handleEditRow = (row: ImportPreview) => {
    setEditingRow(row.id)
    setEditValues({ ...row.mappedData })
  }

  const handleSaveEdit = (rowId: string) => {
    // Re-validate the edited row against column requirements
    const row = previewData.find(p => p.id === rowId)
    if (!row) return

    const newErrors: ValidationError[] = []
    columns.forEach((col) => {
      if (col.required && !editValues[col.key]) {
        newErrors.push({
          row: row.rowNumber,
          column: col.key,
          message: `${col.label} is required`,
          severity: 'error'
        })
      }
    })

    const hasErrors = newErrors.length > 0
    setPreviewData(prev => prev.map(p => 
      p.id === rowId 
        ? { 
            ...p, 
            mappedData: editValues, 
            status: hasErrors ? 'invalid' as const : 'valid' as const, 
            errors: newErrors,
            warnings: []
          }
        : p
    ))
    setEditingRow(null)
    setEditValues({})
  }

  const handleCancelEdit = () => {
    setEditingRow(null)
    setEditValues({})
  }

  const handleStepChange = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step)
    }
  }

  const errorCount = validationErrors.filter(e => e.severity === 'error').length
  const warningCount = validationErrors.filter(e => e.severity === 'warning').length
  const validCount = previewData.filter(p => p.status === 'valid').length
  const invalidCount = previewData.filter(p => p.status === 'invalid').length

  const renderUploadStep = () => (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      <Alert
        title="Supported Formats"
        description="Upload Excel (.xlsx, .xls) or CSV files. Maximum 10,000 rows."
        type="info"
        showIcon
      />
      
      <Upload.Dragger
        accept={uploadAccept}
        beforeUpload={handleUpload}
        showUploadList={false}
        disabled={loading}
      >
        <p className="ant-upload-drag-icon">
          <FileExcelOutlined style={{ fontSize: 48, color: '#52c41a' }} />
        </p>
        <p className="ant-upload-text">Click or drag file to upload</p>
        <p className="ant-upload-hint">
          Supports Excel and CSV files up to 10MB
        </p>
      </Upload.Dragger>

      {uploadedFile && (
        <Card size="small">
          <Space>
            <FileExcelOutlined />
            <Text strong>{uploadedFile.name}</Text>
            <Text type="secondary">({(uploadedFile.size / 1024).toFixed(1)} KB)</Text>
          </Space>
        </Card>
      )}

      {sampleData && (
        <>
          <Divider>Expected Columns</Divider>
          <Space wrap>
            {columns.map(col => (
              <Tag key={col.key} color={col.required ? 'blue' : 'default'}>
                {col.label} {col.required && <span style={{ color: '#ff4d4f' }}>*</span>}
              </Tag>
            ))}
          </Space>
        </>
      )}
    </Space>
  )

  const renderValidateStep = () => (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      <Alert
        title={`Found ${rawData.length} rows`}
        description={`${errorCount} errors, ${warningCount} warnings detected`}
        type={errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'success'}
        showIcon
      />

      {errorCount > 0 && (
        <Card title="Validation Issues" size="small">
          <Table
            size="small"
            dataSource={validationErrors}
            rowKey={(e, i) => `${e.row}-${e.column}-${i}`}
            pagination={false}
            scroll={{ y: 200 }}
            columns={[
              {
                title: 'Row',
                dataIndex: 'row',
                width: 60
              },
              {
                title: 'Column',
                dataIndex: 'column',
                width: 120
              },
              {
                title: 'Issue',
                dataIndex: 'message',
                render: (_, record) => (
                  <Space>
                    {record.severity === 'error' 
                      ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                      : <WarningOutlined style={{ color: '#faad14' }} />
                    }
                    <Text type={record.severity === 'error' ? 'danger' : 'warning'}>
                      {record.message}
                    </Text>
                  </Space>
                )
              }
            ]}
          />
        </Card>
      )}

      <Space>
        <Button onClick={() => setCurrentStep(0)} icon={<ArrowLeftOutlined />}>
          Back
        </Button>
        <Button 
          type="primary" 
          onClick={handleValidate}
          disabled={rawData.length === 0}
        >
          Continue to Preview
        </Button>
      </Space>
    </Space>
  )

  const renderPreviewStep = () => (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      <Alert
        title={`${validCount} valid, ${invalidCount} invalid rows`}
        description="Select rows to import. Click Edit to fix issues."
        type="info"
        showIcon
      />

      <Table
        dataSource={previewData}
        rowKey="id"
        rowSelection={{
          selectedRowKeys: selectedRows,
          onChange: setSelectedRows,
          getCheckboxProps: (record) => ({
            disabled: record.status === 'invalid'
          })
        }}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Status',
            width: 100,
            render: (_, record) => {
              if (record.status === 'valid') {
                return <Tag icon={<CheckCircleOutlined />} color="success">Valid</Tag>
              }
              if (record.status === 'warning') {
                return <Tag icon={<WarningOutlined />} color="warning">Warning</Tag>
              }
              return <Tag icon={<CloseCircleOutlined />} color="error">Invalid</Tag>
            }
          },
          {
            title: 'Row',
            dataIndex: 'rowNumber',
            width: 60
          },
          ...columns.map(col => ({
            title: col.label,
            dataIndex: ['mappedData', col.key],
            key: col.key,
            render: (value: unknown, record: ImportPreview) => {
              const isEditing = editingRow === record.id
              if (isEditing) {
                if (col.type === 'select') {
                  return (
                    <Select
                      value={editValues[col.key] as string}
                      onChange={(v) => setEditValues(prev => ({ ...prev, [col.key]: v }))}
                      style={{ width: 120 }}
                    >
                      {col.options?.map(opt => (
                        <Option key={opt.value} value={opt.value}>{opt.label}</Option>
                      ))}
                    </Select>
                  )
                }
                if (col.type === 'number') {
                  return (
                    <InputNumber
                      value={editValues[col.key] as number}
                      onChange={(v) => setEditValues(prev => ({ ...prev, [col.key]: v }))}
                      style={{ width: 100 }}
                    />
                  )
                }
                return (
                  <Input
                    value={editValues[col.key] as string}
                    onChange={(e) => setEditValues(prev => ({ ...prev, [col.key]: e.target.value }))}
                  />
                )
              }
              return <Text>{String(value ?? '-')}</Text>
            }
          })),
          {
            title: 'Issues',
            width: 200,
            render: (_, record) => (
              <Space orientation="vertical" size="small">
                {record.errors.map((e, i) => (
                  <Text key={i} type="danger" style={{ fontSize: 12 }}>
                    {e.message}
                  </Text>
                ))}
                {record.warnings.map((e, i) => (
                  <Text key={i} type="warning" style={{ fontSize: 12 }}>
                    {e.message}
                  </Text>
                ))}
              </Space>
            )
          },
          {
            title: 'Actions',
            width: 120,
            fixed: 'right',
            render: (_, record) => {
              const isEditing = editingRow === record.id
              if (isEditing) {
                return (
                  <Space>
                    <Button type="primary" size="small" onClick={() => handleSaveEdit(record.id)}>
                      Save
                    </Button>
                    <Button size="small" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                  </Space>
                )
              }
              return (
                <Button 
                  size="small" 
                  icon={<EditOutlined />}
                  onClick={() => handleEditRow(record)}
                  disabled={record.status === 'invalid'}
                >
                  Edit
                </Button>
              )
            }
          }
        ]}
      />

      <Space>
        <Button onClick={() => setCurrentStep(1)} icon={<ArrowLeftOutlined />}>
          Back
        </Button>
        <Button 
          type="primary" 
          onClick={() => setCurrentStep(3)}
          disabled={selectedRows.length === 0}
        >
          Import {selectedRows.length} Rows
        </Button>
      </Space>
    </Space>
  )

  const renderImportStep = () => (
    <Space orientation="vertical" style={{ width: '100%', textAlign: 'center' }} size="large">
      {importStatus === 'importing' && (
        <>
          <Progress percent={importProgress} status="active" />
          <Text>Importing {selectedRows.length} rows...</Text>
        </>
      )}

      {importStatus === 'success' && (
        <>
          <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a' }} />
          <Title level={4}>Import Complete!</Title>
          <Paragraph>
            Successfully imported {importResults.success} rows.
          </Paragraph>
          <Button type="primary" onClick={onClose}>
            Done
          </Button>
        </>
      )}

      {importStatus === 'error' && (
        <>
          <CloseCircleOutlined style={{ fontSize: 64, color: '#ff4d4f' }} />
          <Title level={4}>Import Failed</Title>
          <Paragraph type="danger">
            {importResults.errors[0]?.message || 'Unknown error occurred'}
          </Paragraph>
          <Space>
            <Button onClick={() => setImportStatus('idle')} icon={<ReloadOutlined />}>
              Try Again
            </Button>
            <Button onClick={onClose}>
              Cancel
            </Button>
          </Space>
        </>
      )}

      {importStatus === 'idle' && (
        <>
          <Title level={5}>Ready to Import</Title>
          <Paragraph>
            {selectedRows.length} rows selected for import.
          </Paragraph>
          <Space>
            <Button onClick={() => setCurrentStep(2)} icon={<ArrowLeftOutlined />}>
              Back
            </Button>
            <Button type="primary" onClick={handleImport} loading={loading}>
              Start Import
            </Button>
          </Space>
        </>
      )}
    </Space>
  )

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: return renderUploadStep()
      case 1: return renderValidateStep()
      case 2: return renderPreviewStep()
      case 3: return renderImportStep()
      default: return null
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      width={isMobile ? '100vw' : 960}
      style={{ maxWidth: '95vw', maxHeight: '90vh', top: isMobile ? 0 : 24 }}
      bodyStyle={{ maxHeight: 'calc(90vh - 110px)', overflowY: 'auto' }}
      footer={null}
      destroyOnClose
      className={isMobile ? 'mobile-fullscreen-modal' : undefined}
    >
      <Steps
        current={currentStep}
        items={steps}
        onChange={handleStepChange}
        style={{ marginBottom: 24 }}
        direction={isTiny ? 'vertical' : 'horizontal'}
        size={isMobile ? 'small' : 'default'}
      />
      {renderStepContent()}
    </Modal>
  )
}

export default ImportWizard
