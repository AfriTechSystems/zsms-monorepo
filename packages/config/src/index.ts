/**
 * Country configuration.
 *
 * DYNAMIC_CONFIG.md: country config stays in CODE, deliberately. Adding a
 * country is a reviewed, tested event (ADDING_COUNTRY.md) — not a form
 * submission. Everything else configurable lives in the afritech schema.
 */
export { ZM_CONFIG } from './countries/zm'
export type { CountryConfig } from './types'

import { ZM_CONFIG } from './countries/zm'
import type { CountryConfig } from './types'

const COUNTRIES: Record<string, CountryConfig> = { ZM: ZM_CONFIG }

export function getCountryConfig(): CountryConfig {
  const code = process.env['NEXT_PUBLIC_COUNTRY_CODE'] ?? 'ZM'
  const config = COUNTRIES[code]
  if (!config) {
    throw new Error(
      `No country config for "${code}". Available: ${Object.keys(COUNTRIES).join(', ')}. ` +
        `Adding a country follows 04 Country and Configuration/ADDING_COUNTRY.md.`,
    )
  }
  return config
}
