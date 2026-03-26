import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  Skeleton,
  Select,
  Space,
  Tag,
  Button,
  Tooltip,
  Spin
} from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  HomeOutlined,
  UserOutlined,
  FileTextOutlined,
  ArrowRightOutlined,
  ProjectOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { IndianRupee } from 'lucide-react'
import { MaintenanceLetter, Project } from '@preload/types'
import { useAsyncOperation } from '../hooks/useAsyncOperation'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { Option } = Select

const UNIT_TYPE_OPTIONS = ['Plot', 'Bungalow', 'Garden'] as const

interface StatCard {
  title: string
  value: number
  icon: React.ReactNode
  color: string
  path: string
  isCurrency?: boolean
  tooltip?: string
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { execute: executeAsync } = useAsyncOperation()
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<number | undefined>(undefined)
  const [selectedUnitType, setSelectedUnitType] = useState<string | undefined>(undefined)
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined)

  // Default to current financial year
  const currentYear = dayjs().month() < 3 ? dayjs().year() - 1 : dayjs().year()
  const defaultFY = `${currentYear}-${(currentYear + 1).toString().slice(2)}`
  const [selectedFY, setSelectedFY] = useState<string>(defaultFY)
  const [availableFYs, setAvailableFYs] = useState<string[]>([])

  const [stats, setStats] = useState({
    projects: 0,
    units: 0,
    pendingUnits: 0,
    collectedThisYear: 0,
    totalBilled: 0,
    totalOutstanding: 0
  })

  useEffect(() => {
    const fetchProjects = async (): Promise<void> => {
      await executeAsync(
        async () => {
          const data = await window.api.projects.getAll()
          setProjects(data)
        },
        {
          errorMessage: 'Failed to load projects',
          loadingMessage: 'Loading projects...'
        }
      )
    }
    fetchProjects()
  }, [])

  useEffect(() => {
    const fetchYears = async (): Promise<void> => {
      await executeAsync(
        async () => {
          const letters: MaintenanceLetter[] = await window.api.letters.getAll()
          const yearSet = new Set(letters.map((l) => l.financial_year).filter(Boolean))
          yearSet.add(defaultFY)
          const nextFY = `${currentYear + 1}-${(currentYear + 2).toString().slice(2)}`
          yearSet.add(nextFY)
          const years = Array.from(yearSet).sort().reverse()
          setAvailableFYs(years)
        },
        {
          errorMessage: 'Failed to load financial years',
          loadingMessage: 'Loading financial years...'
        }
      )
    }
    fetchYears()
  }, [currentYear, defaultFY])

  useEffect(() => {
    const fetchDashboardData = async (): Promise<void> => {
      setLoading(true)
      try {
        await executeAsync(
          async () => {
            const data = await window.api.projects.getDashboardStats(
              selectedProject,
              selectedFY,
              selectedUnitType,
              selectedStatus
            )
            setStats(data)
          },
          {
            errorMessage: 'Failed to load dashboard statistics',
            loadingMessage: 'Loading dashboard statistics...'
          }
        )
      } finally {
        setLoading(false)
      }
    }

    fetchDashboardData()
  }, [selectedProject, selectedFY, selectedUnitType, selectedStatus])

  // Generate a range of financial years for the filter
  const fallbackFinancialYears = useMemo(() => {
    const years: string[] = []
    const startYear = 2024 // Application start year
    const endYear = currentYear + 1
    for (let y = startYear; y <= endYear; y++) {
      years.push(`${y}-${(y + 1).toString().slice(2)}`)
    }
    return years
  }, [currentYear])

  const financialYears = availableFYs.length > 0 ? availableFYs : fallbackFinancialYears

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      selectedProject !== undefined ||
      selectedUnitType !== undefined ||
      selectedStatus !== undefined ||
      selectedFY !== defaultFY
    )
  }, [selectedProject, selectedUnitType, selectedStatus, selectedFY, defaultFY])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSelectedProject(undefined)
    setSelectedUnitType(undefined)
    setSelectedStatus(undefined)
    setSelectedFY(defaultFY)
  }, [defaultFY])

  // Get selected project name
  const selectedProjectName = useMemo(() => {
    if (!selectedProject) return ''
    const project = projects.find((p) => p.id === selectedProject)
    return project?.name || ''
  }, [selectedProject, projects])

  const statCards: StatCard[] = [
    {
      title: 'PROJECTS',
      value: stats.projects,
      icon: <HomeOutlined style={{ color: '#2D7A5E' }} />,
      color: '#2D7A5E',
      path: '/projects'
    },
    {
      title: 'UNITS',
      value: stats.units,
      icon: <UserOutlined style={{ color: '#2D7A5E' }} />,
      color: '#2D7A5E',
      path: '/units'
    },
    {
      title: 'PENDING UNITS',
      value: stats.pendingUnits,
      icon: <FileTextOutlined style={{ color: '#cf1322' }} />,
      color: '#cf1322',
      path: '/units',
      tooltip: 'Units with outstanding maintenance payments for current financial year'
    },
    {
      title: 'TOTAL OUTSTANDING',
      value: stats.totalOutstanding,
      icon: <IndianRupee size={24} style={{ color: '#cf1322' }} />,
      color: '#cf1322',
      isCurrency: true,
      path: '/reports',
      tooltip: 'Total unpaid maintenance amount across all projects'
    },
    {
      title: 'COLLECTED (FY)',
      value: stats.collectedThisYear,
      icon: <IndianRupee size={24} style={{ color: '#3f8600' }} />,
      color: '#3f8600',
      isCurrency: true,
      path: '/payments',
      tooltip: 'Total collected maintenance for selected financial year'
    }
  ]

  return (
    <div style={{ margin: '0 auto' }}>
      <div
        style={{
          marginBottom: 32,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: '16px'
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>
            Dashboard
          </Title>
          <Text type="secondary" style={{ fontSize: 16 }}>
            Welcome back! Summary for Financial Year <strong>{selectedFY}</strong>
            {selectedFY === defaultFY && ' (Current)'}
          </Text>
        </div>
        <Space
          size="middle"
          wrap
          style={{
            opacity: loading ? 0.7 : 1,
            pointerEvents: loading ? 'none' : 'auto'
          }}
        >
          <Space direction="vertical" align="start">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text type="secondary" strong style={{ fontSize: 12 }}>
                Project
              </Text>
              {loading && <Spin size="small" style={{ marginLeft: 4 }} />}
            </div>
            <Select
              placeholder="All Projects"
              style={{ width: 180 }}
              allowClear
              onChange={(value) => setSelectedProject(value)}
              value={selectedProject}
              suffixIcon={<ProjectOutlined />}
              disabled={loading}
            >
              {projects.map((p) => (
                <Option key={p.id} value={p.id}>
                  {p.project_code ? `${p.project_code} - ${p.name}` : p.name}
                </Option>
              ))}
            </Select>
          </Space>
          <Space direction="vertical" align="start">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text type="secondary" strong style={{ fontSize: 12 }}>
                Financial Year
              </Text>
              {selectedFY === defaultFY && (
                <Tag color="blue" style={{ marginLeft: 4 }}>
                  Current
                </Tag>
              )}
            </div>
            <Select
              placeholder="Select Year"
              style={{ width: 200 }}
              popupMatchSelectWidth={false}
              onChange={(value) => setSelectedFY(value)}
              value={selectedFY}
              disabled={loading}
              dropdownRender={(menu) => (
                <>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
                    <Space size="small">
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={() => {
                          const prevYear = currentYear - 1
                          setSelectedFY(`${prevYear}-${(prevYear + 1).toString().slice(2)}`)
                        }}
                      >
                        Previous Year
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={() => setSelectedFY(defaultFY)}
                      >
                        Current Year
                      </Button>
                    </Space>
                  </div>
                  {menu}
                </>
              )}
            >
              {financialYears.map((fy) => (
                <Option key={fy} value={fy}>
                  {fy === defaultFY ? `${fy} (Current)` : fy}
                </Option>
              ))}
            </Select>
          </Space>
          <Space direction="vertical" align="start">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text type="secondary" strong style={{ fontSize: 12 }}>
                Unit Type
              </Text>
              {loading && <Spin size="small" style={{ marginLeft: 4 }} />}
            </div>
            <Select
              placeholder="All Types"
              style={{ width: 130 }}
              allowClear
              onChange={setSelectedUnitType}
              value={selectedUnitType}
              disabled={loading}
            >
              {UNIT_TYPE_OPTIONS.map((unitType) => (
                <Option key={unitType} value={unitType}>
                  {unitType}
                </Option>
              ))}
            </Select>
          </Space>
          <Space direction="vertical" align="start">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text type="secondary" strong style={{ fontSize: 12 }}>
                Status
              </Text>
              {loading && <Spin size="small" style={{ marginLeft: 4 }} />}
            </div>
            <Select
              placeholder="All Status"
              style={{ width: 120 }}
              allowClear
              onChange={setSelectedStatus}
              value={selectedStatus}
              disabled={loading}
            >
              <Option value="Active">Active</Option>
              <Option value="Inactive">Inactive</Option>
            </Select>
          </Space>
        </Space>
      </div>

      {/* Filter Summary Section */}
      {hasActiveFilters && (
        <div
          style={{ marginBottom: 24, padding: '12px 16px', background: '#fafafa', borderRadius: 6 }}
        >
          <Space wrap align="center">
            <Text type="secondary" style={{ fontSize: '12px', fontWeight: 500 }}>
              Active filters:
            </Text>
            {selectedProject !== undefined && (
              <Tag
                closable
                onClose={() => setSelectedProject(undefined)}
                style={{ fontSize: '12px' }}
              >
                Project: {selectedProjectName}
              </Tag>
            )}
            {selectedUnitType !== undefined && (
              <Tag
                closable
                onClose={() => setSelectedUnitType(undefined)}
                style={{ fontSize: '12px' }}
              >
                Type: {selectedUnitType}
              </Tag>
            )}
            {selectedStatus !== undefined && (
              <Tag
                closable
                onClose={() => setSelectedStatus(undefined)}
                style={{ fontSize: '12px' }}
              >
                Status: {selectedStatus}
              </Tag>
            )}
            {selectedFY !== defaultFY && (
              <Tag closable onClose={() => setSelectedFY(defaultFY)} style={{ fontSize: '12px' }}>
                FY: {selectedFY}
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

      <Row gutter={[24, 24]}>
        {statCards.map((card, index) => (
          <Col key={index} xs={24} sm={12} lg={index >= 3 ? 6 : 4}>
            <Card
              bordered={false}
              hoverable
              className="admin-stat-card"
              onClick={() => navigate(card.path)}
              style={{ height: '100%', cursor: 'pointer' }}
            >
              <Skeleton loading={loading} active paragraph={{ rows: 1 }}>
                <Tooltip title={card.tooltip}>
                  <Statistic
                    title={
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 4
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Text type="secondary" strong style={{ fontSize: 12 }}>
                            {card.title}
                          </Text>
                          {card.tooltip && (
                            <QuestionCircleOutlined style={{ fontSize: 10, color: '#bfbfbf' }} />
                          )}
                        </div>
                        <ArrowRightOutlined style={{ fontSize: 12, color: '#bfbfbf' }} />
                      </div>
                    }
                    value={card.value}
                    prefix={card.icon}
                    precision={card.isCurrency ? 2 : 0}
                    formatter={
                      card.isCurrency
                        ? (val) =>
                            `₹${Number(val).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}`
                        : undefined
                    }
                    valueStyle={{
                      color: card.color,
                      fontWeight: 700,
                      fontSize: hasActiveFilters ? '20px' : '24px'
                    }}
                  />
                  {hasActiveFilters && (
                    <Text type="secondary" style={{ fontSize: 10, marginTop: 4, display: 'block' }}>
                      Filtered view
                    </Text>
                  )}
                </Tooltip>
              </Skeleton>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[24, 24]} style={{ marginTop: 24 }}>
        <Col xs={24}>
          <Card
            title="Quick Actions"
            bordered={false}
            headStyle={{ borderBottom: '1px solid #f0f0f0' }}
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <Card
                  hoverable
                  size="small"
                  style={{
                    textAlign: 'center',
                    background: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                  onClick={() => navigate('/billing')}
                >
                  <Title level={5} style={{ margin: '8px 0' }}>
                    Generate Maintenance Letters
                  </Title>
                  <Text type="secondary">Process annual maintenance</Text>
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card
                  hoverable
                  size="small"
                  style={{
                    textAlign: 'center',
                    background: '#e6f7ff',
                    border: '1px solid #91d5ff',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                  onClick={() => navigate('/units')}
                >
                  <Title level={5} style={{ margin: '8px 0' }}>
                    Add Unit
                  </Title>
                  <Text type="secondary">Register new unit/owner</Text>
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card
                  hoverable
                  size="small"
                  style={{
                    textAlign: 'center',
                    background: '#fff7e6',
                    border: '1px solid #ffd591',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                  onClick={() => navigate('/payments')}
                >
                  <Title level={5} style={{ margin: '8px 0' }}>
                    Record Payment
                  </Title>
                  <Text type="secondary">Update collection status</Text>
                </Card>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Dashboard
