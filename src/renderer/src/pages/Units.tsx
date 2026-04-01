import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Upload,
  Divider,
  Typography,
  Card,
  Alert,
  Badge,
  Progress,
  Collapse,
  Tag,
  Row,
  Col
} from 'antd'
import type { DividerProps } from 'antd'
import {
  UploadOutlined,
  FileTextOutlined,
  WalletOutlined,
  ThunderboltOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  UndoOutlined
} from '@ant-design/icons'
import { Unit, Project } from '@preload/types'
import { readExcelFile } from '../utils/excelReader'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'
import { UNIT_TYPES, UNIT_TYPE_COLORS } from '../constants/unitTypes'
import { useOperationHistory } from '../hooks/useOperationHistory'
import FilterPanel, {
  createRangeFilter,
  createSearchFilter,
  createSelectFilter
} from '../components/shared/FilterPanel'

const { Title, Text, Paragraph } = Typography
const { Option } = Select
const { Panel } = Collapse

interface ImportUnitPreview extends Unit {
  previewId: string
  [key: string]: unknown
}

interface ImportProfileDetection {
  key: string
  label: string
  description: string
  reason: string
}

const STANDARD_IMPORT_PROFILE: ImportProfileDetection = {
  key: 'standard_normalized',
  label: 'Standard Platform Sheet',
  description: 'Normalized workbook aligned to the platform import format.',
  reason: 'No legacy-specific pattern detected.'
}

const getNormalizedHeaders = (rows: Record<string, unknown>[]): string[] => {
  const seen = new Set<string>()
  const headers: string[] = []

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const normalized = String(key).toLowerCase().trim()
      if (!normalized || normalized === '__id' || seen.has(normalized)) continue
      seen.add(normalized)
      headers.push(normalized)
    }
  }

  return headers
}

const extractFirstMatchingValue = (
  row: Record<string, unknown>,
  possibleKeys: string[]
): string => {
  for (const key of Object.keys(row)) {
    const normalized = String(key).toLowerCase().trim()
    if (!possibleKeys.includes(normalized)) continue
    const value = String(row[key] ?? '').trim()
    if (value) return value
  }
  return ''
}

const detectImportProfile = (rows: Record<string, unknown>[]): ImportProfileDetection => {
  if (rows.length === 0) return STANDARD_IMPORT_PROFILE

  const headers = getNormalizedHeaders(rows)
  const yearHeaders = headers.filter((header) => /^\d{4}-\d{2}$/.test(header))
  const hasSectorColumn = headers.some((header) =>
    ['sector', 'sector no', 'sector_no', 'sector number', 'block'].includes(header)
  )
  const hasPlotColumn = headers.some((header) =>
    ['plot', 'plot no', 'plot_no', 'plot number'].includes(header)
  )
  const hasPipeReplacement = headers.some((header) => /^pipe[\s_-]*replac(e)?ment$/.test(header))
  const hasGst = headers.some((header) => /^gst(?:_\d+)?$/.test(header))
  const hasStandardFinancialYear = headers.some((header) =>
    ['financial_year', 'financial year'].includes(header)
  )
  const hasUnitNumber = headers.some((header) =>
    ['unit_number', 'unit number', 'unit', 'unit_no', 'unitno'].includes(header)
  )

  const plotSamples = rows
    .slice(0, 40)
    .map((row) => extractFirstMatchingValue(row, ['plot', 'plot no', 'plot_no', 'plot number']))
    .filter(Boolean)
  const hasMostlyAbcPlots =
    plotSamples.length > 0 &&
    plotSamples.filter((value) => /^[ABC]/i.test(value)).length >= plotSamples.length * 0.7

  if (hasStandardFinancialYear && hasUnitNumber) {
    return {
      key: 'standard_normalized',
      label: 'Standard Platform Sheet',
      description: 'Ready-to-import normalized workbook.',
      reason: 'Found platform-style financial year and unit number columns.'
    }
  }

  if (
    hasSectorColumn &&
    hasPlotColumn &&
    yearHeaders.length >= 3 &&
    (hasPipeReplacement || hasGst)
  ) {
    return {
      key: 'banjara_numeric_v1',
      label: 'Banjara Sector Ledger',
      description: 'Legacy workbook with sector + plot routing and year-wise columns.',
      reason: 'Detected sector and plot columns with GST / pipe replacement ledger fields.'
    }
  }

  if (hasPlotColumn && yearHeaders.length >= 3 && (hasMostlyAbcPlots || !hasSectorColumn)) {
    return {
      key: 'beverly_abc_v1',
      label: 'Beverly A/B/C Legacy',
      description: 'Legacy workbook with plot-led sectors and wide year columns.',
      reason: hasMostlyAbcPlots
        ? 'Detected plot values primarily starting with A/B/C and multiple year columns.'
        : 'Detected wide-format plot ledger without an explicit sector column.'
    }
  }

  return STANDARD_IMPORT_PROFILE
}

