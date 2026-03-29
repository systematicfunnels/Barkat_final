import React from 'react'
import { Table, Space, Button, Tooltip, Tag, Grid } from 'antd'
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'
import { EditOutlined, DeleteOutlined, FilePdfOutlined } from '@ant-design/icons'
import { IndianRupee } from 'lucide-react'

const { useBreakpoint } = Grid

export interface ActionConfig<T> {
  key: string
  icon?: React.ReactNode
  label?: string
  tooltip?: string
  danger?: boolean
  type?: 'primary' | 'default' | 'text' | 'link' | 'dashed'
  condition?: (record: T) => boolean
  onClick: (record: T) => void
}

export interface EntityTableProps<T> {
  data: T[]
  columns: ColumnsType<T>
  rowKey: string | ((record: T) => React.Key)
  loading?: boolean
  selectedRowKeys?: React.Key[]
  onSelectionChange?: (selectedKeys: React.Key[]) => void
  actions?: ActionConfig<T>[]
  showDefaultActions?: boolean
  onEdit?: (record: T) => void
  onDelete?: (record: T) => void
  onGenerateLetter?: (record: T) => void
  onRecordPayment?: (record: T) => void
  pagination?: TablePaginationConfig | false
  scroll?: { x?: number | string; y?: number | string }
  size?: 'small' | 'middle' | 'large'
}

export function EntityTable<T extends object>({
  data,
  columns,
  rowKey,
  loading = false,
  selectedRowKeys,
  onSelectionChange,
  actions,
  showDefaultActions = true,
  onEdit,
  onDelete,
  onGenerateLetter,
  onRecordPayment,
  pagination = { pageSize: 10 },
  scroll = { x: 'max-content' },
  size = 'middle'
}: EntityTableProps<T>) {
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const isTouch = !screens.lg
  
  const defaultActions: ActionConfig<T>[] = []

  if (onGenerateLetter) {
    defaultActions.push({
      key: 'generate-letter',
      icon: <FilePdfOutlined />,
      label: isMobile ? 'PDF' : undefined,
      tooltip: 'Generate Maintenance Letter',
      onClick: onGenerateLetter
    })
  }

  if (onRecordPayment) {
    defaultActions.push({
      key: 'record-payment',
      icon: <IndianRupee size={isTouch ? 18 : 16} />,
      label: isMobile ? 'Pay' : undefined,
      tooltip: 'Record Payment',
      onClick: onRecordPayment
    })
  }

  if (onEdit) {
    defaultActions.push({
      key: 'edit',
      icon: <EditOutlined />,
      label: isMobile ? 'Edit' : undefined,
      tooltip: 'Edit',
      onClick: onEdit
    })
  }

  if (onDelete) {
    defaultActions.push({
      key: 'delete',
      icon: <DeleteOutlined />,
      label: isMobile ? 'Del' : undefined,
      tooltip: 'Delete',
      danger: true,
      onClick: onDelete
    })
  }

  const allActions = showDefaultActions ? [...defaultActions, ...(actions || [])] : actions || []

  // Responsive action column width
  const getActionColumnWidth = () => {
    if (isMobile) {
      return Math.max(160, allActions.length * 70 + 16)
    }
    return Math.max(120, allActions.length * 48 + 16)
  }

  const actionColumn: ColumnsType<T>[number] = {
    title: 'Actions',
    key: 'actions',
    align: 'right',
    fixed: 'right',
    width: getActionColumnWidth(),
    minWidth: isMobile ? 140 : 100,
    render: (_: unknown, record: T) => (
      <Space size={isMobile ? 'small' : 'middle'}>
        {allActions.map((action) => {
          if (action.condition && !action.condition(record)) {
            return null
          }

          const button = (
            <Button
              key={action.key}
              size={isMobile ? 'middle' : 'small'}
              type={action.type || 'default'}
              danger={action.danger}
              icon={action.icon}
              onClick={(e) => {
                e.stopPropagation()
                action.onClick(record)
              }}
              style={{ minWidth: isMobile ? 44 : 32 }}
            >
              {action.label}
            </Button>
          )

          if (action.tooltip && !isMobile) {
            return (
              <Tooltip key={action.key} title={action.tooltip}>
                {button}
              </Tooltip>
            )
          }

          return button
        })}
      </Space>
    )
  }

  const finalColumns = allActions.length > 0 ? [...columns, actionColumn] : columns

  const rowSelection = onSelectionChange
    ? {
        selectedRowKeys,
        onChange: onSelectionChange
      }
    : undefined

  return (
    <div className="table-scroll-wrapper">
      <Table<T>
        rowSelection={rowSelection}
        columns={finalColumns}
        dataSource={data}
        rowKey={rowKey}
        loading={loading}
        pagination={pagination === false ? false : {
          showSizeChanger: true,
          showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
          pageSizeOptions: ['10', '20', '50', '100'],
          defaultPageSize: 10,
          ...(typeof pagination === 'object' ? pagination : {})
        }}
        scroll={isMobile ? { x: 'max-content', y: 'calc(100vh - 300px)' } : { ...scroll, y: data.length > 50 ? 'calc(100vh - 300px)' : undefined }}
        size={size}
        virtual={data.length > 100}
      />
    </div>
  )
}

