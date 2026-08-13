import { getCountryConfig } from '@zsms/config'

/**
 * Normalises a phone number to E.164. Returns null when invalid.
 * ZM: '0977123456' -> '+260977123456' (DATABASE.md design principle 7).
 */
export function normalisePhone(input: string): string | null {
  const { phone } = getCountryConfig()
  let digits = input.replace(/[\s\-()]/g, '')

  if (digits.startsWith(phone.countryCode)) {
    digits = digits.slice(phone.countryCode.length)
  } else if (digits.startsWith('00' + phone.countryCode.slice(1))) {
    digits = digits.slice(phone.countryCode.length + 1)
  }

  if (phone.stripLeadingZero && digits.startsWith('0')) digits = digits.slice(1)
  if (!/^\d+$/.test(digits)) return null
  if (digits.length < phone.minLength || digits.length > phone.maxLength) return null

  return `${phone.countryCode}${digits}`
}
