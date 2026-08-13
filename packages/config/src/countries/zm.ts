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
}
