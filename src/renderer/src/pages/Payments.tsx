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
  Collapse
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  PrinterOutlined,
  TableOutlined,
  CalculatorOutlined,
  ClearOutlined,
  InfoCircleOutlined,
  FilterOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Project, Unit, Payment, MaintenanceLetter } from '@preload/types'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'

const { Title, Text } = Typography
const { Option } = Select
const { Search } = Input

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
  const navigate = useNavigate()
  const location = useLocation()
  const [payments, setPayments] = useState<Payment[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [letters, setLetters] = useState<MaintenanceLetter[]>([])
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [selectedMode, setSelectedMode] = useState<string | null>(null)

  // Default to current financial year
  const currentYear = dayjs().month() < 3 ? dayjs().year() - 1 : dayjs().year()
  const defaultFY = `${currentYear}-${(currentYear + 1).toString().slice(2)}`
  const [selectedFY, setSelectedFY] = useState<string | null>(defaultFY)

  // Auto-format financial year input
  const formatFinancialYear = (input: string): string => {
    if (!input) return input
    
    // Remove extra spaces and non-digit characters except hyphen
    const clean = input.trim().replace(/[^\d-]/g, '')
    
    // Handle different input formats
    if (clean.includes('-')) {
      const parts = clean.split('-')
      if (parts.length === 2) {
        const year = parts[0].slice(0, 4)
        const yearPart = parts[1].slice(0, 2)
        
        // If second part has 4 digits, take last 2
        const finalYearPart = yearPart.length === 4 ? yearPart.slice(-2) : yearPart
        
        return `${year}-${finalYearPart}`
      }
    } else {
      // Handle pure number input
      if (clean.length === 6) { // 202526
        return `${clean.slice(0,4)}-${clean.slice(4,6)}`
      }
      if (clean.length === 8) { // 20252026
        return `${clean.slice(0,4)}-${clean.slice(6,8)}`
      }
      if (clean.length >= 4) { // 2025 or more
        const year = clean.slice(0,4)
        const nextYear = (parseInt(year) + 1).toString().slice(-2)
        return `${year}-${nextYear}`
      }
    }
    
    return input // Return as-is if can't format
  }

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [searchText, setSearchText] = useState('')
  const [form] = Form.useForm()
  const [bulkForm] = Form.useForm()
  // Watch project_id from payment form to filter unit dropdown
  const formProjectId = Form.useWatch('project_id', form)
  const filteredUnitsForForm = formProjectId
    ? units.filter((u) => u.project_id === formProjectId)
    : units
  const [bulkPayments, setBulkPayments] = useState<BulkPaymentEntry[]>([])
  const [bulkProject, setBulkProject] = useState<number | null>(null)
  const [generatingReceipts, setGeneratingReceipts] = useState(false)
  const [receiptProgress, setReceiptProgress] = useState<ReceiptProgress | null>(null)

  const fetchData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [paymentsData, unitsData, lettersData, projectsData] = await Promise.all([
        window.api.payments.getAll(),
        window.api.units.getAll(),
        window.api.letters.getAll(),
        window.api.projects.getAll()
      ])
      setPayments(paymentsData)
      setUnits(unitsData)
      setLetters(lettersData)
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
    return years
  }, [payments, defaultFY])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      searchText || selectedProject !== null || selectedFY !== defaultFY || selectedMode !== null
    )
  }, [searchText, selectedProject, selectedFY, selectedMode, defaultFY])

  // Get selected project name
  const selectedProjectName = useMemo(() => {
    if (!selectedProject) return ''
    const project = projects.find((p) => p.id === selectedProject)
    return project?.name || ''
  }, [selectedProject, projects])

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
        message.success(`Applied ₹${amount.toLocaleString()} to all units`)
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

    const updatedPayments = bulkPayments.map((payment) => {
      // Find the latest maintenance letter for this unit
      const unitLetters = letters
        .filter((l) => l.unit_id === payment.unit_id && l.status !== 'Paid')
        .sort((a, b) => b.financial_year.localeCompare(a.financial_year))

      if (unitLetters.length > 0) {
        const latestLetter = unitLetters[0]
        return {
          ...payment,
          payment_amount: latestLetter.final_amount
        }
      }
      return payment
    })

    setBulkPayments(updatedPayments)
    message.success('Calculated amounts from maintenance letters')
  }, [bulkProject, bulkPayments, letters])

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
      console.log('🔄 Starting bulk payment creation for:', validPayments.length, 'payments')
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

        setGeneratingReceipts(true)
        try {
          console.log('🧾 Starting receipt generation for payments:', successfulIds)
          await Promise.all(successfulIds.map((id) => window.api.payments.generateReceiptPdf(id)))
          console.log('✅ All receipts generated successfully')
          message.success('Receipts generated successfully')
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error(
            `[PAYMENTS] Failed to generate receipts for ${successfulIds.length} payments:`,
            errorMessage
          )
          // Don't fail the entire payment process, just warn about receipts
          message.warning(`Payments recorded successfully, but receipt generation failed: ${errorMessage}`)
        } finally {
          setGeneratingReceipts(false)
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
          content: `You are about to record ₹${values.payment_amount.toLocaleString()} which exceeds the maintenance letter amount of ₹${selectedLetter.final_amount.toLocaleString()}. Do you want to continue?`,
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
              `Payment of ₹${values.payment_amount.toLocaleString()} has been added`
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
        `Payment of ₹${values.payment_amount.toLocaleString()} has been added`
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
          console.log('🗑️ Starting bulk deletion for:', selectedRowKeys.length, 'payments')
          const result = await window.api.batch.deletePayments(selectedRowKeys as number[])
          console.log('📊 Bulk delete result:', result)
          
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
      const pdfPath = await window.api.payments.generateReceiptPdf(id)
      await window.api.shell.showItemInFolder(pdfPath)
      message.success('Receipt generated successfully')
    } catch (error) {
      console.error('Failed to generate receipt:', error)
      message.error('Failed to generate receipt')
    } finally {
      setLoading(false)
    }
  }

  const handleBatchReceipts = async (): Promise<void> => {
    if (selectedRowKeys.length === 0) {
      message.warning('Please select payments to generate receipts for')
      return
    }

    setGeneratingReceipts(true)
    setReceiptProgress({ current: 0, total: selectedRowKeys.length })

    const paymentIds = selectedRowKeys as number[]
    let successCount = 0
    let failCount = 0
    let firstReceiptPath = ''

    for (let i = 0; i < paymentIds.length; i++) {
      try {
        const pdfPath = await window.api.payments.generateReceiptPdf(paymentIds[i])
        if (i === 0) firstReceiptPath = pdfPath
        successCount++
      } catch {
        failCount++
      }
      setReceiptProgress((prev) => (prev ? { ...prev, current: i + 1 } : null))
    }

    setGeneratingReceipts(false)
    setReceiptProgress(null)

    if (failCount === 0 && firstReceiptPath) {
      message.success(
        <span>
          Successfully generated {successCount} receipts.{' '}
          <a
            onClick={() => window.api.shell.showItemInFolder(firstReceiptPath)}
            style={{ color: '#1890ff', cursor: 'pointer' }}
          >
            Open folder
          </a>
        </span>,
        10 // Show for 10 seconds
      )
    } else if (failCount === 0) {
      message.success(`Successfully generated ${successCount} receipts`)
    } else {
      message.warning(`Generated ${successCount} receipts, failed to generate ${failCount}`)
    }
  }

  const handleCancelBatchGeneration = (): void => {
    if (receiptProgress && receiptProgress.current < receiptProgress.total) {
      Modal.confirm({
        title: 'Cancel Receipt Generation?',
        content: `${receiptProgress.current} of ${receiptProgress.total} receipts have been generated and saved. Do you want to cancel the remaining?`,
        onOk: () => {
          setGeneratingReceipts(false)
          setReceiptProgress(null)
          message.info(`Cancelled. ${receiptProgress.current} receipts were saved.`)
        }
      })
    } else {
      setGeneratingReceipts(false)
      setReceiptProgress(null)
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
      render: (val: number) => <strong>₹{val.toLocaleString()}</strong>,
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
        <Space>
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
            icon={<InfoCircleOutlined />}
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
    <div style={{ padding: '24px' }}>
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
                Go to Projects →
              </Button>
            </span>
          }
        />
      )}
      <div
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
          {filteredPaymentsCount > 0 && (
            <Text type="secondary" style={{ fontSize: '14px' }}>
              {filteredPaymentsCount} payment{filteredPaymentsCount !== 1 ? 's' : ''}
            </Text>
          )}
        </div>
        <Space>
          {selectedRowKeys.length > 0 && (
            <>
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
            </>
          )}
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

      <Card>
        <Collapse 
          defaultActiveKey={['basic']}
          items={[
            {
              key: 'basic',
              label: (
                <Space>
                  <FilterOutlined />
                  <span>Basic Filters</span>
                  {hasActiveFilters && <Tag color="blue">Active</Tag>}
                </Space>
              ),
              children: (
                <Space wrap size="middle">
                  <Search
                    placeholder="Search receipt, unit, owner, or project..."
                    allowClear
                    onChange={(e) => setSearchText(e.target.value)}
                    onSearch={setSearchText}
                    style={{ width: '100%', minWidth: 200, maxWidth: 280 }}
                    enterButton
                    suffix={null}
                    value={searchText}
                    aria-label="Search payments by receipt, unit, owner, or project"
                  />
                  <Select
                    placeholder="Project"
                    style={{ width: '100%', minWidth: 160 }}
                    allowClear
                    onChange={setSelectedProject}
                    value={selectedProject}
                    aria-label="Filter by project"
                  >
                    {projects.map((s) => (
                      <Option key={s.id} value={s.id}>
                        {s.name}
                      </Option>
                    ))}
                  </Select>
                  <Select
                    placeholder="Financial Year"
                    style={{ width: '100%', minWidth: 140 }}
                    allowClear
                    onChange={setSelectedFY}
                    value={selectedFY}
                    aria-label="Filter by financial year"
                  >
                    {uniqueFinancialYears.map((fy) => (
                      <Option key={fy} value={fy}>
                        {fy}
                      </Option>
                    ))}
                  </Select>
                  <Select
                    placeholder="Mode"
                    style={{ width: '100%', minWidth: 160 }}
                    allowClear
                    onChange={setSelectedMode}
                    value={selectedMode}
                    aria-label="Filter by payment mode"
                  >
                    <Option value="Transfer">Bank Transfer / UPI</Option>
                    <Option value="Cheque">Cheque</Option>
                    <Option value="Cash">Cash</Option>
                  </Select>
                </Space>
              )
            }
          ]}
        />

        {/* Filter Summary Chips */}
        {hasActiveFilters && (
          <div style={{ marginTop: 16 }}>
            <Space wrap>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                Active filters:
              </Text>
              {searchText && (
                <Tag
                  closable
                  onClose={() => setSearchText('')}
                  aria-label={`Search filter: ${searchText}`}
                >
                  Search: &quot;{searchText}&quot;
                </Tag>
              )}
              {selectedProject !== null && (
                <Tag
                  closable
                  onClose={() => setSelectedProject(null)}
                  aria-label={`Project filter: ${selectedProjectName}`}
                >
                  Project: {selectedProjectName}
                </Tag>
              )}
              {selectedFY !== null && selectedFY !== defaultFY && (
                <Tag
                  closable
                  onClose={() => setSelectedFY(defaultFY)}
                  aria-label={`Financial year filter: ${selectedFY}`}
                >
                  FY: {selectedFY}
                </Tag>
              )}
              {selectedMode !== null && (
                <Tag
                  closable
                  onClose={() => setSelectedMode(null)}
                  aria-label={`Payment mode filter: ${selectedMode}`}
                >
                  Mode: {selectedMode}
                </Tag>
              )}
              <Button
                type="link"
                size="small"
                onClick={clearAllFilters}
                style={{ fontSize: '12px', padding: 0, height: 'auto' }}
                aria-label="Clear all filters"
              >
                Clear all
              </Button>
            </Space>
          </div>
        )}
      </Card>

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
          pagination={{ pageSize: 10 }}
          scroll={{ x: 'max-content' }}
        />

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
      >
        {receiptProgress && (
          <div>
            <Progress
              percent={Math.round((receiptProgress.current / receiptProgress.total) * 100)}
              status="active"
              style={{ marginBottom: 16 }}
              aria-label={`Progress: ${receiptProgress.current} of ${receiptProgress.total} receipts generated`}
            />
            <Text>
              Generating {receiptProgress.current} of {receiptProgress.total} receipts
            </Text>
            {receiptProgress.current > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
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
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ payment_date: dayjs(), payment_mode: 'Transfer' }}
        >
          <Form.Item name="project_id" hidden>
            <Input type="hidden" />
          </Form.Item>
          <Divider orientation={'left' as DividerProps['orientation']} style={{ marginTop: 0 }}>
            Unit Details
          </Divider>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Step 1: Pick project to narrow the unit list */}
            <Form.Item
              label="Filter by Project"
              style={{ gridColumn: 'span 2', marginBottom: 4 }}
            >
              <Select
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
                    {p.project_code ? `${p.project_code} — ${p.name}` : p.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="unit_id"
              label="Select Unit"
              rules={[{ required: true, message: 'Please select a unit' }]}
              style={{ gridColumn: 'span 2' }}
            >
              <Select
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
              >
                {filteredUnitsForForm.map((u) => (
                  <Option key={u.id} value={u.id}>
                    {u.unit_number} — {u.owner_name}
                    {!formProjectId ? ` (${u.project_name})` : ''}
                  </Option>
                ))}
              </Select>
            </Form.Item>

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
                  <div
                    style={{
                      gridColumn: 'span 2',
                      padding: '12px',
                      backgroundColor: '#fafafa',
                      borderRadius: '6px',
                      border: '1px solid #d9d9d9'
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
                          placeholder="Select Maintenance Letter"
                          allowClear
                          disabled={unitLetters.length === 0}
                          onChange={(val) => {
                            if (val) {
                              const letter = unitLetters.find((l) => l.id === val)
                              if (letter) {
                                // Format the financial year from letter
                                const formattedYear = formatFinancialYear(letter.financial_year)
                                
                                // Validate the formatted year
                                if (!/^\d{4}-\d{2}$/.test(formattedYear)) {
                                  message.warning('Letter has invalid financial year format, using current year')
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
                        >
                          {unitLetters.map((letter) => (
                            <Option key={letter.id} value={letter.id}>
                              FY {letter.financial_year} - ₹{letter.final_amount} ({letter.status})
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>

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
                              Format: YYYY-YY (e.g., 2024-25, 2025-26)
                            </Text>
                            <br />
                            <Text type="secondary">
                              Auto-formats: 2025-2026 → 2025-26, 20252026 → 2025-26
                            </Text>
                            <br />
                            {selectedLetter && (
                              <Text type="warning">
                                Pre-filled from letter - can be edited if needed
                              </Text>
                            )}
                          </div>
                        }
                      >
                        <Select
                          placeholder="Select Financial Year"
                          disabled={false} // Allow manual correction even with letter selected
                          showSearch
                          filterOption={(input, option) => {
                            const optionText = option?.children?.toString() || ''
                            const formattedSearch = formatFinancialYear(input)
                            return optionText.includes(formattedSearch) || 
                                   optionText.toLowerCase().includes(input.toLowerCase())
                          }}
                          aria-label="Select financial year for payment"
                        >
                          {Array.from(new Set(letters.map((l) => l.financial_year)))
                            .filter(fy => /^\d{4}-\d{2}$/.test(fy)) // Only show valid formats
                            .sort()
                            .reverse()
                            .map((fy) => (
                              <Option key={fy} value={fy}>
                                {fy}
                              </Option>
                            ))}
                        </Select>
                      </Form.Item>
                    </div>
                  </div>
                )
              }}
            </Form.Item>
          </div>

          <Divider orientation={'left' as DividerProps['orientation']}>Payment Details</Divider>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <Form.Item
              name="payment_date"
              label="Payment Date"
              rules={[{ required: true, message: 'Please select payment date' }]}
            >
              <DatePicker style={{ width: '100%' }} aria-label="Select payment date" />
            </Form.Item>
            <Form.Item
              name="payment_amount"
              label="Amount (₹)"
              rules={[
                { required: true, message: 'Please enter amount' },
                { type: 'number', min: 1, message: 'Amount must be greater than 0' }
              ]}
              extra={
                <div style={{ fontSize: '12px' }}>
                  {(() => {
                    const letterId = form.getFieldValue('letter_id')
                    if (letterId) {
                      const letter = letters.find((l) => l.id === letterId)
                      if (letter) {
                        return `Letter amount: ₹${letter.final_amount.toLocaleString()}`
                      }
                    }
                    return null
                  })()}
                </div>
              }
            >
              <InputNumber style={{ width: '100%' }} min={1} aria-label="Enter payment amount" />
            </Form.Item>

            <Form.Item
              name="payment_mode"
              label="Payment Mode"
              rules={[{ required: true, message: 'Please select payment mode' }]}
            >
              <Select aria-label="Select payment mode">
                <Option value="Transfer">Bank Transfer / UPI</Option>
                <Option value="Cheque">Cheque</Option>
                <Option value="Cash">Cash</Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="cheque_number"
              label="Reference # (UTR/Cheque No)"
              aria-label="Enter reference number"
            >
              <Input placeholder="Enter UTR or cheque number" />
            </Form.Item>

            <Form.Item
              name="remarks"
              label="Remarks"
              style={{ gridColumn: 'span 2' }}
              aria-label="Enter remarks"
            >
              <Input.TextArea rows={2} placeholder="Enter any additional remarks" />
            </Form.Item>
          </div>
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
                      {fy}
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

              <Table
                dataSource={displayBulkPayments}
                pagination={false}
                scroll={{ y: 400 }}
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
                    title: 'Amount (₹)',
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
                  style={{
                    marginTop: 16,
                    padding: '12px 16px',
                    background: '#f6ffed',
                    borderRadius: 4,
                    border: '1px solid #b7eb8f'
                  }}
                >
                  <Space size="large">
                    <Text strong>
                      Units with amount: {bulkPaymentSummary.unitsWithAmount} /{' '}
                      {bulkPaymentSummary.totalUnits}
                    </Text>
                    <Text strong type="success">
                      Total Amount: ₹{bulkPaymentSummary.totalAmount.toLocaleString()}
                    </Text>
                    <Text type="secondary">
                      Average: ₹{bulkPaymentSummary.averageAmount.toLocaleString()}
                    </Text>
                  </Space>
                </div>
              )}

              <div style={{ marginTop: '16px', display: 'flex', gap: '16px' }}>
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
