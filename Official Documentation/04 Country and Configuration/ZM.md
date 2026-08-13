# ZM.md — Zambia Country Configuration Reference

## Related Documents

- `docs/countries/ADDING_COUNTRY.md` — country expansion playbook
- `docs/ARCHITECTURE.md` — multi-country architecture
- `docs/DATABASE.md` — country_code field and school_academic_config table
- `docs/modules/school/SCHOOL_CONFIG.md` — how schools configure their academic structure
- `docs/modules/results/GRADING.md` — grading calculation using country config
- `docs/infra/META_API.md` — WhatsApp configuration for Zambia
- `docs/infra/SUPABASE.md` — Zambia Supabase project setup

---

## Purpose

This document is the complete reference for the Zambia country configuration. It defines every country-specific value used by the ZSMS application when deployed as `zsms.co.zm`. It also documents the Zambian education system in full — both the traditional ECZ system and the new curriculum framework — so that Claude Code sessions building academic modules have accurate context without needing external research.

This document is the source of truth for `packages/config/countries/zm.ts`. Any changes to how ZSMS operates in Zambia start here.

---

## Configuration File Reference

```typescript
// packages/config/countries/zm.ts
export const ZM_CONFIG = {
  code: 'ZM',
  name: 'Zambia',

  currency: {
    code: 'ZMW',
    symbol: 'K',
    name: 'Zambian Kwacha',
    decimals: 2,
    usdRate: 27.50,          // Approximate — updated periodically by AfriTech admin
    displayFormat: 'K{amount}',
    // Examples: K2,500.00 | K1,000 | K250.50
  },

  phone: {
    countryCode: '+260',
    format: '09X XXX XXXX',
    mobileNetworks: ['MTN Zambia', 'Airtel Zambia', 'Zamtel'],
    normalisation: {
      // Rules for normalising user-entered numbers to E.164
      stripLeadingZero: true,   // '0977123456' → '+260977123456'
      minLength: 9,             // Minimum digits after country code
      maxLength: 9,             // Zambia numbers are always 9 digits after +260
    },
  },

  academicYear: {
    terms: 3,
    termNames: ['Term 1', 'Term 2', 'Term 3'],
    startMonth: 1,             // January
    endMonth: 12,              // December
    typicalTermDates: {
      // Approximate — schools set their own actual dates
      term1: { start: 'January', end: 'April' },
      term2: { start: 'May', end: 'August' },
      term3: { start: 'September', end: 'December' },
    },
  },

  paymentGateways: [
    'flutterwave',
    'pawapay',
    'airtel_money',
    'mtn_momo',
    'zanaco_zpay',
    'dpo',
    'pesapal',
  ],

  whatsAppSenderId: 'ZSMS Zambia',
  domain: 'zsms.co.zm',
  appName: 'ZSMS',
  dataRegion: 'af-south-1',
  complianceLaw: 'Zambia Data Protection Act 2021',
  schoolIdPrefix: 'ZM',

  cities: {
    'LSK': 'Lusaka',
    'CBE': 'Copperbelt',
    'NDL': 'Ndola',
    'KIT': 'Kitwe',
    'KWE': 'Kabwe',
    'LVS': 'Livingstone',
    'CHI': 'Chipata',
    'SOL': 'Solwezi',
    'MAZ': 'Mazabuka',
    'KAF': 'Kafue',
    'CHO': 'Choma',
    'MKS': 'Mongu',
    'SER': 'Serenje',
  },

  provinces: {
    'LSK': 'Lusaka Province',
    'CPR': 'Central Province',
    'CBR': 'Copperbelt Province',
    'EPR': 'Eastern Province',
    'LPR': 'Luapula Province',
    'MPR': 'Muchinga Province',
    'NPR': 'Northern Province',
    'NWP': 'North-Western Province',
    'SPR': 'Southern Province',
    'WPR': 'Western Province',
  },
}
```

---

## The Zambian Education System

This section documents the education system in detail. ZSMS must support both the traditional system and the new curriculum framework simultaneously because schools are at different stages of transition.

### System Overview

Zambia currently operates with two coexisting structures:

**Traditional ECZ System (still in use by most schools):**
- Primary: Grade 1 through Grade 7
- Junior Secondary: Grade 8 through Grade 9
- Senior Secondary: Grade 10 through Grade 12
- All grades use the "Grade" prefix
- Examinations administered by the Examination Council of Zambia (ECZ)

