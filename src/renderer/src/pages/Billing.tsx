import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Select,
  DatePicker,
  message,
  Typography,
  Tag,
  notification,
  Input,
  Card,
  Divider,
  InputNumber,
  Alert,
  Progress,
  List,
  Spin,
  Dropdown,
  Row,
  Col
} from 'antd'
import {
  getUpcomingFinancialYear,
  isValidFinancialYear
} from '../utils/financialYear'
import {
  FilePdfOutlined,
  PlusOutlined,
  FolderOpenOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  SearchOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'

import {
  MaintenanceLetter,
  Project,
  LetterAddOn,
  Unit,
  ProjectSetupSummary,
  MaintenanceRate
} from '@preload/types'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'
import { UNIT_TYPE_FILTER_OPTIONS } from '../constants/unitTypes'
import FilterPanel, {
  createSearchFilter,
  createSelectFilter
} from '../components/shared/FilterPanel'
import { useWorkingFinancialYear } from '../context/WorkingFinancialYearContext'

const { Title, Text } = Typography
const { Option } = Select

interface PdfProgress {
  current: number
  total: number
  currentLetter?: { id: number; unit_number: string; owner_name: string }
  completed: Array<{
    id: number
    path: string
    success: boolean
    unit_number: string
    owner_name: string
  }>
}

interface BatchLetterConfigSnapshot {
  project_id: number
  financial_year: string
  letter_date: Dayjs
  due_date: Dayjs
  add_ons?: Array<{
    addon_name: string
    addon_amount: number
    remarks?: string
  }>
}

const Billing: React.FC = () => {
  const { workingFY } = useWorkingFinancialYear()
  const [letters, setLetters] = useState<MaintenanceLetter[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)

  const defaultFY = workingFY
  const upcomingFY = getUpcomingFinancialYear(defaultFY)
  const [selectedYear, setSelectedYear] = useState<string | null>(defaultFY)

  const [selectedUnitType, setSelectedUnitType] = useState<string | null>('All')

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [searchText, setSearchText] = useState('')
  const [addOnsModalVisible, setAddOnsModalVisible] = useState(false)
  const [currentLetterAddOns, setCurrentLetterAddOns] = useState<LetterAddOn[]>([])
  const [currentLetter, setCurrentLetter] = useState<MaintenanceLetter | null>(null)
  const [form] = Form.useForm()
  const location = useLocation()
  const navigate = useNavigate()
  const [passedUnitIds, setPassedUnitIds] = useState<number[]>([])

  // PDF generation state
  const [pageSize, setPageSize] = useState(10)

  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null)
  const [selectedUnitIds, setSelectedUnitIds] = useState<number[]>([])
  const [batchModalStep, setBatchModalStep] = useState<'config' | 'units'>('config')
  const [projectUnits, setProjectUnits] = useState<Unit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [unitSearchText, setUnitSearchText] = useState('')
  const [unitSelectionStatusFilter, setUnitSelectionStatusFilter] = useState<'all' | 'ready' | 'billed'>('all')
  const [unitSelectionPage, setUnitSelectionPage] = useState(1)
  const [unitSelectionPageSize, setUnitSelectionPageSize] = useState(8)
  const [batchProjectId, setBatchProjectId] = useState<number | null>(null)
  const [batchFinancialYear, setBatchFinancialYear] = useState<string | null>(defaultFY)
  const [batchConfigSnapshot, setBatchConfigSnapshot] = useState<BatchLetterConfigSnapshot | null>(null)
  const [projectSetupSummary, setProjectSetupSummary] = useState<ProjectSetupSummary | null>(null)
  const [setupSummaryLoading, setSetupSummaryLoading] = useState(false)
  const [rateDueDateHint, setRateDueDateHint] = useState<string | null>(null)
  const [lastAutoSyncedDueDate, setLastAutoSyncedDueDate] = useState<string | null>(null)

  const [copyingAddOns, setCopyingAddOns] = useState(false)

  // Fetch add-ons from previous year for copy functionality
  const handleCopyFromPreviousYear = async (): Promise<void> => {
    const projectId = form.getFieldValue('project_id')
    const currentFY = form.getFieldValue('financial_year')
    
    if (!projectId || !currentFY) {
      message.warning('Please select project and financial year first')
      return
    }

    // Find the most recent previous year that has letters
    const previousYears = uniqueYears
      .filter(year => year < currentFY)
      .sort()
      .reverse()
    
    if (previousYears.length === 0) {
      message.info('No previous year data available to copy from')
      return
    }

    setCopyingAddOns(true)
    try {
      // Try each previous year until we find one with add-ons
      for (const prevYear of previousYears) {
        const prevYearLetters = letters.filter(
          l => l.project_id === projectId && l.financial_year === prevYear
        )
        
        if (prevYearLetters.length > 0 && prevYearLetters[0].id) {
          // Get add-ons from the first letter of the previous year
          const prevAddOns = await window.api.letters.getAddOns(prevYearLetters[0].id)
          
          if (prevAddOns && prevAddOns.length > 0) {
            form.setFieldsValue({
              add_ons: prevAddOns.map((a: LetterAddOn) => ({
                addon_name: a.addon_name,
                addon_amount: a.addon_amount,
                remarks: a.remarks
              }))
            })
            message.success(`Copied ${prevAddOns.length} add-on(s) from ${prevYear}`)
            return
          }
        }
      }
      
      message.info('No add-ons found in previous years to copy')
    } catch (error) {
      console.error('Failed to copy add-ons from previous year:', error)
      message.error('Failed to copy from previous year')
    } finally {
      setCopyingAddOns(false)
    }
  }

  const fetchData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [lettersData, projectsData] = await Promise.all([
        window.api.letters.getAll(),
        window.api.projects.getAll()
      ])
      setLetters(lettersData)
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
    // Handle navigation shortcuts from Units page
    const state = location.state as { unitId?: number; unitIds?: number[] }
    if (state) {
      if (state.unitId) {
        setPassedUnitIds([state.unitId])
        setIsModalOpen(true)
      } else if (state.unitIds && state.unitIds.length > 0) {
        setPassedUnitIds(state.unitIds as number[])
        setIsModalOpen(true)
      }
      // Clear navigation state to prevent re-triggering on refresh
      window.history.replaceState({}, document.title)
    }
  }, [location])

  useEffect(() => {
    if (!isModalOpen) {
      setProjectUnits([])
      setUnitsLoading(false)
      setUnitSearchText('')
      setUnitSelectionStatusFilter('all')
      setUnitSelectionPage(1)
      setProjectSetupSummary(null)
      setRateDueDateHint(null)
      setLastAutoSyncedDueDate(null)
      setSelectedUnitIds([])
      return
    }
    if (!batchProjectId) {
      setProjectUnits([])
      if (passedUnitIds.length === 0) {
        setSelectedUnitIds([])
      }
      setUnitSelectionPage(1)
      return
    }
    setUnitsLoading(true)
    window.api.units
      .getByProject(batchProjectId)
      .then((data) => {
        setProjectUnits(data)

        if (passedUnitIds.length > 0) {
          const validPassedIds = new Set(data.map((unit) => unit.id as number))
          setSelectedUnitIds(passedUnitIds.filter((id) => validPassedIds.has(id)))
        } else {
          setSelectedUnitIds([])
        }
      })
      .catch(() => {
        message.error('Failed to load units for selected project')
        setProjectUnits([])
      })
      .finally(() => setUnitsLoading(false))
  }, [batchProjectId, isModalOpen, passedUnitIds])

  useEffect(() => {
    setUnitSelectionPage(1)
  }, [unitSearchText, unitSelectionStatusFilter, batchProjectId, batchFinancialYear])

  useEffect(() => {
    if (!isModalOpen || !batchProjectId || !batchFinancialYear) {
      setProjectSetupSummary(null)
      return
    }

    let isCancelled = false
    setSetupSummaryLoading(true)
    window.api.projects
      .getSetupSummary(batchProjectId, batchFinancialYear)
      .then((summary) => {
        if (!isCancelled) {
          setProjectSetupSummary(summary)
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error('Failed to load project setup summary:', error)
          setProjectSetupSummary(null)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setSetupSummaryLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [batchFinancialYear, batchProjectId, isModalOpen])

  useEffect(() => {
    if (!isModalOpen || !batchProjectId || !batchFinancialYear || !!currentLetter) {
      setRateDueDateHint(null)
      return
    }

    let isCancelled = false

    const syncDueDateFromRate = async (): Promise<void> => {
      try {
        const rates = (await window.api.rates.getByProject(batchProjectId)).filter(
          (rate: MaintenanceRate) => rate.financial_year === batchFinancialYear
        )

        if (rates.length === 0) {
          if (!isCancelled) {
            setRateDueDateHint(null)
          }
          return
        }

        const slabGroups = await Promise.all(
          rates
            .filter((rate) => rate.id)
            .map(async (rate) => ({
              slabs: await window.api.rates.getSlabs(rate.id as number)
            }))
        )

        const dueDates = Array.from(
          new Set(
            slabGroups
              .flatMap(({ slabs }) => slabs)
              .filter((slab) => slab.is_early_payment && slab.due_date)
              .map((slab) => slab.due_date)
          )
        ).sort()

        if (isCancelled || dueDates.length === 0) {
          if (!isCancelled) {
            setRateDueDateHint(null)
          }
          return
        }

        const selectedDueDate = dueDates[0]
        const existingDueDateValue = form.getFieldValue('due_date') as Dayjs | undefined
        const existingDueDate = existingDueDateValue?.isValid()
          ? existingDueDateValue.format('YYYY-MM-DD')
          : null
        const canAutoApply =
          !existingDueDate || !lastAutoSyncedDueDate || existingDueDate === lastAutoSyncedDueDate

        if (canAutoApply) {
          form.setFieldValue('due_date', dayjs(selectedDueDate))
          setLastAutoSyncedDueDate(selectedDueDate)
        }

        if (dueDates.length === 1) {
          setRateDueDateHint(
            canAutoApply
              ? `Due date synced from rate setup: ${dayjs(selectedDueDate).format('DD MMM YYYY')}`
              : `Rate setup suggests due date ${dayjs(selectedDueDate).format('DD MMM YYYY')}. Your manually chosen due date was kept.`
          )
        } else {
          setRateDueDateHint(
            canAutoApply
              ? `Multiple due dates exist for ${batchFinancialYear}. The earliest configured due date (${dayjs(selectedDueDate).format('DD MMM YYYY')}) was applied.`
              : `Multiple due dates exist for ${batchFinancialYear}. The earliest configured due date is ${dayjs(selectedDueDate).format('DD MMM YYYY')}, but your manual due date was kept.`
          )
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to sync due date from maintenance rate:', error)
          setRateDueDateHint(null)
        }
      }
    }

    syncDueDateFromRate()

    return () => {
      isCancelled = true
    }
  }, [batchFinancialYear, batchProjectId, currentLetter, form, isModalOpen, lastAutoSyncedDueDate])

  const getDisplayStatus = useCallback(
    (letter: MaintenanceLetter): 'Generated' | 'Modified' | 'Paid' | 'Pending' | 'Overdue' => {
      const rawStatus = (letter.status || '').trim().toLowerCase()
      
      // Paid status takes precedence
      if (rawStatus === 'paid' || !!letter.is_paid) return 'Paid'

      // Modified status takes precedence (user explicitly modified)
      if (rawStatus === 'modified') return 'Modified'

      // If letter has generated_date, treat as Generated (regardless of status field)
      if (letter.generated_date && dayjs(letter.generated_date).isValid()) {
        // Check if it's overdue
        if (letter.due_date && dayjs(letter.due_date).isBefore(dayjs(), 'day')) {
          return 'Overdue'
        }
        return 'Generated'
      }

      // Default to Pending for letters without generated_date
      if (letter.due_date && dayjs(letter.due_date).isBefore(dayjs(), 'day')) {
        return 'Overdue'
      }
      
      return 'Pending'
    },
    []
  )

  // Calculate filter statistics based on currently filtered letters
  const filterStats = useMemo(() => {
    // Apply all current filters first, then calculate status counts
    const currentlyFilteredLetters = letters.filter((letter) => {
      const matchProject = !selectedProject || letter.project_id === selectedProject
      const matchYear = !selectedYear || letter.financial_year === selectedYear
      const matchSearch =
        !searchText ||
        letter.unit_number?.toLowerCase().includes(searchText.toLowerCase()) ||
        letter.owner_name?.toLowerCase().includes(searchText.toLowerCase())
      const matchUnitType =
        !selectedUnitType || selectedUnitType === 'All' || letter.unit_type === selectedUnitType

      return matchProject && matchYear && matchSearch && matchUnitType
    })

    const generated = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Generated').length
    const modified = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Modified').length
    const pending = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Pending').length
    const paid = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Paid').length
    const overdue = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Overdue').length

    return { generated, modified, pending, paid, overdue }
  }, [letters, selectedProject, selectedYear, searchText, selectedUnitType, getDisplayStatus])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return Boolean(
      searchText ||
      selectedProject !== null ||
      selectedYear !== defaultFY ||
      selectedStatus !== null ||
      (selectedUnitType !== null && selectedUnitType !== 'All')
    )
  }, [
    searchText,
    selectedProject,
    selectedYear,
    selectedStatus,
    selectedUnitType,
    defaultFY
  ])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setSelectedProject(null)
    setSelectedYear(defaultFY)
    setSelectedStatus(null)
    setSelectedUnitType('All')
    setSelectedRowKeys([])
  }, [defaultFY])

  const handleBatchGenerate = (): void => {
    setPassedUnitIds([])
    setSelectedUnitIds([])
    setBatchModalStep('config')
    setBatchProjectId(null)
    setBatchFinancialYear(selectedYear || defaultFY)
    setBatchConfigSnapshot(null)
    form.resetFields()
    setProjectSetupSummary(null)
    setRateDueDateHint(null)
    setCurrentLetter(null) // Clear any existing letter when creating new
    
    // Set default add-ons for new letters
    form.setFieldsValue({
      add_ons: [
        { addon_name: 'N.A. Tax', addon_amount: 0 },
        { addon_name: 'Solar Contribution', addon_amount: 0 },
        { addon_name: 'Cable Charges', addon_amount: 0 }
      ]
    })
    
    setIsModalOpen(true)
  }

  const showProjectSetupBlockingModal = useCallback(
    (summary: ProjectSetupSummary, projectId: number): void => {
      const hasNonRateBlockers = summary.blockers.some(
        (blocker) => !blocker.toLowerCase().includes('rate')
      )
      const navigationState = hasNonRateBlockers
        ? { openEditProjectId: projectId }
        : { openRatesProjectId: projectId }

      Modal.confirm({
        title: 'Project setup incomplete',
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>
              Fix the following before generating maintenance letters:
            </div>
            <ul style={{ paddingLeft: 20, marginBottom: summary.warnings.length > 0 ? 12 : 0 }}>
              {summary.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            {summary.warnings.length > 0 && (
              <>
                <div style={{ marginBottom: 8 }}>Warnings:</div>
                <ul style={{ paddingLeft: 20 }}>
                  {summary.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ),
        okText: hasNonRateBlockers ? 'Open Project Setup' : 'Open Rates',
        cancelText: 'Close',
        onOk: () => {
          setIsModalOpen(false)
          setBatchModalStep('config')
          navigate('/projects', { state: navigationState })
        }
      })
    },
    [navigate]
  )

  const ensureProjectReadyForLetters = useCallback(
    async (projectId: number, financialYear: string): Promise<boolean> => {
      const summary = await window.api.projects.getSetupSummary(projectId, financialYear)
      setProjectSetupSummary(summary)
      if (!summary.ready_for_letters) {
        showProjectSetupBlockingModal(summary, projectId)
        return false
      }
      return true
    },
    [showProjectSetupBlockingModal]
  )

  const handleShowAddOns = async (record: MaintenanceLetter): Promise<void> => {
    if (!record.id) return
    try {
      setLoading(true)
      const data = await window.api.letters.getAddOns(record.id)
      setCurrentLetterAddOns(data)
      setCurrentLetter(record)
      setAddOnsModalVisible(true)
    } catch {
      message.error('Failed to fetch add-ons')
    } finally {
      setLoading(false)
    }
  }

  const handleModalOk = async (): Promise<void> => {
    if (batchModalStep === 'config') {
      // Validate configuration step
      try {
        const values = await form.validateFields([
          'project_id',
          'financial_year',
          'letter_date',
          'due_date',
          'add_ons'
        ])
        const projectId = values.project_id
        const financialYear = values.financial_year
        if (projectId && financialYear) {
          const isReady = await ensureProjectReadyForLetters(projectId, financialYear)
          if (!isReady) return
          setBatchProjectId(projectId)
          setBatchFinancialYear(financialYear)
          setBatchConfigSnapshot({
            project_id: projectId,
            financial_year: financialYear,
            letter_date: values.letter_date,
            due_date: values.due_date,
            add_ons: values.add_ons || []
          })
          // Move to unit selection step
          setBatchModalStep('units')
        }
      } catch {
        // Validation will show errors
      }
    } else {
      // Generate letters or update existing letter
      try {
        const values = currentLetter
          ? await form.validateFields()
          : batchConfigSnapshot

        if (!values?.letter_date || !values?.due_date) {
          throw new Error('Letter configuration is missing. Please go back to step 1 and recheck the dates.')
        }

        const { project_id, financial_year, letter_date, due_date, add_ons } = values

        const letterDate = letter_date.format('YYYY-MM-DD')
        const dueDate = due_date.format('YYYY-MM-DD')

        setLoading(true)

        // Check if we're editing an existing letter
        if (currentLetter && currentLetter.id) {
          // Update existing letter
          if (process.env.NODE_ENV === 'development') {
            console.log('Updating letter', {
              id: currentLetter.id,
              due_date: dueDate,
              generated_date: letterDate
            })
          }
          
          // First update the basic letter fields
          const success = await window.api.letters.update(currentLetter.id, {
            due_date: dueDate,
            generated_date: letterDate,
            status: 'Modified'  // Mark as modified when edited
          })
          
          if (!success) {
            message.error('Failed to update letter')
            return
          }
          
          // Now handle addons - get existing addons and compare with new ones
          const existingAddons = await window.api.letters.getAddOns(currentLetter.id)
          const newAddons = add_ons || []
          type EditableAddon = Pick<LetterAddOn, 'addon_name' | 'addon_amount'>
          
          // Delete addons that are no longer present
          for (const existingAddon of existingAddons) {
            const stillExists = newAddons.find((newAddOn: EditableAddon) => 
              newAddOn.addon_name === existingAddon.addon_name && 
              newAddOn.addon_amount === existingAddon.addon_amount
            )
            if (!stillExists) {
              // Find the addon ID to delete
              // Note: We need to match by name and amount since we don't have the ID in the form
              const addonToDelete = existingAddons.find((a: LetterAddOn) => 
                a.addon_name === existingAddon.addon_name && 
                a.addon_amount === existingAddon.addon_amount
              )
              if (addonToDelete?.id) {
                await window.api.letters.deleteAddOn(addonToDelete.id)
              }
            }
          }
          
          // Add new or updated addons
          for (const newAddon of newAddons) {
            const exists = existingAddons.find((existingAddon: LetterAddOn) => 
              existingAddon.addon_name === newAddon.addon_name && 
              existingAddon.addon_amount === newAddon.addon_amount
            )
            if (!exists) {
              // Add new addon
              await window.api.letters.addAddOn({
                unit_id: currentLetter.unit_id,
                financial_year: currentLetter.financial_year,
                addon_name: newAddon.addon_name,
                addon_amount: newAddon.addon_amount,
                remarks: newAddon.remarks
              })
            }
          }
          
          // Regenerate PDF with updated addons
          try {
            await window.api.letters.generatePdf(currentLetter.id)
            if (process.env.NODE_ENV === 'development') {
              console.log('PDF regenerated with updated add-ons')
            }
          } catch (pdfError) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('Failed to regenerate PDF:', pdfError)
            }
            // Don't fail the update if PDF generation fails
          }
          
          message.success('Letter updated successfully with addon changes')
        } else {
          // Create new letters
          const isReady = await ensureProjectReadyForLetters(project_id, financial_year)
          if (!isReady) return
          const batchResult = await window.api.letters.createBatch({
            projectId: project_id,
            unitIds: selectedUnitIds.length > 0 ? selectedUnitIds : undefined,
            financialYear: financial_year,
            letterDate,
            dueDate,
            addOns: (add_ons || []).map((ao: { addon_name: string; addon_amount: number }) => ({
              addon_name: ao.addon_name,
              addon_amount: ao.addon_amount
            }))
          })
          const completionMessage =
            batchResult.skippedCount > 0
              ? `Generated ${batchResult.createdCount} letter(s); skipped ${batchResult.skippedCount} existing record(s)`
              : `Generated ${batchResult.createdCount} maintenance letter(s) successfully`
          showCompletionWithNextStep('billing', completionMessage, navigate)
        }
        
        setIsModalOpen(false)
        setBatchModalStep('config')
        setBatchProjectId(null)
        setBatchFinancialYear(selectedYear || defaultFY)
        setBatchConfigSnapshot(null)
        setCurrentLetter(null) // Clear current letter
        fetchData()
      } catch (error: unknown) {
        console.error(error)
        const messageText = error instanceof Error ? error.message : String(error)
        const errorMessage = messageText.includes('Error:')
          ? messageText.split('Error:')[1].trim()
          : messageText || 'Failed to generate maintenance letters'

        if (errorMessage.includes('Project setup incomplete')) {
          const projectId = form.getFieldValue('project_id') as number | undefined
          const financialYear = form.getFieldValue('financial_year') as string | undefined
          if (projectId && financialYear) {
            const summary = await window.api.projects.getSetupSummary(projectId, financialYear)
            setProjectSetupSummary(summary)
            showProjectSetupBlockingModal(summary, projectId)
            return
          }
        }

        if (
          errorMessage.includes('No maintenance rate found for this Project and Financial Year')
        ) {
          const projectId = form.getFieldValue('project_id') as number | undefined
          Modal.confirm({
            title: 'Maintenance rate missing',
            content: errorMessage,
            okText: 'Open Rates',
            cancelText: 'Close',
            onOk: () => {
              setIsModalOpen(false)
              setBatchModalStep('config')
              navigate('/projects', { state: { openRatesProjectId: projectId } })
            }
          })
          return
        }

        message.error(errorMessage)
      } finally {
        setLoading(false)
      }
    }
  }

  const handleViewPdf = async (id: number): Promise<void> => {
    try {
      message.loading({ content: 'Generating Letter...', key: 'pdf_gen' })
      const path = await window.api.letters.generatePdf(id)
      message.success({ content: 'Maintenance Letter generated successfully!', key: 'pdf_gen' })
      notification.success({
        message: 'Letter Ready',
        description: `Maintenance Letter has been saved.`,
        btn: (
          <Button
            type="primary"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => window.api.shell.showItemInFolder(path)}
          >
            Show in Folder
          </Button>
        ),
        placement: 'bottomRight'
      })
    } catch {
      message.error({ content: 'Failed to generate letter', key: 'pdf_gen' })
    }
  }

  const handleOpenLettersFolder = useCallback(async (): Promise<void> => {
    try {
      await window.api.shell.openOutputFolder('maintenance-letters')
    } catch {
      message.error('Failed to open maintenance letters folder')
    }
  }, [])

  const handleDownloadLettersZip = useCallback(async (): Promise<void> => {
    try {
      const timestamp = dayjs().format('YYYYMMDD_HHmmss')
      const destinationPath = await window.api.dialog.saveFile({
        title: 'Save Letters ZIP',
        defaultPath: `maintenance_letters_${timestamp}.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      })

      if (!destinationPath) return

      message.loading({ content: 'Creating ZIP...', key: 'letters_zip' })
      const result = await window.api.shell.exportOutputZip('maintenance-letters', destinationPath)
      message.success({
        content: `ZIP saved with ${result.fileCount} letter PDF${result.fileCount !== 1 ? 's' : ''}`,
        key: 'letters_zip'
      })
    } catch (error) {
      console.error('Failed to export letters ZIP:', error)
      message.error({ content: 'Failed to create letters ZIP', key: 'letters_zip' })
    }
  }, [])

  const handleEditLetter = async (record: MaintenanceLetter): Promise<void> => {
    if (!record.id) return
    try {
      message.loading({ content: 'Loading letter...', key: 'letter_edit' })
      
      const addOns = await window.api.letters.getAddOns(record.id)
      
      // Prepare form values before opening modal
      const formValues = {
        project_id: record.project_id,
        financial_year: record.financial_year,
        letter_date: record.generated_date ? dayjs(record.generated_date) : dayjs(),
        due_date: record.due_date ? dayjs(record.due_date) : dayjs().add(15, 'day'),
        add_ons: (addOns || []).map((a: LetterAddOn) => ({
          addon_name: a.addon_name,
          addon_amount: a.addon_amount,
          remarks: a.remarks
        }))
      }

      // Set state first
      setPassedUnitIds([record.unit_id])
      setSelectedUnitIds([])
      setBatchModalStep('config')
      setBatchProjectId(record.project_id)
      setBatchFinancialYear(record.financial_year)
      setBatchConfigSnapshot({
        project_id: record.project_id,
        financial_year: record.financial_year,
        letter_date: formValues.letter_date,
        due_date: formValues.due_date,
        add_ons: formValues.add_ons
      })
      setCurrentLetter(record)
      
      // Open modal with form values ready
      form.setFieldsValue(formValues)
      setIsModalOpen(true)

      message.success({ content: 'Letter ready to edit', key: 'letter_edit' })
    } catch {
      message.error({ content: 'Failed to load letter for editing', key: 'letter_edit' })
    }
  }

  const handleBatchPdf = async (): Promise<void> => {
    if (selectedRowKeys.length === 0) {
      message.warning('Please select letters to generate PDFs for')
      return
    }

    setGeneratingPdf(true)
    setPdfProgress({
      current: 0,
      total: selectedRowKeys.length,
      completed: []
    })

    const letterIds = selectedRowKeys as number[]
    const completedLetters: PdfProgress['completed'] = []

    for (let i = 0; i < letterIds.length; i++) {
      const letterId = letterIds[i]
      
      // Find letter details from the letters array
      const letter = letters.find((l) => l.id === letterId)
      const letterInfo = {
        id: letterId,
        unit_number: letter?.unit_number || `Unit ${letterId}`,
        owner_name: letter?.owner_name || 'Unknown'
      }
      
      // Update current letter being processed
      setPdfProgress((prev) =>
        prev
          ? {
              ...prev,
              currentLetter: letterInfo
            }
          : null
      )

      try {
        const path = await window.api.letters.generatePdf(letterId)
        const completed = {
          id: letterId,
          path,
          success: true,
          unit_number: letterInfo.unit_number,
          owner_name: letterInfo.owner_name
        }
        completedLetters.push(completed)
        setPdfProgress((prev) =>
          prev
            ? {
                ...prev,
                current: i + 1,
                completed: [...prev.completed, completed]
              }
            : null
        )
      } catch {
        const completed = {
          id: letterId,
          path: '',
          success: false,
          unit_number: letterInfo.unit_number,
          owner_name: letterInfo.owner_name
        }
        completedLetters.push(completed)
        setPdfProgress((prev) =>
          prev
            ? {
                ...prev,
                current: i + 1,
                completed: [...prev.completed, completed]
              }
            : null
        )
      }
    }

    setGeneratingPdf(false)

    // Show summary notification with "Show All in Folder" button
    const successCount = completedLetters.filter((c) => c.success).length
    const failCount = completedLetters.filter((c) => !c.success).length

    notification.success({
      message: 'Batch PDF Generation Complete',
      description: (
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: 8 }}>
            {successCount} generated successfully{failCount > 0 ? `, ${failCount} failed` : ''}
          </div>
          <div style={{ color: '#666', fontSize: '13px' }}>
            Total letters processed: {completedLetters.length}
          </div>
        </div>
      ),
      btn: (
        <Button
          type="primary"
          size="small"
          icon={<FolderOpenOutlined />}
          onClick={() => {
            // Open the maintenance-letters directory
            const pdfPath = completedLetters.find((c) => c.success)?.path
            if (pdfPath) {
              window.api.shell.showItemInFolder(pdfPath)
            } else {
              // Fallback: try to open userData/pdfs directory
              message.info('Opening PDF output directory...')
            }
          }}
        >
          Show All in Folder
        </Button>
      ),
      duration: 8,
      placement: 'bottomRight'
    })
  }

  const handleDelete = async (id: number): Promise<void> => {
    Modal.confirm({
      title: 'Are you sure you want to delete this maintenance letter?',
      content: 'This action cannot be undone.',
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'No',
      onOk: async () => {
        await window.api.letters.delete(id)
        message.success('Maintenance letter deleted')
        fetchData()
      }
    })
  }

  const handleBulkDelete = async (): Promise<void> => {
    Modal.confirm({
      title: `Are you sure you want to delete ${selectedRowKeys.length} maintenance letters?`,
      content: 'This action cannot be undone.',
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'No',
      onOk: async () => {
        setLoading(true)
        try {
          await window.api.letters.bulkDelete(selectedRowKeys as number[])
          message.success(`Successfully deleted ${selectedRowKeys.length} maintenance letters`)
          fetchData()
          setSelectedRowKeys([])
        } catch {
          message.error('Failed to delete maintenance letters')
        } finally {
          setLoading(false)
        }
      }
    })
  }

  const filteredLetters = letters.filter((letter) => {
    const matchProject = !selectedProject || letter.project_id === selectedProject
    const matchYear = !selectedYear || letter.financial_year === selectedYear
    const matchSearch =
      !searchText ||
      letter.unit_number?.toLowerCase().includes(searchText.toLowerCase()) ||
      letter.owner_name?.toLowerCase().includes(searchText.toLowerCase())

    const displayStatus = getDisplayStatus(letter)

    const matchStatus =
      !selectedStatus ||
      (selectedStatus === 'Generated' && displayStatus === 'Generated') ||
      (selectedStatus === 'Modified' && displayStatus === 'Modified') ||
      (selectedStatus === 'Pending' && displayStatus === 'Pending') ||
      (selectedStatus === 'Paid' && displayStatus === 'Paid') ||
      (selectedStatus === 'Overdue' && displayStatus === 'Overdue')

    const matchUnitType =
      !selectedUnitType || selectedUnitType === 'All' || letter.unit_type === selectedUnitType

    return (
      matchProject &&
      matchYear &&
      matchSearch &&
      matchStatus &&
      matchUnitType
    )
  })

  const uniqueYears = useMemo(() => {
    const yearSet = new Set(letters.map((l) => l.financial_year).filter(Boolean))
    yearSet.add(defaultFY)
    const nextFY = getUpcomingFinancialYear(defaultFY)
    yearSet.add(nextFY)
    return Array.from(yearSet).sort().reverse()
  }, [letters, defaultFY])

  // Track which units already have a letter for the selected FY (to show indicator in step 2)
  const alreadyBilledUnitIds = useMemo(() => {
    const fy = batchFinancialYear
    const pid = batchProjectId
    if (!fy || !pid) return new Set<number>()
    return new Set(
      letters
        .filter((l) => l.project_id === pid && l.financial_year === fy)
        .map((l) => l.unit_id)
    )
  }, [letters, batchProjectId, batchFinancialYear])

  const filteredProjectUnits = useMemo(() => {
    const q = unitSearchText.trim().toLowerCase()
    return projectUnits.filter((u) => {
      const billed = alreadyBilledUnitIds.has(u.id as number)
      const matchesStatus =
        unitSelectionStatusFilter === 'all' ||
        (unitSelectionStatusFilter === 'ready' && !billed) ||
        (unitSelectionStatusFilter === 'billed' && billed)

      if (!matchesStatus) return false
      if (!q) return true

      return (
        (u.unit_number || '').toLowerCase().includes(q) ||
        (u.owner_name || '').toLowerCase().includes(q)
      )
    })
  }, [alreadyBilledUnitIds, projectUnits, unitSearchText, unitSelectionStatusFilter])

  const selectableProjectUnitIds = useMemo(
    () =>
      filteredProjectUnits
        .filter((unit) => !alreadyBilledUnitIds.has(unit.id as number))
        .map((unit) => unit.id as number),
    [filteredProjectUnits, alreadyBilledUnitIds]
  )

  const readyToGenerateCount = useMemo(
    () => projectUnits.filter((unit) => !alreadyBilledUnitIds.has(unit.id as number)).length,
    [projectUnits, alreadyBilledUnitIds]
  )

  const selectedEligibleCount = useMemo(
    () => selectedUnitIds.filter((id) => !alreadyBilledUnitIds.has(id)).length,
    [selectedUnitIds, alreadyBilledUnitIds]
  )

  const billingStatusOptions = useMemo(
    () => [
      { value: 'Generated', label: `Generated (${filterStats.generated})` },
      { value: 'Modified', label: `Modified (${filterStats.modified})` },
      { value: 'Pending', label: `Pending (${filterStats.pending})` },
      { value: 'Paid', label: `Paid (${filterStats.paid})` },
      { value: 'Overdue', label: `Overdue (${filterStats.overdue})` }
    ],
    [filterStats]
  )

  const billingFilterFields = useMemo(
    () => [
      createSearchFilter('searchText', 'Search', 'Search unit, owner, or project...'),
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
          formatValue: (value) => {
            const project = projects.find((item) => item.id === value)
            return project?.name || ''
          }
        }
      ),
      createSelectFilter(
        'selectedYear',
        'Year',
        uniqueYears.map((year) => ({ value: year, label: year })),
        'Financial Year',
        {
          emptyValue: defaultFY,
          isActive: (value) => value !== null && value !== defaultFY
        }
      ),
      createSelectFilter('selectedStatus', 'Status', billingStatusOptions, 'Status', {
        emptyValue: null,
        formatValue: (value) => String(value ?? '')
      }),
      createSelectFilter(
        'selectedUnitType',
        'Type',
        UNIT_TYPE_FILTER_OPTIONS.map((unitType) => ({ value: unitType, label: unitType })),
        'Unit Type',
        {
          emptyValue: 'All',
          isActive: (value) => value !== null && value !== 'All'
        }
      ),
    ],
    [billingStatusOptions, defaultFY, projects, uniqueYears]
  )

  const billingFilterValues = useMemo(
    () => ({
      searchText,
      selectedProject,
      selectedYear,
      selectedStatus,
      selectedUnitType
    }),
    [searchText, selectedProject, selectedStatus, selectedUnitType, selectedYear]
  )

  const handleBillingFilterChange = useCallback((key: string, value: unknown) => {
    switch (key) {
      case 'searchText':
        setSearchText(typeof value === 'string' ? value : '')
        break
      case 'selectedProject':
        setSelectedProject((value as number | null | undefined) ?? null)
        break
      case 'selectedYear':
        setSelectedYear((value as string | null | undefined) ?? defaultFY)
        break
      case 'selectedStatus':
        setSelectedStatus((value as string | null | undefined) ?? null)
        break
      case 'selectedUnitType':
        setSelectedUnitType((value as string | null | undefined) ?? 'All')
        break
      default:
        break
    }
  }, [defaultFY])

  const columns = [
    {
      title: 'Unit',
      dataIndex: 'unit_number',
      key: 'unit_number',
      sorter: (a: MaintenanceLetter, b: MaintenanceLetter) =>
        (a.unit_number || '').localeCompare(b.unit_number || ''),
      render: (unitNumber: string, record: MaintenanceLetter) => (
        <div>
          <div style={{ fontWeight: 600 }}>{unitNumber}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {record.owner_name || 'No owner assigned'}
          </div>
        </div>
      )
    },
    {
      title: 'Financial Year',
      dataIndex: 'financial_year',
      key: 'financial_year',
      width: 120,
      sorter: (a: MaintenanceLetter, b: MaintenanceLetter) =>
        (a.financial_year || '').localeCompare(b.financial_year || '')
    },
    {
      title: 'Add-ons',
      dataIndex: 'add_ons_total',
      key: 'add_ons_total',
      align: 'right' as const,
      render: (val: number) => (
        <Button type="link" size="small">
          Rs. {Math.round(val || 0).toLocaleString()}
        </Button>
      ),
      onCell: (record: MaintenanceLetter) => ({
        onClick: (e) => {
          e.stopPropagation()
          handleShowAddOns(record)
        }
      })
    },
    {
      title: 'Final',
      dataIndex: 'final_amount',
      key: 'final_amount',
      align: 'right' as const,
      render: (val: number) => <strong>Rs. {Math.round(val || 0).toLocaleString()}</strong>,
      sorter: (a: MaintenanceLetter, b: MaintenanceLetter) => a.final_amount - b.final_amount
    },
    {
      title: 'Letter Date',
      dataIndex: 'generated_date',
      key: 'generated_date',
      render: (date: string) => (date ? dayjs(date).format('DD MMM YYYY') : '-'),
      sorter: (a: MaintenanceLetter, b: MaintenanceLetter) =>
        dayjs(a.generated_date || '').valueOf() - dayjs(b.generated_date || '').valueOf()
    },
    {
      title: 'Due Date',
      dataIndex: 'due_date',
      key: 'due_date',
      render: (date: string, record: MaintenanceLetter) => {
        const isOverdue = getDisplayStatus(record) === 'Overdue'
        return (
          <div>
            {date || '-'}
            {isOverdue && (
              <Tag color="red" style={{ marginLeft: 4 }}>
                Overdue
              </Tag>
            )}
          </div>
        )
      }
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (_status: string, record: MaintenanceLetter) => {
        const status = getDisplayStatus(record)
        const tagColor = 
          status === 'Overdue' ? 'red' : 
          status === 'Paid' ? 'green' : 
          status === 'Generated' ? 'blue' : 
          status === 'Modified' ? 'purple' : 
          'orange'
        return <Tag color={tagColor}>{status}</Tag>
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right' as const,
      fixed: 'right' as const,
      render: (_: unknown, record: MaintenanceLetter) => (
        <Space className="table-row-actions" size="small">
          <Button
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              navigate('/payments', { 
                state: { 
                  unitId: record.unit_id,
                  letterId: record.id,
                  financialYear: record.financial_year
                } 
              })
            }}
          >
            Record Payment
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              record.id && handleViewPdf(record.id)
            }}
          >
            PDF
          </Button>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              handleEditLetter(record)
            }}
          />
          <Button
            icon={<DeleteOutlined />}
            size="small"
            danger
            onClick={(e) => {
              e.stopPropagation()
              record.id && handleDelete(record.id)
            }}
          />
        </Space>
      )
    }
  ]

  return (
    <div className="page-screen">
      {/* Navigation guard: show setup prompt when no projects or no ready projects */}
      {projects.length === 0 && !loading && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="No projects found"
          description={
            <span>
              You need to create a project and add units before generating maintenance letters.{' '}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/projects')}>
                Go to Projects {'->'}
              </Button>
            </span>
          }
        />
      )}
      {projects.length > 0 && !loading && letters.length === 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="No maintenance letters yet"
          description={
            <span>
              Click &quot;Generate Maintenance Letters&quot; to create letters for your units, or check that your projects have units and rates configured.{` `}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/projects')}>
                Check project setup {'->'}
              </Button>
            </span>
          }
        />
      )}
      <div className="page-hero">
        <div
          className="responsive-page-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 16
          }}
        >
          <div>
            <Title level={2} style={{ margin: 0 }}>
              Maintenance Letters
            </Title>
            <Text type="secondary" className="page-hero-subtitle">
              Configure annual letters, generate PDFs, and manage billing progress across units.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Use this screen to generate letters first, then review status, PDFs, and payment readiness.
            </Text>
          </div>
          <Space>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'open-folder',
                    icon: <FolderOpenOutlined />,
                    label: 'Open Letters Folder',
                    onClick: () => void handleOpenLettersFolder()
                  },
                  {
                    key: 'download-zip',
                    icon: <DownloadOutlined />,
                    label: 'Download Letters ZIP',
                    onClick: () => void handleDownloadLettersZip()
                  }
                ]
              }}
            >
              <Button icon={<FolderOpenOutlined />}>Letters Folder</Button>
            </Dropdown>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleBatchGenerate}>
              Generate Maintenance Letters
            </Button>
          </Space>
        </div>
      </div>

      {selectedRowKeys.length > 0 && (
        <div className="page-selection-bar">
          <Text className="page-selection-label">
            {selectedRowKeys.length} letter{selectedRowKeys.length !== 1 ? 's' : ''} selected
          </Text>
          <Space wrap>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              onClick={handleBatchPdf}
              loading={generatingPdf}
            >
              Generate PDFs ({selectedRowKeys.length})
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>
              Delete Selected ({selectedRowKeys.length})
            </Button>
          </Space>
        </div>
      )}

      <Card style={{ marginBottom: 0 }} className="page-toolbar-card page-table-card billing-filter-card">

        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <FilterPanel
            filters={billingFilterFields}
            values={billingFilterValues}
            onChange={handleBillingFilterChange}
            onClear={clearAllFilters}
            showActiveFilters={hasActiveFilters}
            showClearButton={true}
            variant="plain"
          />
        </Space>
      </Card>

      {/* Batch PDF Generation Progress Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pdfProgress?.current === pdfProgress?.total ? (
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
            ) : (
              <Spin size="small" />
            )}
            <span>
              {pdfProgress?.current === pdfProgress?.total
                ? 'Generation Complete'
                : 'Generating PDFs'}
            </span>
            <Tag color={pdfProgress?.current === pdfProgress?.total ? 'success' : 'processing'}>
              {pdfProgress?.current || 0} of {pdfProgress?.total || 0}
            </Tag>
          </div>
        }
        open={generatingPdf}
        onCancel={() => setGeneratingPdf(false)}
        footer={[
          <Button
            key="close"
            type="primary"
            onClick={() => setGeneratingPdf(false)}
            disabled={pdfProgress?.current !== pdfProgress?.total}
          >
            {pdfProgress?.current === pdfProgress?.total ? 'Close' : 'Processing...'}
          </Button>
        ]}
        closable={pdfProgress?.current === pdfProgress?.total}
        maskClosable={pdfProgress?.current === pdfProgress?.total}
        width={560}
        className="progress-status-modal mobile-fullscreen-modal"
      >
        {pdfProgress && (
          <div className="progress-status-body progress-status-body-wide">
            {/* Progress Bar with Percentage */}
            <Progress
              percent={Math.round((pdfProgress.current / pdfProgress.total) * 100)}
              status={pdfProgress.current === pdfProgress.total ? 'success' : 'active'}
              strokeWidth={8}
              className="progress-status-bar"
              format={(percent) => <span style={{ fontWeight: 600 }}>{percent}%</span>}
            />

            {/* Stats Summary */}
            <div className="progress-status-summary">
              <span>
                <strong>Progress:</strong> {pdfProgress?.current || 0} / {pdfProgress?.total || 0}
              </span>
              <span style={{ color: '#52c41a' }}>
                <CheckCircleOutlined /> Success: {pdfProgress?.completed.filter((c) => c.success).length || 0}
              </span>
              <span style={{ color: '#ff4d4f' }}>
                <CloseCircleOutlined /> Failed: {pdfProgress?.completed.filter((c) => !c.success).length || 0}
              </span>
            </div>

            {/* Currently Processing */}
            {pdfProgress.current < pdfProgress.total && pdfProgress.currentLetter && (
              <div className="progress-status-current">
                <div className="progress-status-caption">
                  Currently processing...
                </div>
                <div className="progress-status-current-item">
                  Unit {pdfProgress.currentLetter.unit_number} - {pdfProgress.currentLetter.owner_name}
                </div>
              </div>
            )}

            {/* Completed Items List */}
            {pdfProgress.completed.length > 0 && (
              <div className="progress-status-list">
                <List
                  size="small"
                  dataSource={pdfProgress.completed}
                  renderItem={(item) => (
                    <List.Item
                      style={{
                        background: item.success ? '#f6ffed' : '#fff2f0',
                        borderBottom: '1px solid #f0f0f0'
                      }}
                    >
                      <List.Item.Meta
                        avatar={
                          item.success ? (
                            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                          ) : (
                            <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                          )
                        }
                        title={
                          <span style={{ fontWeight: 600 }}>
                            Unit {item.unit_number} - {item.owner_name}
                          </span>
                        }
                        description={
                          <span style={{ fontSize: '12px', color: item.success ? '#389e0d' : '#cf1322' }}>
                            {item.success ? 'Generated successfully' : 'Failed to generate'}
                          </span>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      <Table
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys
        }}
        columns={columns}
        dataSource={filteredLetters}
        rowKey="id"
        loading={loading}
        pagination={{ 
          pageSize: pageSize,
          size: 'small',
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          onShowSizeChange: (_, size) => setPageSize(size)
        }}
        scroll={{ x: 'max-content' }}
        size="small"
        rowClassName={(record) => {
          const status = getDisplayStatus(record)
          return status === 'Overdue' ? 'overdue-row' : 
                 status === 'Pending' ? 'pending-row' : 
                 status === 'Modified' ? 'modified-row' : 
                 status === 'Generated' ? 'generated-row' : 
                 ''
        }}
        onRow={(record) => ({
          onClick: () => handleShowAddOns(record),
          style: { cursor: 'pointer' }
        })}
      />

      <Modal
        title="Generate Maintenance Letters"
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => {
          setIsModalOpen(false)
          setBatchModalStep('config')
          setBatchProjectId(null)
          setBatchFinancialYear(selectedYear || defaultFY)
          setBatchConfigSnapshot(null)
          setProjectSetupSummary(null)
        }}
        width={720}
        confirmLoading={loading}
        okText={batchModalStep === 'config' ? 'Next: Select Units' : 'Generate Maintenance Letters'}
        className="billing-generate-modal mobile-fullscreen-modal mobile-single-column"
      >
        {passedUnitIds.length > 0 && (
          <Alert
            message={`Generating letters for ${passedUnitIds.length} selected unit(s)`}
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
            closable
            onClose={() => setPassedUnitIds([])}
          />
        )}

        {/* Breadcrumb navigation for multi-step workflow */}
        <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fafafa', borderRadius: 10 }}>
          <Space size="small" align="center">
            <Button
              type={batchModalStep === 'config' ? 'primary' : 'text'}
              size="small"
              onClick={() => setBatchModalStep('config')}
              style={{ fontWeight: batchModalStep === 'config' ? 600 : 'normal' }}
            >
              1. Configure Letter
            </Button>
            <span style={{ color: '#999' }}>{'->'}</span>
            <Button
              type={batchModalStep === 'units' ? 'primary' : 'text'}
              size="small"
              disabled={!batchProjectId}
              onClick={() => batchProjectId && setBatchModalStep('units')}
              style={{ fontWeight: batchModalStep === 'units' ? 600 : 'normal' }}
            >
              2. Select Units
            </Button>
          </Space>
          <div style={{ marginTop: 6, fontSize: '11.5px', color: '#666' }}>
            {batchModalStep === 'config' 
              ? 'Step 1 of 2: Set letter details (project, FY, dates, add-ons)' 
              : 'Step 2 of 2: Choose which units to generate letters for'}
          </div>
        </div>

        {batchModalStep === 'config' ? (
          <Form
            key={currentLetter ? `edit-${currentLetter.id}` : 'create'}
            form={form}
            layout="vertical"
            onValuesChange={(changedValues, allValues) => {
              if (Object.prototype.hasOwnProperty.call(changedValues, 'project_id')) {
                setBatchProjectId((allValues.project_id as number | undefined) ?? null)
              }
              if (Object.prototype.hasOwnProperty.call(changedValues, 'financial_year')) {
                setBatchFinancialYear((allValues.financial_year as string | undefined) ?? null)
              }
            }}
            initialValues={
              currentLetter 
                ? {
                    project_id: currentLetter.project_id,
                    financial_year: currentLetter.financial_year,
                    letter_date: currentLetter.generated_date ? dayjs(currentLetter.generated_date) : dayjs(),
                    due_date: currentLetter.due_date ? dayjs(currentLetter.due_date) : dayjs().add(15, 'day')
                  }
                : {
                    letter_date: dayjs(),
                    due_date: dayjs().add(15, 'day'),
                    financial_year: selectedYear || defaultFY
                  }
            }
          >
            <Row gutter={[16, 8]}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="project_id"
                  label="Select Project"
                  rules={[{ required: true, message: 'Please select project' }]}
                >
                  <Select className="app-combobox" placeholder="Select a project">
                    {projects.map((p) => (
                      <Option key={p.id} value={p.id}>
                        {p.project_code ? `${p.project_code} - ${p.name}` : p.name}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>

              <Col xs={24} md={12}>
                <Form.Item
                  name="financial_year"
                  label="Financial Year"
                extra={`Working FY: ${defaultFY}. Next FY: ${upcomingFY}. The selected working financial year is used by default.`}
                  rules={[
                    { required: true, message: 'Please select financial year' },
                    {
                      validator: (_, value) => {
                        if (!value || isValidFinancialYear(value)) {
                          return Promise.resolve()
                        }
                        return Promise.reject(new Error('Format must be YYYY-YY (e.g., 2024-25)'))
                      }
                    }
                  ]}
                >
                  <Select
                    className="app-combobox"
                    placeholder="Select Financial Year"
                    showSearch
                    optionFilterProp="children"
                  >
                    {uniqueYears.map((year) => (
                      <Option key={year} value={year}>
                        {year === defaultFY
                            ? `${year} (Working)`
                          : year === upcomingFY
                            ? `${year} (Upcoming)`
                            : year}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>

              {batchProjectId && batchFinancialYear && (
                <Col span={24}>
                  <Alert
                    type={projectSetupSummary?.ready_for_letters ? 'success' : projectSetupSummary?.blockers?.length ? 'error' : 'info'}
                    showIcon
                    message={
                      setupSummaryLoading ? 'Checking project setup...' :
                      !projectSetupSummary ? 'Select project and financial year to validate setup.' :
                      projectSetupSummary.ready_for_letters ? '✓ Project setup is ready' :
                      '✗ Project setup incomplete'
                    }
                    description={
                      projectSetupSummary && !projectSetupSummary.ready_for_letters ? (
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          <div style={{ color: '#cf1322' }}>
                            Missing: {projectSetupSummary.blockers.slice(0, 2).join(', ')}
                            {projectSetupSummary.blockers.length > 2 ? ` +${projectSetupSummary.blockers.length - 2} more` : ''}
                          </div>
                        </div>
                      ) : null
                    }
                  />
                  {rateDueDateHint && (
                    <Alert
                      type="info"
                      showIcon
                      message={rateDueDateHint}
                      style={{ marginTop: 8 }}
                    />
                  )}
                </Col>
              )}

              <Col xs={24} md={12}>
                <Form.Item
                  name="letter_date"
                  label="Letter Date"
                  rules={[{ required: true, message: 'Please select letter date' }]}
                >
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>

              <Col xs={24} md={12}>
                <Form.Item
                  name="due_date"
                  label="Due Date"
                  rules={[{ required: true, message: 'Please select due date' }]}
                >
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>

              <Col span={24}>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="Recommended manual flow"
                  description="Select a project, choose a financial year that shows project setup ready, review the letter and due dates, add optional charges if needed, then move to unit selection."
                />
              </Col>

              <Col span={24}>
                <Divider style={{ margin: '8px 0' }}>
                  <Space>
                    <span>Add-ons (Optional)</span>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      loading={copyingAddOns}
                      onClick={handleCopyFromPreviousYear}
                      disabled={!batchProjectId || !batchFinancialYear}
                    >
                      Copy from Previous Year
                    </Button>
                  </Space>
                </Divider>
              </Col>

              <Col span={24}>
                <Form.List name="add_ons">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...restField }) => (
                        <Row key={key} gutter={[8, 8]} align="middle" style={{ marginBottom: 8 }}>
                          <Col xs={24} sm={8}>
                            <Form.Item
                              {...restField}
                              name={[name, 'addon_name']}
                              rules={[{ required: true, message: 'Name required' }]}
                              style={{ marginBottom: 0 }}
                            >
                              <Input
                                placeholder="Addon Name (e.g. Penalty)"
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={6}>
                            <Form.Item
                              {...restField}
                              name={[name, 'addon_amount']}
                              rules={[{ required: true, message: 'Amount required' }]}
                              style={{ marginBottom: 0 }}
                            >
                              <InputNumber
                                placeholder="Amount"
                                style={{ width: '100%' }}
                                prefix="Rs. "
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={8}>
                            <Form.Item
                              {...restField}
                              name={[name, 'remarks']}
                              style={{ marginBottom: 0 }}
                            >
                              <Input placeholder="Remarks" style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={2} style={{ textAlign: 'center' }}>
                            <Button
                              type="text"
                              danger
                              onClick={() => remove(name)}
                              icon={<DeleteOutlined />}
                            />
                          </Col>
                        </Row>
                      ))}
                      <Form.Item style={{ marginBottom: 0 }}>
                        <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                          Add Item
                        </Button>
                      </Form.Item>
                    </>
                  )}
                </Form.List>
              </Col>
            </Row>
          </Form>
        ) : (
          <>
            <Alert
              message="Select specific units to generate letters for, or leave empty to generate for all units in the project"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            {!unitsLoading && projectUnits.length === 0 && (
              <Alert
                message="No units available for this project"
                description="Add units to the selected project before generating maintenance letters."
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
              />
            )}
            {alreadyBilledUnitIds.size > 0 && (
              <Alert
                message={`${alreadyBilledUnitIds.size} unit${alreadyBilledUnitIds.size !== 1 ? 's' : ''} already have a letter for FY ${batchFinancialYear} - shown as "Already billed" and disabled below.`}
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
              />
            )}
            <Space
              wrap
              style={{ width: '100%', marginBottom: 12, justifyContent: 'space-between' }}
              size="middle"
              align="center"
            >
              <Space wrap size="middle">
                <Input
                  className="app-search-field"
                  placeholder="Search unit / owner..."
                  prefix={<SearchOutlined />}
                  style={{ width: 260 }}
                  value={unitSearchText}
                  onChange={(e) => setUnitSearchText(e.target.value)}
                  allowClear
                />
                <Select
                  value={unitSelectionStatusFilter}
                  onChange={(value) => setUnitSelectionStatusFilter(value)}
                  className="app-combobox"
                  style={{ minWidth: 170 }}
                  options={[
                    { value: 'all', label: `All Units (${projectUnits.length})` },
                    { value: 'ready', label: `Ready to Generate (${readyToGenerateCount})` },
                    { value: 'billed', label: `Already Billed (${alreadyBilledUnitIds.size})` }
                  ]}
                />
                <Button
                  onClick={() => setSelectedUnitIds(selectableProjectUnitIds)}
                  disabled={selectableProjectUnitIds.length === 0}
                >
                  Select Eligible
                </Button>
                <Button
                  onClick={() => setSelectedUnitIds([])}
                  disabled={selectedUnitIds.length === 0}
                >
                  Clear
                </Button>
              </Space>
              <div className="billing-unit-selection-summary">
                <Text type="secondary">
                  Selected: {selectedEligibleCount} / {readyToGenerateCount} eligible
                </Text>
                {alreadyBilledUnitIds.size > 0 && (
                  <Text type="secondary">
                    Showing: {filteredProjectUnits.length} of {projectUnits.length} units
                  </Text>
                )}
              </div>
            </Space>
            <div className="billing-unit-selection-table">
              <Table
                size="small"
                loading={unitsLoading}
                dataSource={filteredProjectUnits}
                rowKey="id"
                pagination={{
                  current: unitSelectionPage,
                  pageSize: unitSelectionPageSize,
                  total: filteredProjectUnits.length,
                  showSizeChanger: true,
                  showQuickJumper: filteredProjectUnits.length > unitSelectionPageSize * 4,
                  pageSizeOptions: [8, 12, 20, 50, 100],
                  onChange: (page, size) => {
                    setUnitSelectionPage(page)
                    if (size !== unitSelectionPageSize) {
                      setUnitSelectionPageSize(size)
                    }
                  },
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} units`,
                  size: 'small'
                }}
                scroll={{ y: 240 }}
                rowSelection={{
                  selectedRowKeys: selectedUnitIds,
                  onChange: (keys) => setSelectedUnitIds(keys as number[]),
                  getCheckboxProps: (record) => ({
                    disabled: alreadyBilledUnitIds.has(record.id as number)
                  })
                }}
                columns={[
                  { title: 'Unit', dataIndex: 'unit_number', key: 'unit_number', width: 90 },
                  { title: 'Owner', dataIndex: 'owner_name', key: 'owner_name', ellipsis: true },
                  {
                    title: 'Status',
                    key: 'billed_status',
                    width: 150,
                    render: (_: unknown, record: Unit) =>
                      alreadyBilledUnitIds.has(record.id as number) ? (
                        <Tag className="billing-unit-status-tag billing-unit-status-tag-billed" icon={<CheckCircleOutlined />}>
                          Already billed
                        </Tag>
                      ) : (
                        <Tag className="billing-unit-status-tag billing-unit-status-tag-ready" icon={<ClockCircleOutlined />}>
                          Ready to generate
                        </Tag>
                      )
                  }
                ]}
                rowClassName={(record) =>
                  alreadyBilledUnitIds.has(record.id as number)
                    ? 'billing-unit-row billing-unit-row-billed'
                    : 'billing-unit-row billing-unit-row-ready'
                }
              />
            </div>
          </>
        )}
      </Modal>

      <Modal
        title={`Add-ons Breakdown: ${currentLetter?.unit_number} (${currentLetter?.financial_year})`}
        open={addOnsModalVisible}
        onCancel={() => setAddOnsModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setAddOnsModalVisible(false)}>
            Close
          </Button>
        ]}
        width={600}
        className="mobile-fullscreen-modal"
      >
        <Table
          dataSource={currentLetterAddOns}
          pagination={false}
          rowKey="id"
          columns={[
            { title: 'Description', dataIndex: 'addon_name', key: 'addon_name' },
            {
              title: 'Amount',
              dataIndex: 'addon_amount',
              key: 'addon_amount',
              align: 'right',
              render: (val: number) => `Rs. ${Math.round(val).toLocaleString()}`,
            },
            { title: 'Remarks', dataIndex: 'remarks', key: 'remarks' }
          ]}
          summary={(pageData) => {
            let total = 0
            pageData.forEach(({ addon_amount }) => (total += addon_amount))
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <strong>Total Add-ons</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong>Rs. {Math.round(total).toLocaleString()}</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} />
              </Table.Summary.Row>
            )
          }}
        />
      </Modal>
    </div>
  )
}

export default Billing