// Pre-built column generators for common patterns
export const createColumn = <T extends object>(
  title: string,
  dataIndex: keyof T | string,
  options?: {
    width?: number
    align?: 'left' | 'center' | 'right'
    sorter?: boolean | ((a: T, b: T) => number)
    render?: (value: unknown, record: T) => React.ReactNode
    ellipsis?: boolean
    fixed?: 'left' | 'right'
  }
): ColumnsType<T>[number] => {
  const base: ColumnsType<T>[number] = {
    title,
    dataIndex: dataIndex as string,
    key: dataIndex as string
  }

  if (options?.width) base.width = options.width
  if (options?.align) base.align = options.align
  if (options?.ellipsis) base.ellipsis = options.ellipsis
  if (options?.fixed) base.fixed = options.fixed

  if (options?.sorter === true) {
    base.sorter = (a: T, b: T) => {
      const aVal = String((a as Record<string, unknown>)[dataIndex as string] ?? '')
      const bVal = String((b as Record<string, unknown>)[dataIndex as string] ?? '')
      return aVal.localeCompare(bVal)
    }
  } else if (typeof options?.sorter === 'function') {
    base.sorter = options.sorter
  }

  if (options?.render) {
    base.render = options.render as (value: unknown, record: T) => React.ReactNode
  }

  return base
}

export const createTagColumn = <T extends object>(
  title: string,
  dataIndex: keyof T,
  colorMap: Record<string, string>,
  defaultColor?: string
): ColumnsType<T>[number] => {
  return {
    title,
    dataIndex: dataIndex as string,
    key: dataIndex as string,
    render: (value: string) => {
      const color = colorMap[value] || defaultColor || 'default'
      return <Tag color={color}>{value || '-'}</Tag>
    }
  }
}

export const createAmountColumn = <T extends object>(
  title: string,
  dataIndex: keyof T,
  options?: { bold?: boolean; currency?: string }
): ColumnsType<T>[number] => {
  const { bold = false, currency = '₹' } = options || {}

  return {
    title,
    dataIndex: dataIndex as string,
    key: dataIndex as string,
    align: 'right',
    sorter: (a: T, b: T) => {
      const aVal = Number((a as Record<string, unknown>)[dataIndex as string]) || 0
      const bVal = Number((b as Record<string, unknown>)[dataIndex as string]) || 0
      return aVal - bVal
    },
    render: (value: number) => {
      const formatted = `${currency}${(value || 0).toLocaleString()}`
      return bold ? <strong>{formatted}</strong> : formatted
    }
  }
}

export default EntityTable