**New Curriculum Framework (2023 — being phased in):**
- Primary: Grade 1 through Grade 6 (ends at Grade 6 — final primary exams)
- Secondary: Form 1 through Form 6 (replaces Grade 7 through Grade 12)
- Junior Secondary merged with Senior Secondary into Forms 1–6
- O-Level pathway: Forms 1–4 (final exams at Form 4)
- A-Level pathway: Forms 5–6 (Advanced level — specialisation)
- Progression from Grade 6 to Form 1 is no longer automatic

**Hybrid reality (2026):** Most private schools are in transition. A school may have current students in the old Grade 7–12 system while new students enter under Form 1–6. ZSMS supports this by allowing schools to configure their grade levels freely — they can have both "Grade 9 (Form 3)" transition labels and purely "Form 1" labels depending on their current state.

### Grade Level Mapping (Old to New)

| Old System | New System | Notes |
|---|---|---|
| Grade 1 | Grade 1 | Unchanged |
| Grade 2 | Grade 2 | Unchanged |
| Grade 3 | Grade 3 | Unchanged |
| Grade 4 | Grade 4 | Unchanged |
| Grade 5 | Grade 5 | Unchanged |
| Grade 6 | Grade 6 | Now final primary year (was penultimate) |
| Grade 7 | Form 1 | First year of secondary under new system |
| Grade 8 | Form 2 | |
| Grade 9 | Form 3 | |
| Grade 10 | Form 4 | O-Level examinations (final for most students) |
| Grade 11 | Form 5 | A-Level — specialisation begins |
| Grade 12 | Form 6 | A-Level — final year |

### How ZSMS Handles Both Systems

Schools select their grade structure during onboarding from three options:

**Option 1 — Traditional ECZ (Grades 1–12):**
Pre-populated with Grade 1 through Grade 12. Schools using the old system exclusively select this. Historical records for current students remain as Grades.

**Option 2 — New Curriculum (Grades 1–6 then Forms 1–6):**
Pre-populated with Grade 1–6 for primary and Form 1–6 for secondary. Schools that have fully transitioned select this.

**Option 3 — Hybrid / Transitioning:**
School builds their own level list. They can create levels like "Grade 9 / Form 3" to handle students mid-transition. This is the most common choice for private schools in 2026.

All three options use the same underlying `school_grade_levels` table — they just populate it differently during onboarding.

---

## Grading Systems

### System 1 — ECZ Traditional (Percentage-Based)

Used by schools operating under the traditional ECZ examination system. Marks are recorded as percentages (0–100) and mapped to letter grades and descriptors.

```typescript
ecz_percentage: {
  name: 'ECZ Traditional',
  markType: 'percentage',     // Marks entered as 0-100
  grades: [
    { letter: 'A',  descriptor: 'Distinction', min: 80, max: 100, points: 1, isPassing: true },
    { letter: 'B',  descriptor: 'Merit',       min: 65, max: 79,  points: 2, isPassing: true },
    { letter: 'C',  descriptor: 'Credit',      min: 50, max: 64,  points: 3, isPassing: true },
    { letter: 'D',  descriptor: 'Pass',        min: 40, max: 49,  points: 4, isPassing: true },
    { letter: 'E',  descriptor: 'Weak Pass',   min: 30, max: 39,  points: 5, isPassing: false },
    { letter: 'F',  descriptor: 'Fail',        min: 0,  max: 29,  points: 6, isPassing: false },
  ],
  passMark: 40,
  creditMark: 50,
  distinctionMark: 80,
  positionCalculation: 'aggregate_points',  // Lower aggregate = better position
}
```

**Credit calculation for ECZ:** A credit is a grade of C or above (50% and above). University entrance requires a minimum number of credits in specified subjects. ZSMS calculates and displays the credit count on the report card.

### System 2 — Cambridge O-Level (Forms 1–4)

Used by schools offering Cambridge International examinations at O-Level (Form 4). Letter grades follow the Cambridge scale with grade boundaries set by Cambridge annually — the boundaries in ZSMS are indicative defaults that schools can adjust.

