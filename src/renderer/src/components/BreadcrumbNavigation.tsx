import React from 'react'
import { Breadcrumb } from 'antd'
import { Link } from 'react-router-dom'
import { HomeOutlined } from '@ant-design/icons'

interface BreadcrumbItem {
  label: string
  path?: string
  icon?: React.ReactNode
}

interface BreadcrumbNavigationProps {
  items: Array<{
    label: string
    path?: string
    icon?: React.ReactNode
  }>
  homePath?: string
}

const BreadcrumbNavigation: React.FC<BreadcrumbNavigationProps> = ({ 
  items, 
  homePath = '/' 
}) => {
  if (!items.length) {
    return null
  }

  const breadcrumbItems = [
    {
      label: 'Home',
      path: homePath,
      icon: <HomeOutlined />
    },
    ...items
  ]

  const itemRender = (route: any) => {
    const item = route as BreadcrumbItem
    if (item.path) {
      return (
        <Link to={item.path}>
          {item.icon} {item.label}
        </Link>
      )
    }
    return (
      <span>
        {item.icon} {item.label}
      </span>
    )
  }

  return <Breadcrumb style={{ marginBottom: 16 }} items={breadcrumbItems} itemRender={itemRender} />
}

export default BreadcrumbNavigation
