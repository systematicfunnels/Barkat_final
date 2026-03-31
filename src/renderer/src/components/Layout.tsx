import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Layout as AntLayout, Menu, theme, Drawer, Button } from 'antd'
import {
  DashboardOutlined,
  HomeOutlined,
  UserOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SettingOutlined,
  MenuOutlined,
  CloseOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
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

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

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
  const desktopSidebarWidth = 288
  const tabletSidebarWidth = 240
  const collapsedSidebarWidth = 88
  const [collapsed, setCollapsed] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [isTablet, setIsTablet] = useState(window.innerWidth >= 768 && window.innerWidth < 1024)
  const [isSmallMobile, setIsSmallMobile] = useState(window.innerWidth < 480)
  const navigate = useNavigate()
  const location = useLocation()
  const {
    token: { colorBgContainer }
  } = theme.useToken()

  const routeMeta = useMemo(() => {
    const routes: Record<string, { title: string }> = {
      '/': {
        title: 'Dashboard'
      },
      '/projects': {
        title: 'Projects'
      },
      '/units': {
        title: 'Units'
      },
      '/billing': {
        title: 'Maintenance Letters'
      },
      '/payments': {
        title: 'Payments & Receipts'
      },
      '/reports': {
        title: 'Reports'
      },
      '/settings': {
        title: 'Settings'
      }
    }

    return routes[location.pathname] || routes['/']
  }, [location.pathname])

  const sidebarWidth = isTablet ? tabletSidebarWidth : desktopSidebarWidth
  const contentOffset = isMobile ? 0 : collapsed ? collapsedSidebarWidth : sidebarWidth
  const mobileSidebarWidth = isSmallMobile ? 256 : 304

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
      title: 'Dashboard'
    },
    {
      key: '/projects',
      icon: <HomeOutlined />,
      label: 'Projects',
      title: 'Projects'
    },
    {
      key: '/units',
      icon: <UserOutlined />,
      label: 'Units',
      title: 'Units'
    },
    {
      key: '/billing',
      icon: <FileTextOutlined />,
      label: 'Maintenance Letters',
      title: 'Maintenance Letters'
    },
    {
      key: '/payments',
      icon: <IndianRupee size={16} />,
      label: 'Payments & Receipts',
      title: 'Payments & Receipts'
    },
    {
      key: '/reports',
      icon: <BarChartOutlined />,
      label: 'Reports',
      title: 'Reports'
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      title: 'Settings'
    }
  ]

  // Debounced resize handler for performance
  const handleResize = useDebounce(() => {
    const width = window.innerWidth
    const mobile = width < 768
    const tablet = width >= 768 && width < 1024
    const smallMobile = width < 480
    setIsMobile(mobile)
    setIsTablet(tablet)
    setIsSmallMobile(smallMobile)
    if (!mobile) {
      setMobileDrawerOpen(false)
    }
  }, 150)

  // Handle responsive behavior
  useEffect(() => {
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  useEffect(() => {
    if (isMobile) {
      const closeTimer = window.setTimeout(() => {
        setMobileDrawerOpen(false)
      }, 0)

      return () => window.clearTimeout(closeTimer)
    }

    return undefined
  }, [isMobile, location.pathname])

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
      <div className="app-shell-brand">
        <div className="app-shell-brand-mark">
          <HomeOutlined style={{ color: '#9de4c9' }} />
        </div>
        {!isMobile && !collapsed && (
          <div className="app-shell-brand-text">
            <span className="app-shell-eyebrow">Workspace</span>
            <span className="app-shell-brand-title">Barkat</span>
            <span className="app-shell-brand-subtitle">Management dashboard</span>
          </div>
        )}
      </div>
      <Menu
        className="app-shell-menu"
        selectedKeys={[location.pathname]}
        mode="inline"
        inlineCollapsed={!isMobile && collapsed}
        items={menuItems}
        aria-label="Primary navigation"
        onClick={({ key }) => handleMenuClick(key)}
      />
    </>
  )

  return (
    <AntLayout className="app-shell" style={{ minHeight: '100vh', overflowX: 'hidden' }}>
      {/* Desktop Sidebar - hidden on mobile */}
      {!isMobile && (
        <Sider
          className="app-shell-sidebar"
          collapsible
          trigger={null}
          collapsed={collapsed}
          onCollapse={(value) => setCollapsed(value)}
          width={sidebarWidth}
          collapsedWidth={collapsedSidebarWidth}
          style={{
            overflow: 'auto',
            height: '100vh',
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 1001,
            background: 'linear-gradient(180deg, #0d1f1a 0%, #102822 100%)',
            borderRight: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          {renderMenu()}
        </Sider>
      )}

      {/* Mobile Drawer */}
      <Drawer
        placement="left"
        closable
        onClose={() => setMobileDrawerOpen(false)}
        open={mobileDrawerOpen}
        width={mobileSidebarWidth}
        title={<span className="app-shell-drawer-title">Navigation</span>}
        className="mobile-sidebar-drawer"
        closeIcon={<CloseOutlined />}
        styles={{
          body: {
            padding: 0,
            background: 'linear-gradient(180deg, #0d1f1a 0%, #102822 100%)'
          },
          header: {
            background: 'linear-gradient(180deg, #0d1f1a 0%, #102822 100%)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
          }
        }}
      >
        {renderMenu()}
      </Drawer>

        <AntLayout className="app-shell-main" style={{
          marginLeft: contentOffset,
          transition: 'margin-left 0.2s ease, width 0.2s ease',
          minWidth: 0,
          width: isMobile ? '100%' : undefined
        }}
      >
        <Header
          className="app-shell-header"
          style={{
            padding: isMobile ? '0 16px' : (isTablet ? '0 20px' : '0 32px'),
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 64,
            borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            width: '100%',
            backdropFilter: 'blur(14px)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flex: 1 }}>
            {isMobile ? (
              <Button
                className="app-shell-header-toggle"
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileDrawerOpen(true)}
                aria-label="Open navigation"
                aria-expanded={mobileDrawerOpen}
              />
            ) : (
              <Button
                className="app-shell-header-toggle"
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span className="app-shell-header-title">{routeMeta.title}</span>
            </div>
          </div>
          {!isMobile && (
            <div className="app-shell-header-status" aria-label="Workspace active" title="Workspace active">
              <span className="app-shell-status-dot" />
            </div>
          )}
        </Header>
        <Content
          className="app-shell-content"
          style={{
            minHeight: 'calc(100vh - 64px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            background:
              'radial-gradient(circle at top, rgba(116, 198, 157, 0.15), transparent 28%), linear-gradient(180deg, #f6fbf8 0%, #f3f6f7 100%)'
          }}
        >
          <div className="app-shell-content-inner responsive-page-container">
            <BreadcrumbNavigation items={[]} />
            {children}
          </div>
        </Content>
      </AntLayout>
    </AntLayout>
  )
}

export default Layout
