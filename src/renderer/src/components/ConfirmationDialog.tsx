import React from 'react'
import { Modal, Button, Typography } from 'antd'
import { DeleteOutlined, ExclamationCircleOutlined, WarningOutlined } from '@ant-design/icons'

interface ConfirmationDialogProps {
  visible: boolean
  onConfirm: () => void
  onCancel: () => void
  title?: string
  content?: string
  type?: 'delete' | 'warning' | 'info'
  confirmText?: string
  cancelText?: string
  loading?: boolean
  okButtonProps?: Omit<React.ComponentProps<typeof Button>, 'onClick' | 'loading'>
  cancelButtonProps?: Omit<React.ComponentProps<typeof Button>, 'onClick' | 'loading'>
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  visible,
  onConfirm,
  onCancel,
  title,
  content,
  type = 'warning',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  okButtonProps,
  cancelButtonProps
}) => {
  const { Text } = Typography

  const getIcon = () => {
    switch (type) {
      case 'delete':
        return <DeleteOutlined style={{ color: '#ff4d4f', fontSize: 22 }} />
      case 'warning':
        return <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 22 }} />
      case 'info':
        return <WarningOutlined style={{ color: '#1890ff', fontSize: 22 }} />
      default:
        return <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 22 }} />
    }
  }

  const defaultOkButtonProps = {
    danger: type === 'delete',
    loading,
    ...okButtonProps
  }

  return (
    <Modal
      visible={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      title={title || 'Confirm action'}
      okText={confirmText}
      cancelText={cancelText}
      okButtonProps={defaultOkButtonProps}
      cancelButtonProps={cancelButtonProps}
      centered
      width={480}
      style={{ maxWidth: '95vw' }}
    >
      <div style={{ textAlign: 'center', padding: '20px 0' }}>{getIcon()}</div>

      {content && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Text>{content}</Text>
        </div>
      )}

      <div
        style={{
          textAlign: 'center',
          fontSize: '12px',
          color: '#666',
          fontStyle: 'italic'
        }}
      >
        This action cannot be undone
      </div>
    </Modal>
  )
}

// Helper function for common confirmation scenarios
export const showDeleteConfirmation = (
  onConfirm: () => void,
  onCancel: () => void,
  itemName?: string
) => {
  return (
    <ConfirmationDialog
      visible={true}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title="Delete item?"
      type="delete"
      content={`${itemName ? `"${itemName}"` : 'This item'} will be removed. This cannot be undone.`}
      confirmText="Delete"
      cancelText="Cancel"
    />
  )
}

export const showBulkDeleteConfirmation = (
  onConfirm: () => void,
  onCancel: () => void,
  itemCount: number
) => {
  return (
    <ConfirmationDialog
      visible={true}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title={`Delete ${itemCount} item${itemCount > 1 ? 's' : ''}?`}
      type="delete"
      content={`${itemCount} item${itemCount > 1 ? 's' : ''} will be removed. This cannot be undone.`}
      confirmText="Delete"
      cancelText="Cancel"
    />
  )
}

export const showUnsavedChangesWarning = (onConfirm: () => void, onCancel: () => void) => {
  return (
    <ConfirmationDialog
      visible={true}
      onConfirm={onConfirm}
      onCancel={onCancel}
      title="Discard unsaved changes?"
      type="warning"
      content="Your unsaved changes will be lost."
      confirmText="Discard changes"
      cancelText="Keep editing"
    />
  )
}

export default ConfirmationDialog
