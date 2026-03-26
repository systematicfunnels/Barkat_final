import { getCurrentFinancialYear, getFYStartYear, getFYDeadline } from '../../../main/utils/dateUtils'

describe('dateUtils', () => {
  describe('getCurrentFinancialYear', () => {
    test('returns correct FY for April (start of FY)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-04-01'))
      expect(getCurrentFinancialYear()).toBe('2024-25')
    })

    test('returns correct FY for March (end of FY)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-03-31'))
      expect(getCurrentFinancialYear()).toBe('2024-25')
    })

    test('returns correct FY for December', () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-12-31'))
      expect(getCurrentFinancialYear()).toBe('2024-25')
    })

    test('returns correct FY for January', () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-01-01'))
      expect(getCurrentFinancialYear()).toBe('2024-25')
    })
  })

  describe('getFYStartYear', () => {
    test('extracts start year from YYYY-YY format', () => {
      expect(getFYStartYear('2024-25')).toBe(2024)
    })

    test('extracts start year from YYYY format', () => {
      expect(getFYStartYear('2023')).toBe(2023)
    })
  })

  describe('getFYDeadline', () => {
    test('returns correct deadline for FY 2024-25', () => {
      expect(getFYDeadline('2024-25')).toBe('30th June 2025')
    })

    test('returns correct deadline for FY 2023-24', () => {
      expect(getFYDeadline('2023-24')).toBe('30th June 2024')
    })
  })
})
