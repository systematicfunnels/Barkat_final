import React from 'react'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { ConfigProvider } from 'antd'
import ErrorBoundary from './components/ErrorBoundary'
import Projects from './pages/Projects'
import Units from './pages/Units'
import Dashboard from './pages/Dashboard'
import Billing from './pages/Billing'
import Payments from './pages/Payments'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import { WorkingFinancialYearProvider } from './context/WorkingFinancialYearContext'

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
      <WorkingFinancialYearProvider>
        <Router>
          <Layout>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/units" element={<Units />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/payments" element={<Payments />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </ErrorBoundary>
          </Layout>
        </Router>
      </WorkingFinancialYearProvider>
    </ConfigProvider>
  )
}

export default App
