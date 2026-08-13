import { getCountryConfig } from '@zsms/config'

/**
 * Formats a monetary amount using the active country config.
 * Amounts are NUMERIC(12,2) in the database — never float (CONVENTIONS.md #5).
 */
export function formatCurrency(amount: number, opts?: { showDecimals?: boolean }): string {
  const { currency } = getCountryConfig()
  const showDecimals = opts?.showDecimals ?? true
  const formatted = amount.toLocaleString('en-ZM', {
    minimumFractionDigits: showDecimals ? currency.decimals : 0,
    maximumFractionDigits: showDecimals ? currency.decimals : 0,
  })
  return currency.displayFormat.replace('{amount}', formatted)
}