const Units: React.FC = () => {
  const [units, setUnits] = useState<Unit[]>([])
  const [filteredUnits, setFilteredUnits] = useState<Unit[]>([])
  const [searchText, setSearchText] = useState('')
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [selectedUnitType, setSelectedUnitType] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [areaRange, setAreaRange] = useState<[number | null, number | null]>([null, null])

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [pageSize, setPageSize] = useState(10)

  const [importData, setImportData] = useState<Record<string, unknown>[]>([])
  const [mappedPreview, setMappedPreview] = useState<ImportUnitPreview[]>([])
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [importProjectId, setImportProjectId] = useState<number | null>(null)
  const [ignoreEmptyUnits, setIgnoreEmptyUnits] = useState(true)
  const [defaultArea, setDefaultArea] = useState<number>(0)

  const [form] = Form.useForm()
  const navigate = useNavigate()
  const location = useLocation()
  const { canUndo, addOperation, undo } = useOperationHistory<Unit>({ maxHistory: 5 })

  // Memoized filter status for performance
  const hasActiveFilters = useMemo(() => {
    return Boolean(
      searchText ||
      selectedProject ||
      selectedUnitType ||
      statusFilter ||
      areaRange[0] !== null ||
      areaRange[1] !== null
    )
  }, [searchText, selectedProject, selectedUnitType, statusFilter, areaRange])

  // Find project name by ID
  const getProjectNameById = useCallback(
    (id: number | null) => {
      if (!id) return ''
      const project = projects.find((p) => p.id === id)
      return project ? `${project.project_code || 'PRJ'} - ${project.name}` : ''
    },
    [projects]
  )

  const selectedImportProject = useMemo(
    () => projects.find((project) => project.id === importProjectId) || null,
    [projects, importProjectId]
  )

  const unitFilterFields = useMemo(
    () => [
      createSearchFilter('searchText', 'Search', 'Search unit number or owner...'),
      createSelectFilter(
        'selectedProject',
        'Project',
        projects.flatMap((project) =>
          project.id !== undefined
            ? [
                {
                  value: project.id,
                  label: project.project_code
                    ? `${project.project_code} - ${project.name}`
                    : project.name
                }
              ]
            : []
        ),
        'Project',
        {
          emptyValue: null,
          formatValue: (value) => getProjectNameById((value as number | null) ?? null)
        }
      ),
      createSelectFilter(
        'statusFilter',
        'Status',
        [
          { value: 'Sold', label: 'Sold' },
          { value: 'Unsold', label: 'Unsold' }
        ],
        'Status',
        {
          emptyValue: null
        }
      ),
      createSelectFilter(
        'selectedUnitType',
        'Unit Type',
        UNIT_TYPES.map((unitType) => ({ value: unitType, label: unitType })),
        'Unit Type',
        {
          emptyValue: null
        }
      ),
      createRangeFilter('areaRange', 'Area', {
        emptyValue: [null, null],
        minPlaceholder: 'Min Area',
        maxPlaceholder: 'Max Area',
        isActive: (value) =>
          Array.isArray(value) && (value[0] !== null || value[1] !== null),
        formatValue: (value) => {
          const [min, max] = Array.isArray(value) ? value : [null, null]
          return `${min ?? 'Any'} to ${max ?? 'Any'}`
        }
      })
    ],
    [getProjectNameById, projects]
  )

  const unitFilterValues = useMemo(
    () => ({
      searchText,
      selectedProject,
      statusFilter,
      selectedUnitType,
      areaRange
    }),
    [areaRange, searchText, selectedProject, selectedUnitType, statusFilter]
  )

  const handleUnitFilterChange = useCallback((key: string, value: unknown) => {
    switch (key) {
      case 'searchText':
        setSearchText(typeof value === 'string' ? value : '')
        break
      case 'selectedProject':
        setSelectedProject((value as number | null | undefined) ?? null)
        break
      case 'statusFilter':
        setStatusFilter((value as string | null | undefined) ?? null)
        break
      case 'selectedUnitType':
        setSelectedUnitType((value as string | null | undefined) ?? null)
        break
      case 'areaRange':
        if (Array.isArray(value)) {
          const nextRange: [number | null, number | null] = [
            typeof value[0] === 'number' ? value[0] : null,
            typeof value[1] === 'number' ? value[1] : null
          ]
          if (
            nextRange[0] !== null &&
            nextRange[1] !== null &&
            nextRange[0] > nextRange[1]
          ) {
            message.warning('Minimum area cannot be greater than maximum')
          }
          setAreaRange(nextRange)
        }
        break
      default:
        break
    }
  }, [])

  const detectedImportProfile = useMemo(() => detectImportProfile(importData), [importData])

  const importAudit = useMemo(() => {
    const yearColumns = getNormalizedHeaders(importData).filter((header) =>
      /^\d{4}-\d{2}$/.test(header)
    )
    const sectorCodes = Array.from(
      new Set(
        mappedPreview
          .map((row) =>
            String(row.sector_code || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    const contactCount = mappedPreview.filter(
      (row) => String(row.contact_number || '').trim() !== ''
    ).length
    const emailCount = mappedPreview.filter((row) => String(row.email || '').trim() !== '').length
    const ownerCount = mappedPreview.filter(
      (row) => String(row.owner_name || '').trim() !== ''
    ).length
    const unitFrequency = new Map<string, number>()
    for (const row of mappedPreview) {
      const unitNumber = String(row.unit_number || '')
        .trim()
        .toUpperCase()
      if (!unitNumber) continue
      unitFrequency.set(unitNumber, (unitFrequency.get(unitNumber) || 0) + 1)
    }
    const duplicateUnits = Array.from(unitFrequency.entries())
      .filter(([, count]) => count > 1)
      .map(([unit]) => unit)

    // Enhanced validation with severity grouping
    const blockers: { field: string; message: string; rowCount: number; autoFixable: boolean }[] = []
    const warnings: { field: string; message: string; rowCount: number; autoFixable: boolean }[] = []

    // Check for missing unit numbers (BLOCKER)
    const missingUnitNumbers = mappedPreview.filter((row) => !String(row.unit_number || '').trim())
    if (missingUnitNumbers.length > 0) {
      blockers.push({
        field: 'unit_number',
        message: `${missingUnitNumbers.length} rows missing unit numbers`,
        rowCount: missingUnitNumbers.length,
        autoFixable: false
      })
    }

    // Check for missing owner names (BLOCKER)
    const missingOwners = mappedPreview.filter((row) => !String(row.owner_name || '').trim())
    if (missingOwners.length > 0) {
      blockers.push({
        field: 'owner_name',
        message: `${missingOwners.length} rows missing owner names`,
        rowCount: missingOwners.length,
        autoFixable: false
      })
    }

    // Check for zero/invalid area (WARNING - auto-fixable)
    const invalidArea = mappedPreview.filter((row) => !row.area_sqft || row.area_sqft <= 0)
    if (invalidArea.length > 0) {
      warnings.push({
        field: 'area_sqft',
        message: `${invalidArea.length} rows with invalid area (will use default: ${defaultArea})`,
        rowCount: invalidArea.length,
        autoFixable: true
      })
    }

    // Check for missing unit type (WARNING - auto-fixable)
    const missingUnitType = mappedPreview.filter((row) => !row.unit_type)
    if (missingUnitType.length > 0) {
      warnings.push({
        field: 'unit_type',
        message: `${missingUnitType.length} rows missing unit type (will default to Plot)`,
        rowCount: missingUnitType.length,
        autoFixable: true
      })
    }

    // Check for duplicate unit numbers (BLOCKER)
    if (duplicateUnits.length > 0) {
      blockers.push({
        field: 'duplicate_units',
        message: `${duplicateUnits.length} duplicate unit numbers detected`,
        rowCount: duplicateUnits.length,
        autoFixable: false
      })
    }

    return {
      yearColumns,
      sectorCodes,
      contactCount,
      emailCount,
      ownerCount,
      duplicateUnits,
      blockers,
      warnings,
      totalRows: mappedPreview.length,
      validRows: mappedPreview.length - missingUnitNumbers.length - missingOwners.length
    }
  }, [importData, mappedPreview, defaultArea])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setSelectedProject(null)
    setSelectedUnitType(null)
    setStatusFilter(null)
    setAreaRange([null, null])
    setSelectedRowKeys([])
  }, [])

  // Helper function to map a single row to a Unit object
  const mapRowToUnit = useCallback(
    (
      row: Record<string, unknown>,
      projectId: number | null,
      fallbackPreviewId: string
    ): ImportUnitPreview | null => {
      const previewId =
        typeof row.__id === 'string' && row.__id.trim() ? row.__id : fallbackPreviewId
      const normalizedRow: Record<string, unknown> = {}
      Object.keys(row).forEach((key) => {
        const normalizedKey = String(key).toLowerCase().trim()
        normalizedRow[normalizedKey] = row[key]
      })

      const getValue = (possibleKeys: string[]): unknown => {
        for (const key of possibleKeys) {
          if (
            normalizedRow[key] !== undefined &&
            normalizedRow[key] !== null &&
            String(normalizedRow[key]).trim() !== ''
          ) {
            return normalizedRow[key]
          }
        }
        return undefined
      }

      let effectiveProjectId = projectId
      if (!effectiveProjectId) {
        const projectName = String(getValue(['project', 'building', 'project name']) || '')
          .trim()
          .toLowerCase()
        if (projectName) {
          const matchedProject = projects.find((p) => p.name.toLowerCase() === projectName)
          if (matchedProject) {
            effectiveProjectId = matchedProject.id!
          }
        }
      }

      const explicitUnitNumber = String(
        getValue([
          'unit number',
          'unit',
          'unit_no',
          'unitno',
          'particulars',
          'flat',
          'flat no',
          'flat_no',
          'flat number',
          'member code',
          'id',
          'shop',
          'office'
        ]) || ''
      ).trim()

      const plotNumber = String(
        getValue(['plot', 'plot no', 'plot_no', 'plot number']) || ''
      ).trim()
      const sectorNumber = String(
        getValue(['sector', 'sector no', 'sector_no', 'sector number', 'block']) || ''
      ).trim()

      const inferSectorFromUnitNumber = (candidateUnitNumber: string): string => {
        const normalizedCandidate = String(candidateUnitNumber || '').trim()
        if (!normalizedCandidate) return ''
        const hyphenIndex = normalizedCandidate.indexOf('-')
        if (hyphenIndex > 0) return normalizedCandidate.slice(0, hyphenIndex).trim().toUpperCase()
        const slashIndex = normalizedCandidate.indexOf('/')
        if (slashIndex > 0) return normalizedCandidate.slice(0, slashIndex).trim().toUpperCase()
        return ''
      }

      // For ledgers with repeated plot numbers across sectors, compose a stable unique unit number.
      let unitNumber = explicitUnitNumber
      if (!unitNumber && plotNumber) {
        unitNumber = sectorNumber ? `${sectorNumber}-${plotNumber}` : plotNumber
      }

      if (!unitNumber && ignoreEmptyUnits) return null

      let ownerName = String(
        getValue([
          'owner',
          'name',
          'owner name',
          'ownername',
          'to',
          'respected sir / madam',
          'member',
          'member name',
          'unit owner',
          'unit owner name',
          'customer',
          'client'
        ]) || ''
      ).trim()

      if (!unitNumber && ownerName) {
        const unitPattern = /([A-Z][-/\s]?\d+([-/\s]\d+)?)/i
        const match = ownerName.match(unitPattern)
        if (match) {
          unitNumber = match[0].trim()
          ownerName = ownerName.replace(match[0], '').replace(/[()]/g, '').trim()
        }
      }

      if (!unitNumber) {
        const unitRegex = /^[A-Z][-/\s]?\d+([-/\s]\d+)?$/i
        for (const key of Object.keys(normalizedRow)) {
          const val = String(normalizedRow[key]).trim()
          if (unitRegex.test(val)) {
            unitNumber = val
            break
          }
        }
      }

      if (!unitNumber && ignoreEmptyUnits) return null
      if (!unitNumber && !ownerName && Object.keys(row).length <= 1) return null
      if (unitNumber && /^(particulars|unit|flat|plot|id|no|shop|office)$/i.test(unitNumber))
        return null

      const rawArea = Number(
        String(
          getValue([
            'area',
            'sqft',
            'area_sqft',
            'area sqft',
            'plot area sqft',
            'sq.ft',
            'sq-ft',
            'builtup',
            'built up'
          ]) || '0'
        ).replace(/[^0-9.]/g, '')
      )

      const contactNumber = String(
        getValue(['contact', 'contact number', 'mobile', 'phone', 'phone number']) || ''
      ).trim()
      const emailAddress = String(getValue(['email', 'e-mail', 'mail']) || '').trim()
      const normalizedSectorCode =
        sectorNumber.trim().toUpperCase() || inferSectorFromUnitNumber(unitNumber)

      return {
        ...row,
        previewId,
        project_id: effectiveProjectId || 0,
        unit_number: unitNumber,
        sector_code: normalizedSectorCode || undefined,
        unit_type: (() => {
          const raw = String(
            getValue(['bungalow', 'type', 'unit type', 'category', 'usage']) ||
              (normalizedRow['bungalow'] !== undefined ? 'Bungalow' : 'Plot')
          )
            .trim()
            .toLowerCase()

          if (['bungalow', 'yes', 'y', '1', 'true'].includes(raw)) return 'Bungalow'
          return 'Plot' // Default to Plot for 'plot', 'no', 'n', '0', 'false' or any other value
        })(),
        area_sqft: rawArea || defaultArea,
        owner_name: ownerName || '',
        contact_number: contactNumber,
        email: emailAddress,
        status: String(getValue(['status', 'occupancy']) || 'Sold').trim(),
        penalty: Number(getValue(['penalty', 'opening penalty', 'penalty amount']) || 0)
      }
    },
    [projects, ignoreEmptyUnits, defaultArea]
  )

  useEffect(() => {
    if (importData.length > 0) {
      const preview = importData
        .map((row, index) => {
          if (!row.__id) row.__id = `row-${index}`
          return mapRowToUnit(row, importProjectId, `row-${index}`)
        })
        .filter((u): u is ImportUnitPreview => u !== null)
      setMappedPreview(preview)
    } else {
      setMappedPreview([])
    }
  }, [importData, importProjectId, mapRowToUnit])

  const fetchData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [unitsData, projectsData] = await Promise.all([
        window.api.units.getAll(),
        window.api.projects.getAll()
      ])
      setUnits(unitsData)
      setFilteredUnits(unitsData)
      setProjects(projectsData)
      setSelectedRowKeys([])
    } catch {
      message.error('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    const state = location.state as { projectId?: number } | null
    const queryProjectId = Number(new URLSearchParams(location.search).get('projectId'))
    const projectIdFromRoute =
      state?.projectId ??
      (Number.isFinite(queryProjectId) && queryProjectId > 0 ? queryProjectId : undefined)

    if (projectIdFromRoute) {
      setSelectedProject(projectIdFromRoute)
      // Clear route state so refresh does not re-trigger banner messages in future extensions.
      window.history.replaceState({}, document.title)
    }
  }, [location])

  useEffect(() => {
    const filtered = units.filter((unit) => {
      const matchSearch =
        unit.unit_number.toLowerCase().includes(searchText.toLowerCase()) ||
        unit.owner_name.toLowerCase().includes(searchText.toLowerCase()) ||
        (unit.email || '').toLowerCase().includes(searchText.toLowerCase())
      const matchProject = !selectedProject || unit.project_id === selectedProject
      const matchType = !selectedUnitType || unit.unit_type === selectedUnitType
      const matchStatus = !statusFilter || unit.status === statusFilter
      const matchMinArea = areaRange[0] === null || unit.area_sqft >= areaRange[0]
      const matchMaxArea = areaRange[1] === null || unit.area_sqft <= areaRange[1]

      return matchSearch && matchProject && matchType && matchStatus && matchMinArea && matchMaxArea
    })
    setFilteredUnits(filtered)
  }, [searchText, selectedProject, selectedUnitType, statusFilter, areaRange, units])

  const handleAdd = (): void => {
    setEditingUnit(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleEdit = (record: Unit): void => {
    setEditingUnit(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: number): Promise<void> => {
    Modal.confirm({
      title: 'Are you sure?',
      onOk: async () => {
        setLoading(true)
        try {
          await window.api.units.delete(id)
          message.success('Unit deleted')
          fetchData()
        } catch {
          message.error('Failed to delete unit')
        } finally {
          setLoading(false)
        }
      }
    })
  }

  const handleBulkDelete = async (): Promise<void> => {
    // Get the units that will be deleted for undo functionality
    const unitsToDelete = units.filter(u => selectedRowKeys.includes(u.id!))
    
    Modal.confirm({
      title: `Are you sure you want to delete ${selectedRowKeys.length} units?`,
      content: canUndo 
        ? 'You can undo this action immediately after deletion.' 
        : 'This action cannot be undone.',
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'No',
      onOk: async () => {
        setLoading(true)
        try {
          await window.api.units.bulkDelete(selectedRowKeys as number[])
          
          // Add to operation history for undo
          addOperation({
            type: 'delete',
            description: `Deleted ${unitsToDelete.length} unit(s)`,
            data: unitsToDelete,
            restoreFn: async (deletedUnits) => {
              // Restore each deleted unit by recreating it
              for (const unit of deletedUnits) {
                const unitData = { ...unit }
                delete unitData.id
                await window.api.units.create(unitData)
              }
            }
          })
          
          message.success(`Successfully deleted ${selectedRowKeys.length} units`)
          fetchData()
        } catch {
          message.error('Failed to delete units')
        } finally {
          setLoading(false)
        }
      }
    })
  }

  const handleUndoDelete = async (): Promise<void> => {
    const success = await undo()
    if (success) {
      fetchData()
    }
  }

  const handleModalOk = async (): Promise<void> => {
    setLoading(true)
    try {
      const values = await form.validateFields()
      const payload = {
        ...values,
        sector_code:
          String(values.sector_code || '')
            .trim()
            .toUpperCase() || undefined
      }
      if (editingUnit?.id) {
        await window.api.units.update(editingUnit.id, payload)
      } else {
        await window.api.units.create(payload)
      }
      setIsModalOpen(false)
      fetchData()
    } catch {
      // Validation or API errors will show via form or message
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async (file: File): Promise<boolean> => {
    if (selectedProject) {
      setImportProjectId(selectedProject)
    }

    try {
      message.loading({ content: 'Reading Excel file...', key: 'excel_read' })
      const jsonData = await readExcelFile(file)

      if (jsonData.length === 0) {
        message.warning({ content: 'No data found in the Excel file', key: 'excel_read' })
        return false
      }

      message.success({ content: 'Excel file read successfully', key: 'excel_read' })
      setImportData(jsonData)
      setIsImportModalOpen(true)
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

  const handleImportOk = async (): Promise<void> => {
    if (!importProjectId) {
      message.error('Please select a project for import')
      return
    }

    setLoading(true)
    try {
      const parseAmount = (value: unknown): number => {
        if (typeof value === 'number') {
          return Number.isFinite(value) ? value : 0
        }

        const cleaned = String(value ?? '')
          .replace(/,/g, '')
          .replace(/[^0-9.-]/g, '')
          .trim()
        if (!cleaned || cleaned === '-' || cleaned === '.') return 0

        const parsed = Number(cleaned)
        return Number.isFinite(parsed) ? parsed : 0
      }

      const rowsToImport = mappedPreview.map((row) => {
        const years: {
          financial_year: string
          base_amount: number
          arrears: number
          add_ons: { name: string; amount: number }[]
        }[] = []

        const rowKeys = Object.keys(row)
        const normalizedKeyToOriginal = new Map<string, string>()
        for (const key of rowKeys) {
          normalizedKeyToOriginal.set(key.toLowerCase().trim(), key)
        }

        const getRowValue = (possibleKeys: string[]): unknown => {
          for (const possibleKey of possibleKeys) {
            const originalKey = normalizedKeyToOriginal.get(possibleKey.toLowerCase().trim())
            if (!originalKey) continue

            const value = row[originalKey]
            if (value !== undefined && value !== null && String(value).trim() !== '') {
              return value
            }
          }
          return undefined
        }

        const yearKeys = rowKeys.filter((key) => /^\d{4}-\d{2}$/.test(key.trim()))

        for (const [yearIndex, year] of yearKeys.entries()) {
          const baseAmount = parseAmount(row[year])
          const addons: { name: string; amount: number }[] = []

          const appendAddon = (name: string, amount: number): void => {
            if (amount <= 0) return
            const existingAddon = addons.find((addon) => addon.name === name)
            if (existingAddon) {
              existingAddon.amount += amount
            } else {
              addons.push({ name, amount })
            }
          }

          const arrearsValue = getRowValue(['arrears', 'o/s', 'balance', 'outstanding'])
          const arrears = arrearsValue !== undefined ? parseAmount(arrearsValue) : 0

          const legacyAddons = [
            { keys: ['na tax', 'n.a tax'], name: 'NA Tax' },
            { keys: ['cable'], name: 'Cable' },
            { keys: ['rd & na'], name: 'Road & NA Charges' },
            { keys: ['water'], name: 'Water Charges' },
            { keys: ['interest'], name: 'Interest' }
          ]

          for (const addon of legacyAddons) {
            const addonValue = getRowValue(addon.keys)
            if (addonValue !== undefined) {
              appendAddon(addon.name, parseAmount(addonValue))
            }
          }

          // Capture year-adjacent addon columns like GST / Pipe Replacement from ledger-style sheets.
          const currentYearColIndex = rowKeys.indexOf(year)
          const nextYearKey = yearKeys[yearIndex + 1]
          const nextYearColIndex = nextYearKey ? rowKeys.indexOf(nextYearKey) : rowKeys.length

          if (currentYearColIndex >= 0) {
            const segmentEnd =
              nextYearColIndex > currentYearColIndex ? nextYearColIndex : rowKeys.length
            for (
              let columnIndex = currentYearColIndex + 1;
              columnIndex < segmentEnd;
              columnIndex++
            ) {
              const columnKey = rowKeys[columnIndex]
              const normalizedColumnKey = columnKey.toLowerCase().trim()
              const columnAmount = parseAmount(row[columnKey])
              if (columnAmount <= 0) continue

              if (/^gst(?:_\d+)?$/.test(normalizedColumnKey)) {
                appendAddon('GST', columnAmount)
                continue
              }

              if (/^pipe[\s_-]*replac(e)?ment$/.test(normalizedColumnKey)) {
                appendAddon('Pipe Replacement', columnAmount)
              }
            }
          }

          years.push({
            financial_year: year,
            base_amount: baseAmount,
            arrears: arrears,
            add_ons: addons
          })
        }

        return {
          unit_number: row.unit_number,
          sector_code: row.sector_code,
          owner_name: row.owner_name,
          unit_type: row.unit_type,
          area_sqft: row.area_sqft,
          contact_number: row.contact_number,
          email: row.email,
          status: row.status,
          penalty: row.penalty,
          years: years
        }
      })

      if (process.env.NODE_ENV === 'development') {
        console.log('Sending ledger to importLedger:', rowsToImport)
      }
      await window.api.units.importLedger({
        projectId: Number(importProjectId),
        rows: rowsToImport
      })

      if (selectedImportProject) {
        const currentProfile = String(selectedImportProject.import_profile_key || '').trim()
        if (!currentProfile || currentProfile === 'standard_normalized') {
          if (detectedImportProfile.key !== 'standard_normalized') {
            await window.api.projects.update(selectedImportProject.id as number, {
              import_profile_key: detectedImportProfile.key
            })
          }
        } else if (currentProfile !== detectedImportProfile.key) {
          message.warning(
            `Imported workbook looks like "${detectedImportProfile.label}", but project is configured as "${currentProfile}". Review project setup if this was not intentional.`
          )
        }
      }

      // Show next step guidance using utility
      showCompletionWithNextStep(
        'units',
        'Units imported',
        navigate,
        `Successfully imported ${rowsToImport.length} unit records and their history`
      )

      setIsImportModalOpen(false)
      setImportData([])
      setMappedPreview([])
      setImportProjectId(null)
      fetchData()
    } catch (error: unknown) {
      console.error('Import failed:', error)
      const messageText = error instanceof Error ? error.message : 'Check console for details'
      message.error(`Failed to import ledger: ${messageText}`)
    } finally {
      setLoading(false)
    }
  }

  const handlePreviewCellChange = (previewId: string, field: string, value: unknown): void => {
    setMappedPreview((prev) =>
      prev.map((u) => {
        if (u.previewId === previewId) {
          return { ...u, [field]: value }
        }
        return u
      })
    )
  }

  const previewExcelColumns = useMemo(() => {
    if (importData.length === 0 || mappedPreview.length === 0) return []

    const reservedKeys = new Set([
      '__id',
      'previewid',
      'project_id',
      'unit_number',
      'sector_code',
      'owner_name',
      'unit_type',
      'area_sqft',
      'status',
      'contact_number',
      'email',
      'penalty',
      'years',
      'sector',
      'sector no',
      'sector_no',
      'sector number',
      'block'
    ])

    const orderedHeaders: string[] = []
    const seenHeaders = new Set<string>()

    for (const sourceRow of importData) {
      for (const header of Object.keys(sourceRow)) {
        const normalizedHeader = header.toLowerCase().trim()
        if (reservedKeys.has(normalizedHeader) || seenHeaders.has(normalizedHeader)) continue

        const hasValue = mappedPreview.some((previewRow) => {
          const value = previewRow[header]
          return value !== undefined && value !== null && String(value).trim() !== ''
        })
        if (!hasValue) continue

        seenHeaders.add(normalizedHeader)
        orderedHeaders.push(header)
      }
    }

    const parseDisplayNumber = (value: unknown): number | undefined => {
      const cleaned = String(value ?? '')
        .replace(/,/g, '')
        .replace(/[^0-9.-]/g, '')
        .trim()
      if (!cleaned || cleaned === '-' || cleaned === '.') return undefined
      const parsed = Number(cleaned)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    return orderedHeaders.map((header) => {
      const normalizedHeader = header.toLowerCase().trim()
      const isLikelyNumeric =
        /^\d{4}-\d{2}$/.test(header.trim()) ||
        /^gst(?:_\d+)?$/.test(normalizedHeader) ||
        /^pipe[\s_-]*replac(e)?ment$/.test(normalizedHeader) ||
        /^total$/.test(normalizedHeader) ||
        /^sq\.?ft$/.test(normalizedHeader) ||
        /^sq\.?mts$/.test(normalizedHeader)

      return {
        title: header,
        key: `excel_${header}`,
        width: isLikelyNumeric ? 110 : 150,
        render: (_: unknown, record: ImportUnitPreview) => {
          const value = record[header]

          if (isLikelyNumeric) {
            return (
              <InputNumber
                size="small"
                value={parseDisplayNumber(value)}
                onChange={(val) => handlePreviewCellChange(record.previewId, header, val ?? 0)}
                style={{ width: '100%', minWidth: '90px' }}
              />
            )
          }

          return (
            <Input
              size="small"
              value={String(value ?? '')}
              onChange={(e) => handlePreviewCellChange(record.previewId, header, e.target.value)}
              style={{ width: '100%', minWidth: '120px' }}
            />
          )
        }
      }
    })
  }, [importData, mappedPreview])

  const columns = [
    {
      title: 'Project',
      dataIndex: 'project_name',
      key: 'project_name',
      fixed: 'left' as const,
      width: 140,
      sorter: (a: Unit, b: Unit) => (a.project_name || '').localeCompare(b.project_name || '')
    },
    {
      title: 'Unit No',
      dataIndex: 'unit_number',
      key: 'unit_number',
      width: 100,
      sorter: (a: Unit, b: Unit) => a.unit_number.localeCompare(b.unit_number)
    },
    /* Sector column hidden - sector info usually in unit number (e.g., A-101)
    {
      title: 'Sector',
      dataIndex: 'sector_code',
      key: 'sector_code',
      sorter: (a: Unit, b: Unit) =>
        (a.sector_code || '').localeCompare(b.sector_code || '', undefined, {
          numeric: true,
          sensitivity: 'base'
        }),
      render: (text: string) => text || '-'
    },
    */
    {
      title: 'Type',
      dataIndex: 'unit_type',
      key: 'unit_type',
      width: 80,
      sorter: (a: Unit, b: Unit) => (a.unit_type || '').localeCompare(b.unit_type || ''),
      render: (type: string) => {
        const label = type || 'Plot'
        const color = UNIT_TYPE_COLORS[label] || 'default'
        return <Tag color={color}>{label}</Tag>
      }
    },
    {
      title: 'Owner',
      dataIndex: 'owner_name',
      key: 'owner_name',
      width: 150,
      sorter: (a: Unit, b: Unit) => a.owner_name.localeCompare(b.owner_name)
    },
    {
      title: 'Contact',
      dataIndex: 'contact_number',
      key: 'contact_number',
      responsive: ['md' as const],
      sorter: (a: Unit, b: Unit) =>
        (a.contact_number || '').localeCompare(b.contact_number || '', undefined, {
          numeric: true,
          sensitivity: 'base'
        }),
      render: (text: string) => text || '-'
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      responsive: ['md' as const],
      sorter: (a: Unit, b: Unit) =>
        (a.email || '').localeCompare(b.email || '', undefined, {
          numeric: true,
          sensitivity: 'base'
        }),
      render: (text: string) => text || '-'
    },
    {
      title: 'Area (sqft)',
      dataIndex: 'area_sqft',
      key: 'area_sqft',
      width: 100,
      align: 'right' as const,
      sorter: (a: Unit, b: Unit) => a.area_sqft - b.area_sqft
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      sorter: (a: Unit, b: Unit) => (a.status || '').localeCompare(b.status || ''),
      render: (status: string) => {
        const color = status === 'Sold' ? 'success' : 'default'
        return <Tag color={color}>{status || 'Sold'}</Tag>
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right' as const,
      width: 220,
      fixed: 'right' as const,
      render: (_: unknown, record: Unit) => (
        <Space className="table-row-actions" size="small">
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => navigate('/billing', { state: { unitId: record.id } })}
            aria-label={`Generate maintenance letter for unit ${record.unit_number}`}
          >
            Letter
          </Button>
          <Button
            size="small"
            icon={<WalletOutlined />}
            onClick={() => navigate('/payments', { state: { unitId: record.id } })}
            aria-label={`Record payment for unit ${record.unit_number}`}
          >
            Payment
          </Button>
          <Button 
            size="small" 
            icon={<EditOutlined />} 
            onClick={() => handleEdit(record)}
            aria-label={`Edit unit ${record.unit_number}`}
          >
            Edit
          </Button>
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            onClick={() => handleDelete(record.id!)}
            aria-label={`Delete unit ${record.unit_number}`}
          >
            Delete
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="page-screen">
      {/* Enhanced header with selection feedback */}
      <div className="page-hero">
        <div
          className="responsive-page-header"
          style={{
            marginBottom: 24
          }}
        >
          <div>
            <Title level={2} style={{ margin: 0 }}>
              Units
            </Title>
            <Text type="secondary" className="page-hero-subtitle">
              Review owners, import spreadsheets, and prepare units for billing in a faster workflow.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Import, clean, and manage unit records here before billing and payment operations.
            </Text>
          </div>
          <Space wrap className="responsive-action-bar" align="center">
            {canUndo && (
              <Button
                icon={<UndoOutlined />}
                onClick={handleUndoDelete}
                title="Undo last deletion"
                aria-label="Undo last deletion"
              >
                Undo Delete
              </Button>
            )}
            <Upload
              beforeUpload={handleImport}
              showUploadList={false}
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            >
              <Button icon={<UploadOutlined />}>Import Excel</Button>
            </Upload>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>
              Add Unit
            </Button>
          </Space>
        </div>
      </div>

      {selectedRowKeys.length > 0 && (
        <div className="page-selection-bar">
          <Text className="page-selection-label">
            {selectedRowKeys.length} unit{selectedRowKeys.length !== 1 ? 's' : ''} selected
          </Text>
          <Space wrap>
            <Button
              type="primary"
              icon={<FileTextOutlined />}
              onClick={() => navigate('/billing', { state: { unitIds: selectedRowKeys } })}
            >
              Generate Letters ({selectedRowKeys.length})
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>
              Delete ({selectedRowKeys.length})
            </Button>
          </Space>
        </div>
      )}

      <Card className="page-toolbar-card page-table-card unit-table-card">
        <div className="unit-filter-panel">
          <FilterPanel
            filters={unitFilterFields}
            values={unitFilterValues}
            onChange={handleUnitFilterChange}
            onClear={clearAllFilters}
            showActiveFilters={hasActiveFilters}
            variant="plain"
          />
        </div>

        {/* Mobile scroll hint */}
        <div className="table-scroll-hint">
          <span>Swipe horizontally to see more columns</span>
        </div>

        <div className="table-scroll-wrapper mobile-card-table">
          <Table
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys)
            }}
            columns={columns}
            dataSource={filteredUnits}
            rowKey="id"
            loading={loading}
            pagination={{ 
              pageSize: pageSize, 
              showSizeChanger: true, 
              pageSizeOptions: [10, 20, 50],
              onShowSizeChange: (_, size) => setPageSize(size)
            }}
            size="small"
            scroll={{ x: 'max-content' }}
          />
        </div>
      </Card>

      {/* Responsive Import Modal */}
      <Modal
        title="Import Units from Excel"
        open={isImportModalOpen}
        onOk={handleImportOk}
        onCancel={() => {
          setIsImportModalOpen(false)
          setImportData([])
          setMappedPreview([])
        }}
        width={800}
        confirmLoading={loading}
        style={{ maxWidth: '90vw' }}
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
        className="mobile-fullscreen-modal"
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setIsImportModalOpen(false)
              setImportData([])
              setMappedPreview([])
            }}
          >
            Cancel
          </Button>,
          <Button key="submit" type="primary" loading={loading} onClick={handleImportOk}>
            Import Units
          </Button>
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Alert
            message="Autofill Preview"
            description="The system is automatically identifying columns from your Excel. Check the table below to see if the data is being correctly extracted."
            type="info"
            showIcon
          />

          {projects.length === 0 && (
            <Alert
              message="No Projects Found"
              description="You must create a project before you can import units. Please go to the Projects page first."
              type="warning"
              showIcon
            />
          )}

          {/* Responsive form controls */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                alignItems: 'end'
              }}
            >
              <div>
                <Text strong>Step 1: Import to Project</Text>
                <Select
                  placeholder="Select Project"
                  style={{ width: '100%', marginTop: 8 }}
                  status={!importProjectId ? 'error' : undefined}
                  value={importProjectId}
                  onChange={setImportProjectId}
                  allowClear
                  dropdownMatchSelectWidth={false}
                >
                  {projects.map((p) => (
                    <Option key={p.id} value={p.id}>
                      {p.project_code ? `${p.project_code} - ${p.name}` : p.name}
                    </Option>
                  ))}
                </Select>
              </div>
              <div>
                <Text strong>Empty Units</Text>
                <Select
                  value={ignoreEmptyUnits ? 'ignore' : 'keep'}
                  onChange={(val) => setIgnoreEmptyUnits(val === 'ignore')}
                  style={{ width: '100%', marginTop: 8 }}
                  dropdownMatchSelectWidth={false}
                >
                  <Option value="ignore">Ignore Empty</Option>
                  <Option value="keep">Keep Empty</Option>
                </Select>
              </div>
              <div>
                <Text strong>Default Area</Text>
                <InputNumber
                  placeholder="Default Area"
                  value={defaultArea}
                  onChange={(val) => setDefaultArea(val || 0)}
                  style={{ width: '100%', marginTop: 8 }}
                />
              </div>
            </div>
          </div>

          {importData.length > 0 && (
            <>
              {/* Validation Summary Panel */}
              {(importAudit.blockers.length > 0 || importAudit.warnings.length > 0) && (
                <Card
                  size="small"
                  title={
                    <Space>
                      <Text strong>Validation Summary</Text>
                      {importAudit.blockers.length > 0 && (
                        <Tag color="error" icon={<ExclamationCircleOutlined />}>
                          {importAudit.blockers.length} Blockers
                        </Tag>
                      )}
                      {importAudit.warnings.length > 0 && (
                        <Tag color="warning" icon={<WarningOutlined />}>
                          {importAudit.warnings.length} Warnings
                        </Tag>
                      )}
                    </Space>
                  }
                  extra={
                    importAudit.warnings.some(w => w.autoFixable) && (
                      <Button
                        size="small"
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        onClick={() => {
                          // Auto-fix warnings
                          const fixedPreview = mappedPreview.map(row => ({
                            ...row,
                            area_sqft: row.area_sqft || defaultArea,
                            unit_type: row.unit_type || 'Plot'
                          }))
                          setMappedPreview(fixedPreview)
                          message.success('Auto-fixed ' + importAudit.warnings.filter(w => w.autoFixable).length + ' issues')
                        }}
                      >
                        Auto-Fix Issues
                      </Button>
                    )
                  }
                >
                  <Collapse ghost defaultActiveKey={importAudit.blockers.length > 0 ? ['blockers'] : []}>
                    {importAudit.blockers.length > 0 && (
                      <Panel
                        header={
                          <Space>
                            <Text type="danger" strong>
                              <ExclamationCircleOutlined /> Blockers (Must Fix)
                            </Text>
                            <Badge count={importAudit.blockers.length} style={{ backgroundColor: '#ff4d4f' }} />
                          </Space>
                        }
                        key="blockers"
                      >
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {importAudit.blockers.map((blocker, idx) => (
                            <Alert
                              key={idx}
                              message={blocker.message}
                              type="error"
                              showIcon
                              style={{ marginBottom: 8 }}
                              action={
                                blocker.rowCount <= 5 && (
                                  <Button size="small" onClick={() => {
                                    // Scroll to first row with this issue
                                    const firstRow = mappedPreview.findIndex(
                                      r => !String(r[blocker.field as keyof ImportUnitPreview] || '').trim()
                                    )
                                    if (firstRow >= 0) {
                                      message.info(`Row ${firstRow + 1} needs attention`)
                                    }
                                  }}>
                                    View
                                  </Button>
                                )
                              }
                            />
                          ))}
                        </Space>
                      </Panel>
                    )}
                    {importAudit.warnings.length > 0 && (
                      <Panel
                        header={
                          <Space>
                            <Text type="warning" strong>
                              <WarningOutlined /> Warnings (Auto-fixable)
                            </Text>
                            <Badge count={importAudit.warnings.length} style={{ backgroundColor: '#faad14' }} />
                          </Space>
                        }
                        key="warnings"
                      >
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {importAudit.warnings.map((warning, idx) => (
                            <Alert
                              key={idx}
                              message={warning.message}
                              type="warning"
                              showIcon
                              style={{ marginBottom: 8 }}
                            />
                          ))}
                        </Space>
                      </Panel>
                    )}
                  </Collapse>
                  
                  {/* Progress indicator */}
                  <div style={{ marginTop: 12 }}>
                    <Progress
                      percent={Math.round((importAudit.validRows / importAudit.totalRows) * 100)}
                      size="small"
                      status={importAudit.blockers.length > 0 ? 'exception' : 'active'}
                      format={() => `${importAudit.validRows}/${importAudit.totalRows} rows ready`}
                    />
                  </div>
                </Card>
              )}

              {/* Detection Info */}
              <Alert
                message={`Detected Workbook: ${detectedImportProfile.label}`}
                description={
                  <div>
                    <div>{detectedImportProfile.description}</div>
                    <div style={{ marginTop: 4 }}>{detectedImportProfile.reason}</div>
                    <div style={{ marginTop: 8 }}>
                      FY Columns:{' '}
                      {importAudit.yearColumns.length > 0
                        ? importAudit.yearColumns.join(', ')
                        : 'None'}
                      {' | '}Sectors:{' '}
                      {importAudit.sectorCodes.length > 0
                        ? importAudit.sectorCodes.join(', ')
                        : 'None'}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      Owner rows: {importAudit.ownerCount}/{mappedPreview.length}
                      {' | '}Contact rows: {importAudit.contactCount}/{mappedPreview.length}
                      {' | '}Email rows: {importAudit.emailCount}/{mappedPreview.length}
                    </div>
                    {selectedImportProject && (
                      <div style={{ marginTop: 4 }}>
                        Project import profile:{' '}
                        {selectedImportProject.import_profile_key || 'Not configured'}
                      </div>
                    )}
                    {importAudit.duplicateUnits.length > 0 && (
                      <div style={{ marginTop: 4, color: '#d46b08' }}>
                        Duplicate units in preview:{' '}
                        {importAudit.duplicateUnits.slice(0, 5).join(', ')}
                        {importAudit.duplicateUnits.length > 5
                          ? ` and ${importAudit.duplicateUnits.length - 5} more`
                          : ''}
                      </div>
                    )}
                  </div>
                }
                type={
                  selectedImportProject &&
                  selectedImportProject.import_profile_key &&
                  selectedImportProject.import_profile_key !== detectedImportProfile.key
                    ? 'warning'
                    : 'info'
                }
                showIcon
                style={{ marginTop: 16 }}
              />
            </>
          )}

          {mappedPreview.length > 0 && (
            <div>
              <Text strong>Step 2: Preview & Edit Data</Text>
              <Paragraph type="secondary" style={{ fontSize: '12px', marginTop: 4 }}>
                Double-click on any cell to edit. Red borders indicate missing required fields.
              </Paragraph>
              <Paragraph
                type="secondary"
                style={{ fontSize: '12px', marginTop: 0, marginBottom: 8 }}
              >
                Rows loaded: {mappedPreview.length} | Additional Excel columns shown:{' '}
                {previewExcelColumns.length}
              </Paragraph>

              {/* Responsive table container */}
              <div
                style={{
                  width: '100%',
                  overflow: 'auto',
                  border: '1px solid #f0f0f0',
                  borderRadius: '4px',
                  marginTop: 8
                }}
              >
                <Table
                  size="small"
                  pagination={{
                    pageSize: 5,
                    responsive: true,
                    showSizeChanger: false,
                    simple: true
                  }}
                  dataSource={mappedPreview}
                  rowKey="previewId"
                  columns={[
                    {
                      title: 'Project',
                      key: 'project',
                      width: 120,
                      render: () => {
                        const project = projects.find((p) => p.id === Number(importProjectId))
                        return project ? (
                          <Text ellipsis style={{ maxWidth: '100px' }}>
                            {project.name}
                          </Text>
                        ) : (
                          <Text type="danger" ellipsis style={{ maxWidth: '100px' }}>
                            Not Selected
                          </Text>
                        )
                      },
                      responsive: ['md']
                    },
                    {
                      title: 'Unit No',
                      dataIndex: 'unit_number',
                      key: 'unit_number',
                      width: 120,
                      render: (text: string, record: ImportUnitPreview) => (
                        <Input
                          size="small"
                          status={!text ? 'error' : undefined}
                          value={text}
                          onChange={(e) =>
                            handlePreviewCellChange(record.previewId, 'unit_number', e.target.value)
                          }
                          placeholder="Required"
                          style={{ width: '100%', minWidth: '80px' }}
                        />
                      ),
                      responsive: ['xs']
                    },
                    {
                      title: 'Sector',
                      dataIndex: 'sector_code',
                      key: 'sector_code',
                      width: 90,
                      sorter: (a: ImportUnitPreview, b: ImportUnitPreview) =>
                        String(a.sector_code || '').localeCompare(
                          String(b.sector_code || ''),
                          undefined,
                          {
                            numeric: true,
                            sensitivity: 'base'
                          }
                        ),
                      render: (text: string, record: ImportUnitPreview) => (
                        <Input
                          size="small"
                          value={text}
                          onChange={(e) =>
                            handlePreviewCellChange(
                              record.previewId,
                              'sector_code',
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="A/B/C"
                          style={{ width: '100%', minWidth: '70px' }}
                        />
                      ),
                      responsive: ['sm']
                    },
                    {
                      title: 'Owner',
                      dataIndex: 'owner_name',
                      key: 'owner_name',
                      width: 150,
                      render: (text: string, record: ImportUnitPreview) => (
                        <Input
                          size="small"
                          status={!text ? 'error' : undefined}
                          value={text}
                          onChange={(e) =>
                            handlePreviewCellChange(record.previewId, 'owner_name', e.target.value)
                          }
                          placeholder="Required"
                          style={{ width: '100%', minWidth: '100px' }}
                        />
                      ),
                      responsive: ['xs']
                    },
                    {
                      title: 'Type',
                      dataIndex: 'unit_type',
                      key: 'unit_type',
                      width: 100,
                      render: (text: string, record: ImportUnitPreview) => (
                        <Select
                          size="small"
                          value={text}
                          onChange={(val) =>
                            handlePreviewCellChange(record.previewId, 'unit_type', val)
                          }
                          style={{ width: '100%', minWidth: '80px' }}
                          dropdownMatchSelectWidth={false}
                        >
                          {UNIT_TYPES.map((unitType) => (
                            <Option key={unitType} value={unitType}>
                              {unitType}
                            </Option>
                          ))}
                        </Select>
                      ),
                      responsive: ['sm']
                    },
                    {
                      title: 'Area',
                      dataIndex: 'area_sqft',
                      key: 'area_sqft',
                      width: 90,
                      render: (text: number, record: ImportUnitPreview) => (
                        <InputNumber
                          size="small"
                          value={text}
                          onChange={(val) =>
                            handlePreviewCellChange(record.previewId, 'area_sqft', val)
                          }
                          style={{ width: '100%', minWidth: '70px' }}
                        />
                      ),
                      responsive: ['sm']
                    },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      key: 'status',
                      width: 100,
                      render: (text: string, record: ImportUnitPreview) => (
                        <Select
                          size="small"
                          value={text}
                          onChange={(val) =>
                            handlePreviewCellChange(record.previewId, 'status', val)
                          }
                          style={{ width: '100%', minWidth: '80px' }}
                          dropdownMatchSelectWidth={false}
                        >
                          <Option value="Sold">Sold</Option>
                          <Option value="Unsold">Unsold</Option>
                        </Select>
                      ),
                      responsive: ['sm']
                    },
                    {
                      title: 'Contact',
                      dataIndex: 'contact_number',
                      key: 'contact_number',
                      width: 120,
                      sorter: (a: ImportUnitPreview, b: ImportUnitPreview) =>
                        String(a.contact_number || '').localeCompare(
                          String(b.contact_number || ''),
                          undefined,
                          {
                            numeric: true,
                            sensitivity: 'base'
                          }
                        ),
                      render: (text: string, record: ImportUnitPreview) => (
                        <Input
                          size="small"
                          value={text}
                          onChange={(e) =>
                            handlePreviewCellChange(
                              record.previewId,
                              'contact_number',
                              e.target.value
                            )
                          }
                          style={{ width: '100%', minWidth: '100px' }}
                        />
                      )
                    },
                    {
                      title: 'Email',
                      dataIndex: 'email',
                      key: 'email',
                      width: 180,
                      sorter: (a: ImportUnitPreview, b: ImportUnitPreview) =>
                        String(a.email || '').localeCompare(String(b.email || ''), undefined, {
                          numeric: true,
                          sensitivity: 'base'
                        }),
                      render: (text: string, record: ImportUnitPreview) => (
                        <Input
                          size="small"
                          value={text}
                          onChange={(e) =>
                            handlePreviewCellChange(record.previewId, 'email', e.target.value)
                          }
                          style={{ width: '100%', minWidth: '140px' }}
                        />
                      )
                    },
                    {
                      title: 'Legacy Penalty',
                      dataIndex: 'penalty',
                      key: 'penalty',
                      width: 100,
                      render: (text: number, record: ImportUnitPreview) => (
                        <InputNumber
                          size="small"
                          value={text}
                          onChange={(val) =>
                            handlePreviewCellChange(record.previewId, 'penalty', val)
                          }
                          style={{ width: '100%', minWidth: '70px' }}
                        />
                      ),
                      responsive: ['md']
                    },
                    ...previewExcelColumns
                  ]}
                  scroll={{ x: 'max-content' }}
                  style={{ minWidth: '600px' }}
                  components={{
                    header: {
                      cell: ({ style, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
                        <th {...props} style={{ ...style, whiteSpace: 'nowrap' }} />
                      )
                    }
                  }}
                />
              </div>
            </div>
          )}

          {importData.length > 0 && mappedPreview.length === 0 && (
            <Alert
              message="No units recognized"
              description="Could not find any unit numbers in the uploaded file. Please make sure your Excel has a column for Unit Number or Flat Number."
              type="warning"
              showIcon
            />
          )}
        </Space>
      </Modal>

      <Modal
        title={editingUnit ? 'Edit Unit' : 'Add Unit'}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => {
          setIsModalOpen(false)
        }}
        width={640}
        style={{ 
          maxWidth: '95vw',
          margin: '0 auto'
        }}
        centered
        className="unit-modal-responsive"
        bodyStyle={{ padding: '12px 16px', maxHeight: '70vh', overflowY: 'auto' }}
      >
        {/* Breadcrumb navigation for editing - styled like Generate Maintenance Letter */}
        {editingUnit && (
          <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fafafa', borderRadius: 10 }}>
            <Space size="small" align="center">
              <Button
                type="text"
                size="small"
                style={{ fontWeight: 600, padding: '4px 8px' }}
                onClick={() => document.getElementById('unit-info-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                1. Unit Info
              </Button>
              <span style={{ color: '#999' }}>{'->'}</span>
              <Button
                type="text"
                size="small"
                style={{ fontWeight: 600, padding: '4px 8px' }}
                onClick={() => document.getElementById('owner-details-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                2. Owner Details
              </Button>
              <span style={{ color: '#999' }}>{'->'}</span>
              <Button
                type="text"
                size="small"
                style={{ fontWeight: 600, padding: '4px 8px' }}
                onClick={() => document.getElementById('address-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                3. Address
              </Button>
            </Space>
            <div style={{ marginTop: 6, fontSize: '11.5px', color: '#666' }}>
              Editing: <strong>{editingUnit.unit_number}</strong> | Owner: {editingUnit.owner_name}
            </div>
          </div>
        )}

        <Form
          form={form}
          layout="vertical"
          initialValues={{ 
            unit_type: 'Bungalow', 
            status: 'Sold', 
            penalty: 0,
            project_id: selectedProject || undefined
          }}
        >
          {/* ── Project & Identity ── */}
          <div id="unit-info-section">
            <Divider orientation={'left' as DividerProps['orientation']} plain style={{ marginTop: 0 }}>
              Unit Information
            </Divider>
            <Text type="secondary" className="page-helper-text">
              Late-payment penalty is managed in Project Rates, not at unit level.
            </Text>
            <Row gutter={[16, 8]} className="unit-info-row">
            <Col span={24}>
              <Form.Item
                name="project_id"
                label="Project"
                rules={[{ required: true, message: 'Please select a project' }]}
              >
                <Select disabled={!!editingUnit} style={{ width: '100%' }}>
                  {projects.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.project_code ? `${s.project_code} - ${s.name}` : s.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="unit_number"
                label="Unit Number"
                rules={[{ required: true, message: 'Please enter unit number' }]}
              >
                <Input placeholder="e.g. A-001" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            
            <Col xs={24} sm={12}>
              <Form.Item name="sector_code" label="Sector / Block Code">
                <Input placeholder="e.g. A, B, C" style={{ width: '100%' }} />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="unit_type"
                label="Unit Type"
                rules={[{ required: true, message: 'Please select unit type' }]}
              >
                <Select style={{ width: '100%' }}>
                  <Option value="Plot">Plot</Option>
                  <Option value="Bungalow">Bungalow</Option>
                  <Option value="Garden">Garden</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="area_sqft"
                label="Area (sqft)"
                rules={[{ required: true, message: 'Please enter area' }]}
              >
                <InputNumber style={{ width: '100%' }} min={1} />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="status"
                label="Status"
                rules={[{ required: true, message: 'Please select status' }]}
              >
                <Select style={{ width: '100%' }}>
                  <Option value="Sold">Sold</Option>
                  <Option value="Unsold">Unsold</Option>
                  <Option value="Vacant">Vacant</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="penalty" label="Opening Penalty (₹)">
                <InputNumber<number>
                  style={{ width: '100%' }}
                  min={0}
                  formatter={(value) => `₹ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(displayValue) =>
                    displayValue?.replace(/₹\s?|(,*)/g, '') as unknown as number
                  }
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="penalty_percentage" label="Late Payment Charges (%)" style={{ marginBottom: 0 }}>
                <InputNumber<number>
                  style={{ width: '100%' }}
                  min={0}
                  max={100}
                  formatter={(value) => `${value}%`}
                  parser={(displayValue) =>
                    displayValue?.replace('%', '') as unknown as number
                  }
                  placeholder="Leave blank to use project default"
                />
              </Form.Item>
            </Col>
          </Row>
          </div>

          {/* ── Owner Details ── */}
          <div id="owner-details-section">
            <Divider orientation={'left' as DividerProps['orientation']} plain>
              Owner Details
            </Divider>
            <Row gutter={[16, 8]}>
            <Col span={24}>
              <Form.Item
                name="owner_name"
                label="Owner Name"
                rules={[{ required: true, message: 'Please enter owner name' }]}
              >
                <Input placeholder="Full name of owner" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            
            <Col xs={24} sm={12}>
              <Form.Item name="contact_number" label="Contact Number">
                <Input placeholder="Mobile / phone number" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="email" label="Email Address">
                <Input type="email" placeholder="owner@email.com" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            </Row>
          </div>

          {/* ── Address Details ── */}
          <div id="address-section">
            <Divider orientation={'left' as DividerProps['orientation']} plain>
              Address Details
            </Divider>
            <Row gutter={[16, 8]}>
              <Col span={24}>
                <Form.Item name="billing_address" label="Billing Address">
                  <Input.TextArea
                    rows={2}
                    placeholder="Address for maintenance letter / invoice delivery"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="resident_address" label="Resident / Current Address">
                  <Input.TextArea
                    rows={2}
                    placeholder="Current residential address (if different from billing)"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default Units
