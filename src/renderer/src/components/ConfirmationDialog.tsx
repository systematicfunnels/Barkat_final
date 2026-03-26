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
      title={title || 'Confirm Action'}
      okText={confirmText}
      cancelText={cancelText}
      okButtonProps={defaultOkButtonProps}
      cancelButtonProps={cancelButtonProps}
      centered
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
      title="Delete Item"
      type="delete"
      content={`Are you sure you want to delete ${itemName ? `"${itemName}"` : 'this item'}?`}
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
      title="Delete Multiple Items"
      type="delete"
      content={`Are you sure you want to delete ${itemCount} selected item${itemCount > 1 ? 's' : ''}? This action cannot be undone.`}
      confirmText="Delete All"
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
      title="Unsaved Changes"
      type="warning"
      content="You have unsaved changes. Are you sure you want to continue without saving?"
      confirmText="Continue Without Saving"
      cancelText="Save Changes"
    />
  )
}

export default ConfirmationDialog
