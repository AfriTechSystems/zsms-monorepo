# CHATBOT.md — WhatsApp Chatbot

## Related Documents

- `docs/modules/communication/WHATSAPP.md` — WhatsApp infrastructure
- `docs/modules/communication/TEMPLATES.md` — response templates
- `docs/modules/communication/MESSAGE_LOG.md` — inbound message tracking
- `docs/infra/META_API.md` — inbound webhook configuration
- `docs/api/EDGE_FUNCTIONS.md` — whatsapp-inbound Edge Function

---

## Purpose

This document defines the WhatsApp chatbot — how inbound messages are received, how commands are processed, how responses are formatted, and how the chatbot handles multiple children and edge cases. Every Claude Code session building the chatbot must read this document.

---

## Overview

The chatbot allows parents and alumni to get instant information by texting keywords to the ZSMS WhatsApp Business number. No app download required. No login needed after the first time. The chatbot is a pull mechanism — parents request information when they want it, rather than waiting for push notifications.

The chatbot works within WhatsApp's 24-hour session window. When a parent sends any message, ZSMS can respond with free-form text (not requiring a pre-approved template) for the next 24 hours. After 24 hours of inactivity, responses must use approved templates.

---

## Supported Commands

| Command | Aliases | Response |
|---|---|---|
| `FEES` | `BALANCE`, `FEE` | Outstanding fee balance for all linked children |
| `RESULTS` | `GRADES`, `MARKS` | Latest published results for all linked children |
| `ATTENDANCE` | `ATTEND` | Last 30 days attendance summary |
| `RECEIPT` | `RECEIPTS` | Link to most recent payment receipt |
| `LOAN` | `LOANS` | Current loan application status or application link |
| `HELP` | `HI`, `HELLO`, `START`, `?` | List of available commands with portal link |

Unrecognised commands return the HELP response.

---

## Command Processing Flow

```
1. Parent texts "FEES" to ZSMS WhatsApp number
2. Meta sends webhook to: POST /api/webhooks/whatsapp
3. whatsapp-inbound Edge Function:
   a. Validates Meta HMAC signature
   b. Parses payload — extracts sender phone and message body
   c. Normalises command: trim + uppercase
   d. Looks up parent by phone: SELECT * FROM parents WHERE phone_e164 = $phone
   e. If not found: responds with HELP + "Register at zsms.co.zm"
   f. Gets all linked children (active + alumni with marketing opt-in)
4. If parent has ONE child:
   → Query runs immediately for that child
   → Response sent
5. If parent has MULTIPLE children:
   → Send child selection message:
     "Which child?
      Reply 1 for Chanda (Sunrise Academy)
      Reply 2 for Mwamba (Sunrise Academy)
      Reply 3 for Kunda (Rainbow Academy)"
   → Parent replies "1"
   → Next inbound message (within 24h session) processed as child selection
   → Query runs for selected child
   → Response sent
6. Log inbound and outbound messages to message_log
```

---

## Response Formats

### FEES Response

```
💳 Fees — Sunrise Academy
Chanda Bwalya · Grade 9A

Term 2, 2026:
Tuition Fee:    K2,500 outstanding
Activity Fee:   K  300 paid ✓

Total due: K2,500.00

Pay or view history:
zsms.co.zm/portal/fees
```

### RESULTS Response

```
📊 Results — Sunrise Academy
Chanda Bwalya · Grade 9A · Term 2, 2026

Mathematics:    88%   A
English Lang:   72%   B
Biology:        61%   C
Chemistry:      54%   C
Physics:        45%   D
Geography:      78%   B

Position: 3 of 38
Credits: 4 of 6

Download report card:
zsms.co.zm/portal/results
```

### ATTENDANCE Response

```
📅 Attendance — Sunrise Academy
Chanda Bwalya · Grade 9A

September 2026:
Present: 18 of 20 days (90%)
Absent: 2  Late: 0

This term (Term 2):
Present: 40 of 45 days (88.9%)

Full history:
zsms.co.zm/portal/attendance
```

### RECEIPT Response

```
🧾 Latest Receipt — Sunrise Academy
Chanda Bwalya

Receipt: REC-ZM-LSK-0001-000042
Amount: K2,500.00 · 15 Sep 2026
Tuition Fee — Term 2 2026

Download receipt (valid 7 days):
[signed R2 URL]

View all receipts:
zsms.co.zm/portal/fees
```

### LOAN Response — Active Application

```
🏦 Loan Status — Sunrise Academy
Chanda Bwalya

Application: MFI-LOAN-REF-001
Amount: K2,500.00
Status: Under Review

We'll notify you when the lender responds.
```

### LOAN Response — No Application

```
🏦 School Fee Loan — Sunrise Academy

Need help paying Chanda's fees?
Apply for a fee loan:
zsms.co.zm/portal/loan

Subject to approval. Terms apply.
```

### HELP Response

```
👋 Welcome to ZSMS — Sunrise Academy

Text a command to get started:

FEES      — View outstanding balance
RESULTS   — See latest exam results
ATTENDANCE — Check attendance
RECEIPT   — Download payment receipt
LOAN      — Apply for fee loan

Your portal: zsms.co.zm/portal
```

---

## Alumni Chatbot Access

Graduated students and parents of graduated students retain chatbot access for historical records. When they text a command:

- FEES → shows payment history from their school years (read-only)
- RESULTS → shows all published historical results
- RECEIPT → links to past receipts
- ATTENDANCE → shows historical attendance
- LOAN → shows past loan records only

Alumni responses include a footer: "These are historical records from your time at [School Name]."

If the alumni parent opted into marketing content, the HELP response includes an additional section:
```
SCHOLARSHIPS — View available scholarships
MARKETPLACE  — Browse educational products
STUDYABROAD  — Study abroad opportunities
```

These commands are only shown and available to users with `parents.marketing_opt_in = TRUE`.

---

## Phase 2 — AI Chatbot Upgrade

In Phase 2, the keyword-based chatbot will be upgraded to handle natural language queries using the Claude API. Instead of typing "FEES," a parent can type "How much does my son owe this term?" and receive the same response. The underlying data queries remain identical — only the input parsing changes from keyword matching to Claude-powered intent recognition.

The current keyword system is the foundation — the Phase 2 AI layer sits on top of it.

---

## Business Rules

1. The chatbot identifies parents by their sender phone number (E.164). If the phone is not registered, the chatbot cannot retrieve any data and returns HELP.
2. All chatbot responses are logged in message_log with `channel = 'whatsapp'` and the command as the template_id.
3. Within the 24-hour Meta session window, responses use free-form text. After 24 hours, the next inbound message from the parent opens a new session window.
4. Marketing commands (SCHOLARSHIPS, MARKETPLACE, STUDYABROAD) are only available to users with `marketing_opt_in = TRUE`. They are not shown in HELP for opted-out users.
5. The chatbot never exposes PII (NRC numbers, income figures, full payment gateway transaction IDs) in responses.
6. Chatbot response time target: under 5 seconds from inbound message to outbound response.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 12 communication documentation |
| 2026-04-26 | Added alumni chatbot access | Graduated account model confirmed |
| 2026-04-26 | Added marketing commands for opted-in alumni | AfriTech promotional content channel |
| 2026-04-26 | Added Phase 2 AI upgrade note | Natural language chatbot planned |
