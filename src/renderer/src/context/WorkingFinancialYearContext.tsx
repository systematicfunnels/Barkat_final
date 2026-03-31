import React, { createContext, useContext, useMemo, useState } from 'react'
import { getCurrentFinancialYear, getUpcomingFinancialYear } from '../utils/financialYear'

interface WorkingFinancialYearContextValue {
  workingFY: string
  setWorkingFY: (financialYear: string) => void
}

const STORAGE_KEY = 'barkat-working-financial-year'

const getInitialWorkingFinancialYear = (): string => {
  const fallbackFY = getUpcomingFinancialYear(getCurrentFinancialYear())

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && /^\d{4}-\d{2}$/.test(stored)) {
      return stored
    }
  } catch {
    // Ignore localStorage access errors and fall back to the next billing year.
  }

  return fallbackFY
}

const WorkingFinancialYearContext = createContext<WorkingFinancialYearContextValue | undefined>(
  undefined
)

export const WorkingFinancialYearProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [workingFYState, setWorkingFYState] = useState<string>(getInitialWorkingFinancialYear)

  const setWorkingFY = (financialYear: string): void => {
    setWorkingFYState(financialYear)
    try {
      window.localStorage.setItem(STORAGE_KEY, financialYear)
    } catch {
      // Ignore localStorage write errors and keep the in-memory selection.
    }
  }

  const value = useMemo(
    () => ({
      workingFY: workingFYState,
      setWorkingFY
    }),
    [workingFYState]
  )

  return (
    <WorkingFinancialYearContext.Provider value={value}>
      {children}
    </WorkingFinancialYearContext.Provider>
  )
}

export const useWorkingFinancialYear = (): WorkingFinancialYearContextValue => {
  const context = useContext(WorkingFinancialYearContext)
  if (!context) {
    throw new Error('useWorkingFinancialYear must be used within WorkingFinancialYearProvider')
  }
  return context
}
