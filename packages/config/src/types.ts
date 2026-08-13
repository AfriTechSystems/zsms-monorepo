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
  cities: Record<string, string>
}