```typescript
cambridge_o_level: {
  name: 'Cambridge O-Level',
  markType: 'percentage',
  grades: [
    { letter: 'A*', descriptor: 'Exceptional',  min: 90, max: 100, points: 1, isPassing: true },
    { letter: 'A',  descriptor: 'Excellent',    min: 80, max: 89,  points: 2, isPassing: true },
    { letter: 'B',  descriptor: 'Very Good',    min: 70, max: 79,  points: 3, isPassing: true },
    { letter: 'C',  descriptor: 'Good',         min: 60, max: 69,  points: 4, isPassing: true },
    { letter: 'D',  descriptor: 'Satisfactory', min: 50, max: 59,  points: 5, isPassing: true },
    { letter: 'E',  descriptor: 'Minimum Pass', min: 40, max: 49,  points: 6, isPassing: true },
    { letter: 'U',  descriptor: 'Ungraded',     min: 0,  max: 39,  points: 7, isPassing: false },
  ],
  passMark: 40,
  creditMark: 60,
  positionCalculation: 'aggregate_points',
  note: 'Grade boundaries are indicative — Cambridge sets final boundaries after each exam session.',
}
```

### System 3 — Cambridge A-Level (Forms 5–6)

Used by schools offering Cambridge Advanced Level examinations. Fewer grade divisions — primarily used for university entrance qualification.

```typescript
cambridge_a_level: {
  name: 'Cambridge A-Level',
  markType: 'percentage',
  grades: [
    { letter: 'A*', descriptor: 'Outstanding', min: 90, max: 100, points: 1, isPassing: true },
    { letter: 'A',  descriptor: 'Excellent',   min: 80, max: 89,  points: 2, isPassing: true },
    { letter: 'B',  descriptor: 'Very Good',   min: 70, max: 79,  points: 3, isPassing: true },
    { letter: 'C',  descriptor: 'Good',        min: 60, max: 69,  points: 4, isPassing: true },
    { letter: 'D',  descriptor: 'Satisfactory',min: 50, max: 59,  points: 5, isPassing: true },
    { letter: 'E',  descriptor: 'Pass',        min: 40, max: 49,  points: 6, isPassing: true },
    { letter: 'U',  descriptor: 'Ungraded',    min: 0,  max: 39,  points: 7, isPassing: false },
  ],
  passMark: 40,
  positionCalculation: 'aggregate_points',
}
```

### System 4 — Custom

Schools can define their own grading scale during onboarding or in settings. Custom scales are stored in `school_grading_scales` table with the same structure as the above systems. Common custom scales include:

- Percentage only (no letter grades — mark displayed as a number)
- Division system (First Division, Second Division, Third Division, Fail)
- GPA-style (4.0 scale)

---

## Subjects Reference List

Pre-populated subject suggestions shown during school onboarding. Schools select from this list and can add custom subjects. All entries are stored in `reference_subjects_zm` table.

### Pre-School and Early Childhood (ECD)

| Subject Code | Subject Name | Core |
|---|---|---|
| `literacy` | Literacy and Language | Yes |
| `numeracy` | Numeracy | Yes |
| `creative_arts` | Creative Arts | No |
| `physical_dev` | Physical Development | No |
| `social_skills` | Social and Emotional Development | No |

### Primary — Grades 1 to 6 (ECZ Traditional)

| Subject Code | Subject Name | Core | Notes |
|---|---|---|---|
| `english_primary` | English | Yes | |
| `mathematics` | Mathematics | Yes | |
| `integrated_science` | Integrated Science | Yes | Being split in new curriculum |
| `social_studies` | Social Studies | Yes | Being split in new curriculum |
| `religious_education` | Religious Education | No | |
| `local_language` | Local Language | Yes | School selects specific language |
| `expressive_arts` | Expressive Arts | No | |
| `physical_education` | Physical Education | No | |
| `home_economics` | Home Economics | No | Upper primary only |
| `agriculture` | Agriculture | No | Upper primary only |

### Primary — Grades 1 to 6 (New Curriculum Additions)

Additional subjects introduced or restructured under the 2023 curriculum:

| Subject Code | Subject Name | Core | Notes |
|---|---|---|---|
| `geography_primary` | Geography | No | Split from Social Studies |
| `history_primary` | History | No | Split from Social Studies |
| `civics_primary` | Civics | No | Split from Social Studies |
| `ict_primary` | ICT / Computer Studies | No | |

### Secondary — Forms 1 to 4 / Grades 7 to 10 (O-Level)

