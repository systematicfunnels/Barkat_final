import { numberToWordsIndian } from '../../../main/utils/numberToWords'

describe('numberToWordsIndian', () => {
  test('converts zero', () => {
    expect(numberToWordsIndian(0)).toBe('Zero')
  })

  test('converts single digits', () => {
    expect(numberToWordsIndian(1)).toBe('One')
    expect(numberToWordsIndian(5)).toBe('Five')
    expect(numberToWordsIndian(9)).toBe('Nine')
  })

  test('converts teens', () => {
    expect(numberToWordsIndian(10)).toBe('Ten')
    expect(numberToWordsIndian(11)).toBe('Eleven')
    expect(numberToWordsIndian(15)).toBe('Fifteen')
    expect(numberToWordsIndian(19)).toBe('Nineteen')
  })

  test('converts tens', () => {
    expect(numberToWordsIndian(20)).toBe('Twenty')
    expect(numberToWordsIndian(35)).toBe('Thirty Five')
    expect(numberToWordsIndian(99)).toBe('Ninety Nine')
  })

  test('converts hundreds', () => {
    expect(numberToWordsIndian(100)).toBe('One Hundred')
    expect(numberToWordsIndian(105)).toBe('One Hundred and Five')
    expect(numberToWordsIndian(999)).toBe('Nine Hundred and Ninety Nine')
  })

  test('converts thousands', () => {
    expect(numberToWordsIndian(1000)).toBe('One Thousand')
    expect(numberToWordsIndian(1500)).toBe('One Thousand Five Hundred')
    expect(numberToWordsIndian(10005)).toBe('Ten Thousand Five')
  })

  test('converts lakhs (Indian system)', () => {
    expect(numberToWordsIndian(100000)).toBe('One Lakh')
    expect(numberToWordsIndian(150000)).toBe('One Lakh Fifty Thousand')
    expect(numberToWordsIndian(2000000)).toBe('Twenty Lakh')
  })

  test('converts crores (Indian system)', () => {
    expect(numberToWordsIndian(10000000)).toBe('One Crore')
    expect(numberToWordsIndian(100000000)).toBe('Ten Crore')
  })

  test('converts complex numbers', () => {
    // 1,23,45,678
    expect(numberToWordsIndian(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight')
  })

  test('converts fractions (Paise)', () => {
    expect(numberToWordsIndian(10.50)).toBe('Ten and Fifty Paise')
    expect(numberToWordsIndian(0.75)).toBe('Zero and Seventy Five Paise')
    expect(numberToWordsIndian(100.05)).toBe('One Hundred and Five Paise')
  })
})
