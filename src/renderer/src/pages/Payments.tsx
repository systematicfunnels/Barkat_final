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
  Input,
  InputNumber,
  Tag,
  Typography,
  Divider,
  Card,
  DividerProps,
  Progress,
  Alert,
  Row,
  Col
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  PrinterOutlined,
  EditOutlined,
  FolderOpenOutlined,
  DownloadOutlined,
  TableOutlined,
  CalculatorOutlined,
  ClearOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Project, Unit, Payment, MaintenanceLetter } from '@preload/types'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'
import {
  formatFinancialYear,
  getUpcomingFinancialYear
} from '../utils/financialYear'
import ActionMenuButton from '../components/shared/ActionMenuButton'
import FilterPanel, {
  createSearchFilter,
  createSelectFilter
} from '../components/shared/FilterPanel'
import { useWorkingFinancialYear } from '../context/WorkingFinancialYearContext'

const { Title, Text } = Typography
const { Option } = Select

interface BulkPaymentEntry {
  unit_id: number
  project_id: number
  unit_number: string
  owner_name: string
  payment_amount: number
  payment_mode: string
  payment_date: dayjs.Dayjs
}

interface ReceiptProgress {
  current: number
  total: number
}

const Payments: React.FC = () => {
  const { workingFY } = useWorkingFinancialYear()
  const navigate = useNavigate()
  const location = useLocation()
  const [payments, setPayments] = useState<Payment[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [letters, setLetters] = useState<MaintenanceLetter[]>([])
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [selectedMode, setSelectedMode] = useState<string | null>(null)

  const defaultFY = workingFY
  const upcomingFY = getUpcomingFinancialYear(defaultFY)
  const [selectedFY, setSelectedFY] = useState<string | null>(defaultFY)

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [searchText, setSearchText] = useState('')
  const [form] = Form.useForm()
  const [bulkForm] = Form.useForm()
  // Watch project_id from payment form to filter unit dropdown
  const formProjectId = Form.useWatch('project_id', form)
  const formUnitId = Form.useWatch('unit_id', form)
  const formLetterId = Form.useWatch('letter_id', form)
  const formFinancialYear = Form.useWatch('financial_year', form)
  const formPaymentAmount = Form.useWatch('payment_amount', form)
  const filteredUnitsForForm = formProjectId
    ? units.filter((u) => u.project_id === formProjectId)
    : units
  const [bulkPayments, setBulkPayments] = useState<BulkPaymentEntry[]>([])
  const [bulkProject, setBulkProject] = useState<number | null>(null)
  const [generatingReceipts, setGeneratingReceipts] = useState(false)
  const [receiptProgress, setReceiptProgress] = useState<ReceiptProgress | null>(null)
  const [receiptTaskId, setReceiptTaskId] = useState<string | null>(null)
  const [lastAutoFilledAmount, setLastAutoFilledAmount] = useState<number | null>(null)
  const [lastAutoFillKey, setLastAutoFillKey] = useState<string | null>(null)

  const yearMatchedLetters = useMemo(() => {
    if (!formUnitId || !formFinancialYear) {
      return []
    }

    return letters
      .filter(
        (letter) =>
          letter.unit_id === formUnitId && letter.financial_year === formFinancialYear
      )
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
  }, [formFinancialYear, formUnitId, letters])

  const autoFillPaymentLetter = useMemo(() => {
    const unpaidLetters = yearMatchedLetters.filter((letter) => letter.status !== 'Paid')
    if (unpaidLetters.length > 0) {
      return unpaidLetters[0]
    }
    if (yearMatchedLetters.length > 0) {
      return yearMatchedLetters[0]
    }
    return null
  }, [yearMatchedLetters])

  const suggestedPaymentLetter = useMemo(() => {
    if (formLetterId) {
      return letters.find((letter) => letter.id === formLetterId) || null
    }

    if (autoFillPaymentLetter) {
      return autoFillPaymentLetter
    }

    const unpaidLetter =
      yearMatchedLetters.find((letter) => letter.status !== 'Paid') || yearMatchedLetters[0]

    return unpaidLetter || null
  }, [autoFillPaymentLetter, formLetterId, letters, yearMatchedLetters])

  const suggestedPaymentAmount = suggestedPaymentLetter?.final_amount ?? null

  useEffect(() => {
    if (!isModalOpen) {
      setLastAutoFilledAmount(null)
      setLastAutoFillKey(null)
      return
    }
  }, [isModalOpen])

  useEffect(() => {
    if (!isModalOpen || editingPayment) {
      return
    }

    const sourceLetter = formLetterId
      ? letters.find((letter) => letter.id === formLetterId) || null
      : autoFillPaymentLetter

    if (!sourceLetter) {
      return
    }

    const currentAmount = form.getFieldValue('payment_amount')
    const nextAmount = sourceLetter.final_amount
    const nextKey = formLetterId
      ? `letter:${sourceLetter.id ?? 'none'}`
      : `${formUnitId ?? 'none'}:${formFinancialYear ?? 'none'}:${sourceLetter.id ?? 'none'}`
    const shouldAutofill =
      nextKey !== lastAutoFillKey ||
      currentAmount === undefined ||
      currentAmount === null ||
      currentAmount === '' ||
      currentAmount === 0 ||
      currentAmount === lastAutoFilledAmount

    if (shouldAutofill) {
      form.setFieldsValue({ payment_amount: nextAmount })
      setLastAutoFilledAmount(nextAmount)
      setLastAutoFillKey(nextKey)
    }
  }, [
    autoFillPaymentLetter,
    editingPayment,
    form,
    formFinancialYear,
    formLetterId,
    formPaymentAmount,
    formUnitId,
    isModalOpen,
    lastAutoFillKey,
    lastAutoFilledAmount
  ])

  const fetchData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [paymentsData, projectsData] = await Promise.all([
        window.api.payments.getAll(),
        window.api.projects.getAll()
      ])
      setPayments(paymentsData)
      setProjects(projectsData)
      setSelectedRowKeys([])
    } catch (error) {
      console.error('Failed to fetch data:', error)
      message.error('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    const loadReferenceData = async (): Promise<void> => {
      try {
        const [unitsData, lettersData] = await Promise.all([
          window.api.units.getAll(),
          window.api.letters.getAll()
        ])
        setUnits(unitsData)
        setLetters(lettersData)
      } catch (error) {
        console.error('Failed to fetch payment reference data:', error)
        message.error('Failed to load project unit data')
      }
    }

    void loadReferenceData()
  }, [])

  useEffect(() => {
    // Handle navigation shortcuts from Units or Billing page
    const state = location.state as { 
      unitId?: number; 
      letterId?: number; 
      financialYear?: string 
    } | null
    if (!state?.unitId) return
    if (units.length === 0) return

    const foundUnit = units.find((u) => u.id === state.unitId)
    if (foundUnit) {
      form.resetFields()
      form.setFieldsValue({
        unit_id: foundUnit.id,
        project_id: foundUnit.project_id,
        letter_id: state.letterId,
        financial_year: state.financialYear || defaultFY,
        payment_date: dayjs(),
        payment_mode: 'Transfer'
      })
      setIsModalOpen(true)
    }

    // Clear navigation state to prevent re-triggering on refresh
    window.history.replaceState({}, document.title)
  }, [location, units, form])

  // Get unique financial years for filtering
  const uniqueFinancialYears = useMemo(() => {
    const years = Array.from(new Set(payments.map((p) => p.financial_year).filter(Boolean)))
      .sort()
      .reverse()
    if (!years.includes(defaultFY)) {
      years.unshift(defaultFY)
    }
    if (!years.includes(upcomingFY)) {
      years.unshift(upcomingFY)
    }
    return Array.from(new Set(years)).sort().reverse()
  }, [payments, defaultFY, upcomingFY])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return Boolean(
      searchText || selectedProject !== null || selectedFY !== defaultFY || selectedMode !== null
    )
  }, [searchText, selectedProject, selectedFY, selectedMode, defaultFY])

  const paymentFilterFields = useMemo(
    () => [
      createSearchFilter(
        'searchText',
        'Search',
        'Search receipt, unit, owner, or project...'
      ),
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
        'selectedFY',
        'FY',
        uniqueFinancialYears
          .filter((fy): fy is string => Boolean(fy))
          .map((fy) => ({ value: fy, label: fy })),
        'Financial Year',
        {
          emptyValue: defaultFY,
          isActive: (value) => value !== null && value !== defaultFY
        }
      ),
      createSelectFilter(
        'selectedMode',
        'Mode',
        [
          { value: 'Transfer', label: 'Bank Transfer / UPI' },
          { value: 'Cheque', label: 'Cheque' },
          { value: 'Cash', label: 'Cash' }
        ],
        'Payment Mode',
        {
          emptyValue: null
        }
      )
    ],
    [defaultFY, projects, uniqueFinancialYears]
  )

  const paymentFilterValues = useMemo(
    () => ({
      searchText,
      selectedProject,
      selectedFY,
      selectedMode
    }),
    [searchText, selectedFY, selectedMode, selectedProject]
  )

  const handlePaymentFilterChange = useCallback((key: string, value: unknown) => {
    switch (key) {
      case 'searchText':
        setSearchText(typeof value === 'string' ? value : '')
        break
      case 'selectedProject':
        setSelectedProject((value as number | null | undefined) ?? null)
        break
      case 'selectedFY':
        setSelectedFY((value as string | null | undefined) ?? defaultFY)
        break
      case 'selectedMode':
        setSelectedMode((value as string | null | undefined) ?? null)
        break
      default:
        break
    }
  }, [defaultFY])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setSelectedProject(null)
    setSelectedFY(defaultFY)
    setSelectedMode(null)
    setSelectedRowKeys([])
  }, [defaultFY])

  // Calculate filtered payments count
  const filteredPaymentsCount = useMemo(() => {
    return payments.filter((payment) => {
      const matchSearch =
        !searchText ||
        (payment.unit_number || '').toLowerCase().includes(searchText.toLowerCase()) ||
        (payment.owner_name || '').toLowerCase().includes(searchText.toLowerCase()) ||
        (payment.receipt_number || '').toLowerCase().includes(searchText.toLowerCase())
      const matchProject =
        !selectedProject ||
        payment.project_id === selectedProject ||
        projects.find((s) => s.id === selectedProject)?.name === payment.project_name
      const matchMode = !selectedMode || payment.payment_mode === selectedMode
      const matchFY = !selectedFY || payment.financial_year === selectedFY
      return matchSearch && matchProject && matchMode && matchFY
    }).length
  }, [payments, searchText, selectedProject, selectedMode, selectedFY, projects])

  const handleAdd = (): void => {
    setEditingPayment(null)
    form.resetFields()
    form.setFieldsValue({
      payment_date: dayjs(),
      payment_mode: 'Transfer',
      financial_year: defaultFY,
      // Pre-select project if only one project exists
      project_id: projects.length === 1 ? projects[0].id : undefined
    })
    setIsModalOpen(true)
  }

  const handleEditReceipt = (paymentId: number): void => {
    const payment = payments.find(p => p.id === paymentId)
    if (payment) {
      setEditingPayment(payment)
      form.setFieldsValue({
        project_id: payment.project_id,
        unit_id: payment.unit_id,
        letter_id: payment.letter_id,
        payment_amount: payment.payment_amount,
        payment_mode: payment.payment_mode,
        payment_date: dayjs(payment.payment_date),
        cheque_number: payment.cheque_number,
        remarks: payment.remarks,
        financial_year: payment.financial_year || defaultFY // Use current financial year as fallback
      })
      setIsModalOpen(true)
    }
  }

  const handleBulkAdd = (): void => {
    bulkForm.resetFields()
    bulkForm.setFieldsValue({ 
      payment_date: dayjs(), 
      payment_mode: 'Transfer',
      financial_year: defaultFY 
    })
    setBulkPayments([])
    setBulkProject(null)
    setIsBulkModalOpen(true)
  }

  const handleBulkProjectChange = useCallback(
    (projectId: number): void => {
      setBulkProject(projectId)
      const projectUnits = units.filter((u) => u.project_id === projectId)
      const paymentMode = bulkForm.getFieldValue('payment_mode') || 'Transfer'
      const paymentDate = bulkForm.getFieldValue('payment_date') || dayjs()

      setBulkPayments(
        projectUnits.map((u) => ({
          unit_id: u.id as number,
          project_id: u.project_id,
          unit_number: u.unit_number,
          owner_name: u.owner_name,
          payment_amount: 0,
          payment_mode: paymentMode,
          payment_date: paymentDate
        }))
      )
    },
    [units, bulkForm]
  )

  const handleSetSameAmount = useCallback(() => {
    const amountStr = prompt('Enter amount to apply to all units:')
    if (amountStr) {
      const amount = Number.parseFloat(amountStr)
      if (!Number.isNaN(amount) && amount >= 0) {
        setBulkPayments((prev) => prev.map((p) => ({ ...p, payment_amount: amount })))
        message.success(`Applied Rs. ${amount.toLocaleString()} to all units`)
      } else {
        message.warning('Please enter a valid number')
      }
    }
  }, [])

  const handleClearAllAmounts = useCallback(() => {
    setBulkPayments((prev) => prev.map((p) => ({ ...p, payment_amount: 0 })))
    message.success('Cleared all amounts')
  }, [])

  const handleSetAllToCheque = useCallback(() => {
    setBulkPayments((prev) => prev.map((p) => ({ ...p, payment_mode: 'Cheque' })))
    message.success('Set all payments to Cheque mode')
  }, [])

  const handleSetAllToCash = useCallback(() => {
    setBulkPayments((prev) => prev.map((p) => ({ ...p, payment_mode: 'Cash' })))
    message.success('Set all payments to Cash mode')
  }, [])

  const calculateAmountsFromLetters = useCallback(() => {
    if (!bulkProject) return
    const selectedBulkFY = bulkForm.getFieldValue('financial_year')
    let matchedCount = 0

    const updatedPayments = bulkPayments.map((payment) => {
      const unitLetters = letters
        .filter(
          (l) =>
            l.unit_id === payment.unit_id &&
            l.status !== 'Paid' &&
            (!selectedBulkFY || l.financial_year === selectedBulkFY)
        )
        .sort((a, b) => b.financial_year.localeCompare(a.financial_year))

      if (unitLetters.length > 0) {
        const latestLetter = unitLetters[0]
        matchedCount += 1
        return {
          ...payment,
          payment_amount: latestLetter.final_amount
        }
      }
      return payment
    })

    setBulkPayments(updatedPayments)
    message.success(
      selectedBulkFY
        ? `Calculated amounts from FY ${selectedBulkFY} maintenance letters for ${matchedCount} unit(s)`
        : `Calculated amounts from maintenance letters for ${matchedCount} unit(s)`
    )
  }, [bulkForm, bulkProject, bulkPayments, letters])

  const handleBulkModalOk = async (): Promise<void> => {
    try {
      const values = await bulkForm.validateFields()
      const validPayments = bulkPayments
        .filter((p) => p.payment_amount > 0)
        .map((p) => ({
          unit_id: p.unit_id,
          project_id: p.project_id,
          payment_amount: p.payment_amount,
          financial_year: values.financial_year,
          payment_mode: p.payment_mode,
          payment_date: values.payment_date.format('YYYY-MM-DD'),
          cheque_number: values.reference_number,
          remarks: values.remarks
        }))

      if (validPayments.length === 0) {
        message.warning('Please enter amount for at least one unit')
        return
      }

      setLoading(true)
      
      // Use batch service for efficient bulk payment creation
      if (process.env.NODE_ENV === 'development') {
        console.log('Starting bulk payment creation', { count: validPayments.length })
      }
      const result = await window.api.batch.createPayments(validPayments)
      
      // Generate receipts for successful payments only
      const successfulIds = result.results
        .filter(r => r.paymentId)
        .map(r => r.paymentId!)

      if (successfulIds.length > 0) {
        // Show next step guidance using utility
        showCompletionWithNextStep(
          'payments',
          'Payments recorded successfully',
          navigate,
          `${result.successful} payments recorded. Receipt generation started in background.`
        )

        try {
          if (process.env.NODE_ENV === 'development') {
            console.log('Starting receipt generation', { paymentIds: successfulIds })
          }
          const receiptResult = await runBatchReceiptGeneration(successfulIds)
          setReceiptProgress(null)
          await fetchData()

          if (receiptResult.failed === 0) {
            message.success('Receipts generated successfully')
          } else {
            message.warning(
              `Receipts generated with ${receiptResult.failed} failure${receiptResult.failed !== 1 ? 's' : ''}`
            )
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error(
            `[PAYMENTS] Failed to generate receipts for ${successfulIds.length} payments:`,
            errorMessage
          )
          // Don't fail the entire payment process, just warn about receipts
          message.warning(`Payments recorded successfully, but receipt generation failed: ${errorMessage}`)
        }
      }

      setIsBulkModalOpen(false)
      fetchData()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[PAYMENTS] Failed to record bulk payments:`, errorMessage)
      message.error(`Failed to record bulk payments: ${errorMessage}`)
    } finally {
      setLoading(false)
    }
  }

  const handleModalOk = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const selectedUnit = units.find((u) => u.id === values.unit_id)
      const projectId = values.project_id ?? selectedUnit?.project_id
      const normalizedPaymentDate =
        dayjs.isDayjs(values.payment_date) ? values.payment_date.format('YYYY-MM-DD') : values.payment_date
      const normalizedPaymentData: Payment = {
        project_id: projectId,
        unit_id: values.unit_id,
        letter_id: values.letter_id,
        payment_date: normalizedPaymentDate,
        payment_amount: values.payment_amount,
        payment_mode: values.payment_mode,
        cheque_number: values.cheque_number,
        remarks: values.remarks,
        financial_year: values.financial_year
      }

      if (!projectId) {
        throw new Error('Unable to determine the project for the selected unit')
      }
      
      if (editingPayment) {
        // Update existing payment
        await window.api.payments.update(editingPayment.id!, normalizedPaymentData)
        message.success('Payment updated successfully')
        setEditingPayment(null)
        setIsModalOpen(false)
        fetchData()
        return
      }
      
      // Create new payment logic
      const selectedLetter = letters.find((l) => l.id === values.letter_id)
      if (selectedLetter && values.payment_amount > selectedLetter.final_amount) {
        Modal.confirm({
          title: 'Payment Amount Exceeds Letter Amount',
          content: `You are about to record Rs. ${values.payment_amount.toLocaleString()} which exceeds the maintenance letter amount of Rs. ${selectedLetter.final_amount.toLocaleString()}. Do you want to continue?`,
          okText: 'Yes, Continue',
          cancelText: 'No, Edit Amount',
          onOk: async () => {
            await window.api.payments.create(normalizedPaymentData)
            setIsModalOpen(false)
            fetchData()

            showCompletionWithNextStep(
              'payments',
              'Payment recorded successfully',
              navigate,
              `Payment of Rs. ${values.payment_amount.toLocaleString()} has been added`
            )
          }
        })
        return
      }

      await window.api.payments.create(normalizedPaymentData)
      setIsModalOpen(false)
      fetchData()

      showCompletionWithNextStep(
        'payments',
        'Payment recorded successfully',
        navigate,
        `Payment of Rs. ${values.payment_amount.toLocaleString()} has been added`
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      message.error(`Failed to record payment: ${errorMessage}`)
    }
  }

  const handleDelete = async (id: number): Promise<void> => {
    Modal.confirm({
      title: 'Are you sure you want to delete this payment?',
      onOk: async (): Promise<void> => {
        try {
          await window.api.payments.delete(id)
          message.success('Payment deleted')
          fetchData()
        } catch (error) {
          console.error('Failed to delete payment:', error)
          message.error('Failed to delete payment')
        }
      }
    })
  }

  const handleBulkDelete = async (): Promise<void> => {
    Modal.confirm({
      title: `Are you sure you want to delete ${selectedRowKeys.length} payments?`,
      content: 'This action cannot be undone.',
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'No',
      onOk: async (): Promise<void> => {
        setLoading(true)
        try {
          if (process.env.NODE_ENV === 'development') {
            console.log('Starting bulk deletion', { count: selectedRowKeys.length })
          }
          const result = await window.api.batch.deletePayments(selectedRowKeys as number[])
          if (process.env.NODE_ENV === 'development') {
            console.log('Bulk delete result', result)
          }
          
          if (result.failed > 0) {
            message.warning(`${result.successful} payments deleted, ${result.failed} failed`)
          } else {
            message.success(`Successfully deleted ${result.successful} payments`)
          }
          
          fetchData()
          setSelectedRowKeys([])
        } catch (error) {
          console.error('Failed to delete payments:', error)
          message.error('Failed to delete payments')
        } finally {
          setLoading(false)
        }
      }
    })
  }

  const handlePrintReceipt = async (id: number): Promise<void> => {
    try {
      setLoading(true)
      const { taskId } = (await window.api.worker.enqueueTask('batch-pdf', {
        mode: 'receipts',
        paymentIds: [id]
      })) as { taskId: string }

      const pdfPath = await new Promise<string>((resolve, reject) => {
        const unsubscribe = window.api.worker.onProgress((event) => {
          const progressEvent = event as {
            taskId?: string
            type?: 'complete' | 'error' | 'cancel'
            error?: { message?: string }
            data?: {
              result?: {
                success: boolean
                result?: {
                  files: string[]
                }
              }
            }
          }

          if (progressEvent.taskId !== taskId) {
            return
          }

          if (progressEvent.type === 'complete') {
            unsubscribe()
            resolve(progressEvent.data?.result?.result?.files?.[0] || '')
          }

          if (progressEvent.type === 'error') {
            unsubscribe()
            reject(new Error(progressEvent.error?.message || 'Failed to generate receipt'))
          }

          if (progressEvent.type === 'cancel') {
            unsubscribe()
            reject(new Error('Receipt generation was cancelled'))
          }
        })
      })

      await window.api.shell.showItemInFolder(pdfPath)
      message.success('Receipt generated successfully')
    } catch (error) {
      console.error('Failed to generate receipt:', error)
      message.error('Failed to generate receipt')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenReceiptsFolder = useCallback(async (): Promise<void> => {
    try {
      await window.api.shell.openOutputFolder('receipts')
    } catch (error) {
      console.error('Failed to open receipts folder:', error)
      message.error('Failed to open receipts folder')
    }
  }, [])

  const handleDownloadReceiptsZip = useCallback(async (): Promise<void> => {
    try {
      const timestamp = dayjs().format('YYYYMMDD_HHmmss')
      const destinationPath = await window.api.dialog.saveFile({
        title: 'Save Receipts ZIP',
        defaultPath: `receipts_${timestamp}.zip`,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      })

      if (!destinationPath) return

      message.loading({ content: 'Creating ZIP...', key: 'receipts_zip' })
      const result = await window.api.shell.exportOutputZip('receipts', destinationPath)
      message.success({
        content: `ZIP saved with ${result.fileCount} receipt PDF${result.fileCount !== 1 ? 's' : ''}`,
        key: 'receipts_zip'
      })
    } catch (error) {
      console.error('Failed to export receipts ZIP:', error)
      message.error({ content: 'Failed to create receipts ZIP', key: 'receipts_zip' })
    }
  }, [])

  const runBatchReceiptGeneration = useCallback(
    async (paymentIds: number[]): Promise<{ generated: number; failed: number; files: string[] }> => {
      setGeneratingReceipts(true)
      setReceiptProgress({ current: 0, total: paymentIds.length })

      try {
        const { taskId } = (await window.api.worker.enqueueTask('batch-pdf', {
          mode: 'receipts',
          paymentIds
        })) as { taskId: string }
        setReceiptTaskId(taskId)

        return await new Promise<{ generated: number; failed: number; files: string[] }>(
          (resolve, reject) => {
            const unsubscribe = window.api.worker.onProgress((event) => {
              const progressEvent = event as {
                taskId?: string
                type?: 'start' | 'progress' | 'complete' | 'error' | 'cancel'
                current?: number
                total?: number
                error?: { message?: string }
                data?: {
                  result?: {
                    success: boolean
                    result?: {
                      generated: number
                      failed: number
                      files: string[]
                    }
                  }
                }
              }

              if (progressEvent.taskId !== taskId) {
                return
              }

              if (progressEvent.type === 'progress') {
                setReceiptProgress((prev) =>
                  prev
                    ? {
                        ...prev,
                        current: progressEvent.current ?? prev.current,
                        total: progressEvent.total ?? prev.total
                      }
                    : null
                )
              }

              if (progressEvent.type === 'complete') {
                unsubscribe()
                setReceiptTaskId(null)
                resolve(
                  progressEvent.data?.result?.result || {
                    generated: progressEvent.total || 0,
                    failed: 0,
                    files: []
                  }
                )
              }

              if (progressEvent.type === 'error') {
                unsubscribe()
                setReceiptTaskId(null)
                reject(new Error(progressEvent.error?.message || 'Receipt generation failed'))
              }

              if (progressEvent.type === 'cancel') {
                unsubscribe()
                setReceiptTaskId(null)
                reject(new Error('Receipt generation cancelled'))
              }
            })
          }
        )
      } finally {
        setGeneratingReceipts(false)
      }
    },
    []
  )

  const handleBatchReceipts = async (): Promise<void> => {
    if (selectedRowKeys.length === 0) {
      message.warning('Please select payments to generate receipts for')
      return
    }

    try {
      const result = await runBatchReceiptGeneration(selectedRowKeys as number[])
      setReceiptProgress(null)
      await fetchData()

      if (result.failed === 0 && result.files[0]) {
        message.success(
          <span>
            Successfully generated {result.generated} receipts.{' '}
            <a
              onClick={() => window.api.shell.showItemInFolder(result.files[0])}
              style={{ color: '#1890ff', cursor: 'pointer' }}
            >
              Open folder
            </a>
          </span>,
          10
        )
      } else if (result.failed === 0) {
        message.success(`Successfully generated ${result.generated} receipts`)
      } else {
        message.warning(`Generated ${result.generated} receipts, failed to generate ${result.failed}`)
      }
    } catch (error) {
      console.error('Failed to generate receipts:', error)
      setReceiptProgress(null)
      message.error(error instanceof Error ? error.message : 'Failed to generate receipts')
    }
  }

  const handleCancelBatchGeneration = (): void => {
    if (receiptTaskId && receiptProgress && receiptProgress.current < receiptProgress.total) {
      Modal.confirm({
        title: 'Cancel Receipt Generation?',
        content: `${receiptProgress.current} of ${receiptProgress.total} receipts have been generated and saved. Do you want to cancel the remaining?`,
        onOk: async () => {
          await window.api.worker.cancel(receiptTaskId)
          setGeneratingReceipts(false)
          setReceiptProgress(null)
          setReceiptTaskId(null)
          message.info(`Cancelled. ${receiptProgress.current} receipts were saved.`)
        }
      })
    } else {
      setGeneratingReceipts(false)
      setReceiptProgress(null)
      setReceiptTaskId(null)
    }
  }

  const columns = [
    {
      title: 'Unit',
      dataIndex: 'unit_number',
      key: 'unit_number',
      sorter: (a: Payment, b: Payment) => (a.unit_number || '').localeCompare(b.unit_number || ''),
      render: (unitNumber: string, record: Payment) => (
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
      sorter: (a: Payment, b: Payment) => (a.owner_name || '').localeCompare(b.owner_name || ''),
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
      title: 'Date',
      dataIndex: 'payment_date',
      key: 'payment_date',
      render: (date: string) => dayjs(date).format('DD-MM-YYYY'),
      sorter: (a: Payment, b: Payment) =>
        dayjs(a.payment_date).unix() - dayjs(b.payment_date).unix()
    },
    {
      title: 'Receipt #',
      dataIndex: 'receipt_number',
      key: 'receipt_number',
      render: (receipt: string) => receipt || <Text type="secondary">Not generated</Text>,
      sorter: (a: Payment, b: Payment) =>
        (a.receipt_number || '').localeCompare(b.receipt_number || '', undefined, {
          numeric: true,
          sensitivity: 'base'
        })
    },
    {
      title: 'Amount',
      dataIndex: 'payment_amount',
      key: 'payment_amount',
      align: 'right' as const,
      render: (val: number) => <strong>Rs. {val.toLocaleString()}</strong>,
      sorter: (a: Payment, b: Payment) => a.payment_amount - b.payment_amount
    },
    {
      title: 'Mode',
      dataIndex: 'payment_mode',
      key: 'payment_mode',
      align: 'center' as const,
      render: (mode: string) => (
        <Tag color="blue" aria-label={`Payment mode: ${mode}`}>
          <span style={{ fontWeight: 500 }}>{mode}</span>
        </Tag>
      )
    },
    {
      title: 'Reference #',
      dataIndex: 'cheque_number',
      key: 'cheque_number',
      render: (text: string) => text || '-'
    },
    {
      title: 'For FY',
      dataIndex: 'financial_year',
      key: 'financial_year',
      align: 'center' as const,
      render: (fy: string) => fy || <Text type="secondary">N/A</Text>
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right' as const,
      render: (_: unknown, record: Payment) => (
        <Space className="table-row-actions" size="small">
          <Button
            size="small"
            type="primary"
            icon={<PrinterOutlined />}
            onClick={() => record.id && handlePrintReceipt(record.id)}
            title="Generate Receipt"
            aria-label={`Generate receipt for unit ${record.unit_number}`}
          >
            Receipt
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => record.id && handleEditReceipt(record.id)}
            title="Edit Payment"
            aria-label={`Edit payment for unit ${record.unit_number}`}
          >
            Edit
          </Button>
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            onClick={() => record.id && handleDelete(record.id)}
            title="Delete Payment"
            aria-label={`Delete payment for unit ${record.unit_number}`}
          >
            Delete
          </Button>
        </Space>
      )
    }
  ]

  const filteredPayments = payments.filter((payment) => {
    const matchSearch =
      !searchText ||
      (payment.unit_number || '').toLowerCase().includes(searchText.toLowerCase()) ||
      (payment.owner_name || '').toLowerCase().includes(searchText.toLowerCase()) ||
      (payment.receipt_number || '').toLowerCase().includes(searchText.toLowerCase())
    const matchProject =
      !selectedProject ||
      payment.project_id === selectedProject ||
      projects.find((s) => s.id === selectedProject)?.name === payment.project_name
    const matchMode = !selectedMode || payment.payment_mode === selectedMode
    const matchFY = !selectedFY || payment.financial_year === selectedFY
    return matchSearch && matchProject && matchMode && matchFY
  })

  // Calculate bulk payment summary
  const bulkPaymentSummary = useMemo(() => {
    const unitsWithAmount = bulkPayments.filter((p) => p.payment_amount > 0).length
    const totalAmount = bulkPayments.reduce((sum, p) => sum + p.payment_amount, 0)
    const averageAmount =
      bulkPayments.length > 0 ? Math.round(totalAmount / bulkPayments.length) : 0

    return {
      unitsWithAmount,
      totalAmount,
      averageAmount,
      totalUnits: bulkPayments.length
    }
  }, [bulkPayments])

  // Get units with maintenance letters due (for collapsed view)
  const unitsWithLettersDue = useMemo(() => {
    if (!bulkProject) return []
    return bulkPayments.filter((payment) => {
      const unitLetters = letters.filter(
        (l) => l.unit_id === payment.unit_id && l.status !== 'Paid'
      )
      return unitLetters.length > 0
    })
  }, [bulkProject, bulkPayments, letters])

  // State for showing all units in bulk modal
  const [showAllUnits, setShowAllUnits] = useState(false)

  const displayBulkPayments = useMemo(() => {
    if (showAllUnits) return bulkPayments
    return unitsWithLettersDue.length > 0 ? unitsWithLettersDue : bulkPayments.slice(0, 10)
  }, [showAllUnits, bulkPayments, unitsWithLettersDue])

  return (
    <div className="page-screen">
      {/* Navigation guard: show setup prompt when no projects */}
      {projects.length === 0 && !loading && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="No projects found"
          description={
            <span>
              You need to create a project and generate maintenance letters before recording payments.{' '}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/projects')}>
                Go to Projects {'->'}
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
            marginBottom: 24,
            flexWrap: 'wrap',
            gap: '16px'
          }}
        >
          <div>
            <Title level={2} style={{ margin: 0 }}>
              Payments & Receipts
            </Title>
            <Text type="secondary" className="page-hero-subtitle">
              Capture collections, issue receipts, and process bulk payment updates with fewer clicks.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Record individual payments first, then use bulk and receipt actions for follow-up processing.
            </Text>
            {filteredPaymentsCount > 0 && (
              <Text type="secondary" style={{ fontSize: '14px', display: 'block', marginTop: 6 }}>
                {filteredPaymentsCount} payment{filteredPaymentsCount !== 1 ? 's' : ''}
              </Text>
            )}
          </div>
          <Space className="responsive-action-bar">
            <ActionMenuButton
              label="Receipts Folder"
              icon={<FolderOpenOutlined />}
              ariaLabel="Receipts folder actions"
              items={[
                {
                  key: 'open-folder',
                  icon: <FolderOpenOutlined />,
                  label: 'Open Receipts Folder',
                  onClick: () => void handleOpenReceiptsFolder()
                },
                {
                  key: 'download-zip',
                  icon: <DownloadOutlined />,
                  label: 'Download Receipts ZIP',
                  onClick: () => void handleDownloadReceiptsZip()
                }
              ]}
            />
            <Button
              icon={<TableOutlined />}
              onClick={handleBulkAdd}
              aria-label="Open bulk payment entry"
            >
              Record Bulk Payments
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              style={{ fontWeight: 600 }}
              aria-label="Record new payment"
            >
              Record Payment
            </Button>
          </Space>
        </div>
      </div>

      {selectedRowKeys.length > 0 && (
        <div className="page-selection-bar">
          <Text className="page-selection-label">
            {selectedRowKeys.length} payment{selectedRowKeys.length !== 1 ? 's' : ''} selected
          </Text>
          <Space wrap>
            <Button
              type="primary"
              icon={<PrinterOutlined />}
              onClick={handleBatchReceipts}
              loading={generatingReceipts}
            >
              Batch Receipts ({selectedRowKeys.length})
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleBulkDelete}
              aria-label={`Delete ${selectedRowKeys.length} selected payments`}
            >
              Delete Selected ({selectedRowKeys.length})
            </Button>
          </Space>
        </div>
      )}

      <Card className="page-toolbar-card page-table-card payments-filter-card">
        <FilterPanel
          filters={paymentFilterFields}
          values={paymentFilterValues}
          onChange={handlePaymentFilterChange}
          onClear={clearAllFilters}
          showActiveFilters={hasActiveFilters}
          showClearButton
          loading={loading}
          variant="plain"
        />
      </Card>

        <div className="table-scroll-wrapper mobile-card-table">
          <Table
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              getCheckboxProps: (record: Payment) => ({
                title: `Select payment for unit ${record.unit_number}`
              })
            }}
            columns={columns}
            dataSource={filteredPayments}
            rowKey="id"
            loading={loading}
          pagination={{ 
              pageSize: pageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              onShowSizeChange: (_, size) => setPageSize(size)
            }}
            virtual={filteredPayments.length > 100}
            scroll={{ x: 'max-content', y: filteredPayments.length > 100 ? 620 : undefined }}
          />
        </div>

      {/* Batch Receipt Generation Progress Modal */}
      <Modal
        title="Generating Receipts"
        open={generatingReceipts}
        onCancel={handleCancelBatchGeneration}
        footer={[
          <Button
            key="cancel"
            onClick={handleCancelBatchGeneration}
            disabled={receiptProgress?.current === receiptProgress?.total}
            aria-label="Cancel receipt generation"
          >
            Cancel
          </Button>
        ]}
        closable={false}
        width={500}
        className="mobile-fullscreen-modal progress-status-modal"
      >
        {receiptProgress && (
          <div className="progress-status-body">
            <Progress
              percent={Math.round((receiptProgress.current / receiptProgress.total) * 100)}
              status="active"
              className="progress-status-bar"
              aria-label={`Progress: ${receiptProgress.current} of ${receiptProgress.total} receipts generated`}
            />
            <Text className="progress-status-title">
              Generating {receiptProgress.current} of {receiptProgress.total} receipts
            </Text>
            {receiptProgress.current > 0 && (
              <div className="progress-status-note">
                <Text type="secondary">
                  {receiptProgress.current} receipt{receiptProgress.current !== 1 ? 's' : ''} saved
                </Text>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Record Single Payment Modal */}
      <Modal
        title={editingPayment ? "Edit Payment" : "Record Payment"}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => {
          setIsModalOpen(false)
          setEditingPayment(null)
        }}
        confirmLoading={loading}
        width={640}
        style={{ 
          maxWidth: '95vw',
          margin: '0 auto'
        }}
        centered
        className="payment-modal-responsive"
        bodyStyle={{ padding: '12px 16px', maxHeight: '70vh', overflowY: 'auto' }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ payment_date: dayjs(), payment_mode: 'Transfer' }}
        >
          <Form.Item name="project_id" hidden>
            <Input type="hidden" />
          </Form.Item>

          {/* ── Unit Details ── */}
          <Divider orientation={'left' as DividerProps['orientation']} plain style={{ marginTop: 0 }}>
            Unit Details
          </Divider>
          <Row gutter={[16, 8]}>
            <Col span={24}>
              <Form.Item
                label="Filter by Project"
                style={{ marginBottom: 4 }}
              >
                <Select
                  className="app-combobox"
                  showSearch
                  placeholder="Select project to narrow unit list (optional)"
                  allowClear
                  value={formProjectId || undefined}
                  filterOption={(input, option) =>
                    String(option?.children || '').toLowerCase().includes(input.toLowerCase())
                  }
                  onChange={(pid) => {
                    form.setFieldsValue({ project_id: pid, unit_id: undefined, letter_id: undefined })
                  }}
                  aria-label="Filter units by project"
                  style={{ width: '100%' }}
                >
                  {projects.map((p) => (
                    <Option key={p.id} value={p.id}>
                      {p.project_code ? `${p.project_code} - ${p.name}` : p.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>

            <Col span={24}>
              <Form.Item
                name="unit_id"
                label="Select Unit"
                rules={[{ required: true, message: 'Please select a unit' }]}
              >
                <Select
                  className="app-combobox"
                  showSearch
                  placeholder={
                    formProjectId
                      ? `Search among ${filteredUnitsForForm.length} unit${filteredUnitsForForm.length !== 1 ? 's' : ''}`
                      : 'Select a project above to filter, or search all units'
                  }
                  filterOption={(input, option) =>
                    String(option?.children || '').toLowerCase().includes(input.toLowerCase())
                  }
                  onChange={(unitId) => {
                    const selectedUnit = units.find((u) => u.id === unitId)
                    if (selectedUnit && !formProjectId) {
                      form.setFieldsValue({
                        project_id: selectedUnit.project_id,
                        letter_id: undefined
                      })
                    } else {
                      form.setFieldsValue({ letter_id: undefined })
                    }
                  }}
                  aria-label="Select unit for payment"
                  notFoundContent={formProjectId ? 'No units found for this project' : 'No units found'}
                  style={{ width: '100%' }}
                >
                  {filteredUnitsForForm.map((u) => (
                    <Option key={u.id} value={u.id}>
                      {u.unit_number} - {u.owner_name}
                      {!formProjectId ? ` (${u.project_name})` : ''}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* ── Letter & Financial Year ── */}
          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.unit_id !== currentValues.unit_id ||
              prevValues.letter_id !== currentValues.letter_id
            }
          >
            {({ getFieldValue }) => {
              const unitId = getFieldValue('unit_id')
              const letterId = getFieldValue('letter_id')
              const unitLetters = letters.filter((l) => l.unit_id === unitId)
              const selectedLetter = unitLetters.find((l) => l.id === letterId)

              return (
                <>
                  <Divider orientation={'left' as DividerProps['orientation']} plain>
                    Maintenance Letter
                  </Divider>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Recommended payment flow"
                    description="For billed units, select the maintenance letter first. That will align the financial year and fill the amount automatically."
                  />
                  <Row gutter={[16, 8]}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="letter_id"
                        label="Against Maintenance Letter"
                        extra={
                          <div style={{ fontSize: '12px' }}>
                            {unitLetters.length === 0
                              ? 'No maintenance letters found for this unit'
                              : 'Selecting a letter will automatically set the financial year and amount'}
                          </div>
                        }
                      >
                        <Select
                          className="app-combobox"
                          placeholder="Select Maintenance Letter"
                          allowClear
                          disabled={unitLetters.length === 0}
                          onChange={(val) => {
                            if (val) {
                              const letter = unitLetters.find((l) => l.id === val)
                              if (letter) {
                                const formattedYear = formatFinancialYear(letter.financial_year)
                                if (!/^\d{4}-\d{2}$/.test(formattedYear)) {
                                  message.warning('Letter has invalid financial year format, using the working financial year')
                                  form.setFieldsValue({
                                    financial_year: defaultFY,
                                    payment_amount: letter.final_amount
                                  })
                                } else {
                                  form.setFieldsValue({
                                    financial_year: formattedYear,
                                    payment_amount: letter.final_amount
                                  })
                                }
                              }
                            }
                          }}
                          aria-label="Select maintenance letter"
                          style={{ width: '100%' }}
                        >
                          {unitLetters.map((letter) => (
                            <Option key={letter.id} value={letter.id}>
                              FY {letter.financial_year} - Rs. {letter.final_amount} ({letter.status})
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item
                        name="financial_year"
                        label="For Financial Year"
                        rules={[
                          { required: true, message: 'Please select a financial year' },
                          {
                            pattern: /^\d{4}-\d{2}$/,
                            message: 'Format must be YYYY-YY (e.g., 2024-25)'
                          }
                        ]}
                        normalize={(value) => formatFinancialYear(value)}
                        extra={
                          <div style={{ fontSize: '12px' }}>
                            <Text type="secondary">
                              Working FY: {defaultFY}. Next FY: {upcomingFY}. The selected working financial year is used by default.
                            </Text>
                            {selectedLetter && (
                              <>
                                <br />
                                <Text type="warning">
                                  Locked to the selected maintenance letter. Clear the letter to change FY.
                                </Text>
                              </>
                            )}
                          </div>
                        }
                      >
                        <Select
                          className="app-combobox"
                          placeholder="Select Financial Year"
                          disabled={Boolean(selectedLetter)}
                          showSearch
                          filterOption={(input, option) => {
                            const optionText = option?.children?.toString() || ''
                            const formattedSearch = formatFinancialYear(input)
                            return optionText.includes(formattedSearch) || 
                                   optionText.toLowerCase().includes(input.toLowerCase())
                          }}
                          aria-label="Select financial year for payment"
                          style={{ width: '100%' }}
                        >
                          {Array.from(new Set(letters.map((l) => l.financial_year)))
                            .filter(fy => /^\d{4}-\d{2}$/.test(fy))
                            .sort()
                            .reverse()
                            .map((fy) => (
                              <Option key={fy} value={fy}>
                                {fy === defaultFY
                                  ? `${fy} (Working)`
                                  : fy === upcomingFY
                                    ? `${fy} (Upcoming)`
                                    : fy}
                              </Option>
                            ))}
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )
            }}
          </Form.Item>

          {/* ── Payment Details ── */}
          <Divider orientation={'left' as DividerProps['orientation']} plain>
            Payment Details
          </Divider>
          <Row gutter={[16, 8]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="payment_date"
                label="Payment Date"
                rules={[{ required: true, message: 'Please select payment date' }]}
              >
                <DatePicker style={{ width: '100%' }} aria-label="Select payment date" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="payment_amount"
                label="Amount (Rs.)"
                rules={[
                  { required: true, message: 'Please enter amount' },
                  { type: 'number', min: 1, message: 'Amount must be greater than 0' }
                ]}
                extra={
                  <div style={{ fontSize: '12px' }}>
                    {suggestedPaymentAmount !== null && (
                      <Text type="secondary">
                        {formLetterId
                          ? `Letter amount: Rs. ${suggestedPaymentAmount.toLocaleString('en-IN')}`
                          : `Auto-filled from FY ${formFinancialYear}: Rs. ${suggestedPaymentAmount.toLocaleString('en-IN')}`}
                      </Text>
                    )}
                  </div>
                }
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  placeholder="Enter payment amount"
                  aria-label="Enter payment amount"
                />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item
                name="payment_mode"
                label="Payment Mode"
                rules={[{ required: true, message: 'Please select payment mode' }]}
              >
                <Select aria-label="Select payment mode" style={{ width: '100%' }}>
                  <Option value="Transfer">Bank Transfer / UPI</Option>
                  <Option value="Cheque">Cheque</Option>
                  <Option value="Cash">Cash</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="cheque_number"
                label="Reference # (UTR/Cheque No)"
                aria-label="Enter reference number"
              >
                <Input placeholder="Enter UTR or cheque number" style={{ width: '100%' }} />
              </Form.Item>
            </Col>

            <Col span={24}>
              <Form.Item
                name="remarks"
                label="Remarks"
                aria-label="Enter remarks"
              >
                <Input.TextArea rows={2} placeholder="Enter any additional remarks" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Bulk Payment Modal */}
      <Modal
        title="Record Bulk Payments"
        open={isBulkModalOpen}
        onOk={handleBulkModalOk}
        onCancel={() => setIsBulkModalOpen(false)}
        confirmLoading={loading}
        width={1000}
        okText="Record Bulk Payments"
        className="mobile-fullscreen-modal"
      >
        <Form form={bulkForm} layout="vertical">
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
            <Form.Item
              label="Project"
              style={{ flex: 1 }}
              required
              aria-label="Select project for bulk payments"
            >
              <Select
                placeholder="Select Project"
                onChange={handleBulkProjectChange}
                value={bulkProject}
              >
                {projects.map((s) => (
                  <Option key={s.id} value={s.id}>
                    {s.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              name="payment_date"
              label="Payment Date"
              initialValue={dayjs()}
              style={{ flex: 1 }}
              rules={[{ required: true, message: 'Please select payment date' }]}
            >
              <DatePicker
                style={{ width: '100%' }}
                aria-label="Select payment date for all bulk payments"
              />
            </Form.Item>
            <Form.Item
              name="financial_year"
              label="Financial Year"
              rules={[
                { required: true, message: 'Please select financial year' },
                {
                  pattern: /^\d{4}-\d{2}$/,
                  message: 'Format must be YYYY-YY (e.g., 2024-25)'
                }
              ]}
              style={{ flex: 1 }}
              extra={`Working FY: ${defaultFY}. Next FY: ${upcomingFY}. The selected working financial year is used by default.`}
            >
              <Select
                placeholder="Select Year"
                aria-label="Select financial year for bulk payments"
              >
                {Array.from(new Set(letters.map((l) => l.financial_year)))
                  .filter(fy => /^\d{4}-\d{2}$/.test(fy)) // Only show valid formats
                  .sort()
                  .reverse()
                  .map((fy) => (
                    <Option key={fy} value={fy}>
                      {fy === defaultFY
                        ? `${fy} (Working)`
                        : fy === upcomingFY
                          ? `${fy} (Upcoming)`
                          : fy}
                    </Option>
                  ))}
              </Select>
            </Form.Item>
            <Form.Item
              name="payment_mode"
              label="Default Mode"
              initialValue="Transfer"
              style={{ flex: 1 }}
            >
              <Select
                onChange={(val) =>
                  setBulkPayments((prev) => prev.map((p) => ({ ...p, payment_mode: val })))
                }
                aria-label="Select default payment mode for bulk payments"
              >
                <Option value="Transfer">Bank Transfer / UPI</Option>
                <Option value="Cheque">Cheque</Option>
                <Option value="Cash">Cash</Option>
              </Select>
            </Form.Item>
          </div>

          {bulkProject && (
            <>
              <div
                className="responsive-stack-row"
                style={{
                  marginBottom: 16,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap'
                }}
              >
                <Text type="secondary">Quick actions:</Text>
                <Button
                  size="small"
                  icon={<CalculatorOutlined />}
                  onClick={handleSetSameAmount}
                  aria-label="Set same amount for all units"
                >
                  Set Same Amount
                </Button>
                <Button
                  size="small"
                  icon={<InfoCircleOutlined />}
                  onClick={calculateAmountsFromLetters}
                  aria-label="Calculate amounts from maintenance letters"
                >
                  Calculate from Letters
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<ClearOutlined />}
                  onClick={handleClearAllAmounts}
                  aria-label="Clear all amounts"
                >
                  Clear All Amounts
                </Button>
                <Button
                  size="small"
                  onClick={handleSetAllToCheque}
                  aria-label="Set all payments to Cheque mode"
                >
                  Set All to Cheque
                </Button>
                <Button
                  size="small"
                  onClick={handleSetAllToCash}
                  aria-label="Set all payments to Cash mode"
                >
                  Set All to Cash
                </Button>
              </div>

              {unitsWithLettersDue.length > 0 && !showAllUnits && (
                <Alert
                  message={`Showing ${unitsWithLettersDue.length} units with maintenance letters due`}
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  action={
                    <Button size="small" type="link" onClick={() => setShowAllUnits(true)}>
                      Show all {bulkPayments.length} units
                    </Button>
                  }
                />
              )}

              <div className="table-scroll-wrapper">
                <Table
                  dataSource={displayBulkPayments}
                  pagination={false}
                  scroll={{ x: 'max-content', y: 400 }}
                  rowKey="unit_id"
                  columns={[
                  {
                    title: 'Unit #',
                    dataIndex: 'unit_number',
                    key: 'unit_number',
                    width: 100
                  },
                  {
                    title: 'Owner',
                    dataIndex: 'owner_name',
                    key: 'owner_name'
                  },
                  {
                    title: 'Amount (Rs. )',
                    key: 'amount',
                    width: 150,
                    render: (_: unknown, record: BulkPaymentEntry) => {
                      const actualIndex = bulkPayments.findIndex(
                        (p) => p.unit_id === record.unit_id
                      )
                      return (
                        <InputNumber
                          min={0}
                          style={{ width: '100%' }}
                          value={record.payment_amount}
                          onChange={(val) => {
                            const newPayments = [...bulkPayments]
                            newPayments[actualIndex].payment_amount = val || 0
                            setBulkPayments(newPayments)
                          }}
                          aria-label={`Enter amount for unit ${record.unit_number}`}
                        />
                      )
                    }
                  },
                  {
                    title: 'Mode',
                    key: 'mode',
                    width: 150,
                    render: (_: unknown, record: BulkPaymentEntry) => {
                      const actualIndex = bulkPayments.findIndex(
                        (p) => p.unit_id === record.unit_id
                      )
                      return (
                        <Select
                          style={{ width: '100%' }}
                          value={record.payment_mode}
                          onChange={(val) => {
                            const newPayments = [...bulkPayments]
                            newPayments[actualIndex].payment_mode = val
                            setBulkPayments(newPayments)
                          }}
                          aria-label={`Select payment mode for unit ${record.unit_number}`}
                        >
                          <Option value="Transfer">Transfer</Option>
                          <Option value="Cheque">Cheque</Option>
                          <Option value="Cash">Cash</Option>
                        </Select>
                      )
                    }
                  }
                  ]}
                />
              </div>

              {showAllUnits && bulkPayments.length > 10 && (
                <div style={{ marginTop: 8, textAlign: 'center' }}>
                  <Button type="link" onClick={() => setShowAllUnits(false)}>
                    Show only units with maintenance letters due
                  </Button>
                </div>
              )}

              {/* Bulk Payment Summary */}
              {bulkPayments.length > 0 && (
                <div
                  className="responsive-summary-row"
                  style={{
                    marginTop: 16,
                    padding: '12px 16px',
                    background: '#f6ffed',
                    borderRadius: 4,
                    border: '1px solid #b7eb8f'
                  }}
                >
                  <Space size="large" wrap>
                    <Text strong>
                      Units with amount: {bulkPaymentSummary.unitsWithAmount} /{' '}
                      {bulkPaymentSummary.totalUnits}
                    </Text>
                    <Text strong type="success">
                      Total Amount: Rs. {bulkPaymentSummary.totalAmount.toLocaleString()}
                    </Text>
                    <Text type="secondary">
                      Average: Rs. {bulkPaymentSummary.averageAmount.toLocaleString()}
                    </Text>
                  </Space>
                </div>
              )}

              <div className="responsive-stack-row" style={{ marginTop: '16px', display: 'flex', gap: '16px' }}>
                <Form.Item
                  name="reference_number"
                  label="Common Reference # (Optional)"
                  style={{ flex: 1 }}
                  aria-label="Enter common reference number for all bulk payments"
                >
                  <Input placeholder="Enter common UTR or cheque number" />
                </Form.Item>
                <Form.Item
                  name="remarks"
                  label="Common Remarks (Optional)"
                  style={{ flex: 1 }}
                  aria-label="Enter common remarks for all bulk payments"
                >
                  <Input placeholder="Enter common remarks for all payments" />
                </Form.Item>
              </div>
            </>
          )}

          {!bulkProject && (
            <Alert
              message="Select a project to start bulk payment entry"
              type="info"
              showIcon
              style={{ marginTop: 16 }}
            />
          )}
        </Form>
      </Modal>
    </div>
  )
}

export default Payments
