import React, { useState, useEffect } from 'react'
import { Card, Space, Button, Tag, Typography, Input, Select, InputNumber, Grid } from 'antd'
import { ClearOutlined, FilterOutlined } from '@ant-design/icons'

const { Text } = Typography
const { Option } = Select
const { useBreakpoint } = Grid

export interface FilterOption {
  key: string
  label: string
  value: unknown
  onRemove: () => void
}

export interface FilterField {
  key: string
  label: string
  type: 'search' | 'select' | 'number' | 'range'
  placeholder?: string
  options?: { value: string | number; label: string }[]
  allowClear?: boolean
  width?: number | string
}

export interface FilterPanelProps {
  filters: FilterField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onClear: () => void
  showActiveFilters?: boolean
  showClearButton?: boolean
  children?: React.ReactNode
  loading?: boolean
}

export function FilterPanel({
  filters,
  values,
  onChange,
  onClear,
  showActiveFilters = true,
  showClearButton = true,
  children,
  loading = false
}: FilterPanelProps) {
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const isTablet = screens.md && !screens.lg
  
  const [activeFilters, setActiveFilters] = useState<FilterOption[]>([])

  useEffect(() => {
    const newActiveFilters: FilterOption[] = []
    filters.forEach((field) => {
      const value = values[field.key]
      if (value !== undefined && value !== null && value !== '') {
        let displayValue = String(value)
        if (field.type === 'select' && field.options) {
          const option = field.options.find((o) => o.value === value)
          if (option) displayValue = option.label
        }

        newActiveFilters.push({
          key: field.key,
          label: `${field.label}: ${displayValue}`,
          value,
          onRemove: () => onChange(field.key, undefined)
        })
      }
    })
    setActiveFilters(newActiveFilters)
  }, [filters, values, onChange])

  const hasActiveFilters = activeFilters.length > 0

  const renderField = (field: FilterField) => {
    // Responsive widths based on screen size
    const getResponsiveWidth = () => {
      if (field.width) return field.width
      if (isMobile) {
        return field.type === 'search' ? '100%' : '100%'
      }
      if (isTablet) {
        return field.type === 'search' ? 240 : 140
      }
      return field.type === 'search' ? 280 : 160
    }
    
    const commonStyle = {
      width: getResponsiveWidth(),
      minWidth: isMobile ? '100%' : (field.type === 'search' ? 200 : 120)
    }

    switch (field.type) {
      case 'search':
        return (
          <Input.Search
            key={field.key}
            placeholder={field.placeholder || `Search ${field.label.toLowerCase()}...`}
            value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            onSearch={(value) => onChange(field.key, value)}
            allowClear={field.allowClear !== false}
            enterButton
            style={commonStyle}
          />
        )

      case 'select':
        return (
          <Select
            key={field.key}
            placeholder={field.placeholder || field.label}
            value={typeof values[field.key] === 'string' || typeof values[field.key] === 'number' ? values[field.key] : undefined}
            onChange={(value) => onChange(field.key, value)}
            allowClear={field.allowClear !== false}
            style={commonStyle}
          >
            {field.options?.map((opt) => (
              <Option key={opt.value} value={opt.value}>
                {opt.label}
              </Option>
            ))}
          </Select>
        )

      case 'number':
        return (
          <InputNumber
            key={field.key}
            placeholder={field.placeholder || field.label}
            value={typeof values[field.key] === 'number' ? (values[field.key] as number) : undefined}
            onChange={(value) => onChange(field.key, value)}
            style={commonStyle}
          />
        )

      case 'range':
        {
          const rangeValue = Array.isArray(values[field.key]) ? values[field.key] as [unknown, unknown] : undefined
          const rangeStyle = isMobile ? { width: '100%' } : { width: 200 }
          return (
            <Input.Group compact key={field.key} style={{ display: 'flex', gap: 4, ...rangeStyle }}>
              <InputNumber
                placeholder="Min"
                value={typeof rangeValue?.[0] === 'number' ? rangeValue[0] : undefined}
                onChange={(min) => {
                  const current = rangeValue || [null, null]
                  onChange(field.key, [min, current[1]])
                }}
                style={{ width: isMobile ? 'calc(50% - 14px)' : 90 }}
              />
              <span style={{ padding: '0 8px', lineHeight: '32px' }}>to</span>
              <InputNumber
                placeholder="Max"
                value={typeof rangeValue?.[1] === 'number' ? rangeValue[1] : undefined}
                onChange={(max) => {
                  const current = rangeValue || [null, null]
                  onChange(field.key, [current[0], max])
                }}
                style={{ width: isMobile ? 'calc(50% - 14px)' : 90 }}
              />
            </Input.Group>
          )
        }

      default:
        return null
    }
  }

  return (
    <Card size="small" loading={loading}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Space 
            wrap 
            className="responsive-filters" 
            size="middle"
            orientation={isMobile ? 'vertical' : 'horizontal'}
            style={{ width: '100%' }}
          >
            {filters.map(renderField)}
            {children}
          </Space>
        </div>

        {showActiveFilters && hasActiveFilters && (
          <div style={{ marginTop: 8 }}>
            <Space wrap align="center" size="small">
              <Text type="secondary" style={{ fontSize: isMobile ? '14px' : '12px' }}>
                <FilterOutlined /> Applied filters:
              </Text>
              {activeFilters.map((filter) => (
                <Tag
                  key={filter.key}
                  closable
                  onClose={filter.onRemove}
                  style={{ fontSize: isMobile ? '14px' : '12px' }}
                >
                  {filter.label}
                </Tag>
              ))}
              {showClearButton && (
                <Button
                  type="link"
                  size={isMobile ? 'middle' : 'small'}
                  icon={<ClearOutlined />}
                  onClick={onClear}
                  style={{ fontSize: isMobile ? '14px' : '12px', padding: isMobile ? '4px 8px' : 0, height: isMobile ? 32 : 'auto' }}
                >
                  Clear all
                </Button>
              )}
            </Space>
          </div>
        )}
      </Space>
    </Card>
  )
}

// Preset filter configurations
export const createSelectFilter = (
  key: string,
  label: string,
  options: { value: string | number; label: string }[],
  placeholder?: string
): FilterField => ({
  key,
  label,
  type: 'select',
  options,
  placeholder: placeholder || label,
  allowClear: true
})

export const createSearchFilter = (
  key: string,
  label: string,
  placeholder?: string
): FilterField => ({
  key,
  label,
  type: 'search',
  placeholder: placeholder || `Search ${label.toLowerCase()}...`,
  width: undefined // Let responsive logic handle it
})

export const createRangeFilter = (key: string, label: string): FilterField => ({
  key,
  label,
  type: 'range'
})

export default FilterPanel