| Subject Code | Subject Name | Core | Curriculum |
|---|---|---|---|
| `english_lang` | English Language | Yes | ECZ + Cambridge |
| `english_lit` | English Literature | No | Cambridge |
| `mathematics_secondary` | Mathematics | Yes | ECZ + Cambridge |
| `additional_maths` | Additional Mathematics | No | Cambridge |
| `biology` | Biology | Yes | ECZ + Cambridge (split from Integrated Science) |
| `physics` | Physics | Yes | ECZ + Cambridge (split from Integrated Science) |
| `chemistry` | Chemistry | Yes | ECZ + Cambridge (split from Integrated Science) |
| `combined_science` | Combined Science | No | Some ECZ schools |
| `geography_secondary` | Geography | No | ECZ + Cambridge (split from Social Studies) |
| `history_secondary` | History | No | ECZ + Cambridge (split from Social Studies) |
| `civics_secondary` | Civic Education | No | ECZ |
| `religious_ed_secondary` | Religious Education | No | ECZ |
| `ict_secondary` | ICT / Computer Studies | No | ECZ + Cambridge |
| `business_studies` | Business Studies | No | ECZ + Cambridge |
| `commerce` | Commerce | No | ECZ |
| `accounts` | Principles of Accounts | No | ECZ + Cambridge |
| `economics` | Economics | No | ECZ + Cambridge |
| `french` | French | No | ECZ + Cambridge |
| `physical_education_sec` | Physical Education | No | ECZ |
| `art_design` | Art and Design | No | ECZ + Cambridge |
| `music` | Music | No | |
| `food_nutrition` | Food and Nutrition | No | ECZ |
| `technical_drawing` | Technical Drawing | No | ECZ |
| `woodwork` | Woodwork | No | ECZ |
| `metalwork` | Metalwork | No | ECZ |
| `agriculture_secondary` | Agriculture | No | ECZ |
| `bemba` | Bemba | No | Local language |
| `nyanja` | Nyanja | No | Local language |
| `tonga` | Tonga | No | Local language |
| `lozi` | Lozi | No | Local language |

### Advanced Level — Forms 5 to 6 / Grades 11 to 12 (A-Level Specialisation)

| Subject Code | Subject Name | Core | Notes |
|---|---|---|---|
| `mathematics_alevel` | Mathematics | No | Most common A-level subject |
| `further_maths` | Further Mathematics | No | |
| `physics_alevel` | Physics | No | |
| `chemistry_alevel` | Chemistry | No | |
| `biology_alevel` | Biology | No | |
| `economics_alevel` | Economics | No | |
| `business_alevel` | Business Studies | No | |
| `accounts_alevel` | Accounting | No | |
| `geography_alevel` | Geography | No | |
| `history_alevel` | History | No | |
| `english_alevel` | English Language | No | |
| `ict_alevel` | ICT | No | |
| `divinity` | Divinity / Religious Studies | No | |

---

## Local Languages

Zambia has 73 recognised local languages. The seven official regional languages used in education are:

| Code | Language | Primary Region |
|---|---|---|
| `bemba` | Bemba | Copperbelt, Northern, Luapula Provinces |
| `nyanja` | Nyanja / Chewa | Lusaka, Eastern Provinces |
| `tonga` | Tonga | Southern Province |
| `lozi` | Lozi | Western Province |
| `kaonde` | Kaonde | North-Western Province |
| `luvale` | Luvale | North-Western Province |
| `lunda` | Lunda | North-Western Province |

During school onboarding, schools select which local language(s) they teach. This populates their subject list accordingly.

---

## Subject Restructuring Notes (Important for Results Module)

The following subject changes affect how historical vs current results are stored and displayed:

**Integrated Science → Biology + Physics + Chemistry**
Schools transitioning to the new curriculum will have some students with historical `integrated_science` results and current students with separate `biology`, `physics`, `chemistry` results. Both subject codes remain valid. The report card displays whatever subject code is on the result record — no conversion or merging occurs.

**Social Studies → Geography + History + Civics**
Same situation. `social_studies` results for historical students coexist with separate subject results for current students.

**Religious Education (RE 2044 + RE 2046 merged)**
The two separate RE papers have been merged. ZSMS uses `religious_education` as the unified code. Schools that previously had `re_2044` and `re_2046` as separate subjects should migrate to `religious_education` during their grade structure reconfiguration.

