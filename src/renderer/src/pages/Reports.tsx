import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Row,
  Col,
  Statistic,
  Typography,
  Table,
  Select,
  Space,
  Button,
  TableProps,
  Tooltip,
  message,
  Input,
  Tag,
  InputNumber,
  Alert
} from 'antd'
import {
  FileExcelOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  FilterOutlined,
  BarChartOutlined
} from '@ant-design/icons'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'

import { Project, Unit } from '@preload/types'
import { showCompletionWithNextStep } from '../utils/workflowGuidance'

const { Title, Text } = Typography
const { Option } = Select
const { Search } = Input

interface YearlyData {
  billed: number
  paid: number
  balance: number
}

interface YearlyTotal {
  year: string
  billed: number
  paid: number
  balance: number
  unitCount: number
}

interface PivotData {
  key: string
  unit_number: string
  owner_name: string
  project_name: string
  unit_type: string
  unit_status: string
  [year: string]: string | number | YearlyData
  total_billed: number
  total_paid: number
  outstanding: number
}

const Reports: React.FC = () => {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [allUnits, setAllUnits] = useState<Unit[]>([])
  const [selectedProject, setSelectedProject] = useState<number | null>(null)
  const [selectedUnitType, setSelectedUnitType] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [selectedYears, setSelectedYears] = useState<string[]>([])
  const [outstandingRange, setOutstandingRange] = useState<[number | null, number | null]>([
    null,
    null
  ])

  const [pivotData, setPivotData] = useState<PivotData[]>([])
  const [allPivotData, setAllPivotData] = useState<PivotData[]>([])
  const [years, setYears] = useState<string[]>([])
  const [availableYears, setAvailableYears] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [screenWidth, setScreenWidth] = useState(window.innerWidth)
  const [searchText, setSearchText] = useState('')

  const [stats, setStats] = useState({
    totalBilled: 0,
    totalCollected: 0,
    outstanding: 0
  })

  const [yearlyTotals, setYearlyTotals] = useState<YearlyTotal[]>([])

  // Handle screen resize for responsive columns
  useEffect(() => {
    const handleResize = (): void => setScreenWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Get selected project name for display
  const selectedProjectName = useMemo(() => {
    if (!selectedProject) return ''
    const project = projects.find((p) => p.id === selectedProject)
    return project?.name || ''
  }, [selectedProject, projects])

  // Get unique unit types for filter
  const unitTypes = useMemo(() => {
    return Array.from(new Set(allUnits.map((u) => u.unit_type).filter(Boolean))).sort()
  }, [allUnits])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      searchText ||
      selectedProject !== null ||
      selectedUnitType !== null ||
      selectedStatus !== null ||
      selectedYears.length > 0 ||
      outstandingRange[0] !== null ||
      outstandingRange[1] !== null
    )
  }, [
    searchText,
    selectedProject,
    selectedUnitType,
    selectedStatus,
    selectedYears,
    outstandingRange
  ])

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchText('')
    setSelectedProject(null)
    setSelectedUnitType(null)
    setSelectedStatus(null)
    setSelectedYears([])
    setOutstandingRange([null, null])
  }, [])

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      // Always load projects and units for filter dropdowns
      const [allProjects, unitsData] = await Promise.all([
        window.api.projects.getAll(),
        window.api.units.getAll()
      ])

      setProjects(allProjects)
      setAllUnits(unitsData)

      // Load letters + payments — scoped to selected project if one is chosen
      // This prevents loading 8000+ rows when only one project's data is needed
      const [allLetters, allPayments] = selectedProject
        ? await Promise.all([
            (await window.api.letters.getAll()).filter(l => l.project_id === selectedProject),
            (await window.api.payments.getAll()).filter(p => p.project_id === selectedProject)
          ])
        : await Promise.all([
            window.api.letters.getAll(),
            window.api.payments.getAll()
          ])

      // Get all available financial years from letters
      const allYears = Array.from(new Set(allLetters.map((l) => l.financial_year))).sort() as string[]
      setAvailableYears(allYears)

      // Default to last 3 years for better UX
      const recentYears = allYears.slice(-3) as string[]
      setSelectedYears(recentYears)
      setYears(recentYears)

      // Prepare all pivot data (unfiltered)
      const allData: PivotData[] = unitsData.map((unit) => {
        const row: PivotData = {
          key: String(unit.id),
          unit_number: unit.unit_number,
          owner_name: unit.owner_name,
          project_name: unit.project_name || 'N/A',
          unit_type: unit.unit_type || 'Plot',
          unit_status: unit.status || 'Sold',
          total_billed: 0,
          total_paid: 0,
          outstanding: 0
        }

        allYears.forEach((year) => {
          const letter = allLetters.find((l) => l.unit_id === unit.id && l.financial_year === year)
          const paymentsForYear = allPayments.filter(
            (p) => p.unit_id === unit.id && p.financial_year === year
          )

          const billed = letter ? letter.final_amount : 0
          const paid = paymentsForYear.reduce((sum, p) => sum + p.payment_amount, 0)
          const balance = billed - paid

          ;(row as any)[year] = { billed, paid, balance }
          row.total_billed += billed
          row.total_paid += paid
        })

        row.outstanding = row.total_billed - row.total_paid
        return row
      })

      setAllPivotData(allData)

      // Calculate initial stats from all data
      const totalBilled = allData.reduce((sum, row) => sum + row.total_billed, 0)
      const totalCollected = allData.reduce((sum, row) => sum + row.total_paid, 0)
      setStats({
        totalBilled,
        totalCollected,
        outstanding: totalBilled - totalCollected
      })

      // Calculate yearly totals
      calculateYearlyTotals(allData, allYears as string[])

      // Set initial filtered data (all data)
      setPivotData(allData)
    } catch (error) {
      console.error('Failed to fetch report data:', error)
      message.error('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [selectedProject])

  const calculateYearlyTotals = (data: PivotData[], yearsToCalculate: string[]): void => {
    const totals: YearlyTotal[] = yearsToCalculate.map((year) => {
      const billed = data.reduce((sum, row) => {
        const yearData = row[year] as YearlyData
        return sum + (yearData?.billed || 0)
      }, 0)

      const paid = data.reduce((sum, row) => {
        const yearData = row[year] as YearlyData
        return sum + (yearData?.paid || 0)
      }, 0)

      const balance = data.reduce((sum, row) => {
        const yearData = row[year] as YearlyData
        return sum + (yearData?.balance || 0)
      }, 0)

      const unitCount = data.filter((row) => {
        const yearData = row[year] as YearlyData
        return yearData?.billed && yearData.billed > 0
      }).length

      // Validate yearly calculations
      const calculatedBalance = billed - paid
      if (Math.abs(calculatedBalance - balance) > 0.01) {
        console.warn(`Year ${year} balance mismatch: Expected ${calculatedBalance}, Got ${balance}`)
      }

      return {
        year,
        billed,
        paid,
        balance,
        unitCount
      }
    })

    setYearlyTotals(totals)
  }

  // Apply filters whenever filter states change
  useEffect(() => {
    if (allPivotData.length === 0) return

    // Update years based on selection
    if (selectedYears.length > 0) {
      setYears(selectedYears)
    } else {
      setYears(availableYears)
    }

    const filteredData = allPivotData.filter((row) => {
      // Search filter
      const matchSearch =
        !searchText ||
        row.unit_number.toLowerCase().includes(searchText.toLowerCase()) ||
        row.owner_name.toLowerCase().includes(searchText.toLowerCase()) ||
        row.project_name.toLowerCase().includes(searchText.toLowerCase())

      // Project filter
      const matchProject =
        !selectedProject ||
        row.project_name === projects.find((p) => p.id === selectedProject)?.name

      // Unit type filter
      const matchUnitType = !selectedUnitType || row.unit_type === selectedUnitType

      // Status filter
      const matchStatus = !selectedStatus || row.unit_status === selectedStatus

      // Year filter - check if unit has data in selected years
      const matchYears =
        selectedYears.length === 0 ||
        selectedYears.some((year) => {
          const yearData = row[year] as YearlyData
          return yearData && (yearData.billed > 0 || yearData.paid > 0)
        })

      // Outstanding range filter
      const matchMinOutstanding =
        outstandingRange[0] === null || row.outstanding >= outstandingRange[0]
      const matchMaxOutstanding =
        outstandingRange[1] === null || row.outstanding <= outstandingRange[1]

      return (
        matchSearch &&
        matchProject &&
        matchUnitType &&
        matchStatus &&
        matchYears &&
        matchMinOutstanding &&
        matchMaxOutstanding
      )
    })

    setPivotData(filteredData)

    // Update stats based on filtered data
    const totalBilled = filteredData.reduce((sum, row) => sum + row.total_billed, 0)
    const totalCollected = filteredData.reduce((sum, row) => sum + row.total_paid, 0)
    setStats({
      totalBilled,
      totalCollected,
      outstanding: totalBilled - totalCollected
    })

    // Calculate yearly totals for filtered data
    const yearsToCalculate = selectedYears.length > 0 ? selectedYears : availableYears
    calculateYearlyTotals(filteredData, yearsToCalculate)
  }, [
    allPivotData,
    searchText,
    selectedProject,
    selectedUnitType,
    selectedStatus,
    selectedYears,
    outstandingRange,
    projects,
    availableYears
  ])

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
      if (Math.abs(calculatedTotalBalance - totalBalance) > 0.01) {
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

      // Add filter information if any filters are active
      if (hasActiveFilters) {
        worksheet.addRow(['FILTERED FINANCIAL REPORT'])
        worksheet.addRow([`Generated: ${dayjs().format('DD/MM/YYYY HH:mm')}`])

        if (selectedProject) {
          worksheet.addRow([`Project: ${selectedProjectName}`])
        }
        if (selectedUnitType) {
          worksheet.addRow([`Unit Type: ${selectedUnitType}`])
        }
        if (selectedStatus) {
          worksheet.addRow([`Status: ${selectedStatus}`])
        }
        if (selectedYears.length > 0) {
          worksheet.addRow([`Years: ${selectedYears.join(', ')}`])
        }
        if (searchText) {
          worksheet.addRow([`Search: "${searchText}"`])
        }
        if (outstandingRange[0] !== null || outstandingRange[1] !== null) {
          worksheet.addRow([
            `Outstanding Range: ${outstandingRange[0] !== null ? `₹${outstandingRange[0]}` : 'Any'} - ${outstandingRange[1] !== null ? `₹${outstandingRange[1]}` : 'Any'}`
          ])
        }

        worksheet.addRow([]) // Empty row
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
      const headerRowNumber = hasActiveFilters ? 9 : 1
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

      let filename = `Financial_Report_${dayjs().format('YYYY-MM-DD')}`
      if (hasActiveFilters) {
        filename = `Filtered_Report_${dayjs().format('YYYY-MM-DD')}`
        if (selectedProjectName) {
          filename = `${selectedProjectName.replace(/\s+/g, '_')}_Report_${dayjs().format('YYYY-MM-DD')}`
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
    ...years.map((year) => ({
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
            return <Text>{billed > 0 ? `₹${billed.toLocaleString()}` : '-'}</Text>
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
            return <Text type="success">{paid > 0 ? `₹${paid.toLocaleString()}` : '-'}</Text>
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
                title={`Billed: ₹${yearData?.billed?.toLocaleString() || '0'} | Paid: ₹${yearData?.paid?.toLocaleString() || '0'}`}
              >
                <Text
                  type={balance > 0 ? 'danger' : balance < 0 ? 'warning' : 'success'}
                  style={{ fontSize: '12px' }}
                >
                  {balance !== 0 ? `₹${Math.abs(balance).toLocaleString()}` : '-'}
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
      render: (val: number) => `₹${val.toLocaleString()}`,
      sorter: (a: PivotData, b: PivotData) => a.total_billed - b.total_billed
    },
    {
      title: 'Total Paid',
      dataIndex: 'total_paid',
      key: 'total_paid',
      width: 120,
      align: 'right' as const,
      render: (val: number) => `₹${val.toLocaleString()}`,
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
          ₹{val.toLocaleString()}
        </Text>
      ),
      sorter: (a: PivotData, b: PivotData) => a.outstanding - b.outstanding
    }
  ]

  return (
    <div style={{ padding: '0 8px' }}>
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
        <Title level={2} style={{ margin: 0 }}>
          Financial Reports
        </Title>
        <Space>
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

      <Card style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <Space wrap size="middle">
            <Search
              placeholder="Search unit, owner, or project..."
              prefix={<SearchOutlined />}
              style={{ width: '100%', minWidth: 200, maxWidth: 280 }}
              allowClear
              onChange={(e) => setSearchText(e.target.value)}
              onSearch={setSearchText}
              value={searchText}
              enterButton
              suffix={null}
              aria-label="Search reports by unit, owner, or project"
            />
            <Select
              placeholder="Project"
              style={{ width: '100%', minWidth: 160 }}
              allowClear
              onChange={setSelectedProject}
              value={selectedProject}
            >
              {projects.map((p) => (
                <Option key={p.id} value={p.id}>
                  {p.project_code ? `${p.project_code} - ${p.name}` : p.name}
                </Option>
              ))}
            </Select>
            <Select
              placeholder="Unit Type"
              style={{ width: '100%', minWidth: 110 }}
              allowClear
              onChange={setSelectedUnitType}
              value={selectedUnitType}
            >
              {unitTypes.map((type) => (
                <Option key={type} value={type}>
                  {type}
                </Option>
              ))}
            </Select>
            <Select
              placeholder="Status"
              style={{ width: '100%', minWidth: 110 }}
              allowClear
              onChange={setSelectedStatus}
              value={selectedStatus}
            >
              <Option value="Sold">Sold</Option>
              <Option value="Unsold">Unsold</Option>
            </Select>
            <Select
              mode="multiple"
              placeholder="Financial Years"
              style={{ width: '100%', minWidth: 160 }}
              allowClear
              onChange={setSelectedYears}
              value={selectedYears}
              maxTagCount="responsive"
            >
              {availableYears.map((year) => (
                <Option key={year} value={year}>
                  {year}
                </Option>
              ))}
            </Select>
            <Space wrap>
              <InputNumber
                placeholder="Min Outstanding"
                style={{ width: '100%', minWidth: 120 }}
                value={outstandingRange[0]}
                onChange={(val) => setOutstandingRange([val, outstandingRange[1]])}
                min={0}
              />
              <span>-</span>
              <InputNumber
                placeholder="Max Outstanding"
                style={{ width: '100%', minWidth: 120 }}
                value={outstandingRange[1]}
                onChange={(val) => setOutstandingRange([outstandingRange[0], val])}
                min={0}
              />
            </Space>
          </Space>

          {/* Filter Summary Chips */}
          {hasActiveFilters && (
            <div style={{ marginTop: 16 }}>
              <Space wrap>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  Applied filters:
                </Text>
                {searchText && (
                  <Tag closable onClose={() => setSearchText('')}>
                    Search: &quot;{searchText}&quot;
                  </Tag>
                )}
                {selectedProject !== null && (
                  <Tag closable onClose={() => setSelectedProject(null)}>
                    Project: {selectedProjectName}
                  </Tag>
                )}
                {selectedUnitType !== null && (
                  <Tag closable onClose={() => setSelectedUnitType(null)}>
                    Type: {selectedUnitType}
                  </Tag>
                )}
                {selectedStatus !== null && (
                  <Tag closable onClose={() => setSelectedStatus(null)}>
                    Status: {selectedStatus}
                  </Tag>
                )}
                {selectedYears.length > 0 && (
                  <Tag closable onClose={() => setSelectedYears([])}>
                    Years: {selectedYears.length} selected
                  </Tag>
                )}
                {(outstandingRange[0] !== null || outstandingRange[1] !== null) && (
                  <Tag closable onClose={() => setOutstandingRange([null, null])}>
                    Outstanding: {outstandingRange[0] !== null ? `₹${outstandingRange[0]}` : 'Any'}{' '}
                    - {outstandingRange[1] !== null ? `₹${outstandingRange[1]}` : 'Any'}
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
        </div>
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
          bodyStyle={{ padding: '16px 0' }}
        >
          <Row gutter={[16, 16]}>
            {yearlyTotals.map((total) => {
              const collectionRate = total.billed > 0 ? (total.paid / total.billed) * 100 : 0
              return (
                <Col xs={24} sm={12} md={8} lg={6} key={total.year}>
                  <Card
                    size="small"
                    bordered
                    title={
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <Text strong style={{ fontSize: '16px' }}>
                          {total.year}
                        </Text>
                        <Text type="secondary" style={{ fontSize: '12px' }}>
                          {total.unitCount} units billed
                        </Text>
                      </Space>
                    }
                    extra={
                      <Tag
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
                    }
                  >
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary">Billed:</Text>
                        <Text strong>₹{total.billed.toLocaleString()}</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary">Collected:</Text>
                        <Text type="success">₹{total.paid.toLocaleString()}</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary">Outstanding:</Text>
                        <Text type={total.balance > 0 ? 'danger' : 'success'}>
                          ₹{total.balance.toLocaleString()}
                        </Text>
                      </div>
                    </Space>
                  </Card>
                </Col>
              )
            })}
          </Row>
        </Card>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="report-stat-card billed">
            <Statistic
              title="TOTAL BILLED"
              value={stats.totalBilled}
              precision={0}
              prefix="₹"
              valueStyle={{ fontSize: '24px' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="report-stat-card collected">
            <Statistic
              title="TOTAL COLLECTED"
              value={stats.totalCollected}
              precision={0}
              prefix="₹"
              valueStyle={{ color: '#3f8600', fontSize: '24px' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false} className="report-stat-card outstanding">
            <Statistic
              title="TOTAL OUTSTANDING"
              value={stats.outstanding}
              precision={0}
              prefix="₹"
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
            {selectedYears.length > 0 && (
              <Text type="secondary" style={{ fontSize: '14px' }}>
                ({selectedYears.length} years selected)
              </Text>
            )}
          </Space>
        }
        bodyStyle={{ padding: 0 }}
        extra={
          shouldCollapseYears && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Detailed columns hidden on mobile
            </Text>
          )
        }
      >
        <Alert
          message="Table shows Billed, Paid, and Balance for each financial year"
          type="info"
          showIcon
          style={{ margin: '16px', marginBottom: 0 }}
        />
        <Table
          columns={columns as TableProps<PivotData>['columns']}
          dataSource={pivotData}
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 'max-content', y: 'calc(100vh - 600px)' }}
          size="small"
          bordered
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5}>
                  <Text strong>
                    {hasActiveFilters ? 'APPLIED TOTAL' : 'GRAND TOTAL'}
                    {pivotData.length < allPivotData.length &&
                      ` (${pivotData.length} of ${allPivotData.length} units)`}
                  </Text>
                </Table.Summary.Cell>
                {years.map((year, index) => {
                  const yearlyTotal = yearlyTotals.find((t) => t.year === year)
                  return (
                    <React.Fragment key={year}>
                      <Table.Summary.Cell index={index * 3 + 5} align="right">
                        <Text>₹{yearlyTotal?.billed.toLocaleString() || '0'}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={index * 3 + 6} align="right">
                        <Text type="success">₹{yearlyTotal?.paid.toLocaleString() || '0'}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={index * 3 + 7} align="right">
                        <Text
                          type={
                            yearlyTotal?.balance && yearlyTotal.balance > 0 ? 'danger' : 'success'
                          }
                        >
                          ₹{yearlyTotal?.balance.toLocaleString() || '0'}
                        </Text>
                      </Table.Summary.Cell>
                    </React.Fragment>
                  )
                })}
                <Table.Summary.Cell index={years.length * 3 + 5} align="right">
                  <Text strong>₹{stats.totalBilled.toLocaleString()}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={years.length * 3 + 6} align="right">
                  <Text strong type="success">
                    ₹{stats.totalCollected.toLocaleString()}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={years.length * 3 + 7} align="right">
                  <Text strong type={stats.outstanding > 0 ? 'danger' : 'success'}>
                    ₹{stats.outstanding.toLocaleString()}
                  </Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>
    </div>
  )
}

export default Reports
