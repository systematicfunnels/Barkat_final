import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Layout as AntLayout, Menu, theme, Drawer, Button } from 'antd'
import {
  DashboardOutlined,
  HomeOutlined,
  UserOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SettingOutlined,
  MenuOutlined
} from '@ant-design/icons'
import { IndianRupee } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import BreadcrumbNavigation from './BreadcrumbNavigation'

const { Sider, Content, Header } = AntLayout

interface LayoutProps {
  children: React.ReactNode
}

// Debounce utility for performance
function useDebounce<T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  return useCallback((...args: unknown[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args)
    }, delay)
  }, [callback, delay]) as T
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
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

  // Debounced resize handler for performance
  const handleResize = useDebounce(() => {
    const mobile = window.innerWidth < 768
    setIsMobile(mobile)
    if (!mobile) {
      setMobileDrawerOpen(false)
    }
  }, 150)

  // Handle responsive behavior
  useEffect(() => {
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  const handleMenuClick = useCallback((key: string) => {
    try {
      navigate(key)
    } catch (error) {
      console.error('Navigation failed:', error)
    }
    if (isMobile) {
      setMobileDrawerOpen(false)
    }
  }, [navigate, isMobile])

  const renderMenu = () => (
    <>
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile || collapsed ? 'center' : 'flex-start',
          padding: '0 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          marginBottom: 8
        }}
      >
        <HomeOutlined
          style={{ fontSize: 24, color: '#2D7A5E', marginRight: (isMobile || collapsed) ? 0 : 12 }}
        />
        {!isMobile && !collapsed && (
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
        onClick={({ key }) => handleMenuClick(key)}
      />
    </>
  )

  return (
    <AntLayout style={{ minHeight: '100vh', overflow: 'hidden' }}>
      {/* Desktop Sidebar - hidden on mobile */}
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={(value) => setCollapsed(value)}
          width={260}
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
          {renderMenu()}
        </Sider>
      )}

      {/* Mobile Drawer */}
      <Drawer
        placement="left"
        closable={false}
        onClose={() => setMobileDrawerOpen(false)}
        open={mobileDrawerOpen}
        width={260}
        className="mobile-sidebar-drawer"
        styles={{
          body: { padding: 0, background: '#001529' },
          header: { background: '#001529', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }
        }}
      >
        {renderMenu()}
      </Drawer>

      <AntLayout 
        style={{ 
          marginLeft: isMobile ? 0 : (collapsed ? 80 : 260), 
          transition: 'all 0.2s',
          minWidth: 0
        }}
      >
        <Header
          style={{
            padding: isMobile ? '0 16px' : '0 32px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            height: 64,
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            width: '100%'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
            {/* Mobile menu button */}
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileDrawerOpen(true)}
              />
            )}
            <span style={{ color: '#8c8c8c', marginLeft: 'auto' }}>
              Admin Panel
            </span>
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
            padding: isMobile ? '16px 12px' : '32px',
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
