import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Upload,
  Card,
  Select,
  Tag,
  Tooltip,
  Typography,
  Tabs,
  List,
  Alert,
  Row,
  Col,
  Dropdown
} from 'antd'
const { Title, Text, Paragraph } = Typography
import { appMessage as message } from '../utils/appMessage'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  BankOutlined,
  FolderOpenOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  ToolOutlined
} from '@ant-design/icons'
import {
  Project,
  ProjectSectorPaymentConfig,
  ProjectSetupSummary,
  StandardWorkbookProjectImportResult
} from '@preload/types'
import { readExcelWorkbook } from '../utils/excelReader'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'
import MaintenanceRateModal from '../components/MaintenanceRateModal'
import FilterPanel, {
  createSearchFilter,
  createSelectFilter
} from '../components/shared/FilterPanel'
import { parseStandardWorkbook, StandardWorkbookParseResult } from '../utils/standardWorkbook'
import { getCurrentFinancialYear, getUpcomingFinancialYear } from '../utils/financialYear'
import { useWorkingFinancialYear } from '../context/WorkingFinancialYearContext'

const { Option } = Select

// Intentionally empty by default: the app should not auto-save sector rows
// into the database unless the user explicitly adds them.
const getEmptySectorConfigs = (): Partial<ProjectSectorPaymentConfig>[] => []

// Optional quick-start helper for common sector patterns (A, B, C).
// Users can also add sectors manually when importing project data.
const getABCSectorConfigs = (): Partial<ProjectSectorPaymentConfig>[] => [
  { sector_code: 'A' },
  { sector_code: 'B' },
  { sector_code: 'C' }
]

// Auto-populate sector configs from detected project sectors
const getDetectedSectorConfigs = (sectorCodes: string[]): Partial<ProjectSectorPaymentConfig>[] => {
  return sectorCodes.map(sector_code => ({ sector_code }))
}

const DEFAULT_PROJECT_FORM_VALUES: Partial<Project> = {
  status: 'Active',
  city: '',
  template_type: 'standard',
  payment_modes: 'Cash, Cheque, DD, NEFT, RTGS, UPI',
  import_profile_key: 'standard_normalized'
}

const TEMPLATE_OPTIONS = [
  {
    value: 'standard',
    label: 'Standard Letter',
    description: 'Default platform maintenance letter flow.'
  },
  {
    value: 'sector_legacy',
    label: 'Sector Legacy',
    description: 'For sector-driven legacy projects with bank routing by sector.'
  },
  {
    value: 'reminder_legacy',
    label: 'Reminder Legacy',
    description: 'For reminder-style historical ledgers and follow-up letters.'
  }
]

const IMPORT_PROFILE_OPTIONS = [
  {
    value: 'standard_normalized',
    label: 'Standard Platform Sheet',
    description: 'Use this for new projects. Columns: Unit No, Owner, Type, Area, Status, Contact, Email.'
  },
  {
    value: 'beverly_abc_v1',
    label: 'Beverly A/B/C Legacy',
    description: 'For Beverly-style sheets with sectors (A/B/C) and yearly columns. Has wide layout with FY columns spread across.'
  },
  {
    value: 'banjara_numeric_v1',
    label: 'Banjara Sector Ledger',
    description: 'For ledger-style sheets with numeric sectors (1, 2, 3). Includes GST and penalty columns. Vertical layout.'
  }
]

const TEMPLATE_LABELS = Object.fromEntries(
  TEMPLATE_OPTIONS.map((option) => [option.value, option.label])
)
const IMPORT_PROFILE_LABELS = Object.fromEntries(
  IMPORT_PROFILE_OPTIONS.map((option) => [option.value, option.label])
)

