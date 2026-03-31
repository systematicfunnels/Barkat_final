import React, { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Form,
  Select,
  Button,
  Space,
  message,
  Typography,
  Table,
  Tag,
  Divider,
  Spin,
  Alert
} from 'antd'
import { PlusOutlined, FilePdfOutlined } from '@ant-design/icons'
import {
  Project,
  Unit,
  LetterCalculation,
  MaintenanceLetter,
  MaintenanceRate
} from '@preload/types'
import { getCurrentFinancialYear, getUpcomingFinancialYear } from '../utils/financialYear'

const { Title, Text } = Typography
const { Option } = Select

interface DetailedMaintenanceLetterModalProps {
  projects: Project[]
  units: Unit[]
  visible: boolean
  onCancel: () => void
}

interface FormValues {
  projectId: number
  unitId: number
  financialYear: string
}

const DetailedMaintenanceLetterModal: React.FC<DetailedMaintenanceLetterModalProps> = ({
  projects,
  units,
  visible,
  onCancel
}) => {
  const [form] = Form.useForm<FormValues>()
  const [loading, setLoading] = useState(false)
  const [calculation, setCalculation] = useState<LetterCalculation | null>(null)
  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [financialYearOptions, setFinancialYearOptions] = useState<string[]>([])

  const selectedProjectId = Form.useWatch('projectId', form)

  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: `${project.name} (${project.project_code || 'No Code'})`
  }))

  const selectedProjectUnits = useMemo(() => {
    return units.filter((unit) => unit.project_id === selectedProjectId)
  }, [selectedProjectId, units])

  useEffect(() => {
    if (!visible || !selectedProjectId) {
      setFinancialYearOptions([])
      return
    }

    let isCancelled = false

    const loadFinancialYears = async (): Promise<void> => {
      try {
        const [rates, letters] = await Promise.all([
          window.api.rates.getByProject(selectedProjectId) as Promise<MaintenanceRate[]>,
          window.api.letters.getByProject(selectedProjectId) as Promise<MaintenanceLetter[]>
        ])

        const defaultFY = getCurrentFinancialYear()
        const nextFY = getUpcomingFinancialYear(defaultFY)

        const years = Array.from(
          new Set([
            ...rates.map((rate) => rate.financial_year),
            ...letters.map((letter) => letter.financial_year),
            defaultFY,
            nextFY
          ])
        )
          .filter((year): year is string => /^\d{4}-\d{2}$/.test(String(year)))
          .sort()
          .reverse()

        if (!isCancelled) {
          setFinancialYearOptions(years)
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load financial years for detailed letter:', error)
          setFinancialYearOptions([])
        }
      }
    }

    void loadFinancialYears()

    return () => {
      isCancelled = true
    }
  }, [selectedProjectId, visible])

  const handleGenerateCalculation = async (values: FormValues): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.api.detailedLetters.generateLetter(
        values.projectId,
        values.unitId,
        values.financialYear
      )
      setCalculation(result)
      message.success('Letter calculation generated successfully')
    } catch (error) {
      console.error('Error generating calculation:', error)
      message.error('Failed to generate letter calculation')
    } finally {
      setLoading(false)
    }
  }

  const handleGeneratePdf = async (): Promise<void> => {
    if (!calculation) return

    const formValues = form.getFieldsValue()
    setPdfGenerating(true)
    try {
      const filePath = await window.api.detailedLetters.generatePdf(
        formValues.projectId,
        formValues.unitId,
        formValues.financialYear
      )
      message.success('PDF generated successfully')
      window.api.shell.showItemInFolder(filePath)
    } catch (error) {
      console.error('Error generating PDF:', error)
      message.error('Failed to generate PDF')
    } finally {
      setPdfGenerating(false)
    }
  }

  const handleCancel = (): void => {
    setCalculation(null)
    form.resetFields()
    setFinancialYearOptions([])
    onCancel()
  }

  const formatCurrency = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '-'
    return `Rs. ${value.toLocaleString('en-IN')}`
  }

  const previewColumns = [
    {
      title: 'Particulars',
      dataIndex: 'particulars',
      key: 'particulars',
      width: '25%',
      render: (value: string, record: { rate: number | null; isTotal?: boolean }): React.ReactNode => {
        const content =
          record.rate !== null ? (
            <div>
              <div>{value}</div>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                Rate-linked line item
              </Text>
            </div>
          ) : (
            value
          )

        return record.isTotal ? <Text strong>{content}</Text> : content
      }
    },
    {
      title: 'Plot Area (Sqft)',
      dataIndex: 'plot_area',
      key: 'plot_area',
      align: 'center' as const,
      width: '10%',
      render: (value: number | null): string => (value !== null ? String(value) : '-')
    },
    {
      title: 'Rate per sqft',
      dataIndex: 'rate',
      key: 'rate',
      align: 'right' as const,
      width: '13%',
      render: (value: number | null): string => (value !== null ? formatCurrency(value) : '-')
    },
    {
      title: 'Amount (Rs.)',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right' as const,
      width: '11%',
      render: (value: number | null, record: { isTotal?: boolean }): React.ReactNode => {
        const text = formatCurrency(value)
        return record.isTotal ? <Text strong>{text}</Text> : text
      }
    },
    {
      title: `${calculation?.penalty_percentage ?? 0}% Penalty`,
      dataIndex: 'penalty',
      key: 'penalty',
      align: 'right' as const,
      width: '11%',
      render: (value: number | null): string => formatCurrency(value)
    },
    {
      title: `Discount ${calculation?.discount_percentage ?? 0}%`,
      dataIndex: 'discount',
      key: 'discount',
      align: 'right' as const,
      width: '11%',
      render: (value: number | null): string => formatCurrency(value)
    },
    {
      title: `Before ${calculation?.due_date ?? '-'}`,
      dataIndex: 'before_due',
      key: 'before_due',
      align: 'right' as const,
      width: '11%',
      render: (value: number | null, record: { isTotal?: boolean }): React.ReactNode => {
        const text = formatCurrency(value)
        return record.isTotal ? <Text strong>{text}</Text> : text
      }
    },
    {
      title: `After ${calculation?.due_date ?? '-'}`,
      dataIndex: 'after_due',
      key: 'after_due',
      align: 'right' as const,
      width: '11%',
      render: (value: number | null, record: { isTotal?: boolean }): React.ReactNode => {
        const text = formatCurrency(value)
        return record.isTotal ? <Text strong>{text}</Text> : text
      }
    }
  ]

  return (
    <Modal
      title="Detailed Maintenance Letter Generator"
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={1000}
      style={{ maxWidth: '95vw', maxHeight: '90vh', top: 20 }}
      bodyStyle={{ maxHeight: 'calc(90vh - 100px)', overflowY: 'auto' }}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleGenerateCalculation}
        style={{ marginBottom: 24 }}
      >
        <Form.Item
          name="projectId"
          label="Project"
          rules={[{ required: true, message: 'Please select a project' }]}
        >
          <Select
            placeholder="Select a project"
            options={projectOptions}
            onChange={() => {
              form.setFieldValue('unitId', undefined)
              form.setFieldValue('financialYear', undefined)
              setCalculation(null)
            }}
          />
        </Form.Item>

        <Form.Item
          name="unitId"
          label="Unit"
          rules={[{ required: true, message: 'Please select a unit' }]}
        >
          <Select placeholder="Select a unit" disabled={!selectedProjectId}>
            {selectedProjectUnits.map((unit) => (
              <Option key={unit.id} value={unit.id}>
                {unit.unit_number} - {unit.owner_name}
              </Option>
            ))}
          </Select>
        </Form.Item>

            <Form.Item
              name="financialYear"
              label="Financial Year"
              extra={`Current FY: ${getCurrentFinancialYear()}. Upcoming FY: ${getUpcomingFinancialYear()}. The current financial year is the recommended default.`}
              rules={[{ required: true, message: 'Please select a financial year' }]}
            >
              <Select placeholder="Select financial year" disabled={!selectedProjectId}>
                {financialYearOptions.map((fy) => (
                  <Option key={fy} value={fy}>
                    {fy === getCurrentFinancialYear()
                      ? `${fy} (Current)`
                      : fy === getUpcomingFinancialYear()
                        ? `${fy} (Upcoming)`
                        : fy}
                  </Option>
                ))}
          </Select>
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading} icon={<PlusOutlined />}>
              Generate Calculation
            </Button>
            <Button onClick={handleCancel}>Cancel</Button>
          </Space>
        </Form.Item>
      </Form>

      {loading && (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Spin size="large" />
          <div style={{ marginTop: '10px' }}>Generating letter calculation...</div>
        </div>
      )}

      {calculation && (
        <div>
          <Alert
            message="Letter Calculation Generated"
            description="This preview is rendered from backend-prepared values for the selected project, unit, and financial year."
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <div style={{ marginBottom: 16 }}>
            <Title level={4}>Unit Details</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <div>
                <Text strong>Unit Number: </Text>
                <Text>{calculation.unit_details.unit_number}</Text>
              </div>
              <div>
                <Text strong>Owner Name: </Text>
                <Text>{calculation.unit_details.owner_name}</Text>
              </div>
              <div>
                <Text strong>Plot Area: </Text>
                <Text>{calculation.unit_details.plot_area.toLocaleString('en-IN')} sqft</Text>
              </div>
              <div>
                <Text strong>Rate per sqft: </Text>
                <Text>{formatCurrency(calculation.unit_details.rate_per_sqft)}</Text>
              </div>
            </div>
          </div>

          <div className="maintenance-table-container" style={{ marginBottom: 24 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
                borderBottom: '2px solid #1d4e89',
                paddingBottom: 8
              }}
            >
              <Title level={4} style={{ margin: 0, color: '#1d4e89' }}>
                Maintenance Demand Notice
              </Title>
            </div>

            <style>{`
              .maintenance-table .ant-table-thead > tr > th {
                background-color: #e6e9ef !important;
                color: #1d4e89 !important;
                font-weight: bold !important;
                text-align: center !important;
                border-bottom: 1px solid #d9d9d9 !important;
              }
              .maintenance-table .ant-table-tbody > tr > td {
                border-bottom: 1px solid #f0f0f0 !important;
              }
              .maintenance-table .total-row {
                background-color: #f8f9fb !important;
              }
              .maintenance-table .total-row td {
                border-top: 2px solid #d9d9d9 !important;
                border-bottom: 2px solid #d9d9d9 !important;
              }
            `}</style>

            <Table
              className="maintenance-table"
              dataSource={calculation.preview_rows}
              columns={previewColumns}
              pagination={false}
              size="middle"
              bordered
              rowClassName={(record) => (record.isTotal ? 'total-row' : '')}
              summary={() => null}
            />
          </div>

          <Divider />

          <div style={{ marginBottom: 16 }}>
            <Title level={4}>Payment Summary</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <div>
                <Text>Total Arrears with Penalty: </Text>
                <Tag color="red">{formatCurrency(calculation.totals.total_arrears_with_penalty)}</Tag>
              </div>
              <div>
                <Text>Total Current Charges: </Text>
                <Tag color="blue">{formatCurrency(calculation.totals.total_current_charges)}</Tag>
              </div>
              <div>
                <Text>Grand Total (Before Discount): </Text>
                <Tag color="orange">{formatCurrency(calculation.totals.grand_total_before_discount)}</Tag>
              </div>
              <div>
                <Text>Early Payment Discount ({calculation.discount_percentage}%): </Text>
                <Tag color="green">- {formatCurrency(calculation.totals.early_payment_discount)}</Tag>
              </div>
              <div>
                <Text strong style={{ fontSize: '16px' }}>
                  Amount Payable Before Due Date:
                </Text>
                <Tag color="green" style={{ fontSize: '16px', padding: '4px 8px' }}>
                  {formatCurrency(calculation.totals.amount_payable_before_due)}
                </Tag>
              </div>
              <div>
                <Text strong style={{ fontSize: '16px' }}>
                  Amount Payable After Due Date:
                </Text>
                <Tag color="red" style={{ fontSize: '16px', padding: '4px 8px' }}>
                  {formatCurrency(calculation.totals.amount_payable_after_due)}
                </Tag>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Title level={4}>Bank Details</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <div>
                <Text strong>Account Name: </Text>
                <Text>{calculation.bank_details.name}</Text>
              </div>
              <div>
                <Text strong>Account Number: </Text>
                <Text>{calculation.bank_details.account_no}</Text>
              </div>
              <div>
                <Text strong>IFSC Code: </Text>
                <Text>{calculation.bank_details.ifsc_code}</Text>
              </div>
              <div>
                <Text strong>Bank Name: </Text>
                <Text>{calculation.bank_details.bank_name}</Text>
              </div>
              <div>
                <Text strong>Branch: </Text>
                <Text>{calculation.bank_details.branch}</Text>
              </div>
              {calculation.bank_details.branch_address && (
                <div>
                  <Text strong>Branch Address: </Text>
                  <Text>{calculation.bank_details.branch_address}</Text>
                </div>
              )}
            </div>
          </div>

          <Divider />

          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button
                type="primary"
                icon={<FilePdfOutlined />}
                onClick={handleGeneratePdf}
                loading={pdfGenerating}
              >
                Generate PDF
              </Button>
              <Button onClick={handleCancel}>Close</Button>
            </Space>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default DetailedMaintenanceLetterModal
