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
  Select,
  Divider,
  Typography,
  Card,
  Tag,
  Row,
  Col
} from 'antd'
import type { DividerProps } from 'antd'
import {
  FileTextOutlined,
  WalletOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  UndoOutlined
} from '@ant-design/icons'
import { Unit, Project } from '@preload/types'
import { UNIT_TYPES, UNIT_TYPE_COLORS } from '../constants/unitTypes'
import { appMessage as message } from '../utils/appMessage'
import { useOperationHistory } from '../hooks/useOperationHistory'
import FilterPanel, {
  createRangeFilter,
  createSearchFilter,
  createSelectFilter
} from '../components/shared/FilterPanel'

const { Title, Text } = Typography
const { Option } = Select

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

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setSelectedProject(null)
    setSelectedUnitType(null)
    setStatusFilter(null)
    setAreaRange([null, null])
    setSelectedRowKeys([])
  }, [])

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
              Review owners, import unit master data, and prepare units for billing in a faster workflow.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Import, clean, and manage unit records here before billing and payment operations. Historical ledger and billing migrations should be done from the project import flow.
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
            loading={loading}
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
            project_id: selectedProject || undefined
          }}
        >
          {/* ── Project & Identity ── */}
          <div id="unit-info-section">
            <Divider orientation={'left' as DividerProps['orientation']} plain style={{ marginTop: 0 }}>
              Unit Information
            </Divider>
            <Text type="secondary" className="page-helper-text">
              Billing rules like penalty and discount are managed in Project Rates, not at unit level.
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
