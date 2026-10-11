# ACCOUNTING_CONNECTORS.md — Accounting System Connectors

## Related Documents

- `docs/modules/integrations/INTEGRATIONS.md` — integrations framework overview
- `docs/modules/fees/PAYMENTS.md` — payment events that trigger accounting sync
- `docs/modules/fees/FEE_STRUCTURES.md` — fee records that generate invoices
- `docs/modules/students/STUDENTS.md` — student creation that creates customer records
- `docs/DATABASE.md` — school_integrations config structure for each connector

---

## Implementation Status (2026-10-11)

**Connector 1 (Sage 50 CSV export) is built. Connectors 2–4 are credential-blocked.**

| Connector | State |
|---|---|
| **Sage 50 — CSV export** | **Built** (`0263`). `sage50_export_rows()` + `/api/school/integrations/sage50`, downloadable from Settings → Connections |
| Sage Business Cloud | Blocked — needs OAuth credentials |
| QuickBooks | Blocked — needs a registered app |
| Xero | Blocked — needs OAuth credentials |

Sage 50 was built first because it is the one connector needing **no authentication at
all**: a desktop application with no cloud API, so the integration is a file the
accountant imports. This document notes Sage 50 Pastel is the most common accounting
software in Zambian private schools, which makes it both the easiest and the most useful.

**Three decisions in the export worth preserving:**

- **Verified payments only.** A Sales Receipt asserts money arrived, and ZSMS records a
  parent's *claim* separately from a bursar's *verification*. Exporting an unverified
  claim would put the school's books out by whatever a parent mistyped. Reversals and
  waivers are excluded for the same reason — both would overstate income.
- **UTF-8 BOM and CRLF line endings.** Sage 50 is a Windows desktop application: without
  the BOM it reads the file in the system codepage and mangles any diacritic, and without
  CRLF some versions treat the whole file as a single line. Two one-character fixes for a
  failure that presents as corrupt data.
- **RFC 4180 quoting.** A pupil's name can carry an apostrophe and a fee label a comma;
  either unescaped shifts every subsequent column, which Sage imports without complaint
  and the accountant finds at reconciliation.

Nominal codes come from `school_integrations.config` — a default plus per-fee-label
overrides — because a school's chart of accounts is its own. The export works against
the documented default of 4000 even for a school that has never opened the screen.

---

## Purpose

This document defines the four accounting system connectors — Sage 50 (CSV export), Sage Business Cloud (API), QuickBooks Online (API), and Google Sheets (API). Every Claude Code session building an accounting connector must read this document in full.

---

## Overview

The most common pain point for school accountants is double entry — recording a payment in ZSMS and then recording it again in their accounting software. The accounting connectors eliminate this. When a payment is verified in ZSMS, the accounting system is updated automatically.

The connectors are Phase 2 features. The architecture (database tables, dispatch queue) is built in Phase 1 so schools can connect immediately when connectors go live.

---

## Connector 1 — Sage 50 (Desktop) — CSV Export

Sage 50 Pastel is the most common accounting software in Zambian private schools. It is a desktop application — there is no cloud API. Direct real-time integration is not possible.

The practical solution is a Sage-compatible CSV export that the school's accountant downloads from ZSMS and imports into Sage using Sage 50's batch import feature. This eliminates re-typing individual transactions while working within Sage 50's constraints.

### What the CSV Contains

The export produces a Nominal Ledger batch import CSV in Sage 50's expected format:

```csv
Type,Account,Date,Reference,Description,Net Amount,Tax Code,Tax Amount
SA,4000,15/09/2026,REC-ZM-LSK-0001-000042,"Chanda Bwalya - Tuition Fee Term 2",2500.00,T0,0.00
SA,4001,15/09/2026,REC-ZM-LSK-0001-000043,"Mwamba Phiri - Activity Fee Term 2",300.00,T0,0.00
```

**Column definitions:**
- `Type`: SA = Sales Receipt (payment received)
- `Account`: Nominal account code — configurable per fee type (default: 4000 for tuition, school configures)
- `Date`: Payment verification date
- `Reference`: ZSMS receipt number — the link between ZSMS and Sage records
- `Description`: Student name + fee label + term
- `Net Amount`: Amount paid
- `Tax Code`: T0 (zero-rated — school fees are VAT exempt in Zambia)

