import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  Skeleton,
  Tooltip
} from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  HomeOutlined,
  UserOutlined,
  FileTextOutlined,
  ArrowRightOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { Project } from '@preload/types'
import { useAsyncOperation } from '../hooks/useAsyncOperation'
import FilterPanel, { createSelectFilter } from '../components/shared/FilterPanel'
import { useWorkingFinancialYear } from '../context/WorkingFinancialYearContext'

const { Title, Text } = Typography

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
  const { workingFY } = useWorkingFinancialYear()
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<number | undefined>(undefined)
  const [selectedUnitType, setSelectedUnitType] = useState<string | undefined>(undefined)
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(undefined)

  const defaultFY = workingFY
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
    setSelectedFY(defaultFY)
  }, [defaultFY])

  useEffect(() => {
    const fetchYears = async (): Promise<void> => {
      await executeAsync(
        async () => {
          const years = await window.api.reports.getAvailableFinancialYears(selectedProject)
          setAvailableFYs(years)
        },
        {
          errorMessage: 'Failed to load financial years',
          loadingMessage: 'Loading financial years...'
        }
      )
    }
    fetchYears()
  }, [defaultFY, executeAsync, selectedProject])

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

  const financialYears = availableFYs

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

  const dashboardFilterFields = useMemo(
    () => [
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
        'All Projects',
        {
          emptyValue: undefined,
          formatValue: (value) => {
            const project = projects.find((item) => item.id === value)
            return project?.name || ''
          }
        }
      ),
      createSelectFilter(
        'selectedFY',
        'Financial Year',
        financialYears.map((fy) => ({
          value: fy,
          label: fy === defaultFY ? `${fy} (Working)` : fy
        })),
        'Select Year',
        {
          emptyValue: defaultFY,
          isActive: (value) => value !== undefined && value !== defaultFY
        }
      ),
      createSelectFilter(
        'selectedUnitType',
        'Unit Type',
        UNIT_TYPE_OPTIONS.map((unitType) => ({ value: unitType, label: unitType })),
        'All Types',
        {
          emptyValue: undefined
        }
      ),
      createSelectFilter(
        'selectedStatus',
        'Status',
        [
          { value: 'Active', label: 'Active' },
          { value: 'Inactive', label: 'Inactive' }
        ],
        'All Status',
        {
          emptyValue: undefined
        }
      )
    ],
    [defaultFY, financialYears, projects]
  )

  const dashboardFilterValues = useMemo(
    () => ({
      selectedProject,
      selectedFY,
      selectedUnitType,
      selectedStatus
    }),
    [selectedFY, selectedProject, selectedStatus, selectedUnitType]
  )

  const handleDashboardFilterChange = useCallback(
    (key: string, value: unknown) => {
      switch (key) {
        case 'selectedProject':
          setSelectedProject((value as number | undefined) ?? undefined)
          break
        case 'selectedFY':
          setSelectedFY((value as string | undefined) ?? defaultFY)
          break
        case 'selectedUnitType':
          setSelectedUnitType((value as string | undefined) ?? undefined)
          break
        case 'selectedStatus':
          setSelectedStatus((value as string | undefined) ?? undefined)
          break
        default:
          break
      }
    },
    [defaultFY]
  )

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
      title: 'DEFAULTER UNITS',
      value: stats.pendingUnits,
      icon: <FileTextOutlined style={{ color: '#cf1322' }} />,
      color: '#cf1322',
      path: '/units',
      tooltip: 'Units with unpaid maintenance for the selected financial year'
    },
    {
      title: 'TOTAL OUTSTANDING',
      value: stats.totalOutstanding,
      icon: <FileTextOutlined style={{ color: '#cf1322' }} />,
      color: '#cf1322',
      isCurrency: true,
      path: '/reports',
      tooltip: 'Total unpaid maintenance amount across all projects'
    },
    {
      title: 'COLLECTED (FY)',
      value: stats.collectedThisYear,
      icon: <FileTextOutlined style={{ color: '#3f8600' }} />,
      color: '#3f8600',
      isCurrency: true,
      path: '/payments',
      tooltip: 'Total collected maintenance for selected financial year'
    }
  ]

  return (
    <div className="responsive-page-container page-screen" style={{ margin: '0 auto' }}>
      <div className="page-hero">
        <div className="responsive-page-header">
          <div>
            <Title level={2}>Dashboard</Title>
            <Text type="secondary" className="page-hero-subtitle">
              Welcome back! Summary for Financial Year <strong>{selectedFY}</strong>
              {selectedFY === defaultFY && ' (Working)'}
            </Text>
            <Text type="secondary" className="page-helper-text">
              Select a summary card to open the related workspace.
            </Text>
          </div>
        </div>
      </div>

      <Card className="page-toolbar-card dashboard-filter-card" variant="borderless">
        <FilterPanel
          filters={dashboardFilterFields}
          values={dashboardFilterValues}
          onChange={handleDashboardFilterChange}
          onClear={clearAllFilters}
          showActiveFilters={hasActiveFilters}
          variant="plain"
          loading={loading}
        />
      </Card>

      <Row gutter={[20, 20]} className="dashboard-stats-row">
        {statCards.map((card, index) => (
          <Col
            key={index}
            xs={24}
            sm={12}
            md={12}
            lg={8}
            xl={8}
          >
            <Card
              variant="borderless"
              hoverable
              className="admin-stat-card page-stat-card"
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                          <Text type="secondary" strong style={{ fontSize: 12 }}>
                            {card.title}
                          </Text>
                          {card.tooltip && (
                            <QuestionCircleOutlined style={{ fontSize: 14, color: '#bfbfbf' }} />
                          )}
                        </div>
                        <ArrowRightOutlined style={{ fontSize: 16, color: '#555555' }} />
                      </div>
                    }
                    value={card.value}
                    prefix={card.icon}
                    precision={card.isCurrency ? 2 : 0}
                    formatter={
                      card.isCurrency
                        ? (val) =>
                            `Rs. ${Number(val).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}`
                        : undefined
                    }
                    styles={{
                      content: {
                        color: card.color,
                        fontWeight: 700,
                        fontSize: hasActiveFilters ? '20px' : '24px'
                      }
                    }}
                  />
                  {hasActiveFilters && (
                    <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
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
            variant="borderless"
            className="page-toolbar-card"
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <Card
                  hoverable
                  size="small"
                  className="page-action-card"
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
                  className="page-action-card"
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
                  className="page-action-card"
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
