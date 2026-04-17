import {
  getCurrentFinancialYear,
  getPreviousFinancialYear,
  getUpcomingFinancialYear
} from '../../../renderer/src/utils/financialYear'

describe('renderer financialYear utils', () => {
  test('getPreviousFinancialYear returns the FY immediately before the supplied year', () => {
    expect(getPreviousFinancialYear('2027-28')).toBe('2026-27')
    expect(getPreviousFinancialYear('2026-27')).toBe('2025-26')
  })

  test('getUpcomingFinancialYear returns the FY immediately after the supplied year', () => {
    expect(getUpcomingFinancialYear('2027-28')).toBe('2028-29')
  })

  test('previous and upcoming helpers stay aligned around the current FY', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-17'))

    const currentFY = getCurrentFinancialYear()
    const upcomingFY = getUpcomingFinancialYear(currentFY)

    expect(currentFY).toBe('2026-27')
    expect(upcomingFY).toBe('2027-28')
    expect(getPreviousFinancialYear(upcomingFY)).toBe(currentFY)
  })
})
