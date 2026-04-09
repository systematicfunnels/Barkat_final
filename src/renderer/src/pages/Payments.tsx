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
  TableOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Project, Unit, Payment, MaintenanceLetter } from '@preload/types'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'
import {
  formatFinancialYear,
  getUpcomingFinancialYear
} from '../utils/financialYear'
import { appMessage as message } from '../utils/appMessage'
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
  has_matching_letter: boolean
  matched_letter_id?: number
  matched_letter_amount?: number
  amount_source: 'empty' | 'letter' | 'manual'
}

interface ReceiptProgress {
  current: number
  total: number
}

interface BulkPaymentSharedValues {
  paymentDate: dayjs.Dayjs
  financialYear: string
  paymentMode: string
  referenceNumber?: string
  remarks?: string
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
  const [bulkModalStep, setBulkModalStep] = useState<'config' | 'units'>('config')
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
  const isGeneratedLetter = useCallback(
    (letter: MaintenanceLetter): boolean =>
      Boolean(letter.generated_date && dayjs(letter.generated_date).isValid()),
    []
  )
  const availableLettersForForm = useMemo(
    () =>
      letters.filter((letter) => {
        if (formProjectId && letter.project_id !== formProjectId) {
          return false
        }
        if (formFinancialYear && letter.financial_year !== formFinancialYear) {
          return false
        }
        if (!isGeneratedLetter(letter) && letter.id !== formLetterId) {
          return false
        }
        if (letter.status === 'Paid' && letter.unit_id !== formUnitId && letter.id !== formLetterId) {
          return false
        }
        return true
      }),
    [formFinancialYear, formLetterId, formProjectId, formUnitId, isGeneratedLetter, letters]
  )
  const availableUnitIdsForForm = useMemo(
    () =>
      new Set(
        availableLettersForForm
          .map((letter) => Number(letter.unit_id))
          .filter((unitId) => Number.isFinite(unitId))
      ),
    [availableLettersForForm]
  )
  const filteredUnitsForForm = useMemo(
    () =>
      units.filter((unit) => {
        if (formProjectId && unit.project_id !== formProjectId) {
          return false
        }

        const unitId = Number(unit.id)
        if (!Number.isFinite(unitId)) {
          return false
        }

        if (unitId === formUnitId) {
          return true
        }

        return availableUnitIdsForForm.has(unitId)
      }),
    [availableUnitIdsForForm, formProjectId, formUnitId, units]
  )
  const [bulkPayments, setBulkPayments] = useState<BulkPaymentEntry[]>([])
  const [bulkProject, setBulkProject] = useState<number | null>(null)
  const [bulkSelectedFinancialYear, setBulkSelectedFinancialYear] = useState(defaultFY)
  const [bulkSharedValues, setBulkSharedValues] = useState<BulkPaymentSharedValues>({
    paymentDate: dayjs(),
    financialYear: defaultFY,
    paymentMode: 'Transfer',
    referenceNumber: undefined,
    remarks: undefined
  })
  const [bulkTablePageSize, setBulkTablePageSize] = useState(15)
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
          letter.unit_id === formUnitId &&
          letter.financial_year === formFinancialYear &&
          isGeneratedLetter(letter)
      )
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
  }, [formFinancialYear, formUnitId, isGeneratedLetter, letters])

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

  const getBulkMatchingLetter = useCallback(
    (unitId: number, financialYear?: string | null) => {
      const normalizedFY = financialYear || undefined
      return letters
        .filter(
          (letter) =>
            letter.unit_id === unitId &&
            isGeneratedLetter(letter) &&
            letter.status !== 'Paid' &&
            (!normalizedFY || letter.financial_year === normalizedFY)
        )
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0]
    },
    [isGeneratedLetter, letters]
  )

  const createBulkPaymentEntry = useCallback(
    (
      unit: Unit,
      options: {
        financialYear?: string | null
        paymentMode: string
        paymentDate: dayjs.Dayjs
      }
    ): BulkPaymentEntry => {
      const matchedLetter = getBulkMatchingLetter(unit.id as number, options.financialYear)
      const matchedAmount = matchedLetter?.final_amount ?? 0
      return {
        unit_id: unit.id as number,
        project_id: unit.project_id,
        unit_number: unit.unit_number,
        owner_name: unit.owner_name,
        payment_amount: matchedAmount,
        payment_mode: options.paymentMode,
        payment_date: options.paymentDate,
        has_matching_letter: Boolean(matchedLetter),
        matched_letter_id: matchedLetter?.id,
        matched_letter_amount: matchedAmount || undefined,
        amount_source: matchedLetter ? 'letter' : 'empty'
      }
    },
    [getBulkMatchingLetter]
  )

  const buildBulkPaymentEntries = useCallback(
    (projectId: number, financialYear?: string | null): BulkPaymentEntry[] => {
      const projectUnits = units.filter((u) => u.project_id === projectId)
      const paymentMode = bulkSharedValues.paymentMode || 'Transfer'
      const paymentDate = bulkSharedValues.paymentDate || dayjs()

      return projectUnits
        .map((unit) =>
          createBulkPaymentEntry(unit, {
            financialYear,
            paymentMode,
            paymentDate
          })
        )
        .filter((entry) => entry.has_matching_letter)
    },
    [bulkSharedValues.paymentDate, bulkSharedValues.paymentMode, createBulkPaymentEntry, units]
  )

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
    formUnitId,
    isModalOpen,
    lastAutoFillKey,
    lastAutoFilledAmount,
    letters
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
      message.error('Could not load payments')
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
        message.error('Could not load units for this project')
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
  }, [defaultFY, form, location, units])

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

  const selectedProjectName = useMemo(
    () => projects.find((project) => project.id === selectedProject)?.name,
    [projects, selectedProject]
  )

    const matchesPaymentFilters = useCallback(
      (payment: Payment): boolean => {
        const normalizedSearch = searchText.toLowerCase()
        const matchSearch =
          !searchText ||
          (payment.unit_number || '').toLowerCase().includes(normalizedSearch) ||
          (payment.owner_name || '').toLowerCase().includes(normalizedSearch) ||
          (payment.receipt_number || '').toLowerCase().includes(normalizedSearch) ||
          (payment.project_name || '').toLowerCase().includes(normalizedSearch)
        const matchProject =
          !selectedProject ||
          payment.project_id === selectedProject ||
        selectedProjectName === payment.project_name
      const matchMode = !selectedMode || payment.payment_mode === selectedMode
      const matchFY = !selectedFY || payment.financial_year === selectedFY
      return matchSearch && matchProject && matchMode && matchFY
    },
    [searchText, selectedProject, selectedProjectName, selectedMode, selectedFY]
  )

  // Calculate filtered payments count
  const filteredPaymentsCount = useMemo(
    () => payments.filter(matchesPaymentFilters).length,
    [payments, matchesPaymentFilters]
  )

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
    const initialBulkSharedValues: BulkPaymentSharedValues = {
      paymentDate: dayjs(),
      financialYear: defaultFY,
      paymentMode: 'Transfer',
      referenceNumber: undefined,
      remarks: undefined
    }
    bulkForm.resetFields()
    bulkForm.setFieldsValue({ 
      project_id: undefined,
      payment_date: initialBulkSharedValues.paymentDate, 
      payment_mode: initialBulkSharedValues.paymentMode,
      financial_year: initialBulkSharedValues.financialYear,
      reference_number: initialBulkSharedValues.referenceNumber,
      remarks: initialBulkSharedValues.remarks
    })
    setBulkPayments([])
    setBulkProject(null)
    setBulkSelectedFinancialYear(defaultFY)
    setBulkSharedValues(initialBulkSharedValues)
    setBulkModalStep('config')
    setBulkTablePageSize(15)
    setIsBulkModalOpen(true)
  }

  const handleBulkProjectChange = useCallback(
    (projectId: number): void => {
      setBulkProject(projectId)
      setBulkPayments(buildBulkPaymentEntries(projectId, bulkSelectedFinancialYear))
    },
    [buildBulkPaymentEntries, bulkSelectedFinancialYear]
  )

  useEffect(() => {
    if (!bulkProject) {
      return
    }

    setBulkPayments(buildBulkPaymentEntries(bulkProject, bulkSelectedFinancialYear))
  }, [buildBulkPaymentEntries, bulkProject, bulkSelectedFinancialYear])

  const handleBulkModalOk = async (): Promise<void> => {
    try {
      if (bulkModalStep === 'config') {
        const values = await bulkForm.validateFields([
          'project_id',
          'payment_date',
          'financial_year',
          'payment_mode',
          'reference_number',
          'remarks'
        ])

        if (!values.project_id) {
          message.warning('Select a project to continue')
          return
        }

        const nextSharedValues: BulkPaymentSharedValues = {
          paymentDate: dayjs.isDayjs(values.payment_date) ? values.payment_date : dayjs(values.payment_date),
          financialYear: values.financial_year,
          paymentMode: values.payment_mode || 'Transfer',
          referenceNumber: values.reference_number,
          remarks: values.remarks
        }

        setBulkSharedValues(nextSharedValues)
        setBulkSelectedFinancialYear(values.financial_year)
        setBulkModalStep('units')
        return
      }

      const normalizedPaymentDate = dayjs.isDayjs(bulkSharedValues.paymentDate)
        ? bulkSharedValues.paymentDate
        : dayjs(bulkSharedValues.paymentDate)

      if (!normalizedPaymentDate.isValid()) {
        message.warning('Go back to step 1 and select a valid payment date')
        setBulkModalStep('config')
        return
      }

      const validPayments = bulkPayments
        .filter((p) => p.payment_amount > 0)
        .map((p) => ({
          unit_id: p.unit_id,
          project_id: p.project_id,
          payment_amount: p.payment_amount,
          financial_year: bulkSharedValues.financialYear,
          payment_mode: p.payment_mode,
          payment_date: normalizedPaymentDate.format('YYYY-MM-DD'),
          cheque_number: bulkSharedValues.referenceNumber,
          remarks: bulkSharedValues.remarks
        }))

      if (validPayments.length === 0) {
        message.warning('Enter an amount for at least one unit')
        return
      }

      setLoading(true)
      
      // Use batch service for efficient bulk payment creation
      if (process.env.NODE_ENV === 'development') {
        console.log('Starting bulk payment creation', { count: validPayments.length })
      }
      const result = await window.api.batch.createPayments(validPayments)

      if (result.successful === 0) {
        const firstError = result.results.find((entry) => entry.error)?.error
        message.error(firstError || 'No payments were recorded')
        return
      }

      if (result.failed > 0) {
        message.warning(
          `${result.successful} payment${result.successful !== 1 ? 's' : ''} recorded; ${result.failed} failed`
        )
      }
      
      // Generate receipts for successful payments only
      const successfulIds = result.results
        .filter(r => r.paymentId)
        .map(r => r.paymentId!)

      if (successfulIds.length > 0) {
        // Show next step guidance using utility
        showCompletionWithNextStep(
          'payments',
          'Payments recorded',
          navigate,
          `${result.successful} payments recorded. Receipt generation started in the background.`
        )

        try {
          if (process.env.NODE_ENV === 'development') {
            console.log('Starting receipt generation', { paymentIds: successfulIds })
          }
          const receiptResult = await runBatchReceiptGeneration(successfulIds)
          setReceiptProgress(null)
          await fetchData()

          if (receiptResult.failed === 0) {
            message.success('Receipts ready')
          } else {
            message.warning(
              `${receiptResult.failed} receipt${receiptResult.failed !== 1 ? 's' : ''} could not be generated`
            )
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error(
            `[PAYMENTS] Failed to generate receipts for ${successfulIds.length} payments:`,
            errorMessage
          )
          // Don't fail the entire payment process, just warn about receipts
          message.warning(`Payments were recorded, but receipts could not be generated: ${errorMessage}`)
        }
      }

      setIsBulkModalOpen(false)
      setBulkModalStep('config')
      fetchData()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[PAYMENTS] Failed to record bulk payments:`, errorMessage)
      message.error(`Could not record bulk payments: ${errorMessage}`)
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
        message.success('Payment updated')
        setEditingPayment(null)
        setIsModalOpen(false)
        fetchData()
        return
      }
      
      // Create new payment logic
      const selectedLetter = letters.find((l) => l.id === values.letter_id)
      if (selectedLetter && values.payment_amount > selectedLetter.final_amount) {
        Modal.confirm({
          title: 'Payment exceeds letter amount',
          content: `This payment (Rs. ${values.payment_amount.toLocaleString()}) is higher than the letter total (Rs. ${selectedLetter.final_amount.toLocaleString()}). Continue anyway?`,
          okText: 'Continue',
          cancelText: 'Edit Amount',
          onOk: async () => {
            await window.api.payments.create(normalizedPaymentData)
            setIsModalOpen(false)
            fetchData()

            showCompletionWithNextStep(
              'payments',
              'Payment recorded',
              navigate,
              `Payment of Rs. ${values.payment_amount.toLocaleString()} was added`
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
        'Payment recorded',
        navigate,
        `Payment of Rs. ${values.payment_amount.toLocaleString()} was added`
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      message.error(`Could not record the payment: ${errorMessage}`)
    }
  }

  const handleDelete = async (id: number): Promise<void> => {
    Modal.confirm({
      title: 'Delete payment?',
      content: 'This cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async (): Promise<void> => {
        try {
          await window.api.payments.delete(id)
          message.success('Payment deleted')
          fetchData()
        } catch (error) {
          console.error('Failed to delete payment:', error)
          message.error('Could not delete the payment')
        }
      }
    })
  }

  const handleBulkDelete = async (): Promise<void> => {
    Modal.confirm({
      title: `Delete ${selectedRowKeys.length} payments?`,
      content: 'This cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
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
            message.warning(`${result.successful} payments deleted; ${result.failed} failed`)
          } else {
            message.success(`${result.successful} payments deleted`)
          }
          
          fetchData()
          setSelectedRowKeys([])
        } catch (error) {
          console.error('Failed to delete payments:', error)
          message.error('Could not delete the payments')
        } finally {
          setLoading(false)
        }
      }
    })
  }

  const handlePrintReceipt = async (id: number): Promise<void> => {
    try {
      setLoading(true)
      const pdfPath = await window.api.payments.generateReceiptPdf(id)

      await window.api.shell.showItemInFolder(pdfPath)
      message.success('Receipt ready')
    } catch (error) {
      console.error('Failed to generate receipt:', error)
      message.error(error instanceof Error ? error.message : 'Could not generate the receipt')
    } finally {
      setLoading(false)
    }
  }

  const handleBulkModalCancel = (): void => {
    setIsBulkModalOpen(false)
    setBulkModalStep('config')
  }

  const handleOpenReceiptsFolder = useCallback(async (): Promise<void> => {
    try {
      await window.api.shell.openOutputFolder('receipts')
    } catch (error) {
      console.error('Failed to open receipts folder:', error)
      message.error('Could not open the receipts folder')
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
        content: `Receipts ZIP saved with ${result.fileCount} PDF${result.fileCount !== 1 ? 's' : ''}`,
        key: 'receipts_zip'
      })
    } catch (error) {
      console.error('Failed to export receipts ZIP:', error)
      message.error({ content: 'Could not create the receipts ZIP', key: 'receipts_zip' })
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
                  success?: boolean
                  result?: {
                    generated: number
                    failed: number
                    files: string[]
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
                  progressEvent.data?.result || {
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

  const generateReceiptsForPaymentIds = async (
    paymentIds: number[],
    options?: {
      emptyMessage?: string
      failureMessage?: string
    }
  ): Promise<void> => {
    if (paymentIds.length === 0) {
      message.warning(options?.emptyMessage || 'Select at least one payment to generate receipts')
      return
    }

    try {
      const result = await runBatchReceiptGeneration(paymentIds)
      setReceiptProgress(null)
      await fetchData()

      if (result.failed === 0 && result.files[0]) {
        message.success(
          <span>
            {result.generated} receipt{result.generated !== 1 ? 's' : ''} generated.{' '}
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
        message.success(`${result.generated} receipts generated`)
      } else {
        message.warning(`${result.generated} receipts generated; ${result.failed} failed`)
      }
    } catch (error) {
      console.error('Failed to generate receipts:', error)
      setReceiptProgress(null)
      message.error(
        error instanceof Error
          ? error.message
          : options?.failureMessage || 'Could not generate receipts'
      )
    }
  }

  const handleBatchReceipts = async (): Promise<void> => {
    const paymentIds = selectedRowKeys
      .map((key) => Number(key))
      .filter((id): id is number => Number.isFinite(id))

    await generateReceiptsForPaymentIds(paymentIds, {
      emptyMessage: 'Select at least one payment to generate receipts',
      failureMessage: 'Could not generate receipts'
    })
  }

  const handleCancelBatchGeneration = (): void => {
    if (receiptTaskId && receiptProgress && receiptProgress.current < receiptProgress.total) {
      Modal.confirm({
        title: 'Stop receipt generation?',
        content: `${receiptProgress.current} of ${receiptProgress.total} receipts are already saved. Stop the rest?`,
        okText: 'Stop',
        okType: 'danger',
        cancelText: 'Keep Running',
        onOk: async () => {
          await window.api.worker.cancel(receiptTaskId)
          setGeneratingReceipts(false)
          setReceiptProgress(null)
          setReceiptTaskId(null)
          message.info(`Receipt generation stopped after ${receiptProgress.current} receipts`)
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
      width: 250,
      sorter: (a: Payment, b: Payment) => (a.unit_number || '').localeCompare(b.unit_number || ''),
      render: (unitNumber: string, record: Payment) => (
        <div className="payments-unit-cell">
          <div className="payments-unit-value">{unitNumber}</div>
          <div className="payments-unit-owner">
            {record.owner_name || 'No owner assigned'}
          </div>
        </div>
      )
    },
    {
      title: 'Date',
      dataIndex: 'payment_date',
      key: 'payment_date',
      width: 138,
      render: (date: string) => dayjs(date).format('DD-MM-YYYY'),
      sorter: (a: Payment, b: Payment) =>
        dayjs(a.payment_date).unix() - dayjs(b.payment_date).unix()
    },
    {
      title: 'Receipt #',
      dataIndex: 'receipt_number',
      key: 'receipt_number',
      width: 126,
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
      width: 132,
      align: 'right' as const,
      render: (val: number) => <strong>Rs. {val.toLocaleString()}</strong>,
      sorter: (a: Payment, b: Payment) => a.payment_amount - b.payment_amount
    },
    {
      title: 'Mode',
      dataIndex: 'payment_mode',
      key: 'payment_mode',
      width: 112,
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
      width: 132,
      render: (text: string) => text || '-'
    },
    {
      title: 'For FY',
      dataIndex: 'financial_year',
      key: 'financial_year',
      width: 104,
      align: 'center' as const,
      render: (fy: string) => fy || <Text type="secondary">N/A</Text>
    },
    {
      title: 'Actions',
      key: 'actions',
      className: 'payments-actions-column',
      width: 172,
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

  const filteredPayments = useMemo(
    () => payments.filter(matchesPaymentFilters),
    [payments, matchesPaymentFilters]
  )

  const filteredPaymentIds = useMemo(
    () =>
      filteredPayments
        .map((payment) => Number(payment.id))
        .filter((id): id is number => Number.isFinite(id)),
    [filteredPayments]
  )

  const handleGenerateFilteredReceipts = (): void => {
    if (filteredPaymentIds.length === 0) {
      message.warning('No payments match the current filters')
      return
    }

    const runBulkReceipts = async (): Promise<void> => {
      await generateReceiptsForPaymentIds(filteredPaymentIds, {
        emptyMessage: 'No payments match the current filters',
        failureMessage: 'Could not generate receipts for the visible list'
      })
    }

    if (filteredPaymentIds.length === 1) {
      void runBulkReceipts()
      return
    }

    Modal.confirm({
      title: `Generate receipts for ${filteredPaymentIds.length} visible payments?`,
      content: 'This uses the current filters. Select rows below if you want a smaller set.',
      okText: `Generate ${filteredPaymentIds.length} Receipts`,
      cancelText: 'Cancel',
      onOk: runBulkReceipts
    })
  }

  // Calculate bulk payment summary
  const bulkPaymentSummary = useMemo(() => {
    const unitsWithAmount = bulkPayments.filter((p) => p.payment_amount > 0).length
    const manualAmountEntries = bulkPayments.filter((p) => p.amount_source === 'manual').length
    const totalAmount = bulkPayments.reduce((sum, p) => sum + p.payment_amount, 0)

    return {
      unitsWithAmount,
      manualAmountEntries,
      totalAmount,
      totalUnits: bulkPayments.length
    }
  }, [bulkPayments])

  return (
    <div className="page-screen">
      {/* Navigation guard: show setup prompt when no projects */}
      {projects.length === 0 && !loading && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="No projects found"
          description={
            <span>
              Create a project and generate letters first.{' '}
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
              Record payments and issue receipts.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Record payments here. Use bulk entry and Bulk Receipts when needed.
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
              icon={<PrinterOutlined />}
              onClick={handleGenerateFilteredReceipts}
              disabled={filteredPaymentIds.length === 0}
              loading={generatingReceipts}
            >
              Bulk Receipts ({filteredPaymentIds.length})
            </Button>
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

      <div className="table-scroll-hint">
        <span>Swipe horizontally to see more columns</span>
      </div>

      <div className="table-scroll-wrapper mobile-card-table">
        <Table
          className="payments-data-table"
          rowSelection={{
            columnWidth: 56,
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
          scroll={{ x: 1200, y: filteredPayments.length > 100 ? 620 : undefined }}
        />
      </div>

      {/* Batch Receipt Generation Progress Modal */}
      <Modal
        title="Generating receipts"
        open={generatingReceipts}
        onCancel={handleCancelBatchGeneration}
        footer={[
          <Button
            key="cancel"
            onClick={handleCancelBatchGeneration}
            disabled={receiptProgress?.current === receiptProgress?.total}
            aria-label="Stop receipt generation"
          >
            Stop
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
        title={editingPayment ? 'Edit payment' : 'Record payment'}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => {
          setIsModalOpen(false)
          setEditingPayment(null)
        }}
        confirmLoading={loading}
        okText="Save"
        cancelText="Cancel"
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
                      ? `Search ${filteredUnitsForForm.length} unit${filteredUnitsForForm.length !== 1 ? 's' : ''} with letters`
                      : 'Select a project to filter units with letters'
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
                  notFoundContent={
                    formProjectId
                      ? 'No units with letters found for this project and year'
                      : 'No units with letters found'
                  }
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
              const unitLetters = availableLettersForForm
                .filter((l) => l.unit_id === unitId || l.id === letterId)
                .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
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
                    title="Payment flow"
                    description="Only units with letters are shown. Picking one fills the year and amount."
                  />
                  <Row gutter={[16, 8]}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="letter_id"
                        label="Against Maintenance Letter"
                        extra={
                          <div style={{ fontSize: '12px' }}>
                            {unitLetters.length === 0
                              ? 'No letters found for this unit'
                              : 'Picking a letter fills the year and amount.'}
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
                                  message.warning('This letter has an invalid financial year. The working year was used instead')
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
                              Default FY: {defaultFY}
                            </Text>
                            {selectedLetter && (
                              <>
                                <br />
                                <Text type="warning">
                                  Clear the letter to change the year.
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
        title="Record bulk payments"
        open={isBulkModalOpen}
        onOk={handleBulkModalOk}
        onCancel={handleBulkModalCancel}
        confirmLoading={loading}
        width={820}
        okText={bulkModalStep === 'config' ? 'Next: Review Units' : 'Record Bulk Payments'}
        cancelText="Cancel"
        okButtonProps={{
          disabled:
            bulkModalStep === 'units' &&
            bulkPayments.every((payment) => payment.payment_amount <= 0)
        }}
        className="payments-bulk-modal"
      >
        <div className="payments-bulk-modal-scroll">
        <Form form={bulkForm} layout="vertical" className="bulk-payment-form">
          <div className="bulk-payment-steps">
            <Space size="small" align="center">
              <Button
                type={bulkModalStep === 'config' ? 'primary' : 'text'}
                size="small"
                onClick={() => setBulkModalStep('config')}
                style={{ fontWeight: bulkModalStep === 'config' ? 600 : 'normal' }}
              >
                1. Shared Values
              </Button>
              <span style={{ color: '#999' }}>{'->'}</span>
              <Button
                type={bulkModalStep === 'units' ? 'primary' : 'text'}
                size="small"
                disabled={!bulkProject}
                onClick={() => bulkProject && setBulkModalStep('units')}
                style={{ fontWeight: bulkModalStep === 'units' ? 600 : 'normal' }}
              >
                2. Review Units
              </Button>
            </Space>
            <div className="bulk-payment-steps-caption">
              {bulkModalStep === 'config'
                ? 'Step 1 of 2: Payment setup'
                : 'Step 2 of 2: Review entries'}
            </div>
          </div>

          {bulkModalStep === 'config' ? (
            <>
              <div className="bulk-payment-section">
                <div className="bulk-payment-section-header">
                  <div>
                    <Text strong className="bulk-payment-section-title">
                      Payment Setup
                    </Text>
                  </div>
                </div>
                <div className="bulk-payment-grid">
                  <Form.Item
                    name="project_id"
                    label="Project"
                    rules={[{ required: true, message: 'Please select a project' }]}
                    aria-label="Select project for bulk payments"
                  >
                    <Select placeholder="Select Project" onChange={handleBulkProjectChange}>
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
                  >
                    <Select placeholder="Select Year" aria-label="Select financial year for bulk payments">
                      {Array.from(new Set(letters.map((l) => l.financial_year)))
                        .filter((fy) => /^\d{4}-\d{2}$/.test(fy))
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
                  <Form.Item
                    name="reference_number"
                    label="Reference #"
                    aria-label="Enter common reference number for all bulk payments"
                  >
                    <Input placeholder="Enter common UTR or cheque number" />
                  </Form.Item>
                  <Form.Item
                    name="remarks"
                    label="Remarks"
                    aria-label="Enter common remarks for all bulk payments"
                  >
                    <Input.TextArea rows={2} placeholder="Enter remarks (optional)" />
                  </Form.Item>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bulk-payment-section">
                <div className="bulk-payment-section-header">
                  <div>
                    <Text strong className="bulk-payment-section-title">
                      Review Entries
                    </Text>
                    <Text type="secondary" className="page-helper-text">
                      {bulkPayments.length > 0
                        ? `Showing units with unpaid letters for FY ${bulkSelectedFinancialYear || defaultFY}.`
                        : `No unpaid maintenance letters were found for FY ${bulkSelectedFinancialYear || defaultFY}.`}
                    </Text>
                  </div>
                </div>
                {bulkPayments.length > 0 ? (
                  <>
                    <div className="bulk-payment-entry-summary">
                      <Text type="secondary">
                        Generated letters: {bulkPaymentSummary.totalUnits}
                      </Text>
                      <Text type="secondary">
                        Ready: {bulkPaymentSummary.unitsWithAmount}
                      </Text>
                      <Text type="secondary">
                        Overrides: {bulkPaymentSummary.manualAmountEntries}
                      </Text>
                      <Text strong>
                        Total: Rs. {bulkPaymentSummary.totalAmount.toLocaleString()}
                      </Text>
                    </div>
                    <div className="bulk-payment-table-shell">
                      <Table
                        className="bulk-payment-units-table"
                        dataSource={bulkPayments}
                        pagination={{
                          pageSize: bulkTablePageSize,
                          showSizeChanger: true,
                          pageSizeOptions: [10, 15, 25, 50],
                          onShowSizeChange: (_, size) => setBulkTablePageSize(size)
                        }}
                        rowKey="unit_id"
                        columns={[
                          {
                            title: 'Unit',
                            dataIndex: 'unit_number',
                            key: 'unit_number',
                            width: 300,
                            render: (unitNumber: string, record: BulkPaymentEntry) => (
                              <div className="bulk-payment-unit-cell">
                                <div className="bulk-payment-unit-value">{unitNumber}</div>
                                <div className="bulk-payment-unit-owner">
                                  {record.owner_name || 'No owner assigned'}
                                </div>
                              </div>
                            )
                          },
                          {
                            title: 'Letter Total',
                            key: 'letter_total',
                            width: 150,
                            render: (_: unknown, record: BulkPaymentEntry) => (
                              <strong>Rs. {Math.round(record.matched_letter_amount || 0).toLocaleString()}</strong>
                            )
                          },
                          {
                            title: 'Amount (Rs.)',
                            key: 'amount',
                            width: 170,
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
                                    newPayments[actualIndex].amount_source =
                                      (val || 0) > 0 ? 'manual' : 'empty'
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
                            width: 160,
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
                  </>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    title="No generated unpaid letters found for this project and financial year"
                    description="Generate letters first, or choose another financial year."
                    style={{ marginTop: 12 }}
                  />
                )}
              </div>
            </>
          )}
        </Form>
        </div>
      </Modal>
    </div>
  )
}

export default Payments
