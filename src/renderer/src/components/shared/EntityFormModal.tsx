import React from 'react'
import { Modal, Form, Button, Space, Tag, FormInstance, Grid } from 'antd'
import { FileAddOutlined } from '@ant-design/icons'

const { useBreakpoint } = Grid

export interface EntityFormModalProps {
  open: boolean
  onOk: () => void
  onCancel: () => void
  title: string | React.ReactNode
  subtitle?: string
  width?: number
  confirmLoading?: boolean
  children: React.ReactNode
  form: FormInstance
  extraTags?: React.ReactNode
  footer?: React.ReactNode[] | null
  isQuickMode?: boolean
  onSwitchMode?: () => void
}

export function EntityFormModal({
  open,
  onOk,
  onCancel,
  title,
  subtitle,
  width = 680,
  confirmLoading = false,
  children,
  form,
  extraTags,
  footer,
  isQuickMode = false,
  onSwitchMode
}: EntityFormModalProps) {
  const screens = useBreakpoint()
  const isMobile = !screens.md
  
  const modalTitle = (
    <Space>
      {title}
      {isQuickMode && (
        <Tag color="blue" icon={<FileAddOutlined />}>
          Quick Mode
        </Tag>
      )}
      {extraTags}
    </Space>
  )

  const modalFooter = footer !== undefined ? footer : [
    <Button key="cancel" onClick={onCancel}>
      Cancel
    </Button>,
    <Button key="submit" type="primary" loading={confirmLoading} onClick={onOk}>
      Save
    </Button>
  ]

  return (
    <Modal
      title={modalTitle}
      open={open}
      onCancel={onCancel}
      width={isQuickMode ? 480 : width}
      style={{ maxWidth: '95vw', maxHeight: '90vh', top: isMobile ? 0 : 20 }}
      bodyStyle={{ maxHeight: 'calc(90vh - 140px)', overflowY: 'auto' }}
      confirmLoading={confirmLoading}
      footer={modalFooter}
      className={isMobile ? 'mobile-fullscreen-modal mobile-single-column' : undefined}
    >
      {isQuickMode && onSwitchMode && (
        <div style={{ marginBottom: 16 }}>
          <Button size="small" onClick={onSwitchMode}>
            Switch to Full Form
          </Button>
        </div>
      )}
      {subtitle && (
        <p style={{ marginBottom: 16, color: '#666' }}>{subtitle}</p>
      )}
      <FormSection title={typeof title === 'string' ? title : 'Form'} columns={isMobile ? 1 : 2}>
        <Form form={form} layout="vertical">
          {children}
        </Form>
      </FormSection>
    </Modal>
  )
}

// Preset form section wrappers
export function FormSection({
  title,
  children,
  columns = 2,
  gap = 16
}: {
  title: string
  children: React.ReactNode
  columns?: 1 | 2 | 3
  gap?: number
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontWeight: 600,
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: '1px solid #f0f0f0'
        }}
      >
        {title}
      </div>
      <div
        className="responsive-form-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: `${gap}px`
        }}
      >
        {children}
      </div>
    </div>
  )
}

// Preset form field wrapper for consistent styling
export function FormField({
  children,
  fullWidth = false
}: {
  children: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <div className={fullWidth ? 'span-2' : undefined} style={{ gridColumn: fullWidth ? 'span 2' : undefined }}>{children}</div>
  )
}

export default EntityFormModal