### Configuration

```typescript
// school_integrations.config for sage_50_export
interface Sage50ExportConfig {
  default_nominal_code: string        // e.g. '4000'
  nominal_code_by_fee_label?: {       // Override per fee type
    'Tuition Fee': '4000',
    'Activity Fee': '4001',
    'Boarding Fee': '4002',
    'Exam Fee': '4003',
  }
  date_format: 'DD/MM/YYYY' | 'MM/DD/YYYY'
  include_student_name: boolean        // True = description includes student name
  tax_code: string                     // Default 'T0' (zero-rated)
}
```

### Generating the Export

The school accountant navigates to Fees → Export → Sage 50 Import File:

```
Generate Sage 50 Import File
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Date range:
From: [date picker]   To: [date picker]

Include:
☑ Verified payments (sales receipts)
☐ Fee records generated (invoices) — optional

[Download CSV]

The downloaded file can be imported directly into Sage 50
via File → Import → Nominal Ledger Transactions.
```

No events subscription needed for Sage 50 — it is a pull model (accountant downloads when ready), not push.

### Importing into Sage 50

Instructions included in the Settings → Integrations → Sage 50 panel:

```
How to import into Sage 50:
1. Open Sage 50 on your computer
2. Go to File → Import → Nominal Ledger Transactions
3. Select the downloaded CSV file
4. Map columns (first import only — Sage saves the mapping)
5. Preview and confirm
6. Transactions appear in your Nominal Ledger
```

---

## Connector 2 — Sage Business Cloud (API)

Sage Business Cloud is the cloud version of Sage. Schools on this platform get real-time integration — no manual downloads.

### OAuth Setup

```
Settings → Integrations → Connect Sage Business Cloud
→ [Connect to Sage →] button
→ Redirected to Sage OAuth consent screen
→ School owner selects their Sage Business Cloud account
→ Grants ZSMS permissions:
    - Read contacts
    - Create/update contacts
    - Create sales receipts
    - Read accounts (for nominal code lookup)
→ Redirected back to ZSMS with OAuth code
→ ZSMS exchanges code for access + refresh token
→ Tokens encrypted and stored in school_integrations.credentials_enc
```

### Event: `payment.verified` → Sage Sales Receipt

```typescript
async function syncPaymentToSageCloud(
  payment: Payment,
  feeRecord: FeeRecord,
  student: Student,
  config: SageCloudConfig,
  credentials: SageCloudCredentials
): Promise<void> {

  const sageClient = new SageClient(credentials)

  // Find or create the customer (parent/student) in Sage
  const contact = await sageClient.findOrCreateContact({
    name: student.first_name + ' ' + student.last_name,
    reference: student.student_id,
    notes: `ZSMS Student ID: ${student.student_id}`,
  })

  // Create the sales receipt
  await sageClient.createSalesReceipt({
    contact_id: contact.id,
    date: payment.verified_at,
    reference: payment.receipt_number,
    description: `${feeRecord.fee_label} - Term ${feeRecord.term_number} ${feeRecord.academic_year}`,
    total_amount: payment.amount,
    ledger_account_code: config.nominal_codes[feeRecord.fee_label] ?? config.default_nominal_code,
    tax_rate_id: 'EXEMPT',
  })
}
```

### Event: `student.created` → Sage Contact

When a new student is enrolled, a contact is created in Sage:

```typescript
await sageClient.createContact({
  name: `${student.first_name} ${student.last_name}`,
  reference: student.student_id,
  contact_type: 'CUSTOMER',
  notes: `Grade: ${student.grade_id} | Enrolled: ${student.enrolment_date}`,
})
```

### Configuration

```typescript
interface SageCloudConfig {
  region: 'ZM' | 'ZA' | 'GB'
  default_nominal_code: string
  nominal_codes: Record<string, string>  // fee_label → Sage account code
  create_contacts_on_student_create: boolean
  tax_rate: 'EXEMPT' | 'ZERO'           // Zambia: school fees are exempt
}
```

