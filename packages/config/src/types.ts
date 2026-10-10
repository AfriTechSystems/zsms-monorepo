export interface CountryConfig {
  code: string
  name: string
  currency: { code: string; symbol: string; name: string; decimals: number; displayFormat: string }
  phone: { countryCode: string; minLength: number; maxLength: number; stripLeadingZero: boolean }
  academicYear: { terms: number; termNames: string[]; startMonth: number; endMonth: number }
  paymentGateways: string[]
  domain: string
  dataRegion: string
  complianceLaw: string
  schoolIdPrefix: string
  /**
   * City codes. **The city code is part of the school identifier** (`ZM-LSK-0001`) and therefore
   * permanent — renaming or removing one would leave existing schools carrying an identifier that
   * disagrees with this map. Add freely; never edit or delete.
   */
  cities: Record<string, string>
  /** Province codes, per the country reference document. Not part of any identifier. */
  provinces: Record<string, string>
  /**
   * Which province each city sits in, so the registration forms can narrow the city list once a
   * province is chosen.
   *
   * Migration `0142` carries the same mapping to backfill `schools.province_code`, and the two
   * must agree — a school created through the form and one backfilled by the migration should end
   * up in the same province.
   */
  cityProvince: Record<string, string>
}
