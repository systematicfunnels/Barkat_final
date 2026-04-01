import React, { useMemo } from 'react'
import { Card, Space, Button, Tag, Typography, Input, Dropdown, InputNumber, Grid } from 'antd'
import type { CardProps } from 'antd'
import { CheckOutlined, ClearOutlined, FilterOutlined, SearchOutlined } from '@ant-design/icons'

const { Text } = Typography
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
  emptyValue?: unknown
  multiple?: boolean
  maxTagCount?: number | 'responsive'
  formatValue?: (value: unknown) => string
  isActive?: (value: unknown) => boolean
  minPlaceholder?: string
  maxPlaceholder?: string
}

export interface FilterPanelProps {
  filters: FilterField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onClear: () => void
  showActiveFilters?: boolean
  showClearButton?: boolean
  showFields?: boolean
  children?: React.ReactNode
  loading?: boolean
  extraActiveFilters?: FilterOption[]
  variant?: 'card' | 'plain'
  cardProps?: CardProps
}

export function FilterPanel({
  filters,
  values,
  onChange,
  onClear,
  showActiveFilters = true,
  showClearButton = true,
  showFields = true,
  children,
  loading = false,
  extraActiveFilters = [],
  variant = 'card',
  cardProps
}: FilterPanelProps) {
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const isTablet = screens.md && !screens.lg
  const responsiveLabelSize = isMobile ? '14px' : '12px'

  const activeFilters = useMemo(() => {
    const derivedActiveFilters: FilterOption[] = []

    filters.forEach((field) => {
      const value = values[field.key]
      const isActive =
        field.isActive?.(value) ??
        (Array.isArray(value)
          ? value.length > 0
          : value !== undefined && value !== null && value !== '')

      if (!isActive) return

      let displayValue = field.formatValue ? field.formatValue(value) : String(value)
      if (!field.formatValue && field.type === 'select' && field.options) {
        if (Array.isArray(value)) {
          displayValue = value
            .map((selectedValue) => {
              const option = field.options?.find((o) => o.value === selectedValue)
              return option?.label || String(selectedValue)
            })
            .join(', ')
        } else {
          const option = field.options.find((o) => o.value === value)
          if (option) displayValue = option.label
        }
      }

      derivedActiveFilters.push({
        key: field.key,
        label: `${field.label}: ${displayValue}`,
        value,
        onRemove: () => onChange(field.key, field.emptyValue)
      })
    })

    return [...derivedActiveFilters, ...extraActiveFilters]
  }, [extraActiveFilters, filters, onChange, values])

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
          <Input
            key={field.key}
            className="app-search-field"
            placeholder={field.placeholder || `Search ${field.label.toLowerCase()}...`}
            value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
            onChange={(e) => onChange(field.key, e.target.value)}
            onPressEnter={(e) => onChange(field.key, e.currentTarget.value)}
            allowClear={field.allowClear !== false}
            prefix={<SearchOutlined />}
            disabled={loading}
            style={commonStyle}
          />
        )

      case 'select':
      {
        const currentValue = values[field.key]
        const selectedValues = Array.isArray(currentValue)
          ? currentValue
          : currentValue !== undefined && currentValue !== null && currentValue !== ''
            ? [currentValue]
            : []

        const selectedLabels = selectedValues
          .map((selectedValue) => field.options?.find((opt) => opt.value === selectedValue)?.label || String(selectedValue))
          .filter(Boolean)

        const buttonLabel =
          selectedLabels.length > 0
            ? selectedLabels.join(', ')
            : field.placeholder || field.label

        const hasOptions = (field.options?.length ?? 0) > 0

        const menuItems = [
          ...(field.allowClear !== false
            ? [
                {
                  key: '__clear__',
                  label: `All ${field.label}`,
                  onClick: () => onChange(field.key, field.emptyValue)
                }
              ]
            : []),
          ...(field.options?.map((opt) => {
            const isSelected = selectedValues.includes(opt.value)
            return {
              key: String(opt.value),
              label: opt.label,
              icon: isSelected ? <CheckOutlined /> : undefined,
              onClick: () => {
                if (field.multiple) {
                  const nextValues = isSelected
                    ? selectedValues.filter((value) => value !== opt.value)
                    : [...selectedValues, opt.value]
                  onChange(field.key, nextValues)
                } else {
                  onChange(field.key, opt.value)
                }
              }
            }
          }) || [])
        ]

        return (
          <Dropdown
            key={field.key}
            trigger={['hover', 'click']}
            menu={{ items: menuItems }}
            placement="bottomLeft"
            overlayClassName="app-filter-dropdown-menu"
            disabled={loading || !hasOptions}
          >
            <Button
              className="app-filter-dropdown-button"
              style={commonStyle}
              title={buttonLabel}
              disabled={loading || !hasOptions}
            >
              {loading ? `Loading ${field.label}...` : buttonLabel}
            </Button>
          </Dropdown>
        )
      }

      case 'number':
        return (
          <InputNumber
            key={field.key}
            className="app-filter-number"
            placeholder={field.placeholder || field.label}
            value={typeof values[field.key] === 'number' ? (values[field.key] as number) : undefined}
            onChange={(value) => onChange(field.key, value)}
            disabled={loading}
            style={commonStyle}
          />
        )

      case 'range':
        {
          const rangeValue = Array.isArray(values[field.key]) ? values[field.key] as [unknown, unknown] : undefined
          const rangeStyle = isMobile ? { width: '100%' } : { width: 200 }
          return (
            <Space.Compact key={field.key} className="app-filter-range" style={{ display: 'flex', gap: 4, ...rangeStyle }}>
              <InputNumber
                className="app-filter-number"
                placeholder={field.minPlaceholder || 'Min'}
                value={typeof rangeValue?.[0] === 'number' ? rangeValue[0] : undefined}
                onChange={(min) => {
                  const current = rangeValue || [null, null]
                  onChange(field.key, [min, current[1]])
                }}
                disabled={loading}
                style={{ width: isMobile ? 'calc(50% - 14px)' : 90 }}
              />
              <span className="app-filter-range-separator">to</span>
              <InputNumber
                className="app-filter-number"
                placeholder={field.maxPlaceholder || 'Max'}
                value={typeof rangeValue?.[1] === 'number' ? rangeValue[1] : undefined}
                onChange={(max) => {
                  const current = rangeValue || [null, null]
                  onChange(field.key, [current[0], max])
                }}
                disabled={loading}
                style={{ width: isMobile ? 'calc(50% - 14px)' : 90 }}
              />
          </Space.Compact>
          )
        }

      default:
        return null
    }
  }

  const content = (
    <div
      className={`app-filter-panel${loading ? ' is-loading' : ''}`}
      aria-busy={loading}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      {showFields && (
        <div className="app-filter-panel-fields">
          <div className="app-filter-panel-label">
            <FilterOutlined />
            <span>Refine results</span>
          </div>
          <Space
            wrap
            className="responsive-filters app-filter-row"
            size="middle"
            orientation={isMobile ? 'vertical' : 'horizontal'}
            style={{ width: '100%' }}
          >
            {filters.map(renderField)}
            {children}
          </Space>
        </div>
      )}

      {showActiveFilters && hasActiveFilters && (
        <div className="page-chip-bar" style={{ marginTop: 8 }}>
          <Space wrap align="center" size="small">
            <Text type="secondary" className="app-filter-summary-label" style={{ fontSize: responsiveLabelSize }}>
              <FilterOutlined /> Active filters:
            </Text>
            {activeFilters.map((filter) => (
              <Tag
                key={filter.key}
                closable
                onClose={filter.onRemove}
                className="app-filter-chip"
                style={{ fontSize: responsiveLabelSize }}
              >
                {filter.label}
              </Tag>
            ))}
            {showClearButton && (
              <Button
                type="default"
                size={isMobile ? 'middle' : 'small'}
                className="app-filter-clear-button"
                icon={<ClearOutlined />}
                onClick={onClear}
                disabled={loading}
                style={{ fontSize: responsiveLabelSize }}
              >
                Clear all
              </Button>
            )}
          </Space>
        </div>
      )}
      </Space>
    </div>
  )

  if (variant === 'plain') {
    return content
  }

  return (
    <Card size="small" loading={loading} {...cardProps}>
      {content}
    </Card>
  )
}

// Preset filter configurations
export const createSelectFilter = (
  key: string,
  label: string,
  options: { value: string | number; label: string }[],
  placeholder?: string,
  extra?: Partial<FilterField>
): FilterField => ({
  key,
  label,
  type: 'select',
  options,
  placeholder: placeholder || label,
  allowClear: true
  ,
  ...extra
})

export const createSearchFilter = (
  key: string,
  label: string,
  placeholder?: string,
  extra?: Partial<FilterField>
): FilterField => ({
  key,
  label,
  type: 'search',
  placeholder: placeholder || `Search ${label.toLowerCase()}...`,
  width: undefined,
  ...extra
})

export const createRangeFilter = (
  key: string,
  label: string,
  extra?: Partial<FilterField>
): FilterField => ({
  key,
  label,
  type: 'range',
  ...extra
})

export default FilterPanel
