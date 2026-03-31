import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Modal,
  Table,
  Button,
  Form,
  Input,
  InputNumber,
  Space,
  message,
  Divider,
  Select,
  Popconfirm,
  Tag,
  Card,
  Typography,
  Alert,
  Tooltip
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  PercentageOutlined,
  EditOutlined
} from '@ant-design/icons'
import { MaintenanceRate, MaintenanceSlab } from '@preload/types'
import FilterPanel, { createSelectFilter } from './shared/FilterPanel'
import { getCurrentFinancialYear, getUpcomingFinancialYear } from '../utils/financialYear'

interface MaintenanceRateModalProps {
  projectId: number
  projectName: string
  visible: boolean
  onCancel: () => void
}

const { Option } = Select
const { Text, Title } = Typography

const UNIT_TYPE_OPTIONS = ['All', 'Plot', 'Bungalow', 'Garden'] as const

interface RateFormValues {
  financial_year: string
  unit_type: string
  rate_per_sqft: number
  gst_percent: number
  penalty_percentage?: number
  billing_frequency: string
  due_date?: string
  discount_percentage?: number
}

interface SlabFormValues {
  due_date: string
  discount_percentage: number
}

type FormValidationError = {
  errorFields?: unknown[]
}

const MaintenanceRateModal: React.FC<MaintenanceRateModalProps> = ({
  projectId,
  projectName,
  visible,
  onCancel
}) => {
  const [rates, setRates] = useState<MaintenanceRate[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingSlabs, setLoadingSlabs] = useState(false)
  const [isAddingRate, setIsAddingRate] = useState(false)
  const [editingRateId, setEditingRateId] = useState<number | null>(null)
  const [selectedRate, setSelectedRate] = useState<MaintenanceRate | null>(null)
  const [slabs, setSlabs] = useState<MaintenanceSlab[]>([])
  const [isAddingSlab, setIsAddingSlab] = useState(false)
  const [filterFY, setFilterFY] = useState<string | null>(null)
  const [filterUnitType, setFilterUnitType] = useState<string>('All')

  const [rateForm] = Form.useForm<RateFormValues>()
  const [slabForm] = Form.useForm<SlabFormValues>()

  const todayDateInput = useMemo(() => {
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])

  const isFormValidationError = (error: unknown): error is FormValidationError => {
    return !!error && typeof error === 'object' && 'errorFields' in error
  }

  const getErrorMessage = useCallback((error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message.trim()) {
      return error.message
    }
    return fallback
  }, [])

  const fetchRates = useCallback(async (): Promise<void> => {
    if (!projectId) return

    setLoading(true)
    try {
      const data = await window.api.rates.getByProject(projectId)
      setRates(data || [])
    } catch (error) {
      console.error('Failed to fetch rates:', error)
      message.error('Failed to fetch rates')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (visible && projectId) {
      fetchRates()
      // Reset selections when modal opens
      setSelectedRate(null)
      setSlabs([])
      setIsAddingRate(false)
      setEditingRateId(null)
      setIsAddingSlab(false)
      resetBillingDates()
      rateForm.resetFields()
      slabForm.resetFields()
    }
  }, [visible, projectId, fetchRates, rateForm, slabForm])

  const fyOptions = useMemo(() => {
    const years = Array.from(
      new Set(rates.map((r) => r.financial_year).filter(Boolean))
    ) as string[]
    const currentFY = getCurrentFinancialYear()
    const upcomingFY = getUpcomingFinancialYear(currentFY)
    return Array.from(new Set([...years, currentFY, upcomingFY])).sort().reverse()
  }, [rates])

  const formFinancialYearOptions = useMemo(() => {
    const today = new Date()
    const currentFyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
    const rollingYears = Array.from({ length: 10 }, (_, idx) => {
      const startYear = currentFyStartYear - 2 + idx
      const endYear = String(startYear + 1).slice(-2)
      return `${startYear}-${endYear}`
    })
    const existingYears = rates.map((r) => r.financial_year).filter(Boolean) as string[]
    return Array.from(new Set([...rollingYears, ...existingYears]))
      .sort()
      .reverse()
  }, [rates])

  const filteredRates = useMemo(() => {
    return rates.filter((r) => {
      const fyOk = !filterFY || r.financial_year === filterFY
      const typeOk = filterUnitType === 'All' || (r.unit_type || 'Bungalow') === filterUnitType
      return fyOk && typeOk
    })
  }, [rates, filterFY, filterUnitType])

  const rateFilterFields = useMemo(
    () => [
      createSelectFilter(
        'filterFY',
        'Financial Year',
        fyOptions.map((fy) => ({
          value: fy,
          label:
            fy === getCurrentFinancialYear()
              ? `${fy} (Current)`
              : fy === getUpcomingFinancialYear()
                ? `${fy} (Upcoming)`
                : fy
        })),
        'Financial Year',
        {
          emptyValue: null
        }
      ),
      createSelectFilter(
        'filterUnitType',
        'Unit Type',
        UNIT_TYPE_OPTIONS.map((unitType) => ({ value: unitType, label: unitType })),
        'Unit Type',
        {
          emptyValue: 'All',
          isActive: (value) => value !== null && value !== 'All'
        }
      )
    ],
    [fyOptions]
  )

  const rateFilterValues = useMemo(
    () => ({
      filterFY,
      filterUnitType
    }),
    [filterFY, filterUnitType]
  )

  const handleRateFilterChange = useCallback((key: string, value: unknown) => {
    switch (key) {
      case 'filterFY':
        setFilterFY((value as string | null | undefined) ?? null)
        break
      case 'filterUnitType':
        setFilterUnitType((value as string | null | undefined) ?? 'All')
        break
      default:
        break
    }
  }, [])

  // Check for duplicate rates before saving
  const checkDuplicateRate = useCallback(
    (financial_year: string, unit_type: string, excludeId?: number): boolean => {
      return rates.some(
        (rate) =>
          rate.financial_year === financial_year &&
          (rate.unit_type || 'Bungalow') === (unit_type || 'Bungalow') &&
          rate.id !== excludeId
      )
    },
    [rates]
  )

  const handleSaveRate = async (): Promise<void> => {
    try {
      const values = await rateForm.validateFields()

      // Check for duplicate
      const isDuplicate = checkDuplicateRate(
        values.financial_year,
        values.unit_type || 'Bungalow',
        editingRateId || undefined
      )

      if (isDuplicate) {
        message.error('A rate with this Financial Year and Unit Type already exists')
        return
      }

      setLoading(true)
      if (editingRateId) {
        await window.api.rates.update(editingRateId, {
          ...values,
          unit_type: values.unit_type || 'Bungalow',
          gst_percent: values.gst_percent ?? 0,
          penalty_percentage: values.penalty_percentage ?? null,
          billing_frequency: values.billing_frequency || 'YEARLY'
        })
        
        // Handle slab update/create/delete for existing rate
        if (values.due_date && values.discount_percentage !== undefined && values.discount_percentage > 0) {
          try {
            // Check if there's an existing slab
            const existingSlabs = await window.api.rates.getSlabs(editingRateId)
            if (existingSlabs && existingSlabs.length > 0) {
              // Delete existing slabs and create new one (since updateSlab doesn't exist)
              for (const slab of existingSlabs) {
                if (slab.id) {
                  await window.api.rates.deleteSlab(slab.id)
                }
              }
            }
            // Create new slab with updated values
            await window.api.rates.addSlab({
              rate_id: editingRateId,
              due_date: values.due_date,
              discount_percentage: values.discount_percentage,
              is_early_payment: true
            } as MaintenanceSlab)
          } catch {
            message.warning('Rate saved, but early payment discount could not be updated. You can manage it via the Slabs button.')
          }
        } else {
          // Delete all slabs if discount is removed or set to 0
          try {
            const existingSlabs = await window.api.rates.getSlabs(editingRateId)
            if (existingSlabs && existingSlabs.length > 0) {
              for (const slab of existingSlabs) {
                if (slab.id) {
                  await window.api.rates.deleteSlab(slab.id)
                }
              }
            }
          } catch {
            // Silently ignore errors when deleting slabs
          }
        }
        
        message.success('Rate updated successfully')
      } else {
        const newRateId = await window.api.rates.create({
          ...values,
          unit_type: values.unit_type || 'Bungalow',
          gst_percent: values.gst_percent ?? 0,
          penalty_percentage: values.penalty_percentage ?? null,
          billing_frequency: values.billing_frequency || 'YEARLY',
          project_id: projectId
        } as MaintenanceRate)

        // Save inline early-payment slab if configured (for new rates)
        if (values.due_date && values.discount_percentage !== undefined && values.discount_percentage > 0) {
          try {
            await window.api.rates.addSlab({
              rate_id: newRateId,
              due_date: values.due_date,
              discount_percentage: values.discount_percentage,
              is_early_payment: true
            } as MaintenanceSlab)
          } catch {
            message.warning('Rate saved, but early payment slab could not be added. Add it manually from the Slabs button.')
          }
        }

        message.success('Rate added successfully')
      }

      setIsAddingRate(false)
      setEditingRateId(null)
      resetBillingDates()
      rateForm.resetFields()
      fetchRates()
    } catch (error) {
      if (!isFormValidationError(error)) {
        message.error(getErrorMessage(error, 'Failed to save rate'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleEditRate = async (rate: MaintenanceRate): Promise<void> => {
    setEditingRateId(rate.id ?? null)
    setIsAddingRate(true)
    
    // Pre-fill basic rate fields
    rateForm.setFieldsValue({
      financial_year: rate.financial_year,
      unit_type: rate.unit_type || 'Bungalow',
      rate_per_sqft: rate.rate_per_sqft,
      gst_percent: rate.gst_percent ?? 0,
      penalty_percentage: rate.penalty_percentage ?? undefined,
      billing_frequency: rate.billing_frequency || 'YEARLY'
    })
    
    // Load and pre-fill slab data if exists (only first slab supported in inline editing)
    if (rate.id) {
      try {
        const slabs = await window.api.rates.getSlabs(rate.id)
        if (slabs && slabs.length > 0) {
          const firstSlab = slabs[0]
          // Pre-fill billing dates from slab
          rateForm.setFieldsValue({
            due_date: firstSlab.due_date,
            discount_percentage: firstSlab.discount_percentage
          })
          // Warn if multiple slabs exist (they can only be managed via Slabs button)
          if (slabs.length > 1) {
            message.info(`This rate has ${slabs.length} slabs. Only the first one is shown here. Use the "Slabs" button to manage all.`, 5)
          }
        }
      } catch {
        // Silently ignore slab fetch errors - form will just show empty billing dates
      }
    }
  }

  const handleDeleteRate = async (id: number): Promise<void> => {
    try {
      await window.api.rates.delete(id)
      message.success('Rate deleted successfully')
      fetchRates()
      if (selectedRate?.id === id) {
        setSelectedRate(null)
        setSlabs([])
      }
      if (editingRateId === id) {
        setIsAddingRate(false)
        setEditingRateId(null)
        rateForm.resetFields()
        resetBillingDates()
      }
    } catch (error) {
      console.error('Failed to delete rate:', error)
      message.error('Failed to delete rate')
    }
  }

  const resetBillingDates = (): void => {
    rateForm.setFieldsValue({
      due_date: undefined,
      discount_percentage: undefined
    })
  }

  const handleViewSlabs = async (rate: MaintenanceRate): Promise<void> => {
    setSelectedRate(rate)
    setLoadingSlabs(true)
    try {
      const data = await window.api.rates.getSlabs(rate.id!)
      setSlabs(data || [])
    } catch (error) {
      console.error('Failed to fetch slabs:', error)
      message.error('Failed to fetch slabs')
    } finally {
      setLoadingSlabs(false)
    }
  }

  const handleAddSlab = async (): Promise<void> => {
    if (!selectedRate) {
      message.warning('Please select a rate first')
      return
    }

    try {
      const values = await slabForm.validateFields()

      // Validate due date is not in the past
      const [year, month, day] = values.due_date.split('-').map(Number)
      const dueDate = new Date(year, month - 1, day)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      if (dueDate < today) {
        message.warning('Due date cannot be in the past')
        return
      }

      setLoadingSlabs(true)
      await window.api.rates.addSlab({
        ...values,
        rate_id: selectedRate.id!,
        is_early_payment: true
      } as MaintenanceSlab)

      message.success('Slab added successfully')
      setIsAddingSlab(false)
      slabForm.resetFields()
      handleViewSlabs(selectedRate)
    } catch (error) {
      if (!isFormValidationError(error)) {
        message.error(getErrorMessage(error, 'Failed to add slab'))
      }
    } finally {
      setLoadingSlabs(false)
    }
  }

  const handleDeleteSlab = async (id: number): Promise<void> => {
    try {
      await window.api.rates.deleteSlab(id)
      message.success('Slab deleted successfully')
      if (selectedRate) handleViewSlabs(selectedRate)
    } catch (error) {
      console.error('Failed to delete slab:', error)
      message.error('Failed to delete slab')
    }
  }

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return filterFY !== null || filterUnitType !== 'All'
  }, [filterFY, filterUnitType])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setFilterFY(null)
    setFilterUnitType('All')
  }, [])

  // Format billing frequency for display
  const formatBillingFrequency = useCallback((frequency: string): string => {
    const frequencyMap: Record<string, string> = {
      YEARLY: 'Yearly',
      MONTHLY: 'Monthly',
      QUARTERLY: 'Quarterly',
      HALFYEARLY: 'Half-Yearly'
    }
    return frequencyMap[frequency] || frequency
  }, [])

  const rateColumns = [
    {
      title: 'Financial Year',
      dataIndex: 'financial_year',
      key: 'financial_year'
    },
    {
      title: 'Unit Type',
      dataIndex: 'unit_type',
      key: 'unit_type',
      render: (val: string): React.ReactNode => <Tag>{val || 'Bungalow'}</Tag>
    },
    {
      title: 'Rate/Sqft',
      dataIndex: 'rate_per_sqft',
      key: 'rate_per_sqft',
      render: (val: number): string => `₹${val?.toFixed(2) || '0.00'}`
    },
    {
      title: 'GST %',
      dataIndex: 'gst_percent',
      key: 'gst_percent',
      render: (val: number): React.ReactNode =>
        (val ?? 0) > 0 ? <Tag color="orange">{val}%</Tag> : <Tag>None</Tag>
    },
    {
      title: 'Penalty %',
      dataIndex: 'penalty_percentage',
      key: 'penalty_percentage',
      render: (val: number | null | undefined): React.ReactNode =>
        val !== null && val !== undefined ? <Tag color="red">{val}%</Tag> : <Tag>Default</Tag>
    },
    {
      title: 'Billing Frequency',
      dataIndex: 'billing_frequency',
      key: 'billing_frequency',
      render: (val: string): React.ReactNode => (
        <Tag color="blue">{formatBillingFrequency(val)}</Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: MaintenanceRate): React.ReactNode => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditRate(record)}
            aria-label={`Edit ${record.financial_year} ${record.unit_type || 'Bungalow'} rate`}
          >
            Edit
          </Button>
          <Button
            size="small"
            icon={<PercentageOutlined />}
            onClick={() => handleViewSlabs(record)}
            type={selectedRate?.id === record.id ? 'primary' : 'default'}
            loading={selectedRate?.id === record.id && loadingSlabs}
            aria-label={`View slabs for ${record.financial_year} ${record.unit_type || 'Bungalow'}`}
          >
            Slabs
          </Button>
          <Popconfirm
            title="Are you sure you want to delete this rate?"
            description="This action cannot be undone."
            onConfirm={() => handleDeleteRate(record.id!)}
            okText="Yes"
            cancelText="No"
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`Delete ${record.financial_year} ${record.unit_type || 'Bungalow'} rate`}
            />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const slabColumns = [
    {
      title: 'Due Date',
      dataIndex: 'due_date',
      key: 'due_date',
      render: (date: string): string => {
        if (!date) return '-'
        return new Date(date).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      }
    },
    {
      title: 'Discount Percentage',
      dataIndex: 'discount_percentage',
      key: 'discount_percentage',
      render: (val: number): string => `${val}%`
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, record: MaintenanceSlab): React.ReactNode => (
        <Popconfirm
          title="Are you sure you want to delete this slab?"
          description="This action cannot be undone."
          onConfirm={() => handleDeleteSlab(record.id!)}
          okText="Yes"
          cancelText="No"
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label={`Delete slab with ${record.discount_percentage}% discount due ${record.due_date}`}
          />
        </Popconfirm>
      )
    }
  ]

  const handleCancelRateForm = (): void => {
    setIsAddingRate(false)
    setEditingRateId(null)
    resetBillingDates()
    rateForm.resetFields()
  }

  const handleCancelSlabForm = (): void => {
    setIsAddingSlab(false)
    slabForm.resetFields()
  }

  return (
    <Modal
      title={`Maintenance Rates - ${projectName}`}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={900}
      style={{ maxWidth: '95vw', maxHeight: '90vh', top: 20 }}
      bodyStyle={{ maxHeight: 'calc(90vh - 100px)', overflowY: 'auto', padding: '16px 24px' }}
      destroyOnClose
    >
      <div style={{ marginBottom: 24 }}>
        <Alert
          message={`Managing rates for: ${projectName}`}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Alert
          message="Penalty source of truth"
          description="Set late-payment penalty here for each financial year and unit type. If a rate penalty is blank, the project-level charges configuration is used as the fallback. Unit-level penalty values are legacy/import fields and are not the source of truth for new maintenance letters."
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <div
          style={{
            marginBottom: 16
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            Rates
          </Title>
        </div>
        <FilterPanel
          filters={rateFilterFields}
          values={rateFilterValues}
          onChange={handleRateFilterChange}
          onClear={clearAllFilters}
          showActiveFilters={hasActiveFilters}
          variant="plain"
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingRateId(null)
              rateForm.resetFields()
              rateForm.setFieldsValue({
                unit_type: 'Bungalow',
                billing_frequency: 'YEARLY'
              })
              setIsAddingRate(true)
            }}
            disabled={isAddingRate}
          >
            Add Rate
          </Button>
        </FilterPanel>

        {isAddingRate && (
          <Card size="small" style={{ marginBottom: 16, backgroundColor: '#fafafa' }}>
            <Form form={rateForm} layout="inline" onFinish={handleSaveRate}>
              <Form.Item<RateFormValues>
                name="financial_year"
                label="Financial Year"
                rules={[{ required: true, message: 'Financial Year is required' }]}
                style={{ marginBottom: 8 }}
              >
                <Select style={{ width: 120 }} aria-label="Financial year">
                  {formFinancialYearOptions.map((fy) => (
                    <Option key={fy} value={fy}>
                      {fy}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item<RateFormValues>
                name="unit_type"
                label="Unit Type"
                initialValue="All"
                style={{ marginBottom: 8 }}
              >
                <Select style={{ width: 120 }} aria-label="Unit type">
                  {UNIT_TYPE_OPTIONS.map((unitType) => (
                    <Option key={unitType} value={unitType}>
                      {unitType}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item<RateFormValues>
                name="rate_per_sqft"
                label="Rate per Sqft (₹)"
                rules={[
                  { required: true, message: 'Rate is required' },
                  { type: 'number', min: 0, message: 'Rate must be positive' }
                ]}
                style={{ marginBottom: 8 }}
              >
                <InputNumber
                  min={0}
                  placeholder="0.00"
                  style={{ width: 120 }}
                  aria-label="Rate per square foot"
                  precision={2}
                />
              </Form.Item>
              <Form.Item<RateFormValues>
                name="gst_percent"
                label="GST %"
                initialValue={0}
                style={{ marginBottom: 8 }}
                tooltip="GST percentage applied on top of base maintenance (e.g. 18 for 18%)"
              >
                <InputNumber
                  min={0}
                  max={100}
                  placeholder="0"
                  style={{ width: 90 }}
                  aria-label="GST percentage"
                  precision={2}
                  addonAfter="%"
                />
              </Form.Item>
              <Form.Item<RateFormValues>
                name="penalty_percentage"
                label="Penalty %"
                tooltip="Late payment penalty percentage for this rate and financial year"
                style={{ marginBottom: 8 }}
              >
                <InputNumber
                  min={0}
                  max={100}
                  placeholder="Default"
                  style={{ width: 100 }}
                  aria-label="Penalty percentage"
                  precision={2}
                  addonAfter="%"
                />
              </Form.Item>
              <Form.Item<RateFormValues>
                name="billing_frequency"
                label="Billing Frequency"
                initialValue="YEARLY"
                style={{ marginBottom: 8 }}
              >
                <Select style={{ width: 140 }} aria-label="Billing frequency">
                  <Option value="YEARLY">Yearly</Option>
                  <Option value="MONTHLY">Monthly</Option>
                  <Option value="QUARTERLY">Quarterly</Option>
                  <Option value="HALFYEARLY">Half-Yearly</Option>
                </Select>
              </Form.Item>

              {/* Billing Dates Section */}
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ marginBottom: 8, fontWeight: 500, color: '#555' }}>Billing Dates & Early Payment Discount</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Form.Item<RateFormValues>
                  name="due_date"
                  label="Due Date"
                  tooltip="Payment due date"
                  style={{ marginBottom: 8 }}
                >
                  <Input type="date" aria-label="Due date" />
                </Form.Item>
                <Form.Item<RateFormValues>
                  name="discount_percentage"
                  label="Discount %"
                  tooltip="Early payment discount percentage"
                  style={{ marginBottom: 8 }}
                >
                  <InputNumber
                    min={0}
                    max={100}
                    placeholder="e.g. 10"
                    style={{ width: 100 }}
                    aria-label="Discount percentage"
                    addonAfter="%"
                  />
                </Form.Item>
              </div>

              <Form.Item style={{ marginBottom: 8, marginTop: 12 }}>
                <Space>
                  <Button type="primary" htmlType="submit" loading={loading}>
                    Save
                  </Button>
                  <Button onClick={handleCancelRateForm}>Cancel</Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>
        )}

        <Table
          dataSource={filteredRates}
          columns={rateColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 5, showSizeChanger: false }}
          locale={{
            emptyText: 'No rates found. Click "Add Rate" to create your first rate.'
          }}
          scroll={{ x: 'max-content' }}
        />
      </div>

      {selectedRate && (
        <>
          <Divider />
          <div style={{ marginBottom: 16 }}>
            <Title level={4} style={{ marginBottom: 8 }}>
              Early Payment Slabs
            </Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              Discounts for {selectedRate.financial_year} - {selectedRate.unit_type || 'Bungalow'}{' '}
              rate
            </Text>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
                flexWrap: 'wrap',
                gap: '16px'
              }}
            >
              <Text>
                {slabs.length > 0
                  ? `${slabs.length} slab${slabs.length !== 1 ? 's' : ''} configured`
                  : 'No slabs configured yet'}
              </Text>
              <Tooltip title="Add discount slabs for early payments">
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setIsAddingSlab(true)}
                  disabled={isAddingSlab}
                >
                  Add Slab
                </Button>
              </Tooltip>
            </div>

            {isAddingSlab && (
              <Card size="small" style={{ marginBottom: 16, backgroundColor: '#fafafa' }}>
                <Form form={slabForm} layout="inline" onFinish={handleAddSlab}>
                  <Form.Item<SlabFormValues>
                    name="due_date"
                    label="Due Date"
                    rules={[{ required: true, message: 'Due date is required' }]}
                    style={{ marginBottom: 8 }}
                  >
                    <Input type="date" aria-label="Slab due date" min={todayDateInput} />
                  </Form.Item>
                  <Form.Item<SlabFormValues>
                    name="discount_percentage"
                    label="Discount Percentage"
                    rules={[
                      { required: true, message: 'Discount percentage is required' },
                      {
                        type: 'number',
                        min: 0,
                        max: 100,
                        message: 'Discount must be between 0-100%'
                      }
                    ]}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      min={0}
                      max={100}
                      placeholder="%"
                      style={{ width: 100 }}
                      aria-label="Discount percentage"
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 8 }}>
                    <Space>
                      <Button type="primary" htmlType="submit" loading={loadingSlabs}>
                        Save
                      </Button>
                      <Button onClick={handleCancelSlabForm}>Cancel</Button>
                    </Space>
                  </Form.Item>
                </Form>
              </Card>
            )}

            {slabs.length > 0 ? (
              <Table
                dataSource={slabs}
                columns={slabColumns}
                rowKey="id"
                size="small"
                pagination={false}
                loading={loadingSlabs}
                locale={{
                  emptyText: 'No slabs found. Click "Add Slab" to create your first discount slab.'
                }}
              />
            ) : (
              <Alert
                message="No early payment slabs"
                description="Add slabs to offer discounts for payments made before due dates."
                type="info"
                showIcon
              />
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

export default MaintenanceRateModal
