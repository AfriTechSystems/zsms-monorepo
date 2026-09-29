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

/**
 * The cities in one province, as `[code, name]` pairs sorted by name — what a registration form
 * needs once a province has been chosen.
 *
 * Returns an empty list for a province with no cities configured rather than throwing. A province
 * ZSMS has not reached yet is a normal state, and a form should show "no cities configured" rather
 * than fail to render.
 */
export function citiesInProvince(provinceCode: string): Array<[string, string]> {
  const config = getCountryConfig()
  return Object.entries(config.cities)
    .filter(([code]) => config.cityProvince[code] === provinceCode)
    .sort((a, b) => a[1].localeCompare(b[1]))
}

/**
 * Every city must belong to a province, or it can never be picked — the registration form lists
 * cities *within* a chosen province, so an unmapped city is invisible rather than merely untidy.
 *
 * Checked at module load, which means a bad edit to a country file fails the build rather than
 * producing a form with a silently missing option. `ADDING_COUNTRY.md` is the place a second
 * country would have to satisfy this too.
 */
function assertEveryCityHasAProvince(config: CountryConfig): void {
  const orphans = Object.keys(config.cities).filter(
    (code) => !(code in config.cityProvince) || !(config.cityProvince[code]! in config.provinces),
  )
  if (orphans.length > 0) {
    throw new Error(
      `Country ${config.code}: city code(s) ${orphans.join(', ')} have no valid province in ` +
        `cityProvince. A city with no province cannot be chosen on the registration form. ` +
        `Migration 0142 carries the same mapping and must agree.`,
    )
  }
}

for (const config of Object.values(COUNTRIES)) assertEveryCityHasAProvince(config)
