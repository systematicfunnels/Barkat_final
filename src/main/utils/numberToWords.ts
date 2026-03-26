/**
 * Utility to convert numbers to words in the Indian numbering system (Lakhs, Crores).
 */

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const teens = [
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen'
]

function convertBelowThousand(n: number): string {
  if (n === 0) return ''
  if (n < 10) return ones[n]
  if (n < 20) return teens[n - 10]
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '')
  return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + convertBelowThousand(n % 100) : '')
}

/**
 * Converts a number to words in the Indian numbering system (Lakhs, Crores).
 */
export function numberToWordsIndian(num: number): string {
  if (num === 0) return 'Zero'

  const whole = Math.floor(num)
  const fraction = Math.round((num - whole) * 100)

  let res = ''

  if (whole >= 10000000) {
    res += convertBelowThousand(Math.floor(whole / 10000000)) + ' Crore '
  }
  
  const lakhs = Math.floor((whole % 10000000) / 100000)
  if (lakhs > 0) {
    res += convertBelowThousand(lakhs) + ' Lakh '
  }

  const thousands = Math.floor((whole % 100000) / 1000)
  if (thousands > 0) {
    res += convertBelowThousand(thousands) + ' Thousand '
  }

  const remainder = whole % 1000
  if (remainder > 0) {
    res += convertBelowThousand(remainder)
  }

  res = res.trim()

  if (fraction > 0) {
    if (res === '') res = 'Zero'
    res += ` and ${convertBelowThousand(fraction)} Paise`
  }

  return res
}
