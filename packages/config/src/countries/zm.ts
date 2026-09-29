import type { CountryConfig } from '../types'

/** Source of truth: `04 Country and Configuration/ZM.md`. */
export const ZM_CONFIG: CountryConfig = {
  code: 'ZM',
  name: 'Zambia',
  currency: {
    code: 'ZMW',
    symbol: 'K',
    name: 'Zambian Kwacha',
    decimals: 2,
    displayFormat: 'K{amount}',
  },
  phone: { countryCode: '+260', minLength: 9, maxLength: 9, stripLeadingZero: true },
  academicYear: {
    terms: 3,
    termNames: ['Term 1', 'Term 2', 'Term 3'],
    startMonth: 1,
    endMonth: 12,
  },
  paymentGateways: [
    'flutterwave', 'pawapay', 'airtel_money', 'mtn_momo', 'zanaco_zpay', 'dpo', 'pesapal',
  ],
  domain: 'zsms.co.zm',
  dataRegion: 'af-south-1',
  complianceLaw: 'Zambia Data Protection Act 2021',
  schoolIdPrefix: 'ZM',
  cities: {
    LSK: 'Lusaka', CBE: 'Copperbelt', NDL: 'Ndola', KIT: 'Kitwe', KWE: 'Kabwe',
    LVS: 'Livingstone', CHI: 'Chipata', SOL: 'Solwezi', MAZ: 'Mazabuka',
    KAF: 'Kafue', CHO: 'Choma', MKS: 'Mongu', SER: 'Serenje',
  },

  /** `ZM.md` → country configuration. Transcribed, not re-derived. */
  provinces: {
    LSK: 'Lusaka Province',
    CPR: 'Central Province',
    CBR: 'Copperbelt Province',
    EPR: 'Eastern Province',
    LPR: 'Luapula Province',
    MPR: 'Muchinga Province',
    NPR: 'Northern Province',
    NWP: 'North-Western Province',
    SPR: 'Southern Province',
    WPR: 'Western Province',
  },

  /**
   * City → province. Must match the CASE in migration `0142`.
   *
   * `CBE` is the awkward one: "Copperbelt" is a province, listed as a city alongside Ndola and
   * Kitwe which are both in it. It stays because school identifiers already embed it — see the
   * note on `cities` in `CountryConfig`.
   */
  cityProvince: {
    LSK: 'LSK', KAF: 'LSK',
    CBE: 'CBR', NDL: 'CBR', KIT: 'CBR',
    KWE: 'CPR', SER: 'CPR',
    LVS: 'SPR', MAZ: 'SPR', CHO: 'SPR',
    CHI: 'EPR',
    SOL: 'NWP',
    MKS: 'WPR',
  },
}
