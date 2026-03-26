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

const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#2D7A5E',
          borderRadius: 4, // Admin-optimized: tighter corners
          fontSize: 14,
          controlHeight: 36, // Component height 36px
          paddingContentHorizontal: 16
        },
        components: {
          Table: {
            headerBg: '#fafafa',
            headerBorderRadius: 0,
            cellPaddingBlock: 12 // Achieve ~44px row height
          },
          Button: {
            controlHeight: 32 // Compact buttons for admin
          },
          Input: {
            controlHeight: 36
          },
          Select: {
            controlHeight: 36
          }
        }
      }}
    >
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
    </ConfigProvider>
  )
}

export default App
