import React, { useState } from 'react'
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
import { Project, Unit, LetterCalculation } from '@preload/types'

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

  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: `${project.name} (${project.project_code || 'No Code'})`
  }))

  const getUnitsForProject = (projectId: number) => {
    return units.filter((unit) => unit.project_id === projectId)
  }

  const financialYearOptions = [
    '2025-26',
    '2024-25',
    '2023-24',
    '2022-23',
    '2021-22',
    '2020-21',
    '2019-20',
    '2018-19'
  ]

  const handleGenerateCalculation = async (values: FormValues) => {
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

  const handleGeneratePdf = async () => {
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

  const handleCancel = () => {
    setCalculation(null)
    form.resetFields()
    onCancel()
  }

  const arrearsColumns = [
    {
      title: 'Financial Year',
      dataIndex: 'financial_year',
      key: 'financial_year'
    },
    {
      title: 'Amount (Rs.)',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => amount.toFixed(2)
    },
    {
      title: 'Penalty (21%)',
      dataIndex: 'penalty',
      key: 'penalty',
      render: (penalty: number) => penalty.toFixed(2)
    },
    {
      title: 'Total with Penalty',
      dataIndex: 'total_with_penalty',
      key: 'total_with_penalty',
      render: (total: number) => total.toFixed(2)
    }
  ]

  const chargesColumns = [
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: 'Amount (Rs.)',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => amount.toFixed(2)
    }
  ]

  return (
    <Modal
      title="Detailed Maintenance Letter Generator"
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={1000}
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
              setCalculation(null)
            }}
          />
        </Form.Item>

        <Form.Item
          name="unitId"
          label="Unit"
          rules={[{ required: true, message: 'Please select a unit' }]}
        >
          <Select placeholder="Select a unit" disabled={!form.getFieldValue('projectId')}>
            {getUnitsForProject(form.getFieldValue('projectId') || 0).map((unit) => (
              <Option key={unit.id} value={unit.id}>
                {unit.unit_number} - {unit.owner_name}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="financialYear"
          label="Financial Year"
          rules={[{ required: true, message: 'Please select a financial year' }]}
        >
          <Select placeholder="Select financial year">
            {financialYearOptions.map((fy) => (
              <Option key={fy} value={fy}>
                {fy}
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
            description="The detailed maintenance letter calculation has been generated successfully."
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
          />

          {/* Unit Details */}
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
                <Text>{calculation.unit_details.plot_area.toFixed(2)} sqft</Text>
              </div>
              <div>
                <Text strong>Rate per sqft: </Text>
                <Text>Rs. {calculation.unit_details.rate_per_sqft.toFixed(2)}</Text>
              </div>
            </div>
          </div>

          <Divider />

          {/* Arrears Breakdown */}
          {calculation.arrears_breakdown.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Title level={4}>Arrears Breakdown</Title>
              <Table
                dataSource={calculation.arrears_breakdown}
                columns={arrearsColumns}
                pagination={false}
                size="small"
                rowKey={(_, index) => `arrears-${index}`}
              />
            </div>
          )}

          {/* Current Year Charges */}
          <div style={{ marginBottom: 16 }}>
            <Title level={4}>Current Year Charges</Title>
            <Table
              dataSource={calculation.charges_breakdown}
              columns={chargesColumns}
              pagination={false}
              size="small"
              rowKey={(_, index) => `charge-${index}`}
            />
          </div>

          <Divider />

          {/* Totals */}
          <div style={{ marginBottom: 16 }}>
            <Title level={4}>Payment Summary</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <div>
                <Text>Total Arrears with Penalty: </Text>
                <Tag color="red">
                  Rs. {calculation.totals.total_arrears_with_penalty.toFixed(2)}
                </Tag>
              </div>
              <div>
                <Text>Total Current Charges: </Text>
                <Tag color="blue">Rs. {calculation.totals.total_current_charges.toFixed(2)}</Tag>
              </div>
              <div>
                <Text>Grand Total (Before Discount): </Text>
                <Tag color="orange">
                  Rs. {calculation.totals.grand_total_before_discount.toFixed(2)}
                </Tag>
              </div>
              <div>
                <Text>Early Payment Discount (10%): </Text>
                <Tag color="green">
                  - Rs. {calculation.totals.early_payment_discount.toFixed(2)}
                </Tag>
              </div>
              <div>
                <Text strong style={{ fontSize: '16px' }}>
                  Amount Payable Before Due Date:
                </Text>
                <Tag color="green" style={{ fontSize: '16px', padding: '4px 8px' }}>
                  Rs. {calculation.totals.amount_payable_before_due.toFixed(2)}
                </Tag>
              </div>
              <div>
                <Text strong style={{ fontSize: '16px' }}>
                  Amount Payable After Due Date:
                </Text>
                <Tag color="red" style={{ fontSize: '16px', padding: '4px 8px' }}>
                  Rs. {calculation.totals.amount_payable_after_due.toFixed(2)}
                </Tag>
              </div>
            </div>
          </div>

          {/* Bank Details */}
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

          {/* Actions */}
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