### Token Refresh

Sage access tokens expire every hour. The dispatch Edge Function automatically refreshes using the stored refresh token:

```typescript
async function getSageToken(credentials: SageCredentials): Promise<string> {
  if (isExpired(credentials.access_token_expires_at)) {
    const refreshed = await refreshSageToken(credentials.refresh_token)
    await updateStoredCredentials(integrationId, refreshed)
    return refreshed.access_token
  }
  return credentials.access_token
}
```

---

## Connector 3 — QuickBooks Online (API)

QuickBooks Online is the second most common cloud accounting tool among Zambian private schools.

### OAuth Setup

Same OAuth flow as Sage Business Cloud — QuickBooks uses OAuth 2.0 via Intuit's OAuth server.

```
→ [Connect to QuickBooks →]
→ Intuit OAuth consent screen
→ Grant permissions: accounting, read/write
→ Redirect back to ZSMS with tokens
```

### Event: `payment.verified` → QuickBooks Payment

```typescript
async function syncPaymentToQuickBooks(
  payment: Payment,
  feeRecord: FeeRecord,
  student: Student,
  config: QuickBooksConfig
): Promise<void> {

  const qbClient = new QuickBooksClient(credentials)

  // Find or create Customer in QuickBooks
  const customer = await qbClient.findOrCreateCustomer({
    DisplayName: `${student.first_name} ${student.last_name}`,
    Notes: `ZSMS: ${student.student_id}`,
  })

  // Find or create the Income Account
  const account = await qbClient.findAccount(
    config.income_account_name ?? 'School Fees Income'
  )

  // Create Sales Receipt (payment received without prior invoice)
  await qbClient.createSalesReceipt({
    CustomerRef: { value: customer.Id },
    TxnDate: payment.verified_at,
    DocNumber: payment.receipt_number,
    Line: [{
      Amount: payment.amount,
      Description: `${feeRecord.fee_label} - Term ${feeRecord.term_number}`,
      SalesItemLineDetail: {
        ItemRef: { value: config.fee_item_id },
        UnitPrice: payment.amount,
        Qty: 1,
      },
    }],
    DepositToAccountRef: { value: config.deposit_account_id },
  })
}
```

### Configuration

```typescript
interface QuickBooksConfig {
  realm_id: string                    // QuickBooks company ID
  income_account_name: string         // Default: 'School Fees Income'
  fee_item_id: string                 // QuickBooks Product/Service item for fees
  deposit_account_id: string          // Bank account to deposit into
  create_invoices: boolean            // TRUE: create invoice when fee record generated
}
```

---

## Connector 4 — Xero (API)

Xero is growing in adoption among newer and more tech-forward Zambian private schools. Integration follows the same pattern as Sage Business Cloud and QuickBooks.

### OAuth Setup

Xero uses OAuth 2.0 via Xero's identity server.

### Event: `payment.verified` → Xero Payment

```typescript
async function syncPaymentToXero(
  payment: Payment,
  feeRecord: FeeRecord,
  student: Student,
  config: XeroConfig
): Promise<void> {

  const xeroClient = new XeroClient(credentials)

  // Find or create Contact in Xero
  const contact = await xeroClient.findOrCreateContact({
    Name: `${student.first_name} ${student.last_name}`,
    AccountNumber: student.student_id,
  })

  // Create a Receive Money transaction
  await xeroClient.createBankTransaction({
    Type: 'RECEIVE',
    Contact: { ContactID: contact.ContactID },
    Date: payment.verified_at,
    Reference: payment.receipt_number,
    BankAccount: { Code: config.bank_account_code },
    LineItems: [{
      Description: `${feeRecord.fee_label} - Term ${feeRecord.term_number} ${feeRecord.academic_year}`,
      Quantity: 1,
      UnitAmount: payment.amount,
      AccountCode: config.income_account_code ?? '200',
      TaxType: 'NONE',
    }],
  })
}
```

### Configuration

```typescript
interface XeroConfig {
  tenant_id: string                 // Xero organisation ID
  bank_account_code: string         // Xero bank account code for receipts
  income_account_code: string       // Xero account code for fee income (default: '200')
  tracking_category_name?: string   // Optional: Xero tracking category (e.g. by term)
}
```

