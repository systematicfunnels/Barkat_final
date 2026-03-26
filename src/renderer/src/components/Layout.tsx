import React, { useState } from 'react'
import { Layout as AntLayout, Menu, theme } from 'antd'
import {
  DashboardOutlined,
  HomeOutlined,
  UserOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { IndianRupee } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import BreadcrumbNavigation from './BreadcrumbNavigation'

const { Sider, Content, Header } = AntLayout

interface LayoutProps {
  children: React.ReactNode
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const {
    token: { colorBgContainer }
  } = theme.useToken()

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: 'Dashboard'
    },
    {
      key: '/projects',
      icon: <HomeOutlined />,
      label: 'Projects'
    },
    {
      key: '/units',
      icon: <UserOutlined />,
      label: 'Units'
    },
    {
      key: '/billing',
      icon: <FileTextOutlined />,
      label: 'Maintenance Letters'
    },
    {
      key: '/payments',
      icon: <IndianRupee size={16} />,
      label: 'Payments & Receipts'
    },
    {
      key: '/reports',
      icon: <BarChartOutlined />,
      label: 'Reports'
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: 'Settings'
    }
  ]

  return (
    <AntLayout style={{ minHeight: '100vh', overflow: 'hidden' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        width={260} // Blueprint: 240-280px
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 1001
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: '0 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            marginBottom: 8
          }}
        >
          <HomeOutlined
            style={{ fontSize: 24, color: '#2D7A5E', marginRight: collapsed ? 0 : 12 }}
          />
          {!collapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span
                style={{ color: 'white', fontSize: 18, fontWeight: 'bold', letterSpacing: 1.5 }}
              >
                BARKAT
              </span>
              <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: 'normal' }}>
                MANAGEMENT SOLUTIONS
              </span>
            </div>
          )}
        </div>
        <Menu
          theme="dark"
          selectedKeys={[location.pathname]}
          mode="inline"
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <AntLayout style={{ marginLeft: collapsed ? 80 : 260, transition: 'all 0.2s' }}>
        <Header
          style={{
            padding: '0 32px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            height: 64, // Blueprint: 56-64px
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            width: '100%'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: '#8c8c8c' }}>Admin Panel</span>
            <div
              style={{
                width: 32,
                height: 32,
                background: '#f0f0f0',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <UserOutlined style={{ color: '#2D7A5E' }} />
            </div>
          </div>
        </Header>
        <Content
          style={{
            padding: '32px',
            height: 'calc(100vh - 64px)',
            overflowY: 'auto',
            background: '#f5f7f9'
          }}
        >
          <div style={{ maxWidth: 1600, margin: '0 auto' }}>
            <BreadcrumbNavigation items={[]} />
            {children}
          </div>
        </Content>
      </AntLayout>
    </AntLayout>
  )
}

export default Layout