const Projects: React.FC = () => {
  const navigate = useNavigate()
  const currentFY = getCurrentFinancialYear()
  const upcomingFY = getUpcomingFinancialYear(currentFY)
  const { workingFY, setWorkingFY } = useWorkingFinancialYear()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectSetupSummaries, setProjectSetupSummaries] = useState<
    Record<number, ProjectSetupSummary>
  >({})
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isRateModalOpen, setIsRateModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [pageSize, setPageSize] = useState(10)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // Filter states
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [cityFilter, setCityFilter] = useState<string | null>(null)

  const [standardWorkbookPreview, setStandardWorkbookPreview] =
    useState<StandardWorkbookParseResult | null>(null)
  const [isWorkbookImporting, setIsWorkbookImporting] = useState(false)
  const [importResults, setImportResults] = useState<StandardWorkbookProjectImportResult[]>([])
  const [showImportSummary, setShowImportSummary] = useState(false)
  const [showStandardImportModal, setShowStandardImportModal] = useState(false)
  const [sectorConfigs, setSectorConfigs] = useState<
    Partial<ProjectSectorPaymentConfig>[]
  >(getEmptySectorConfigs())

  const [form] = Form.useForm()
  const location = useLocation()

  const fetchProjects = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [data, summaries] = await Promise.all([
        window.api.projects.getAll(),
        window.api.projects.getSetupSummaries(workingFY)
      ])
      setProjects(data)
      setProjectSetupSummaries(
        Object.fromEntries(summaries.map((summary) => [summary.project_id, summary]))
      )
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[PROJECTS] Error fetching projects:', error)
      }
      message.error('Failed to fetch projects')
    } finally {
      setLoading(false)
    }
  }, [workingFY])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    const state = location.state as {
      openRatesProjectId?: number
      openEditProjectId?: number
    } | null
    const targetEditProjectId = state?.openEditProjectId
    if (targetEditProjectId) {
      const projectToEdit = projects.find((x) => x.id === targetEditProjectId)
      if (projectToEdit) {
        handleEdit(projectToEdit)
        window.history.replaceState({}, document.title)
      }
      return
    }

    const targetProjectId = state?.openRatesProjectId
    if (!targetProjectId) return

    const p = projects.find((x) => x.id === targetProjectId)
    if (!p) return

    setSelectedProject(p)
    setIsRateModalOpen(true)
    window.history.replaceState({}, document.title)
  }, [location, projects])

  // Get unique cities for filter
  const uniqueCities = useMemo(() => {
    return Array.from(
      new Set(projects.map((p) => p.city).filter((city): city is string => Boolean(city)))
    ).sort()
  }, [projects])

  const workingFYOptions = useMemo(
    () => [
      { value: upcomingFY, label: `FY ${upcomingFY}` },
      { value: currentFY, label: `FY ${currentFY}` }
    ],
    [currentFY, upcomingFY]
  )

  const projectFilterFields = useMemo(
    () => [
      createSearchFilter(
        'searchText',
        'Search',
        'Search project code, name, address, or city...'
      ),
      createSelectFilter(
        'statusFilter',
        'Status',
        [
          { value: 'Active', label: 'Active' },
          { value: 'Inactive', label: 'Inactive' }
        ],
        'Status',
        {
          emptyValue: null
        }
      ),
      createSelectFilter(
        'cityFilter',
        'City',
        uniqueCities.map((city) => ({ value: city, label: city })),
        'City',
        {
          emptyValue: null
        }
      )
    ],
    [uniqueCities]
  )

  const projectFilterValues = useMemo(
    () => ({
      searchText,
      statusFilter,
      cityFilter
    }),
    [cityFilter, searchText, statusFilter]
  )

  const handleProjectFilterChange = useCallback((key: string, value: unknown) => {
    switch (key) {
      case 'searchText':
        setSearchText(typeof value === 'string' ? value : '')
        break
      case 'statusFilter':
        setStatusFilter((value as string | null | undefined) ?? null)
        break
      case 'cityFilter':
        setCityFilter((value as string | null | undefined) ?? null)
        break
      default:
        break
    }
  }, [])

  const existingProjectNameSet = useMemo(() => {
    return new Set(projects.map((project) => project.name.trim().toLowerCase()))
  }, [projects])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return Boolean(searchText || statusFilter || cityFilter)
  }, [searchText, statusFilter, cityFilter])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setStatusFilter(null)
    setCityFilter(null)
  }, [])

  // Filtered data
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchText.toLowerCase()) ||
        (p.project_code || '').toLowerCase().includes(searchText.toLowerCase()) ||
        (p.city || '').toLowerCase().includes(searchText.toLowerCase())

      const projectStatus = p.status || 'Active'
      const matchesStatus = !statusFilter || projectStatus === statusFilter
      const matchesCity = !cityFilter || p.city === cityFilter

      return matchesSearch && matchesStatus && matchesCity
    })
  }, [projects, searchText, statusFilter, cityFilter])

  // Get selected projects for bulk delete preview
  const selectedProjects = useMemo(() => {
    return projects.filter((p) => selectedRowKeys.includes(p.id!))
  }, [projects, selectedRowKeys])

  const editingProjectSummary = useMemo(() => {
    if (!editingProject?.id) return null
    return projectSetupSummaries[editingProject.id] || null
  }, [editingProject, projectSetupSummaries])

  const handleAdd = (): void => {
    setEditingProject(null)
    form.resetFields()
    form.setFieldsValue(DEFAULT_PROJECT_FORM_VALUES)
    setSectorConfigs(getEmptySectorConfigs())
    setIsModalOpen(true)
  }

  const pickSectorQrFile = async (index: number): Promise<void> => {
    try {
      const selectedPath = await window.api.dialog.selectLocalFile({
        title: 'Select Sector QR / Barcode Image',
        filters: [
          {
            name: 'Image Files',
            extensions: ['png', 'jpg', 'jpeg']
          }
        ]
      })

      if (selectedPath) {
        // Copy file to app's user data directory
        const fileName = selectedPath.split(/[\\/]/).pop() || 'file.png'
        const targetDir = 'assets' // Relative to user data directory
        const targetPath = `${targetDir}/${fileName}`
        
        // Use the backend to copy the file to app directory
        const copyResult = await window.api.files.copyAssetFile(selectedPath, targetPath)
        
        if (copyResult.success) {
          handleSectorConfigChange(index, 'qr_code_path', targetPath)
          message.success('Sector QR Code copied successfully')
        } else {
          message.error(`Failed to copy QR Code: ${copyResult.error}`)
        }
      }
    } catch (error) {
      console.error('Failed to pick sector QR file:', error)
      message.error('Failed to open file picker')
    }
  }

  const handleSectorConfigChange = (
    index: number,
    key: keyof ProjectSectorPaymentConfig,
    value: string
  ): void => {
    setSectorConfigs((prev) =>
      prev.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        return {
          ...item,
          [key]: key === 'sector_code' ? value.toUpperCase() : value
        }
      })
    )
  }

  const handleAddSectorConfigRow = (): void => {
    setSectorConfigs((prev) => [...prev, { sector_code: '' }])
  }

  const handleRemoveSectorConfigRow = (index: number): void => {
    setSectorConfigs((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  }

  const handleStandardWorkbookImport = async (file: File): Promise<boolean> => {
    try {
      setImportResults([])
      setShowImportSummary(false)
      message.loading({ content: 'Reading standard workbook...', key: 'excel_read' })
      const workbook = await readExcelWorkbook(file)
      const parsedWorkbook = parseStandardWorkbook(workbook)

      if (parsedWorkbook.projects.length === 0) {
        const blockerText =
          parsedWorkbook.workbook_blockers.length > 0
            ? parsedWorkbook.workbook_blockers[0]
            : 'No project data found in the workbook.'
        message.warning({ content: blockerText, key: 'excel_read', duration: 5 })
        return false
      }

      setStandardWorkbookPreview(parsedWorkbook)

      if (parsedWorkbook.workbook_blockers.length > 0) {
        message.error({
          content: `Cannot import: ${parsedWorkbook.workbook_blockers[0]}`,
          key: 'excel_read',
          duration: 5
        })
        return false
      }

      // Instead of showing a modal, proceed directly to execution
      await executeDirectWorkbookImport(parsedWorkbook)
    } catch (error) {
      console.error('Error reading Excel file:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      message.error({
        content: `Failed to read Excel file: ${errorMessage}`,
        key: 'excel_read',
        duration: 5
      })
    }
    return false
  }

  const executeDirectWorkbookImport = async (preview: StandardWorkbookParseResult): Promise<void> => {
    setIsWorkbookImporting(true)
    message.loading({ content: 'Importing workbook data...', key: 'workbook_import_status' })
    
    try {
      const results: StandardWorkbookProjectImportResult[] = []
      for (const projectPreview of preview.projects) {
        const result = await window.api.projects.importStandardWorkbookProject({
          project: projectPreview.project,
          sector_configs: projectPreview.sector_configs,
          rates: projectPreview.rates,
          payments: projectPreview.payments,
          rows: projectPreview.rows
        })
        results.push(result)
      }

      const importedProjects = results.length
      const importedUnits = results.reduce((sum, r) => sum + r.imported_units, 0)
      const importedLetters = results.reduce((sum, r) => sum + r.imported_letters, 0)
      const importedRates = results.reduce((sum, r) => sum + (r.imported_rates || 0), 0)
      const importedPayments = results.reduce((sum, r) => sum + (r.imported_payments || 0), 0)

      // Check for projects missing bank details
      const projectsMissingBankDetails = preview.projects
        .filter((p) => {
          const hasSectorBankDetails =
            !!p.sector_configs &&
            p.sector_configs.some(
              (sc) => sc.account_name && sc.bank_name && sc.account_no && sc.ifsc_code
            )

          return !hasSectorBankDetails
        })
        .map((p) => p.project.name)

      setImportResults(results)
      setShowImportSummary(true)
      setStandardWorkbookPreview(null)
      setShowStandardImportModal(false)
      
      await fetchProjects()

      const parts = [
        `${importedProjects} project(s)`,
        `${importedUnits} unit(s)`,
        `${importedLetters} maintenance records`,
        importedRates > 0 ? `${importedRates} rate(s)` : null,
        importedPayments > 0 ? `${importedPayments} payment(s)` : null
      ].filter(Boolean).join(', ')

      message.success({
        content: `Successfully imported ${parts}.`,
        key: 'workbook_import_status',
        duration: 4
      })

      // Show warning for projects missing bank details
      if (projectsMissingBankDetails.length > 0) {
        message.warning({
          content: `Note: ${projectsMissingBankDetails.join(', ')} - missing sector bank details. Please edit the project and add sector payment configs.`,
          key: 'bank_details_missing',
          duration: 6
        })
      }
    } catch (error) {
      console.error('Workbook import failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      message.error({
        content: `Workbook import failed: ${errorMessage}`,
        key: 'workbook_import_status'
      })
    } finally {
      setIsWorkbookImporting(false)
    }
  }

  const executeStandardWorkbookImport = async (): Promise<void> => {
    if (!standardWorkbookPreview) return
    await executeDirectWorkbookImport(standardWorkbookPreview)
  }

  const handleEdit = async (record: Project): Promise<void> => {
    setEditingProject(record)
    
    // Fetch existing sector configs from database
    try {
      const existingSectorConfigs = await window.api.projects.getSectorPaymentConfigs(record.id!)
      setSectorConfigs(existingSectorConfigs || [])
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[EDIT PROJECT] Failed to fetch sector configs:', error)
      }
      // Fallback to empty configs if fetch fails
      setSectorConfigs(getEmptySectorConfigs())
    }
    
    const formValues = {
      ...DEFAULT_PROJECT_FORM_VALUES,
      ...record,
      status: record.status || 'Active',
      city: record.city || '',
      template_type: record.template_type || 'standard',
      import_profile_key: record.import_profile_key || 'standard_normalized'
    }
    form.setFieldsValue(formValues)
    setIsModalOpen(true)
  }

  const handleRates = (record: Project): void => {
    setSelectedProject(record)
    setIsRateModalOpen(true)
  }

  const handleDelete = async (id: number): Promise<void> => {
    Modal.confirm({
      title: 'Are you sure you want to delete this project?',
      content: 'This action cannot be undone.',
      onOk: async () => {
        try {
          await window.api.projects.delete(id)
          message.success('Project deleted successfully')
          fetchProjects()
        } catch {
          message.error('Failed to delete project')
        }
      }
    })
  }

  const handleBulkDelete = (): void => {
    Modal.confirm({
      title: `Delete ${selectedRowKeys.length} projects?`,
      content: (
        <div>
          <p>
            This action cannot be undone. All related units, maintenance letters, and payments will
            also be deleted.
          </p>
          {selectedProjects.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">Projects to delete:</Text>
              <ul style={{ margin: '4px 0 0 20px', fontSize: '12px' }}>
                {selectedProjects.slice(0, 5).map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
                {selectedProjects.length > 5 && <li>...and {selectedProjects.length - 5} more</li>}
              </ul>
            </div>
          )}
        </div>
      ),
      okText: 'Delete All',
      okType: 'danger',
      onOk: async () => {
        try {
          await window.api.projects.bulkDelete(selectedRowKeys as number[])
          message.success(`${selectedRowKeys.length} projects deleted successfully`)
          setSelectedRowKeys([])
          fetchProjects()
        } catch (error) {
          console.error(error)
          message.error('Failed to delete projects')
        }
      }
    })
  }

  const handleModalOk = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const normalizedValues: Partial<Project> = {
        name: String(values.name || '').trim(),
        address: String(values.address || '').trim(),
        city: String(values.city || '').trim(),
        state: String(values.state || '').trim(),
        pincode: String(values.pincode || '').trim(),
        status: String(values.status || 'Active').trim(),
        letterhead_path: String(values.letterhead_path || '').trim(),
        template_type: String(values.template_type || 'standard').trim(),
        import_profile_key: String(values.import_profile_key || 'standard_normalized').trim()
      }

      const preparedSectorConfigs = sectorConfigs
        .map((config) => ({
          sector_code: String(config.sector_code || '').trim().toUpperCase(),
          account_name: String(config.account_name || '').trim() || undefined,
          bank_name: String(config.bank_name || '').trim() || undefined,
          account_no: String(config.account_no || '').trim() || undefined,
          ifsc_code: String(config.ifsc_code || '').trim().toUpperCase() || undefined,
          branch: String(config.branch || '').trim() || undefined,
          qr_code_path: String(config.qr_code_path || '').trim() || undefined
        }))
        .filter((config) =>
          [config.sector_code, config.account_name, config.account_no, config.qr_code_path].some(
            (value) => (value || '').length > 0
          )
        )

      const seenSectors = new Set<string>()
      for (const config of preparedSectorConfigs) {
        if (!config.sector_code) {
          message.error('Sector code is required for each sector payment row')
          return
        }
        if (seenSectors.has(config.sector_code)) {
          message.error(`Duplicate sector code: ${config.sector_code}`)
          return
        }
        seenSectors.add(config.sector_code)
      }

      let projectId: number
      if (editingProject?.id) {
        await window.api.projects.update(editingProject.id, normalizedValues)
        projectId = editingProject.id
        message.success('Project updated successfully')
      } else {
        projectId = await window.api.projects.create(normalizedValues as Project)

        // Show next step guidance using utility
        showCompletionWithNextStep(
          'projects',
          'Project created successfully',
          navigate,
          `Project "${normalizedValues.name}" has been added to the platform`
        )
      }

      await window.api.projects.saveSectorPaymentConfigs(projectId, preparedSectorConfigs)
      setIsModalOpen(false)
      fetchProjects()
    } catch (error) {
      console.error(error)
    }
  }

  const columns = [
    {
      title: 'Code',
      dataIndex: 'project_code',
      key: 'project_code',
      width: 110,
      align: 'center' as const,
      render: (projectCode: string, record: Project) =>
        projectCode || `PRJ-${String(record.id || '').padStart(3, '0')}`
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: 'City',
      dataIndex: 'city',
      key: 'city',
      width: 140
    },
    {
      title: 'Workflow',
      key: 'workflow',
      width: 220,
      render: (_: unknown, record: Project) => (
        <Space orientation="vertical" size={4}>
          <Tag color="blue">
            {TEMPLATE_LABELS[record.template_type || 'standard'] || 'Standard Letter'}
          </Tag>
          <Tag>
            {IMPORT_PROFILE_LABELS[record.import_profile_key || 'standard_normalized'] ||
              'Standard Platform Sheet'}
          </Tag>
        </Space>
      )
    },
    {
      title: `Setup (FY ${workingFY})`,
      key: 'setup_status',
      width: 320,
      render: (_: unknown, record: Project) => {
        const summary = record.id ? projectSetupSummaries[record.id] : undefined
        if (!summary) {
          return <Text type="secondary">Checking setup...</Text>
        }

        return (
          <Space orientation="vertical" size={4}>
            <Tag color={summary.ready_for_letters ? 'success' : 'error'}>
              {summary.ready_for_letters ? 'Ready' : 'Needs Setup'}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Units: {summary.unit_count} | Detected Sectors:{' '}
              {summary.sector_codes.length > 0 ? summary.sector_codes.join(', ') : 'None'}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: summary.ready_for_letters ? '#389e0d' : '#cf1322'
              }}
            >
              FY {workingFY}:{' '}
              {summary.ready_for_letters ? 'Ready' : summary.blockers[0] || 'Needs setup'}
            </Text>
            {!summary.ready_for_letters && summary.warnings[0] && (
              <Text style={{ fontSize: 12, color: '#d48806' }}>{summary.warnings[0]}</Text>
            )}
          </Space>
        )
      }
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'Active' ? 'success' : 'error'}>{status || 'Inactive'}</Tag>
      )
    },
    {
      title: 'Action',
      key: 'actions',
      align: 'center' as const,
      width: 250,
      render: (_: unknown, record: Project) => (
        <Space className="table-row-actions" size="small">
          <Tooltip title="Manage Rates">
            <Button icon={<ToolOutlined />} onClick={() => handleRates(record)} size="small">
              Rates
            </Button>
          </Tooltip>
          <Tooltip title="Edit Project">
            <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} size="small">
              Edit
            </Button>
          </Tooltip>
          <Tooltip title="Delete Project">
            <Button
              icon={<DeleteOutlined />}
              danger
              onClick={() => handleDelete(record.id!)}
              size="small"
            >
              Delete
            </Button>
          </Tooltip>
        </Space>
      )
    }
  ]

  return (
    <div className="page-screen">
      {/* Header */}
      <div className="page-hero">
        <div
          className="responsive-page-header"
          style={{
            marginBottom: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16
          }}
        >
          <div>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Projects
            </Typography.Title>
            <Text type="secondary" className="page-hero-subtitle">
              Manage project setup, workbook imports, and billing readiness from one place.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Choose the billing financial year you want to prepare, then complete only that setup path.
            </Text>
          </div>
          <Space wrap className="responsive-action-bar">
            <Upload
              beforeUpload={(file) => {
                handleStandardWorkbookImport(file)
                return false
              }}
              showUploadList={false}
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            >
              <Button icon={<UploadOutlined />}>Import Standard Workbook</Button>
            </Upload>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              Add Project
            </Button>
          </Space>
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap align="center" size={12}>
              <Text strong>Working Financial Year</Text>
              <Dropdown
                trigger={['hover', 'click']}
                placement="bottomLeft"
                classNames={{ root: 'app-filter-dropdown-menu' }}
                disabled={loading}
                menu={{
                  items: workingFYOptions.map((option) => ({
                    key: String(option.value),
                    label: option.label,
                    onClick: () => setWorkingFY(String(option.value))
                  }))
                }}
              >
                <Button className="app-filter-dropdown-button" style={{ minWidth: 220 }} disabled={loading}>
                  {loading
                    ? 'Loading financial year...'
                    : workingFYOptions.find((option) => option.value === workingFY)?.label || workingFY}
                </Button>
              </Dropdown>
            </Space>
          <Alert
            type="info"
            showIcon
            title={`Billing setup for FY ${workingFY}`}
            description={`Choose the year you want to bill, then follow this order: add units with sector codes, configure sector bank details, add maintenance rates for ${workingFY}, then generate maintenance letters and receipts.`}
          />
        </Space>
      </Card>

      {selectedRowKeys.length > 0 && (
        <div className="page-selection-bar">
          <Text className="page-selection-label">
            {selectedRowKeys.length} project{selectedRowKeys.length !== 1 ? 's' : ''} selected
          </Text>
          <Space wrap>
            <Button danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>
              Delete Selected ({selectedRowKeys.length})
            </Button>
          </Space>
        </div>
      )}

      <Card style={{ marginBottom: 0 }} className="page-toolbar-card">
        <FilterPanel
          filters={projectFilterFields}
          values={projectFilterValues}
          onChange={handleProjectFilterChange}
          onClear={clearAllFilters}
          showActiveFilters={hasActiveFilters}
          loading={loading}
          variant="plain"
        />
      </Card>

      {/* Setup Checklist Banner - shown when any project has incomplete setup */}
      {(() => {
        const incompleteProjects = projects.filter((p) => {
          const summary = projectSetupSummaries[p.id!]
          return summary && !summary.ready_for_letters
        })
        if (incompleteProjects.length === 0) return null
        return (
          <Alert
            className="project-setup-alert"
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined style={{ fontSize: 24 }} />}
            title={
              <span className="project-setup-alert-title">
                {incompleteProjects.length === 1
                  ? `"${incompleteProjects[0].name}" is not ready for ${workingFY} billing`
                  : `${incompleteProjects.length} projects are not ready for ${workingFY} billing`}
              </span>
            }
            description={
              <div className="project-setup-alert-list">
                {incompleteProjects.map((p) => {
                  const summary = projectSetupSummaries[p.id!]
                  if (!summary) return null
                  const needsBank = summary.blockers.some((b) => {
                    const text = b.toLowerCase()
                    return text.includes('bank') || text.includes('sector code') || text.includes('sector grouping')
                  })
                  const needsRate = summary.blockers.some((b) => b.toLowerCase().includes('rate'))
                  const needsUnits = summary.blockers.some((b) => b.toLowerCase().includes('unit'))
                  const blockerText = `FY ${workingFY}: ${summary.blockers.join(' · ')}`
                  return (
                    <div
                      key={p.id}
                      className="project-setup-alert-item"
                    >
                      <span className="project-setup-alert-project">
                        {p.project_code || `PRJ-${p.id}`} - {p.name}
                      </span>
                      <span className="project-setup-alert-blockers">
                        {blockerText}
                      </span>
                      <div className="project-setup-alert-actions">
                        {(needsBank || needsRate) && (
                          <Button
                            size="middle"
                            icon={<BankOutlined />}
                            onClick={() => handleEdit(p)}
                            className="project-setup-alert-button"
                          >
                            {needsBank ? 'Configure Sector Banks' : 'Edit Project'}
                          </Button>
                        )}
                        {needsRate && (
                          <Button
                            size="middle"
                            icon={<ToolOutlined />}
                            onClick={() => handleRates(p)}
                            type="primary"
                            className="project-setup-alert-button"
                          >
                            {`Add Rates for ${workingFY}`}
                          </Button>
                        )}
                        {needsUnits && (
                          <Button
                            size="middle"
                            onClick={() => navigate('/units')}
                            className="project-setup-alert-button"
                          >
                            Add Units
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            }
          />
        )
      })()}

      <div className="table-scroll-wrapper mobile-card-table">
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys
          }}
          dataSource={filteredProjects}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ 
            pageSize: pageSize,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            onShowSizeChange: (_, size) => setPageSize(size)
          }}
          virtual={filteredProjects.length > 100}
          scroll={{ x: 'max-content', y: filteredProjects.length > 100 ? 620 : undefined }}
        />
      </div>

      {/* Project Add/Edit Modal */}
      <Modal
        title={editingProject ? 'Edit Project' : 'Add Project'}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => setIsModalOpen(false)}
        width={720}
        style={{ 
          maxWidth: '95vw',
          margin: '0 auto'
        }}
        centered
        className="project-modal-responsive"
        bodyStyle={{ padding: '12px 16px', maxHeight: '70vh', overflowY: 'auto' }}
      >
        <Form 
          form={form} 
          layout="vertical" 
          initialValues={DEFAULT_PROJECT_FORM_VALUES}
          validateTrigger={['onBlur', 'onChange']}
        >
          {editingProjectSummary && (
            <Alert
              type={
                editingProjectSummary.ready_for_letters
                  ? editingProjectSummary.warnings.length > 0
                    ? 'warning'
                    : 'success'
                  : 'error'
              }
              showIcon
              icon={
                editingProjectSummary.ready_for_letters ? (
                  <CheckCircleOutlined />
                ) : (
                  <WarningOutlined />
                )
              }
              title={
                editingProjectSummary.ready_for_letters
                  ? editingProjectSummary.warnings.length > 0
                    ? `Project setup for ${workingFY} is usable but still has warnings.`
                    : `Project setup for ${workingFY} is ready for maintenance letters.`
                  : `Project setup for ${workingFY} is incomplete.`
              }
              description={
                <div>
                  <div style={{ marginBottom: 8 }}>
                    Working FY: {workingFY}
                    {' | '}
                    Detected sectors:{' '}
                    {editingProjectSummary.sector_codes.length > 0
                      ? editingProjectSummary.sector_codes.join(', ')
                      : 'None'}
                    {' | '}Unit types:{' '}
                    {editingProjectSummary.unit_types.length > 0
                      ? editingProjectSummary.unit_types.join(', ')
                      : 'None'}
                  </div>
                  {editingProjectSummary.blockers.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="danger" strong style={{ display: 'block', marginBottom: 4 }}>
                        Blockers (Must Fix):
                      </Text>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#cf1322' }}>
                        {editingProjectSummary.blockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {editingProjectSummary.warnings.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="warning" strong style={{ display: 'block', marginBottom: 4 }}>
                        Warnings:
                      </Text>
                      <ul style={{ margin: 0, paddingLeft: 20, color: '#d48806' }}>
                        {editingProjectSummary.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              }
              style={{ marginBottom: 16 }}
            />
          )}
          <Tabs
            defaultActiveKey="basic"
            items={[
              {
                key: 'basic',
                label: 'Basic Information',
                children: (
                  <Row gutter={[16, 8]} style={{ marginTop: 16 }}>
                    <Col span={24}>
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 8 }}
                        title="Recommended setup order"
                        description={`Create the project, add units with sector codes, configure sector bank details, choose the working FY, add rates for ${workingFY}, then generate maintenance letters.`}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="Project Code">
                        <Input
                          value={editingProject?.project_code || 'Auto-generated on save'}
                          disabled
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item
                        name="name"
                        label="Project Name"
                        rules={[{ required: true, message: 'Please enter project name' }]}
                      >
                        <Input style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>

                    <Col span={24}>
                      <Form.Item name="address" label="Address">
                        <Input.TextArea rows={2} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item name="city" label="City">
                        <Input style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item name="state" label="State">
                        <Input style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item name="pincode" label="Pincode">
                        <Input style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item name="status" label="Status">
                        <Select placeholder="Select status" style={{ width: '100%' }}>
                          <Option value="Active">Active</Option>
                          <Option value="Inactive">Inactive</Option>
                        </Select>
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item
                        name="template_type"
                        label="Letter Template"
                        extra="The default choice is fine for most manual projects."
                      >
                        <Select
                          options={TEMPLATE_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label
                          }))}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>

                    <Col span={24}>
                      <Form.Item
                        name="import_profile_key"
                        label="Excel Import Profile"
                        extra="Used mainly for workbook imports. Manual projects can keep the default profile."
                      >
                        <Select
                          options={IMPORT_PROFILE_OPTIONS.map((option) => ({
                            value: option.value,
                            label: `${option.label} - ${option.description}`
                          }))}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                )
              },
              {
                key: 'bank',
                label: 'Bank Details',
                icon: <BankOutlined />,
                children: (
                  <div style={{ marginTop: 16 }}>
                    <div>
                      <Title level={5} style={{ marginBottom: 16 }}>Sector Bank Details</Title>
                      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                        Manual and imported projects both use sector bank details. Add one payment
                        config row for each sector that should appear on maintenance letters.
                      </Paragraph>

                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        title="Recommended flow"
                        description="Manual flow: add units with sector codes first, then add matching sector bank configs here. Import flow: detected sectors from the workbook can be auto-populated here and completed manually."
                      />

                      {editingProjectSummary && editingProjectSummary.sector_codes.length > 0 && (
                        <Alert
                          type="info"
                          showIcon
                          title={`Detected sectors: ${editingProjectSummary.sector_codes.join(', ')}`}
                          description={
                            <div>
                              <div>
                                These sectors were detected from the project units. Use the button below
                                to create one bank-config row per detected sector, then fill the payment
                                details manually.
                              </div>
                              <Button 
                                size="small" 
                                type="link" 
                                onClick={() => setSectorConfigs(getDetectedSectorConfigs(editingProjectSummary.sector_codes))}
                                style={{ padding: 0, height: 'auto' }}
                              >
                                Auto-populate with detected sectors
                              </Button>
                            </div>
                          }
                          style={{ marginBottom: 16 }}
                        />
                      )}

                      {(!editingProjectSummary ||
                        editingProjectSummary.sector_codes.length === 0) && (
                        <Alert
                          type="warning"
                          showIcon
                          style={{ marginBottom: 16 }}
                          title="Manual sector setup"
                          description="If you are setting up a project manually, add units with sector codes first, or start with common sectors here and keep the same sector codes on the units."
                        />
                      )}

                      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                        {sectorConfigs.map((config, index) => (
                          <Card
                            key={`sector-config-${index}`}
                            className="project-sector-config-card"
                            size="small"
                            title={`Sector ${String(config.sector_code || index + 1)} Payment Config`}
                            extra={
                              <Button
                                size="small"
                                danger
                                onClick={() => handleRemoveSectorConfigRow(index)}
                                disabled={sectorConfigs.length <= 1}
                              >
                                Remove
                              </Button>
                            }
                          >
                            <div className="project-sector-config-grid">
                              <div className="project-sector-config-field project-sector-config-field-compact">
                                <label className="project-sector-config-label">Sector</label>
                                <Input
                                  value={String(config.sector_code || '')}
                                  onChange={(e) =>
                                    handleSectorConfigChange(index, 'sector_code', e.target.value)
                                  }
                                  placeholder="A / B / C"
                                />
                              </div>

                              <div className="project-sector-config-field">
                                <label className="project-sector-config-label">Account Name</label>
                                <Input
                                  value={String(config.account_name || '')}
                                  onChange={(e) =>
                                    handleSectorConfigChange(index, 'account_name', e.target.value)
                                  }
                                  placeholder="Account Name"
                                />
                              </div>

                              <div className="project-sector-config-field">
                                <label className="project-sector-config-label">Bank Name</label>
                                <Input
                                  value={String(config.bank_name || '')}
                                  onChange={(e) =>
                                    handleSectorConfigChange(index, 'bank_name', e.target.value)
                                  }
                                  placeholder="Bank Name"
                                />
                              </div>

                              <div className="project-sector-config-field">
                                <label className="project-sector-config-label">Account Number</label>
                                <Input
                                  value={String(config.account_no || '')}
                                  onChange={(e) =>
                                    handleSectorConfigChange(index, 'account_no', e.target.value)
                                  }
                                  placeholder="Account Number"
                                />
                              </div>

                              <div className="project-sector-config-field">
                                <label className="project-sector-config-label">IFSC Code</label>
                                <Input
                                  value={String(config.ifsc_code || '')}
                                  onChange={(e) =>
                                    handleSectorConfigChange(index, 'ifsc_code', e.target.value.toUpperCase())
                                  }
                                  placeholder="IFSC Code"
                                />
                              </div>

                              <div className="project-sector-config-field">
                                <label className="project-sector-config-label">Branch</label>
                                <Input
                                  value={String(config.branch || '')}
                                  onChange={(e) =>
                                    handleSectorConfigChange(index, 'branch', e.target.value)
                                  }
                                  placeholder="Branch"
                                />
                              </div>

                              <div className="project-sector-config-field project-sector-config-field-wide">
                                <label className="project-sector-config-label">Sector QR Image</label>
                                <div className="project-sector-config-qr-row">
                                  <Input
                                    value={String(config.qr_code_path || '')}
                                    onChange={(e) =>
                                      handleSectorConfigChange(index, 'qr_code_path', e.target.value)
                                    }
                                    placeholder="Sector QR image path (.png/.jpg/.jpeg)"
                                  />
                                  <Button
                                    icon={<FolderOpenOutlined />}
                                    onClick={() => pickSectorQrFile(index)}
                                  >
                                    Browse
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                        <Button
                          type="dashed"
                          onClick={handleAddSectorConfigRow}
                          style={{ width: '100%' }}
                          icon={<PlusOutlined />}
                        >
                          Add Sector Bank Config
                        </Button>
                        <Space>
                          {editingProjectSummary && editingProjectSummary.sector_codes.length > 0 ? (
                            <Button size="small" onClick={() => setSectorConfigs(getDetectedSectorConfigs(editingProjectSummary.sector_codes))}>
                              Use Detected Sectors ({editingProjectSummary.sector_codes.join(', ')})
                            </Button>
                          ) : (
                            <Button size="small" onClick={() => setSectorConfigs(getABCSectorConfigs())}>
                              Start Manual Sectors (A, B, C)
                            </Button>
                          )}
                          {process.env.NODE_ENV === 'development' && editingProject && (
                            <Button 
                              size="small" 
                              type="dashed" 
                              onClick={async () => {
                                try {
                                  const configs = await window.api.projects.getSectorPaymentConfigs(editingProject.id!)
                                  message.info(`Found ${configs?.length || 0} sector configs`)
                                } catch (error) {
                                  console.error('[DEBUG] Manual fetch error:', error)
                                  message.error('Fetch failed: ' + (error instanceof Error ? error.message : String(error)))
                                }
                              }}
                            >
                              Debug Fetch
                            </Button>
                          )}
                          <Button size="small" onClick={() => setSectorConfigs(getEmptySectorConfigs())}>
                            Clear All
                          </Button>
                        </Space>
                      </Space>
                    </div>
                  </div>
                )
              }
            ]}
          />
        </Form>
      </Modal>

      {/* Standard Workbook Import Modal */}
      <Modal
        title="Import Projects from Standard Workbook"
        open={showStandardImportModal}
        onOk={executeStandardWorkbookImport}
        onCancel={() => {
          setShowStandardImportModal(false)
          setStandardWorkbookPreview(null)
        }}
        okText="Import Workbook"
        okButtonProps={{
          disabled:
            !standardWorkbookPreview ||
            standardWorkbookPreview.projects.length === 0 ||
            standardWorkbookPreview.workbook_blockers.length > 0
        }}
        confirmLoading={isWorkbookImporting}
        width={860}
        className="mobile-fullscreen-modal"
      >
        {standardWorkbookPreview && (
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type={
                standardWorkbookPreview.workbook_blockers.length > 0
                  ? 'error'
                  : standardWorkbookPreview.workbook_warnings.length > 0
                    ? 'warning'
                    : 'success'
              }
              showIcon
              title={
                standardWorkbookPreview.workbook_blockers.length > 0
                  ? 'Workbook has blockers and cannot be imported yet.'
                  : standardWorkbookPreview.workbook_warnings.length > 0
                    ? 'Workbook is importable but has warnings to review.'
                    : 'Workbook is ready to import.'
              }
              description={
                <div>
                  <div style={{ marginBottom: 8 }}>
                    Projects: {standardWorkbookPreview.projects.length}
                    {' | '}Workbook warnings: {standardWorkbookPreview.workbook_warnings.length}
                    {' | '}Workbook blockers: {standardWorkbookPreview.workbook_blockers.length}
                  </div>
                  {standardWorkbookPreview.workbook_blockers.slice(0, 6).map((blocker) => (
                    <div key={blocker} style={{ color: '#cf1322' }}>
                      {blocker}
                    </div>
                  ))}
                  {standardWorkbookPreview.workbook_warnings.slice(0, 4).map((warning) => (
                    <div key={warning} style={{ color: '#d48806' }}>
                      {warning}
                    </div>
                  ))}
                </div>
              }
            />

            <List
              dataSource={standardWorkbookPreview.projects}
              renderItem={(projectPreview) => {
                const importAction = existingProjectNameSet.has(
                  projectPreview.project.name.trim().toLowerCase()
                )
                  ? 'Update Existing'
                  : 'Create New'

                return (
                  <List.Item>
                    <Card
                      size="small"
                      title={projectPreview.project.name}
                      style={{ width: '100%' }}
                      extra={
                        <Space>
                          <Tag color={importAction === 'Create New' ? 'green' : 'blue'}>
                            {importAction}
                          </Tag>
                          <Tag>
                            {TEMPLATE_LABELS[projectPreview.project.template_type || 'standard'] ||
                              'Standard Letter'}
                          </Tag>
                          <Tag>
                            {IMPORT_PROFILE_LABELS[
                              projectPreview.project.import_profile_key || 'standard_normalized'
                            ] || 'Standard Platform Sheet'}
                          </Tag>
                        </Space>
                      }
                    >
                      <div style={{ display: 'grid', gap: 6 }}>
                        <Text type="secondary">
                          Units: {projectPreview.unit_count} | Ledger rows:{' '}
                          {projectPreview.ledger_row_count} | Letters:{' '}
                          {projectPreview.letter_count}
                          {(projectPreview.rate_count || 0) > 0
                            ? ` | Rates: ${projectPreview.rate_count}`
                            : ''}
                          {(projectPreview.payment_count || 0) > 0
                            ? ` | Payments: ${projectPreview.payment_count}`
                            : ''}
                        </Text>
                        <Text type="secondary">
                          Sectors:{' '}
                          {projectPreview.sector_codes.length > 0
                            ? projectPreview.sector_codes.join(', ')
                            : 'None'}
                          {' | '}Unit types:{' '}
                          {projectPreview.unit_types.length > 0
                            ? projectPreview.unit_types.join(', ')
                            : 'None'}
                        </Text>
                        {projectPreview.blockers.map((blocker) => (
                          <Text key={blocker} type="danger" style={{ fontSize: 12 }}>
                            {blocker}
                          </Text>
                        ))}
                        {projectPreview.warnings.slice(0, 4).map((warning) => (
                          <Text key={warning} style={{ fontSize: 12, color: '#d48806' }}>
                            {warning}
                          </Text>
                        ))}
                      </div>
                    </Card>
                  </List.Item>
                )
              }}
            />
          </Space>
        )}
      </Modal>

      {/* Import Summary Modal */}
      <Modal
        title="Import Summary"
        open={showImportSummary}
        onCancel={() => setShowImportSummary(false)}
        footer={[
          <Button key="close" onClick={() => setShowImportSummary(false)}>
            Close
          </Button>
        ]}
        width={600}
        className="mobile-fullscreen-modal"
      >
        <div style={{ maxHeight: '400px', overflow: 'auto' }}>
          <List
            dataSource={importResults}
            renderItem={(result, index) => (
              <List.Item>
                <List.Item.Meta
                  title={`${index + 1}. ${result.project_code || 'PRJ'} - ${result.project_name}`}
                  description={
                    <div>
                      <div>
                        Action:{' '}
                        {result.created ? 'Created new project' : 'Updated existing project'}
                      </div>
                      <div>Units imported: {result.imported_units}</div>
                      <div>Maintenance records: {result.imported_letters}</div>
                      {(result.imported_rates || 0) > 0 && (
                        <div>Rates imported: {result.imported_rates}</div>
                      )}
                      {(result.imported_payments || 0) > 0 && (
                        <div>Payments imported: {result.imported_payments}</div>
                      )}
                      <div>
                        Sector payment config:{' '}
                        {result.sector_configs_merged ? 'Merged from workbook' : 'No change'}
                      </div>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      </Modal>

      {/* Maintenance Rates Modal */}
      {selectedProject && (
        <MaintenanceRateModal
          visible={isRateModalOpen}
          projectId={selectedProject.id!}
          projectName={selectedProject.name}
          workingFinancialYear={workingFY}
          onCancel={() => setIsRateModalOpen(false)}
        />
      )}
    </div>
  )
}

export default Projects