**Science 5124 removed**
Schools that had `science_5124` as a subject should remove it from their subject configuration and ensure no current students have active marks entries for it.

---

## Payment Gateway Notes for Zambia

### PawaPay
PawaPay is the most straightforward mobile money gateway for Zambia. It supports all three networks simultaneously (Airtel, MTN, Zamtel) through a single integration. Configuration requires:
- `correspondent`: `AIRTEL_ZAMBIA`, `MTN_ZAMBIA`, or `ZAMTEL`
- Country code: `ZMB` (ISO 3166-1 alpha-3 — note: three letters, not two)
- Transactions are in ZMW

### Airtel Money Direct
For schools that want to accept Airtel Money specifically without PawaPay as an intermediary. Requires a direct merchant agreement with Airtel Zambia.

### MTN MoMo
For schools accepting MTN Mobile Money. Requires MTN Zambia merchant account.

### Zanaco ZPay
Zambia National Commercial Bank's payment platform. Used primarily by schools banking with Zanaco who want seamless bank-to-account transfers. Requires a Zanaco business account.

### Flutterwave
Supports card payments (Visa, Mastercard) and some mobile money in Zambia. Best for schools with parents who pay by card — typically urban elite private schools.

### DPO (Direct Pay Online)
Pan-African payment gateway. Supports multiple payment methods including card and mobile money. Alternative to Flutterwave for card payments.

---

## Compliance — Zambia Data Protection Act 2021

Key requirements affecting ZSMS operations in Zambia:

**Data Controller Registration:** AfriTech Systems Limited must be registered as a Data Controller with the Zambia Information and Communications Technology Authority (ZICTA). Confirm registration status before launching with the first paid school.

**Data Subject Rights:** Parents and students have the right to access their data, correct inaccurate data, and request deletion. ZSMS supports these rights via the parent portal (data export) and the school admin panel (data correction). Deletion requests are processed within 30 days.

**Consent Requirements:** Explicit consent is required before sharing personal data with third parties (lending partners). The loan application consent flow in ZSMS satisfies this requirement — the consent_log table provides the audit trail.

**Data Residency:** The ZSMS Zambia deployment uses the Supabase `af-south-1` (South Africa) region. This satisfies the Act's requirement for data to be stored within a jurisdiction with adequate data protection laws. South Africa has the POPIA which is recognised as adequate.

**Breach Notification:** Data breaches must be reported to ZICTA within 72 hours of discovery. This is AfriTech's responsibility as the Data Controller. Sentry alerts and the audit trail support rapid breach investigation.

---

## Business Rules Specific to Zambia

1. Phone numbers for Zambia must be normalised to E.164 format: `+260` followed by 9 digits. The leading zero is stripped during normalisation.
2. All monetary amounts displayed in the Zambian deployment use the `K` prefix (e.g. `K2,500.00`). USD is shown only as a secondary reference in the super admin financial dashboard.
3. The academic year follows the Zambian calendar: January to December, 3 terms. Schools that deviate from this (e.g. calendar year schools) configure their own term dates.
4. Both ECZ and Cambridge grading systems are valid selections for any Zambian school. ZSMS does not restrict which grading system a school can choose.
5. The subject restructuring notes above must be communicated to schools during onboarding to prevent confusion when migrating historical records.

---

## Known Limitations and Future Work

- Zambia has no Supabase data centre. The af-south-1 region (South Africa) is used as the closest available option. If stricter data localisation requirements are introduced, a self-hosted Supabase deployment on Zambian infrastructure would be required.
- The ZMW/USD exchange rate in the config is static and manually updated. A future improvement would fetch the rate automatically from a public API and update the config dynamically.
- Local language subject offerings (Bemba, Nyanja, etc.) currently require a custom subject entry during onboarding. A future improvement would allow schools to select their regional language from a dropdown that auto-populates the correct subject.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 4 country documentation |
| 2026-04-26 | Added dual education system documentation | Zambia 2023 curriculum reform — schools transitioning between Grade and Form systems simultaneously |
| 2026-04-26 | Added complete subject reference list | Onboarding subject pre-population for Zambian schools |
| 2026-04-26 | Added subject restructuring notes | Integrated Science and Social Studies split affects historical records |
