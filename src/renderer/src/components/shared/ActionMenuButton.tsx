import React from 'react'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'

type ActionMenuButtonProps = {
  label: React.ReactNode
  icon?: React.ReactNode
  items: MenuProps['items']
  ariaLabel?: string
}

const ActionMenuButton: React.FC<ActionMenuButtonProps> = ({
  label,
  icon,
  items,
  ariaLabel
}) => {
  return (
    <Dropdown
      trigger={['hover', 'click']}
      menu={{ items }}
      placement="bottomLeft"
    >
      <Button icon={icon} aria-label={ariaLabel}>
        {label}
      </Button>
    </Dropdown>
  )
}

export default ActionMenuButton
