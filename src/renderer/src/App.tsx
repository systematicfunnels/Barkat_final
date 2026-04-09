import React, { Suspense, lazy, useEffect } from 'react'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { App as AntdApp, ConfigProvider, Spin } from 'antd'
import ErrorBoundary from './components/ErrorBoundary'
import { WorkingFinancialYearProvider } from './context/WorkingFinancialYearContext'
import { bindMessageApi } from './utils/appMessage'
import { bindNotificationApi } from './utils/appNotification'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Projects = lazy(() => import('./pages/Projects'))
const Units = lazy(() => import('./pages/Units'))
const Billing = lazy(() => import('./pages/Billing'))
const Payments = lazy(() => import('./pages/Payments'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

const MESSAGE_CONFIG = {
  top: 88,
  duration: 3,
  maxCount: 3,
  pauseOnHover: true
} as const

const NOTIFICATION_CONFIG = {
  top: 88,
  placement: 'topRight' as const,
  duration: 6,
  maxCount: 3,
  showProgress: true,
  pauseOnHover: true
} as const

const AntdAppBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { message, notification } = AntdApp.useApp()

  useEffect(() => {
    bindMessageApi(message)
    bindNotificationApi(notification)
  }, [message, notification])

  return <>{children}</>
}

const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2D7A5E',
          borderRadius: 16,
          fontSize: 14,
          controlHeight: 40,
          paddingContentHorizontal: 16,
          colorBgLayout: '#f3f6f7',
          colorBgContainer: 'rgba(255,255,255,0.88)'
        },
        components: {
          Table: {
            headerBg: '#fafafa',
            headerBorderRadius: 12,
            cellPaddingBlock: 12
          },
          Button: {
            controlHeight: 40,
            borderRadius: 12
          },
          Input: {
            controlHeight: 40
          },
          Select: {
            controlHeight: 40
          },
          Card: {
            borderRadiusLG: 20
          }
        }
      }}
    >
      <AntdApp message={MESSAGE_CONFIG} notification={NOTIFICATION_CONFIG}>
        <AntdAppBridge>
          <WorkingFinancialYearProvider>
            <Router>
              <Layout>
                <ErrorBoundary>
                  <Suspense
                    fallback={
                      <div
                        style={{
                          minHeight: '55vh',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Spin size="large" />
                      </div>
                    }
                  >
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/projects" element={<Projects />} />
                      <Route path="/units" element={<Units />} />
                      <Route path="/billing" element={<Billing />} />
                      <Route path="/payments" element={<Payments />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/settings" element={<Settings />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </Layout>
            </Router>
          </WorkingFinancialYearProvider>
        </AntdAppBridge>
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