---

## Connector 5 — Google Sheets (API)

Google Sheets is the universal fallback integration that works for any school regardless of their accounting system. It appends ZSMS events as rows to a configured Google Sheet.

### Why Google Sheets

- Almost every school has Google Workspace
- Accountants are comfortable with spreadsheets
- Schools can build their own dashboards and reports in Sheets
- Zero accounting software knowledge required
- Works as a staging area — accountant reviews in Sheets before posting to their accounting system

### OAuth Setup

```
→ [Connect to Google Sheets →]
→ Google OAuth consent screen
→ Grant permissions: google.spreadsheets (read/write to specific sheet)
→ School selects which spreadsheet and tab to write to
```

### Event: `payment.verified` → New Row in Sheet

```typescript
async function syncPaymentToGoogleSheets(
  payment: Payment,
  feeRecord: FeeRecord,
  student: Student,
  config: GoogleSheetsConfig
): Promise<void> {

  const sheetsClient = new GoogleSheetsClient(credentials)

  // Append a row to the configured sheet and tab
  await sheetsClient.appendRow(
    config.spreadsheet_id,
    config.payments_tab_name ?? 'Payments',
    [
      new Date(payment.verified_at).toLocaleDateString('en-ZM'),
      payment.receipt_number,
      student.student_id,
      `${student.first_name} ${student.last_name}`,
      student.grade_id,
      feeRecord.fee_label,
      `Term ${feeRecord.term_number} ${feeRecord.academic_year}`,
      payment.amount,
      payment.payment_method,
      payment.transaction_reference ?? '',
    ]
  )
}
```

### Configurable Tabs

Schools can configure different events to write to different tabs:

```typescript
interface GoogleSheetsConfig {
  spreadsheet_id: string
  payments_tab_name: string           // Default: 'Payments'
  students_tab_name?: string          // Where new students are logged
  attendance_tab_name?: string        // Where daily attendance summaries go
  fee_records_tab_name?: string       // Where new fee records are logged
  column_headers_row: number          // Row number where headers are (default: 1)
  auto_format_currency: boolean       // Format amount column as ZMW currency
}
```

### Automatic Header Row

When first connecting, ZSMS writes the column headers to row 1 of each configured tab:

```
Date | Receipt # | Student ID | Student Name | Grade | Fee | Term | Amount | Method | Reference
```

This ensures the accountant can build formulas and filters based on consistent column positions.

---

## Connector Testing

Before enabling any connector for real events, the school can send a test event:

```
Settings → Integrations → [Connector] → Send Test Event

This will send a sample payment event to verify the connection works.
No real data will be created in your accounting system.

[Send Test Event]
→ Integration log shows: status 'success' or 'failed' with error details
```

---

## Business Rules

1. All accounting connectors use ZSMS receipt numbers as the external reference — this is the key that links a ZSMS payment to the corresponding entry in the accounting system.
2. OAuth tokens are encrypted using `GATEWAY_ENCRYPTION_KEY` before storage. Plaintext tokens never appear in logs, API responses, or the database.
3. If a connector fails for a payment event, the payment remains verified in ZSMS. The accounting system sync is a secondary operation — it never blocks or rolls back the primary ZSMS operation.
4. Sage 50 (CSV export) uses a pull model — no OAuth, no event subscriptions, no integration log entries. The accountant downloads when ready.
5. Token refresh is handled automatically by the dispatch Edge Function. If a refresh fails (revoked by the school admin in the target system), the integration is paused and the school is notified to reconnect.
6. Google Sheets rows are appended — never updated or deleted. If a payment is reversed in ZSMS, a new row is appended with a negative amount and a reference to the original receipt number.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | CRM and accounting integration confirmed |
| 2026-04-26 | Sage 50 CSV export as pull model | Sage 50 desktop has no cloud API |
| 2026-04-26 | Google Sheets as universal fallback | Works for all schools regardless of accounting system |
| 2026-04-26 | Phase 2 classification | Post-pilot implementation |
