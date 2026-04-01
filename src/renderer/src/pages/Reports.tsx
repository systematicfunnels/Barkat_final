import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Row,
  Col,
  Statistic,
  Typography,
  Table,
  Space,
  Button,
  TableProps,
  Tooltip,
  message,
  Tag,
  Alert
} from 'antd'
import {
  FileExcelOutlined,
  ExclamationCircleOutlined,
  FilterOutlined,
  BarChartOutlined
} from '@ant-design/icons'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'

import {
  Project,
  FinancialReportFilters,
  FinancialReportYearlyData as YearlyData,
  FinancialReportYearlyTotal as YearlyTotal,
  FinancialReportRow as PivotData
} from '@preload/types'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'
import FilterPanel, {
  createRangeFilter,
  createSearchFilter,
  createSelectFilter
} from '../components/shared/FilterPanel'

const { Title, Text } = Typography

const Reports: React.FC = () => {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [selectedUnitType, setSelectedUnitType] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [outstandingRange, setOutstandingRange] = useState<[number | null, number | null]>([
    null,
    null
  ])

  const [pivotData, setPivotData] = useState<PivotData[]>([])
  const [years, setYears] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [pageSize, setPageSize] = useState(20)
  const [exporting, setExporting] = useState(false)
  const [screenWidth, setScreenWidth] = useState(window.innerWidth)
  const [searchText, setSearchText] = useState('')

  const [stats, setStats] = useState({
    totalBilled: 0,
    totalCollected: 0,
    outstanding: 0
  })

  const [yearlyTotals, setYearlyTotals] = useState<YearlyTotal[]>([])

  const selectedProjectRecord = useMemo(
    () => projects.find((project) => project.id === selectedProject) || null,
    [projects, selectedProject]
  )

  // Handle screen resize for responsive columns
  useEffect(() => {
    const handleResize = (): void => setScreenWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Get selected project name for display
  const selectedProjectName = useMemo(() => {
    return selectedProjectRecord?.name || ''
  }, [selectedProjectRecord])

  // Get unique unit types for filter
  const unitTypes = useMemo(() => {
    return Array.from(
      new Set(pivotData.map((row) => row.unit_type).filter((type): type is string => Boolean(type)))
    ).sort()
  }, [pivotData])

  const reportFilterFields = useMemo(
    () => [
      createSearchFilter('searchText', 'Search', 'Search unit, owner, or project...'),
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
        'selectedStatus',
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
        unitTypes.map((type) => ({ value: type, label: type })),
        'Unit Type',
        {
          emptyValue: null
        }
      ),
      createRangeFilter('outstandingRange', 'Outstanding', {
        emptyValue: [null, null],
        minPlaceholder: 'Min Outstanding',
        maxPlaceholder: 'Max Outstanding',
        isActive: (value) =>
          Array.isArray(value) && (value[0] !== null || value[1] !== null),
        formatValue: (value) => {
          const [min, max] = Array.isArray(value) ? value : [null, null]
          return `${min !== null ? `Rs. ${min}` : 'Any'} - ${max !== null ? `Rs. ${max}` : 'Any'}`
        }
      })
    ],
    [projects, unitTypes]
  )

  const reportFilterValues = useMemo(
    () => ({
      selectedProject,
      selectedStatus,
      selectedUnitType,
      searchText,
      outstandingRange
    }),
    [
      searchText,
      selectedProject,
      selectedUnitType,
      selectedStatus,
      outstandingRange
    ]
  )

  const handleReportFilterChange = useCallback((key: string, value: unknown) => {
    switch (key) {
      case 'selectedProject':
        setSelectedProject((value as number | null | undefined) ?? null)
        break
      case 'selectedStatus':
        setSelectedStatus((value as string | null | undefined) ?? null)
        break
      case 'selectedUnitType':
        setSelectedUnitType((value as string | null | undefined) ?? null)
        break
      case 'searchText':
        setSearchText(typeof value === 'string' ? value : '')
        break
      case 'outstandingRange':
        if (Array.isArray(value)) {
          setOutstandingRange([
            typeof value[0] === 'number' ? value[0] : null,
            typeof value[1] === 'number' ? value[1] : null
          ])
        }
        break
      default:
        break
    }
  }, [])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return Boolean(
      searchText ||
      selectedProject !== null ||
      selectedUnitType !== null ||
      selectedStatus !== null ||
      outstandingRange[0] !== null ||
      outstandingRange[1] !== null
    )
  }, [
    searchText,
    selectedProject,
    selectedUnitType,
    selectedStatus,
    outstandingRange
  ])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setSelectedProject(null)
    setSelectedUnitType(null)
    setSelectedStatus(null)
    setOutstandingRange([null, null])
  }, [])

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const filters: FinancialReportFilters = {
        searchText,
        selectedUnitType,
        selectedStatus,
        outstandingRange
      }
      const [allProjects, reportSummary] = await Promise.all([
        window.api.projects.getAll(),
        window.api.reports.getFinancialSummary(selectedProject || undefined, filters)
      ])

      setProjects(allProjects)
      setYears(reportSummary.years)
      setPivotData(reportSummary.rows)
      setStats(reportSummary.stats)
      setYearlyTotals(reportSummary.yearlyTotals)
    } catch (error) {
      console.error('Failed to fetch report data:', error)
      message.error('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [outstandingRange, searchText, selectedProject, selectedStatus, selectedUnitType])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const exportToExcel = async (): Promise<void> => {
    if (pivotData.length === 0) {
      message.warning('No data to export')
      return
    }

    setExporting(true)
    try {
      const workbook = new ExcelJS.Workbook()
      const worksheetName = hasActiveFilters ? 'Filtered Financial Report' : 'Financial Report'
      const worksheet = workbook.addWorksheet(worksheetName)

      // Add Yearly Summary Sheet
      const summarySheet = workbook.addWorksheet('Yearly Summary')

      // Yearly Summary Sheet
      summarySheet.columns = [
        { header: 'Financial Year', key: 'year', width: 20 },
        { header: 'Units Billed', key: 'unitCount', width: 15 },
        { header: 'Total Billed', key: 'billed', width: 15 },
        { header: 'Total Collected', key: 'paid', width: 15 },
        { header: 'Outstanding', key: 'balance', width: 15 },
        { header: 'Collection %', key: 'collectionRate', width: 15 }
      ]

      // Validate yearly totals calculation
      yearlyTotals.forEach((total) => {
      const collectionRate = total.billed > 0 ? (total.paid / total.billed) * 100 : 0
        summarySheet.addRow({
          year: total.year,
          unitCount: total.unitCount,
          billed: total.billed,
          paid: total.paid,
          balance: total.balance,
          collectionRate: `${collectionRate.toFixed(1)}%`
        })
      })

      // Add summary totals row with validation
      const totalBilled = yearlyTotals.reduce((sum, t) => sum + t.billed, 0)
      const totalPaid = yearlyTotals.reduce((sum, t) => sum + t.paid, 0)
      const totalBalance = yearlyTotals.reduce((sum, t) => sum + t.balance, 0)
      const totalUnits = yearlyTotals.reduce((sum, t) => sum + t.unitCount, 0)
      const overallCollectionRate = totalBilled > 0 ? (totalPaid / totalBilled) * 100 : 0

      // Validate that totals match the expected calculations
      const calculatedTotalBalance = totalBilled - totalPaid
      if (calculatedTotalBalance !== totalBalance) {
        console.warn(
          `Balance calculation mismatch: Expected ${calculatedTotalBalance}, Got ${totalBalance}`
        )
      }

      summarySheet.addRow({})
      const totalRow = summarySheet.addRow({
        year: 'GRAND TOTAL',
        unitCount: totalUnits,
        billed: totalBilled,
        paid: totalPaid,
        balance: totalBalance,
        collectionRate: `${overallCollectionRate.toFixed(1)}%`
      })

      totalRow.font = { bold: true }
      totalRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      }

      // Main Detailed Sheet
      const columns = [
        { header: 'Project', key: 'Project', width: 20 },
        { header: 'Unit', key: 'Unit', width: 15 },
        { header: 'Owner', key: 'Owner', width: 25 },
        { header: 'Type', key: 'Type', width: 10 },
        { header: 'Status', key: 'Status', width: 10 }
      ]

      years.forEach((year) => {
        columns.push({ header: `${year} - Billed`, key: `${year}_Billed`, width: 15 })
        columns.push({ header: `${year} - Paid`, key: `${year}_Paid`, width: 15 })
        columns.push({ header: `${year} - Balance`, key: `${year}_Balance`, width: 15 })
      })

      columns.push({ header: 'Total Billed', key: 'Total_Billed', width: 15 })
      columns.push({ header: 'Total Paid', key: 'Total_Paid', width: 15 })
      columns.push({ header: 'Total Outstanding', key: 'Total_Outstanding', width: 15 })

      worksheet.columns = columns

      const filterSummaryRows: string[][] = []
      if (hasActiveFilters) {
        filterSummaryRows.push(['FILTERED FINANCIAL REPORT'])
        filterSummaryRows.push([`Generated: ${dayjs().format('DD/MM/YYYY HH:mm')}`])

        if (selectedProject) {
          filterSummaryRows.push([`Project: ${selectedProjectName}`])
        }
        if (selectedUnitType) {
          filterSummaryRows.push([`Unit Type: ${selectedUnitType}`])
        }
        if (selectedStatus) {
          filterSummaryRows.push([`Status: ${selectedStatus}`])
        }
        if (searchText) {
          filterSummaryRows.push([`Search: "${searchText}"`])
        }
        if (outstandingRange[0] !== null || outstandingRange[1] !== null) {
          filterSummaryRows.push([
            `Outstanding Range: ${outstandingRange[0] !== null ? `Rs. ${outstandingRange[0]}` : 'Any'} - ${outstandingRange[1] !== null ? `Rs. ${outstandingRange[1]}` : 'Any'}`
          ])
        }

        filterSummaryRows.push([''])
      }

      if (filterSummaryRows.length > 0) {
        worksheet.insertRows(1, filterSummaryRows)
      }

      // Add rows with validation
      let grandTotalBilled = 0
      let grandTotalPaid = 0
      let grandTotalOutstanding = 0

      pivotData.forEach((row) => {
        const exportRow: Record<string, string | number> = {
          Project: row.project_name,
          Unit: row.unit_number,
          Owner: row.owner_name,
          Type: row.unit_type,
          Status: row.unit_status,
          Total_Billed: row.total_billed,
          Total_Paid: row.total_paid,
          Total_Outstanding: row.outstanding
        }

        // Validate individual row calculations
        const calculatedOutstanding = row.total_billed - row.total_paid
        if (Math.abs(calculatedOutstanding - row.outstanding) > 0.01) {
          console.warn(
            `Row ${row.unit_number} outstanding mismatch: Expected ${calculatedOutstanding}, Got ${row.outstanding}`
          )
        }

        grandTotalBilled += row.total_billed
        grandTotalPaid += row.total_paid
        grandTotalOutstanding += row.outstanding

        years.forEach((year) => {
          const yearData = row[year] as YearlyData
          const billed = yearData?.billed || 0
          const paid = yearData?.paid || 0
          const balance = yearData?.balance || 0

          // Validate yearly data consistency
          const calculatedBalance = billed - paid
          if (Math.abs(calculatedBalance - balance) > 0.01) {
            console.warn(
              `Row ${row.unit_number} year ${year} balance mismatch: Expected ${calculatedBalance}, Got ${balance}`
            )
          }

          exportRow[`${year}_Billed`] = billed
          exportRow[`${year}_Paid`] = paid
          exportRow[`${year}_Balance`] = balance
        })

        worksheet.addRow(exportRow)
      })

      // Add summary row with validation
      const summaryRow = worksheet.addRow({})
      summaryRow.getCell('Project').value = 'GRAND TOTAL'
      summaryRow.getCell('Project').font = { bold: true }

      years.forEach((year) => {
        const billedCol = `${year}_Billed`
        const paidCol = `${year}_Paid`
        const balanceCol = `${year}_Balance`

        const totalBilled = pivotData.reduce((sum, row) => {
          const yearData = row[year] as YearlyData
          return sum + (yearData?.billed || 0)
        }, 0)

        const totalPaid = pivotData.reduce((sum, row) => {
          const yearData = row[year] as YearlyData
          return sum + (yearData?.paid || 0)
        }, 0)

        const totalBalance = pivotData.reduce((sum, row) => {
          const yearData = row[year] as YearlyData
          return sum + (yearData?.balance || 0)
        }, 0)

        // Validate yearly totals consistency
        const calculatedTotalBalance = totalBilled - totalPaid
        if (Math.abs(calculatedTotalBalance - totalBalance) > 0.01) {
          console.warn(
            `Year ${year} balance mismatch: Expected ${calculatedTotalBalance}, Got ${totalBalance}`
          )
        }

        summaryRow.getCell(billedCol).value = totalBilled
        summaryRow.getCell(paidCol).value = totalPaid
        summaryRow.getCell(balanceCol).value = totalBalance

        summaryRow.getCell(billedCol).font = { bold: true }
        summaryRow.getCell(paidCol).font = { bold: true }
        summaryRow.getCell(balanceCol).font = { bold: true }
      })

      // Validate final totals
      if (Math.abs(grandTotalBilled - stats.totalBilled) > 0.01) {
        console.warn(
          `Grand total billed mismatch: Expected ${stats.totalBilled}, Got ${grandTotalBilled}`
        )
      }
      if (Math.abs(grandTotalPaid - stats.totalCollected) > 0.01) {
        console.warn(
          `Grand total paid mismatch: Expected ${stats.totalCollected}, Got ${grandTotalPaid}`
        )
      }
      if (Math.abs(grandTotalOutstanding - stats.outstanding) > 0.01) {
        console.warn(
          `Grand total outstanding mismatch: Expected ${stats.outstanding}, Got ${grandTotalOutstanding}`
        )
      }

      summaryRow.getCell('Total_Billed').value = stats.totalBilled
      summaryRow.getCell('Total_Paid').value = stats.totalCollected
      summaryRow.getCell('Total_Outstanding').value = stats.outstanding

      summaryRow.getCell('Total_Billed').font = { bold: true }
      summaryRow.getCell('Total_Paid').font = { bold: true }
      summaryRow.getCell('Total_Outstanding').font = { bold: true }

      // Style the headers
      const headerRowNumber = filterSummaryRows.length + 1
      worksheet.getRow(headerRowNumber).font = { bold: true }
      worksheet.getRow(headerRowNumber).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      }

      summarySheet.getRow(1).font = { bold: true }
      summarySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      }

      // Generate buffer and save
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url

      const sanitizedProjectName = selectedProjectName
        .split('')
        .filter((char) => !/[<>:"/\\|?*]/.test(char) && char.charCodeAt(0) >= 32)
        .join('')
        .trim()
        .replace(/\s+/g, '_')

      let filename = `Financial_Report_${dayjs().format('YYYY-MM-DD')}`
      if (hasActiveFilters) {
        filename = `Filtered_Report_${dayjs().format('YYYY-MM-DD')}`
        if (sanitizedProjectName) {
          filename = `${sanitizedProjectName}_Report_${dayjs().format('YYYY-MM-DD')}`
        }
      }

      anchor.download = `${filename}.xlsx`
      anchor.click()
      window.URL.revokeObjectURL(url)

      // Show completion notification using utility
      showCompletionWithNextStep(
        'reports',
        'Report exported successfully',
        navigate,
        'Excel file exported with yearly summary'
      )
    } catch (error) {
      console.error('Failed to export Excel:', error)
      message.error('Failed to export Excel file')
    } finally {
      setExporting(false)
    }
  }

  // Determine if we should collapse years on mobile
  const shouldCollapseYears = screenWidth < 768
  const visibleYears = shouldCollapseYears ? [] : years

  const columns = [
    {
      title: 'Project',
      dataIndex: 'project_name',
      key: 'project_name',
      fixed: 'left' as const,
      width: 150,
      ellipsis: true,
      sorter: (a: PivotData, b: PivotData) =>
        (a.project_name || '').localeCompare(b.project_name || '')
    },
    {
      title: 'Unit',
      dataIndex: 'unit_number',
      key: 'unit_number',
      fixed: 'left' as const,
      width: 100,
      sorter: (a: PivotData, b: PivotData) => a.unit_number.localeCompare(b.unit_number),
      render: (unitNumber: string, record: PivotData) => (
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
      fixed: 'left' as const,
      width: 200,
      ellipsis: true,
      sorter: (a: PivotData, b: PivotData) => a.owner_name.localeCompare(b.owner_name),
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
      width: 80,
      render: (type: string) => <Tag color="blue">{type}</Tag>
    },
    {
      title: 'Status',
      dataIndex: 'unit_status',
      key: 'unit_status',
      width: 80,
      render: (status: string) => <Tag color={status === 'Sold' ? 'green' : 'red'}>{status}</Tag>
    },
    // Yearly columns - now with all three metrics
    ...visibleYears.map((year) => ({
      title: year,
      children: [
        {
          title: 'Billed',
          key: `${year}_billed`,
          width: 100,
          align: 'right' as const,
          render: (row: PivotData) => {
            const yearData = row[year] as YearlyData
            const billed = yearData?.billed || 0
            return <Text>{billed > 0 ? `Rs. ${billed.toLocaleString()}` : '-'}</Text>
          }
        },
        {
          title: 'Paid',
          key: `${year}_paid`,
          width: 100,
          align: 'right' as const,
          render: (row: PivotData) => {
            const yearData = row[year] as YearlyData
            const paid = yearData?.paid || 0
            return <Text type="success">{paid > 0 ? `Rs. ${paid.toLocaleString()}` : '-'}</Text>
          }
        },
        {
          title: 'Balance',
          key: `${year}_bal`,
          width: 100,
          align: 'right' as const,
          render: (row: PivotData) => {
            const yearData = row[year] as YearlyData
            const balance = yearData?.balance || 0
            return (
              <Tooltip
                title={`Billed: Rs. ${yearData?.billed?.toLocaleString() || '0'} | Paid: Rs. ${yearData?.paid?.toLocaleString() || '0'}`}
              >
                <Text
                  type={balance > 0 ? 'danger' : balance < 0 ? 'warning' : 'success'}
                  style={{ fontSize: '12px' }}
                >
                  {balance !== 0 ? `Rs. ${Math.abs(balance).toLocaleString()}` : '-'}
                  {balance > 0 && <ExclamationCircleOutlined style={{ marginLeft: 4 }} />}
                </Text>
              </Tooltip>
            )
          }
        }
      ]
    })),
    {
      title: 'Total Billed',
      dataIndex: 'total_billed',
      key: 'total_billed',
      width: 120,
      align: 'right' as const,
      render: (val: number) => `Rs. ${val.toLocaleString()}`,
      sorter: (a: PivotData, b: PivotData) => a.total_billed - b.total_billed
    },
    {
      title: 'Total Paid',
      dataIndex: 'total_paid',
      key: 'total_paid',
      width: 120,
      align: 'right' as const,
      render: (val: number) => `Rs. ${val.toLocaleString()}`,
      sorter: (a: PivotData, b: PivotData) => a.total_paid - b.total_paid
    },
    {
      title: 'Total Outstanding',
      dataIndex: 'outstanding',
      key: 'outstanding',
      fixed: 'right' as const,
      width: 120,
      align: 'right' as const,
      render: (val: number) => (
        <Text strong type={val > 0 ? 'danger' : val < 0 ? 'warning' : 'success'}>
          Rs. {val.toLocaleString()}
        </Text>
      ),
      sorter: (a: PivotData, b: PivotData) => a.outstanding - b.outstanding
    }
  ]

  return (
    <div className="page-screen">
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
              Financial Reports
            </Title>
            <Text type="secondary" className="page-hero-subtitle">
              Analyze billed, collected, and outstanding amounts across projects and financial years.
            </Text>
            <Text
              type="secondary"
              className="page-helper-text"
              style={{ display: 'block', marginTop: 8 }}
            >
              Start with the summary cards, then drill into the pivot ledger for unit-level detail.
            </Text>
          </div>
          <Space className="responsive-action-bar">
            <Button
              icon={<FileExcelOutlined />}
              onClick={exportToExcel}
              disabled={pivotData.length === 0 || exporting}
              loading={exporting}
            >
              {exporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          </Space>
        </div>
      </div>

      <Card style={{ marginBottom: 0 }} className="page-toolbar-card reports-filter-card">
        <FilterPanel
          filters={reportFilterFields}
          values={reportFilterValues}
          onChange={handleReportFilterChange}
          onClear={clearAllFilters}
          showActiveFilters={hasActiveFilters}
          loading={loading}
          variant="plain"
        />
      </Card>

      {/* Yearly Summary Cards */}
      {yearlyTotals.length > 0 && (
        <Card
          title={
            <>
              <BarChartOutlined /> Yearly Summary
            </>
          }
          style={{ marginBottom: 24 }}
          bodyStyle={{ padding: '16px 16px 12px' }}
          className="page-toolbar-card report-summary-card"
        >
          <div className="report-summary-grid">
            {yearlyTotals.map((total) => {
              const collectionRate = total.billed > 0 ? (total.paid / total.billed) * 100 : 0
              return (
                <div key={total.year}>
                  <Card
                    size="small"
                    bordered
                    className="page-stat-card report-year-card"
                  >
                    <div className="report-year-card-header">
                      <div className="report-year-card-meta">
                        <Text strong className="report-year-card-title">
                          {total.year}
                        </Text>
                        <Text type="secondary" className="report-year-card-subtitle">
                          {total.unitCount} units billed
                        </Text>
                      </div>
                      <Tag
                        className="report-year-card-rate"
                        color={
                          collectionRate >= 90
                            ? 'success'
                            : collectionRate >= 70
                              ? 'warning'
                              : 'error'
                        }
                      >
                        {collectionRate.toFixed(1)}%
                      </Tag>
                    </div>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <div className="report-year-card-row">
                        <Text type="secondary">Billed:</Text>
                        <Text strong className="report-year-card-value">
                          Rs. {total.billed.toLocaleString()}
                        </Text>
                      </div>
                      <div className="report-year-card-row">
                        <Text type="secondary">Collected:</Text>
                        <Text type="success" className="report-year-card-value">
                          Rs. {total.paid.toLocaleString()}
                        </Text>
                      </div>
                      <div className="report-year-card-row">
                        <Text type="secondary">Outstanding:</Text>
                        <Text
                          type={total.balance > 0 ? 'danger' : 'success'}
                          className="report-year-card-value"
                        >
                          Rs. {total.balance.toLocaleString()}
                        </Text>
                      </div>
                    </Space>
                  </Card>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="report-stat-card billed page-stat-card">
            <Statistic
              title="TOTAL BILLED"
              value={stats.totalBilled}
              precision={0}
              prefix="Rs. "
              valueStyle={{ fontSize: '24px' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="report-stat-card collected page-stat-card">
            <Statistic
              title="TOTAL COLLECTED"
              value={stats.totalCollected}
              precision={0}
              prefix="Rs. "
              valueStyle={{ color: '#3f8600', fontSize: '24px' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="report-stat-card outstanding page-stat-card">
            <Statistic
              title="TOTAL OUTSTANDING"
              value={stats.outstanding}
              precision={0}
              prefix="Rs. "
              valueStyle={{
                color: stats.outstanding > 0 ? '#cf1322' : '#3f8600',
                fontSize: '24px'
              }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <FilterOutlined />
            <span>Unit-wise Pivot Ledger</span>
            {hasActiveFilters && <Tag color="blue">Filtered</Tag>}
          </Space>
        }
        bodyStyle={{ padding: 0 }}
        className="page-table-card report-ledger-card"
        extra={
          shouldCollapseYears && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Showing totals only on smaller screens
            </Text>
          )
        }
      >
        <Text className="page-helper-text" style={{ display: 'block', margin: '16px 16px 0' }}>
          {shouldCollapseYears
            ? 'On smaller widths, review the yearly summary cards first. The ledger below shows totals only to keep the table readable.'
            : 'Use the yearly columns below for detailed billed, paid, and balance review across each financial year.'}
        </Text>
        <Alert
          message={
            shouldCollapseYears
              ? 'Mobile view shows totals only. Use the summary cards or export Excel for full year-by-year detail.'
              : 'Table shows Billed, Paid, and Balance for each financial year'
          }
          type="info"
          showIcon
          style={{ margin: '16px', marginBottom: 0 }}
        />
        <div className="table-scroll-wrapper mobile-card-table">
          <Table
            columns={columns as TableProps<PivotData>['columns']}
            dataSource={pivotData}
            loading={loading}
            pagination={{ 
              pageSize: pageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              onShowSizeChange: (_, size) => setPageSize(size)
            }}
            scroll={{ x: 'max-content', y: 'calc(100vh - 600px)' }}
            size="small"
            bordered
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={5}>
                    <Text strong>
                      {hasActiveFilters ? 'APPLIED TOTAL' : 'GRAND TOTAL'}
                      {hasActiveFilters && ` (${pivotData.length} units)`}
                    </Text>
                  </Table.Summary.Cell>
                  {visibleYears.map((year, index) => {
                    const yearlyTotal = yearlyTotals.find((t) => t.year === year)
                    return (
                      <React.Fragment key={year}>
                        <Table.Summary.Cell index={index * 3 + 5} align="right">
                          <Text>Rs. {yearlyTotal?.billed.toLocaleString() || '0'}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={index * 3 + 6} align="right">
                          <Text type="success">Rs. {yearlyTotal?.paid.toLocaleString() || '0'}</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={index * 3 + 7} align="right">
                          <Text
                            type={
                              yearlyTotal?.balance && yearlyTotal.balance > 0 ? 'danger' : 'success'
                            }
                          >
                            Rs. {yearlyTotal?.balance.toLocaleString() || '0'}
                          </Text>
                        </Table.Summary.Cell>
                      </React.Fragment>
                    )
                  })}
                  <Table.Summary.Cell index={visibleYears.length * 3 + 5} align="right">
                    <Text strong>Rs. {stats.totalBilled.toLocaleString()}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={visibleYears.length * 3 + 6} align="right">
                    <Text strong type="success">
                      Rs. {stats.totalCollected.toLocaleString()}
                    </Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={visibleYears.length * 3 + 7} align="right">
                    <Text strong type={stats.outstanding > 0 ? 'danger' : 'success'}>
                      Rs. {stats.outstanding.toLocaleString()}
                    </Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </div>
      </Card>
    </div>
  )
}

export default Reports
