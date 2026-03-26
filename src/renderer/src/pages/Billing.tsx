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
  Tabs,
  Progress,
  List,
  Spin
} from 'antd'
import {
  FilePdfOutlined,
  PlusOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'

dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)

import { MaintenanceLetter, Project, LetterAddOn, Unit, ProjectSetupSummary } from '@preload/types'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'

const { Title, Text } = Typography
const { Option } = Select

const UNIT_TYPE_OPTIONS = ['All', 'Plot', 'Bungalow', 'Garden'] as const
// TabPane removed — using Tabs items API (Antd v5+)
const { Search } = Input

interface PdfProgress {
  current: number
  total: number
  completed: Array<{ id: number; path: string; success: boolean }>
}

const Billing: React.FC = () => {
  const [letters, setLetters] = useState<MaintenanceLetter[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)

  // Default to current financial year
  const currentYear = dayjs().month() < 3 ? dayjs().year() - 1 : dayjs().year()
  const defaultFY = `${currentYear}-${(currentYear + 1).toString().slice(2)}`
  const [selectedYear, setSelectedYear] = useState<string | null>(defaultFY)

  const [selectedUnitType, setSelectedUnitType] = useState<string | null>('All')
  const [amountRange, setAmountRange] = useState<[number | null, number | null]>([null, null])
  const [dueDateRange, setDueDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    null,
    null
  ])

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
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null)
  const [selectedUnitIds, setSelectedUnitIds] = useState<number[]>([])
  const [batchModalStep, setBatchModalStep] = useState<'config' | 'units'>('config')
  const [projectUnits, setProjectUnits] = useState<Unit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [unitSearchText, setUnitSearchText] = useState('')
  const batchProjectId = Form.useWatch('project_id', form)
  const batchFinancialYear = Form.useWatch('financial_year', form)
  const [projectSetupSummary, setProjectSetupSummary] = useState<ProjectSetupSummary | null>(null)
  const [setupSummaryLoading, setSetupSummaryLoading] = useState(false)

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
      setProjectSetupSummary(null)
      return
    }
    if (!batchProjectId) {
      setProjectUnits([])
      return
    }
    setUnitsLoading(true)
    window.api.units
      .getByProject(batchProjectId)
      .then((data) => setProjectUnits(data))
      .catch(() => {
        message.error('Failed to load units for selected project')
        setProjectUnits([])
      })
      .finally(() => setUnitsLoading(false))
  }, [batchProjectId, isModalOpen])

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
    if (!isModalOpen) return
    if (passedUnitIds.length === 0) return
    if (selectedUnitIds.length > 0) return
    setSelectedUnitIds(passedUnitIds)
  }, [isModalOpen, passedUnitIds, selectedUnitIds])

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
      const matchMinAmount = amountRange[0] === null || letter.final_amount >= amountRange[0]
      const matchMaxAmount = amountRange[1] === null || letter.final_amount <= amountRange[1]
      
      const letterDueDate = letter.due_date ? dayjs(letter.due_date) : null
      const matchMinDueDate =
        !dueDateRange[0] || (letterDueDate && letterDueDate.isSameOrAfter(dueDateRange[0], 'day'))
      const matchMaxDueDate =
        !dueDateRange[1] || (letterDueDate && letterDueDate.isSameOrBefore(dueDateRange[1], 'day'))

      return matchProject && matchYear && matchSearch && matchUnitType && 
             matchMinAmount && matchMaxAmount && matchMinDueDate && matchMaxDueDate
    })

    const generated = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Generated').length
    const modified = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Modified').length
    const pending = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Pending').length
    const paid = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Paid').length
    const overdue = currentlyFilteredLetters.filter((l) => getDisplayStatus(l) === 'Overdue').length

    return { generated, modified, pending, paid, overdue }
  }, [letters, selectedProject, selectedYear, searchText, selectedUnitType, amountRange, dueDateRange, getDisplayStatus])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      searchText ||
      selectedProject !== null ||
      selectedYear !== defaultFY ||
      selectedStatus !== null ||
      (selectedUnitType !== null && selectedUnitType !== 'All') ||
      amountRange[0] !== null ||
      amountRange[1] !== null ||
      dueDateRange[0] !== null ||
      dueDateRange[1] !== null
    )
  }, [
    searchText,
    selectedProject,
    selectedYear,
    selectedStatus,
    selectedUnitType,
    amountRange,
    dueDateRange,
    defaultFY
  ])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setSelectedProject(null)
    setSelectedYear(defaultFY)
    setSelectedStatus(null)
    setSelectedUnitType('All')
    setAmountRange([null, null])
    setDueDateRange([null, null])
    setSelectedRowKeys([])
  }, [defaultFY])

  const handleBatchGenerate = (): void => {
    setPassedUnitIds([])
    setSelectedUnitIds([])
    setBatchModalStep('config')
    form.resetFields()
    setProjectSetupSummary(null)
    setCurrentLetter(null) // Clear any existing letter when creating new
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
        await form.validateFields(['project_id', 'financial_year', 'letter_date', 'due_date'])
        const projectId = form.getFieldValue('project_id')
        const financialYear = form.getFieldValue('financial_year')
        if (projectId && financialYear) {
          const isReady = await ensureProjectReadyForLetters(projectId, financialYear)
          if (!isReady) return
          // Move to unit selection step
          setBatchModalStep('units')
        }
      } catch {
        // Validation will show errors
      }
    } else {
      // Generate letters or update existing letter
      try {
        const values = await form.validateFields()
        const { project_id, financial_year, letter_date, due_date, add_ons } = values

        const letterDate = letter_date.format('YYYY-MM-DD')
        const dueDate = due_date.format('YYYY-MM-DD')

        setLoading(true)

        // Check if we're editing an existing letter
        if (currentLetter && currentLetter.id) {
          // Update existing letter
          console.log('[FRONTEND] Updating letter:', currentLetter.id, {
            due_date: dueDate,
            generated_date: letterDate
          })
          
          // First update the basic letter fields
          const success = await window.api.letters.update(currentLetter.id, {
            due_date: dueDate,
            generated_date: letterDate,
            status: 'Modified'  // Mark as modified when edited
          })
          
          console.log('[FRONTEND] Update result:', success)
          
          if (!success) {
            message.error('Failed to update letter')
            return
          }
          
          // Now handle addons - get existing addons and compare with new ones
          const existingAddons = await window.api.letters.getAddOns(currentLetter.id)
          const newAddons = add_ons || []
          
          // Delete addons that are no longer present
          for (const existingAddon of existingAddons) {
            const stillExists = newAddons.find((newAddOn: any) => 
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
            console.log('[FRONTEND] PDF regenerated with updated addons')
          } catch (pdfError) {
            console.warn('[FRONTEND] Failed to regenerate PDF:', pdfError)
            // Don't fail the update if PDF generation fails
          }
          
          message.success('Letter updated successfully with addon changes')
        } else {
          // Create new letters
          const isReady = await ensureProjectReadyForLetters(project_id, financial_year)
          if (!isReady) return
          await window.api.letters.createBatch({
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
          showCompletionWithNextStep(
            'billing',
            'Maintenance letters generated successfully',
            navigate
          )
        }
        
        setIsModalOpen(false)
        setBatchModalStep('config')
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

  const handleEditLetter = async (record: MaintenanceLetter): Promise<void> => {
    if (!record.id) return
    try {
      message.loading({ content: 'Loading letter...', key: 'letter_edit' })
      // Don't reset fields as it conflicts with initialValues
      setPassedUnitIds([record.unit_id])
      setSelectedUnitIds([])
      setBatchModalStep('config')
      setIsModalOpen(true)
      setCurrentLetter(record) // Set the current letter for editing

      const addOns = await window.api.letters.getAddOns(record.id)

      // Set form values after a small delay to ensure initialValues are applied
      setTimeout(() => {
        console.log('[EDIT LETTER] Setting form values:', {
          project_id: record.project_id,
          financial_year: record.financial_year,
          letter_date: record.generated_date ? dayjs(record.generated_date).format('YYYY-MM-DD') : 'today',
          due_date: record.due_date ? dayjs(record.due_date).format('YYYY-MM-DD') : 'today+15'
        })
        
        form.setFieldsValue({
          project_id: record.project_id,
          financial_year: record.financial_year,
          letter_date: record.generated_date ? dayjs(record.generated_date) : dayjs(),
          due_date: record.due_date ? dayjs(record.due_date) : dayjs().add(15, 'day'),
          add_ons: (addOns || []).map((a: LetterAddOn) => ({
            addon_name: a.addon_name,
            addon_amount: a.addon_amount,
            remarks: a.remarks
          }))
        })
        
        // Check what values were actually set
        setTimeout(() => {
          const currentValues = form.getFieldsValue(['letter_date', 'due_date'])
          console.log('[EDIT LETTER] Current form values after setting:', currentValues)
        }, 50)
      }, 100)

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

    for (let i = 0; i < letterIds.length; i++) {
      try {
        const path = await window.api.letters.generatePdf(letterIds[i])
        setPdfProgress((prev) =>
          prev
            ? {
                ...prev,
                current: i + 1,
                completed: [...prev.completed, { id: letterIds[i], path, success: true }]
              }
            : null
        )
      } catch {
        setPdfProgress((prev) =>
          prev
            ? {
                ...prev,
                current: i + 1,
                completed: [...prev.completed, { id: letterIds[i], path: '', success: false }]
              }
            : null
        )
      }
    }

    setGeneratingPdf(false)

    // Show summary notification
    if (pdfProgress) {
      const successCount = pdfProgress.completed.filter((c) => c.success).length
      const failCount = pdfProgress.completed.filter((c) => !c.success).length

      notification.info({
        message: 'Batch PDF Generation Complete',
        description: (
          <div>
            <div>Successfully generated: {successCount} letters</div>
            {failCount > 0 && <div>Failed: {failCount} letters</div>}
          </div>
        ),
        duration: 5
      })
    }
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

    const letterDueDate = letter.due_date ? dayjs(letter.due_date) : null
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

    const matchMinAmount = amountRange[0] === null || letter.final_amount >= amountRange[0]
    const matchMaxAmount = amountRange[1] === null || letter.final_amount <= amountRange[1]

    const matchMinDueDate =
      !dueDateRange[0] || (letterDueDate && letterDueDate.isSameOrAfter(dueDateRange[0], 'day'))
    const matchMaxDueDate =
      !dueDateRange[1] || (letterDueDate && letterDueDate.isSameOrBefore(dueDateRange[1], 'day'))

    return (
      matchProject &&
      matchYear &&
      matchSearch &&
      matchStatus &&
      matchUnitType &&
      matchMinAmount &&
      matchMaxAmount &&
      matchMinDueDate &&
      matchMaxDueDate
    )
  })

  const uniqueYears = useMemo(() => {
    const yearSet = new Set(letters.map((l) => l.financial_year).filter(Boolean))
    yearSet.add(defaultFY)
    const nextFY = `${currentYear + 1}-${(currentYear + 2).toString().slice(2)}`
    yearSet.add(nextFY)
    return Array.from(yearSet).sort().reverse()
  }, [letters, defaultFY, currentYear])

  const filteredProjectUnits = useMemo(() => {
    const q = unitSearchText.trim().toLowerCase()
    if (!q) return projectUnits
    return projectUnits.filter((u) => {
      return (
        (u.unit_number || '').toLowerCase().includes(q) ||
        (u.owner_name || '').toLowerCase().includes(q)
      )
    })
  }, [projectUnits, unitSearchText])

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

  // Get selected project name
  const selectedProjectName = useMemo(() => {
    if (!selectedProject) return ''
    const project = projects.find((p) => p.id === selectedProject)
    return project?.name || ''
  }, [selectedProject, projects])

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
      title: 'Owner',
      dataIndex: 'owner_name',
      key: 'owner_name',
      width: 200,
      sorter: (a: MaintenanceLetter, b: MaintenanceLetter) =>
        (a.owner_name || '').localeCompare(b.owner_name || ''),
      render: (ownerName: string) => (
        <div>
          <div style={{ fontWeight: 600 }}>{ownerName || 'No owner assigned'}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {ownerName ? 'Property Owner' : 'Please update owner details'}
          </div>
        </div>
      )
    },
    {
      title: 'Type',
      dataIndex: 'unit_type',
      key: 'unit_type',
      width: 120,
      sorter: (a: MaintenanceLetter, b: MaintenanceLetter) =>
        (a.unit_type || '').localeCompare(b.unit_type || '')
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
      title: 'Amount',
      dataIndex: 'base_amount',
      key: 'base_amount',
      align: 'right' as const,
      render: (val: number) => `₹${(val || 0).toLocaleString()}`
    },
    {
      title: 'Add-ons',
      dataIndex: 'add_ons_total',
      key: 'add_ons_total',
      align: 'right' as const,
      render: (val: number) => (
        <Button type="link" size="small">
          ₹{(val || 0).toLocaleString()}
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
      render: (val: number) => <strong>₹{(val || 0).toLocaleString()}</strong>,
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
        <Space size="middle">
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
    <div>
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
                Go to Projects →
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
              Click "Generate Maintenance Letters" to create letters for your units, or check that your projects have units and rates configured.{' '}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/projects')}>
                Check project setup →
              </Button>
            </span>
          }
        />
      )}
      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            Maintenance Letters
          </Title>
          <Space>
            {selectedRowKeys.length > 0 && (
              <>
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
              </>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={handleBatchGenerate}>
              Generate Maintenance Letters
            </Button>
          </Space>
        </div>

        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap size="middle">
            <Search
              placeholder="Search Unit, Owner, or Project..."
              style={{ width: 250 }}
              allowClear
              onSearch={setSearchText}
              onChange={(e) => setSearchText(e.target.value)}
              value={searchText}
              enterButton
              suffix={null}
              aria-label="Search maintenance letters by unit, owner, or project"
            />
            <Select
              placeholder="Project"
              style={{ width: 200 }}
              allowClear
              onChange={setSelectedProject}
              value={selectedProject}
            >
              {projects.map((p) => (
                <Option key={p.id} value={p.id}>
                  {p.project_code ? `${p.project_code} - ${p.name}` : p.name}
                </Option>
              ))}
            </Select>
            <Select
              placeholder="Financial Year"
              style={{ width: 150 }}
              allowClear
              onChange={setSelectedYear}
              value={selectedYear}
            >
              {uniqueYears.map((year) => (
                <Option key={year} value={year}>
                  {year}
                </Option>
              ))}
            </Select>
            <Select
              placeholder="Status"
              style={{ width: 150 }}
              allowClear
              onChange={setSelectedStatus}
              value={selectedStatus}
            >
              <Option value="Generated">
                <Space>
                  <span>Generated</span>
                  <Tag color="blue">{filterStats.generated}</Tag>
                </Space>
              </Option>
              <Option value="Modified">
                <Space>
                  <span>Modified</span>
                  <Tag color="purple">{filterStats.modified}</Tag>
                </Space>
              </Option>
              <Option value="Pending">
                <Space>
                  <span>Pending</span>
                  <Tag color="orange">{filterStats.pending}</Tag>
                </Space>
              </Option>
              <Option value="Paid">
                <Space>
                  <span>Paid</span>
                  <Tag color="green">{filterStats.paid}</Tag>
                </Space>
              </Option>
              <Option value="Overdue">
                <Space>
                  <span>Overdue</span>
                  <Tag color="red">{filterStats.overdue}</Tag>
                </Space>
              </Option>
            </Select>
            <Select
              placeholder="Unit Type"
              style={{ width: 140 }}
              allowClear
              onChange={(val) => setSelectedUnitType(val ?? 'All')}
              value={selectedUnitType}
            >
              {UNIT_TYPE_OPTIONS.map((unitType) => (
                <Option key={unitType} value={unitType}>
                  {unitType}
                </Option>
              ))}
            </Select>
          </Space>

          <Space wrap size="middle">
            <Space>
              <Text type="secondary">Amount Range:</Text>
              <InputNumber
                placeholder="Min"
                style={{ width: 100 }}
                value={amountRange[0]}
                onChange={(min) => {
                  if (amountRange[1] && min && min > amountRange[1]) {
                    message.warning('Minimum amount cannot exceed maximum')
                    return
                  }
                  setAmountRange([min, amountRange[1]])
                }}
                min={0}
              />
              <Text>-</Text>
              <InputNumber
                placeholder="Max"
                style={{ width: 100 }}
                value={amountRange[1]}
                onChange={(max) => {
                  if (amountRange[0] && max && max < amountRange[0]) {
                    message.warning('Maximum amount cannot be less than minimum')
                    return
                  }
                  setAmountRange([amountRange[0], max])
                }}
                min={0}
              />
            </Space>
            <Space>
              <Text type="secondary">Due Date Range:</Text>
              <DatePicker.RangePicker
                style={{ width: 250 }}
                value={[dueDateRange[0], dueDateRange[1]]}
                onChange={(dates) => setDueDateRange(dates ? [dates[0], dates[1]] : [null, null])}
                format="DD/MM/YYYY"
              />
            </Space>
          </Space>

          {/* Filter Summary Chips */}
          {hasActiveFilters && (
            <div
              style={{
                marginTop: 16,
                padding: '12px 16px',
                background: '#fafafa',
                borderRadius: 6
              }}
            >
              <Space wrap align="center">
                <Text type="secondary" style={{ fontSize: '12px', fontWeight: 500 }}>
                  Active filters:
                </Text>
                {searchText && (
                  <Tag closable onClose={() => setSearchText('')}>
                    Search: &quot;{searchText}&quot;
                  </Tag>
                )}
                {selectedProject !== null && (
                  <Tag closable onClose={() => setSelectedProject(null)}>
                    Project: {selectedProjectName}
                  </Tag>
                )}
                {(selectedYear === null ||
                  (selectedYear !== null && selectedYear !== defaultFY)) && (
                  <Tag closable onClose={() => setSelectedYear(defaultFY)}>
                    Year: {selectedYear ?? 'All'}
                  </Tag>
                )}
                {selectedStatus && (
                  <Tag closable onClose={() => setSelectedStatus(null)}>
                    Status: {selectedStatus}
                  </Tag>
                )}
                {selectedUnitType && selectedUnitType !== 'All' && (
                  <Tag closable onClose={() => setSelectedUnitType('All')}>
                    Type: {selectedUnitType}
                  </Tag>
                )}
                {(amountRange[0] !== null || amountRange[1] !== null) && (
                  <Tag closable onClose={() => setAmountRange([null, null])}>
                    Amount: {amountRange[0] !== null ? `₹${amountRange[0]}` : 'Any'} -{' '}
                    {amountRange[1] !== null ? `₹${amountRange[1]}` : 'Any'}
                  </Tag>
                )}
                {(dueDateRange[0] || dueDateRange[1]) && (
                  <Tag closable onClose={() => setDueDateRange([null, null])}>
                    Due: {dueDateRange[0]?.format('DD/MM/YY') || 'Any'} to{' '}
                    {dueDateRange[1]?.format('DD/MM/YY') || 'Any'}
                  </Tag>
                )}
                <Button
                  type="link"
                  size="small"
                  onClick={clearAllFilters}
                  style={{ fontSize: '12px', padding: 0, height: 'auto' }}
                >
                  Clear all filters
                </Button>
              </Space>
            </div>
          )}
        </Space>
      </Card>

      {/* Batch PDF Generation Progress Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Spin size="small" />
            <span>Generating PDFs</span>
            <Tag color="processing">
              {pdfProgress?.current || 0} of {pdfProgress?.total || 0}
            </Tag>
          </div>
        }
        open={generatingPdf}
        onCancel={() => setGeneratingPdf(false)}
        footer={[
          <Button
            key="cancel"
            onClick={() => setGeneratingPdf(false)}
            disabled={pdfProgress?.current === pdfProgress?.total}
          >
            Cancel
          </Button>
        ]}
        closable={true}
        width={600}
      >
        {pdfProgress && (
          <div>
            <Progress
              percent={Math.round((pdfProgress.current / pdfProgress.total) * 100)}
              status="active"
              showInfo={false}
              strokeWidth={8}
              style={{ marginBottom: 16 }}
            />
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              marginTop: 8,
              fontSize: '12px',
              color: '#666'
            }}>
              <span>Progress: {(pdfProgress?.current || 0)} / {(pdfProgress?.total || 0)}</span>
              <span>Success: {(pdfProgress?.completed.filter(c => c.success).length || 0)}</span>
              <span>Failed: {(pdfProgress?.completed.filter(c => !c.success).length || 0)}</span>
            </div>

            {pdfProgress.completed.length > 0 && (
              <div style={{ marginTop: 16, maxHeight: 200, overflow: 'auto' }}>
                <List
                  size="small"
                  dataSource={pdfProgress.completed}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={
                          item.success ? (
                            <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          ) : (
                            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                          )
                        }
                        title={`Letter ${item.id}`}
                        description={item.success ? 'Generated successfully' : 'Failed to generate'}
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
        pagination={{ pageSize: 10 }}
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
          setProjectSetupSummary(null)
        }}
        width={700}
        confirmLoading={loading}
        okText={batchModalStep === 'config' ? 'Next: Select Units' : 'Generate Maintenance Letters'}
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

        <Tabs
          activeKey={batchModalStep}
          onChange={(key) => setBatchModalStep(key as 'config' | 'units')}
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'config',
              label: '1. Configuration',
              children: (
                <Form
                  key={currentLetter ? `edit-${currentLetter.id}` : 'create'}
                  form={form}
                  layout="vertical"
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <Form.Item
                      name="project_id"
                      label="Select Project"
                      rules={[{ required: true, message: 'Please select project' }]}
                      style={{ gridColumn: 'span 2' }}
                    >
                      <Select placeholder="Select a project">
                        {projects.map((p) => (
                          <Option key={p.id} value={p.id}>
                            {p.project_code ? `${p.project_code} - ${p.name}` : p.name}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>

                    <Form.Item
                      name="financial_year"
                      label="Financial Year (e.g., 2024-25)"
                      rules={[{ required: true, message: 'Please enter financial year' }]}
                      style={{ gridColumn: 'span 2' }}
                    >
                      <Select
                        placeholder="Select Financial Year"
                        showSearch
                        optionFilterProp="children"
                      >
                        {uniqueYears.map((year) => (
                          <Option key={year} value={year}>
                            {year}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>

                    {batchProjectId && batchFinancialYear && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <Alert
                          type={
                            projectSetupSummary
                              ? projectSetupSummary.ready_for_letters
                                ? projectSetupSummary.warnings.length > 0
                                  ? 'warning'
                                  : 'success'
                                : 'error'
                              : 'info'
                          }
                          showIcon
                          message={
                            setupSummaryLoading
                              ? 'Checking project setup...'
                              : projectSetupSummary
                                ? projectSetupSummary.ready_for_letters
                                  ? projectSetupSummary.warnings.length > 0
                                    ? 'Project setup is usable, but there are warnings.'
                                    : 'Project setup is ready for maintenance letters.'
                                  : 'Project setup is incomplete.'
                                : 'Select project and financial year to validate setup.'
                          }
                          description={
                            projectSetupSummary ? (
                              <div>
                                <div>
                                  Units: {projectSetupSummary.unit_count} | Sectors:{' '}
                                  {projectSetupSummary.sector_codes.length > 0
                                    ? projectSetupSummary.sector_codes.join(', ')
                                    : 'None'}{' '}
                                  | Rate years:{' '}
                                  {projectSetupSummary.rate_years.length > 0
                                    ? projectSetupSummary.rate_years.join(', ')
                                    : 'None'}
                                </div>
                                {projectSetupSummary.blockers.map((blocker) => (
                                  <div key={blocker} style={{ color: '#cf1322', marginTop: 4 }}>
                                    {blocker}
                                  </div>
                                ))}
                                {projectSetupSummary.warnings.map((warning) => (
                                  <div key={warning} style={{ color: '#d48806', marginTop: 4 }}>
                                    {warning}
                                  </div>
                                ))}
                              </div>
                            ) : undefined
                          }
                        />
                      </div>
                    )}

                    <Form.Item
                      name="letter_date"
                      label="Letter Date"
                      rules={[{ required: true, message: 'Please select letter date' }]}
                    >
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>

                    <Form.Item
                      name="due_date"
                      label="Due Date"
                      rules={[{ required: true, message: 'Please select due date' }]}
                    >
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>

                    <Divider style={{ gridColumn: 'span 2', margin: '8px 0' }}>
                      Add-ons (Optional)
                    </Divider>

                    <Form.List name="add_ons">
                      {(fields, { add, remove }) => (
                        <div style={{ gridColumn: 'span 2' }}>
                          {fields.map(({ key, name, ...restField }) => (
                            <Space
                              key={key}
                              wrap
                              style={{
                                display: 'flex',
                                width: '100%',
                                marginBottom: 8,
                                flexWrap: 'wrap'
                              }}
                              align="baseline"
                            >
                              <Form.Item
                                {...restField}
                                name={[name, 'addon_name']}
                                rules={[{ required: true, message: 'Name required' }]}
                                style={{ flex: '1 1 220px', marginBottom: 0 }}
                              >
                                <Input
                                  placeholder="Addon Name (e.g. Penalty)"
                                  style={{ width: '100%' }}
                                />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'addon_amount']}
                                rules={[{ required: true, message: 'Amount required' }]}
                                style={{ width: 140, marginBottom: 0 }}
                              >
                                <InputNumber
                                  placeholder="Amount"
                                  style={{ width: '100%' }}
                                  prefix="₹"
                                />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'remarks']}
                                style={{ flex: '1 1 220px', marginBottom: 0 }}
                              >
                                <Input placeholder="Remarks" style={{ width: '100%' }} />
                              </Form.Item>
                              <Button
                                type="text"
                                danger
                                onClick={() => remove(name)}
                                icon={<DeleteOutlined />}
                              />
                            </Space>
                          ))}
                          <Form.Item>
                            <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                              Add Item
                            </Button>
                          </Form.Item>
                        </div>
                      )}
                    </Form.List>
                  </div>
                </Form>
              )
            },
            {
              key: 'units',
              label: '2. Select Units (Optional)',
              disabled: !batchProjectId,
              children: (
                <>
                  <Alert
                    message="Select specific units to generate letters for, or leave empty to generate for all units in the project"
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  {alreadyBilledUnitIds.size > 0 && (
                    <Alert
                      message={`${alreadyBilledUnitIds.size} unit${alreadyBilledUnitIds.size !== 1 ? 's' : ''} already have a letter for FY ${batchFinancialYear} — shown as "Already billed" and disabled below.`}
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                    />
                  )}
                  <Space
                    wrap
                    style={{ width: '100%', marginBottom: 12 }}
                    size="middle"
                    align="center"
                  >
                    <Input
                      placeholder="Search unit / owner..."
                      style={{ width: 260 }}
                      value={unitSearchText}
                      onChange={(e) => setUnitSearchText(e.target.value)}
                      allowClear
                    />
                    <Button
                      onClick={() => setSelectedUnitIds(projectUnits.map((u) => u.id as number))}
                      disabled={projectUnits.length === 0}
                    >
                      Select all
                    </Button>
                    <Button
                      onClick={() => setSelectedUnitIds([])}
                      disabled={selectedUnitIds.length === 0}
                    >
                      Clear
                    </Button>
                    <Text type="secondary">
                      Selected: {selectedUnitIds.length} / {projectUnits.length}
                    </Text>
                  </Space>
                  <Table
                    size="small"
                    loading={unitsLoading}
                    dataSource={filteredProjectUnits}
                    rowKey="id"
                    pagination={{ pageSize: 8 }}
                    scroll={{ y: 280 }}
                    rowSelection={{
                      selectedRowKeys: selectedUnitIds,
                      onChange: (keys) => setSelectedUnitIds(keys as number[]),
                      getCheckboxProps: (record) => ({
                        disabled: alreadyBilledUnitIds.has(record.id as number)
                      })
                    }}
                    columns={[
                      { title: 'Unit', dataIndex: 'unit_number', key: 'unit_number', width: 120 },
                      { title: 'Owner', dataIndex: 'owner_name', key: 'owner_name' },
                      {
                        title: 'Status',
                        key: 'billed_status',
                        width: 100,
                        render: (_: unknown, record: Unit) =>
                          alreadyBilledUnitIds.has(record.id as number) ? (
                            <Tag color="green" style={{ fontSize: 11 }}>Already billed</Tag>
                          ) : (
                            <Tag color="default" style={{ fontSize: 11 }}>Pending</Tag>
                          )
                      }
                    ]}
                  />
                </>
              )
            }
          ]}
        />
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
              render: (val: number) => `₹${val.toLocaleString()}`
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
                  <strong>₹{total.toLocaleString()}</strong>
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
