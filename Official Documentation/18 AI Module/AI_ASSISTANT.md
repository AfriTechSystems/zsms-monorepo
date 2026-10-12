# AI_ASSISTANT.md — Role-Based AI Assistant

## Related Documents

- `docs/modules/ai/AI_OVERVIEW.md` — four-system AI architecture
- `docs/modules/ai/AI_DATA_REQUIREMENTS.md` — data completeness gate
- `docs/modules/auth/ROLES.md` — role boundaries enforced in assistant
- `docs/DATABASE.md` — ai_conversations table
- `docs/api/EDGE_FUNCTIONS.md` — ai-assistant Edge Function
- `docs/modules/admin/PRICING.md` — ai_assistant feature flag

---

## Implementation Status (2026-10-11)

**Built, and the RLS enforcement this document insists on is real.**

`start_ai_conversation()`, `ai_assistant_begin()`, `ai_conversations`, `ai_messages`, with
`archive_old_ai_conversations()` for retention. The assistant reads through the caller's
own policies rather than a service role, so it cannot surface a pupil the asker could not
already see — which is the whole basis for letting a model near a class register.

`ai_assistant_quota()` meters it, and `school_data_completeness()` implements the gate
this document describes: ≥70% full, 50–69% limited, <50% locked.

**Zero conversations exist on dev**, which is expected rather than a gap.

**`ai_models` holds two providers**, OpenAI and Anthropic, ordered by priority. OpenAI has
answered a real call (`npm run ai:smoke` — `gpt-4o`, 6.2s, schema-valid structured
output). **Failover TO Anthropic has never executed**: the key has no credit, so the chain
has only ever been observed leaving a provider, never arriving at the second one.

That matters more than it sounds. A failover path that has never run is not a failover
path — it is an untested branch that will be exercised for the first time during an
outage.

---

## Purpose

This document defines the role-based AI assistant — how questions are interpreted, how structured queries are generated, how Claude narrates results, and how RLS boundaries are enforced. Every Claude Code session building the AI assistant must read this document before starting.

---

## Overview

The AI assistant is a conversational interface that answers questions about school data using natural language. A principal asks "Which students are at risk this term?" and receives a plain-English answer backed by real ZSMS data — not a generic response.

The assistant never has direct database access. It operates through a structured pipeline that enforces the same access controls as every other ZSMS operation.

---

## The Assistant Pipeline

```
User message
     ↓
1. Context extraction
   (school_id, user_id, role, current page from JWT + client context)
     ↓
2. Intent classification
   (Claude identifies: what data is needed, what question is being asked)
     ↓
3. Query parameter extraction
   (Claude extracts: filters, date ranges, grade levels, student IDs etc.)
     ↓
4. ZSMS API execution
   (ZSMS executes the appropriate RLS-enforced database query)
     ↓
5. Data narration
   (Claude receives structured result + original question → generates response)
     ↓
6. Response with citations
   (Answer shown with data source references — not just text)
```

Claude is called **twice** per assistant interaction — once to understand intent and extract query parameters (cheap, fast), and once to narrate the result (slightly more expensive). This two-step approach keeps costs low and ensures structured query execution through the proper access-controlled layer.

---

## Role-Specific Behaviour

### Teacher Assistant

**Data access:** Only their assigned classes and subjects.

**Supported intents:**
- Student performance in their class ("Who is struggling in Grade 9A Mathematics?")
- Attendance summary for their class ("How has attendance been this week in 9A?")
- Marks entry status ("Have I entered all marks for 9A this term?")
- Lesson planning context ("What topics have I covered this term in Grade 9 Mathematics?")

**Example interaction:**
```
Teacher: "Which students in my class are struggling?"

Intent: student_performance_at_risk
Query params: { class_id: "grade_9a", staff_user_id: "teacher_clerk_id", term: current }

ZSMS executes: SELECT students with marks below 50% average in teacher's assigned subjects

Claude narrates: "5 students in Grade 9A are scoring below 50% on average this term.
Mwamba Phiri has the lowest average at 38%, with particular difficulty in Algebra.
Grace Mwale has declined significantly — her average dropped from 67% last term to 45%
this term. I'd suggest prioritising these two for additional support."
```

---

### Parent Assistant

**Data access:** Only their linked children's data.

**Supported intents:**
- Child's current performance ("How is Chanda doing this term?")
- Attendance summary ("How has Chanda's attendance been?")
- Fee balance ("What fees are outstanding?")
- Results history ("What did Chanda get last term?")

**Example interaction:**
```
Parent: "How is my child doing in school?"

Intent: child_performance_summary
Query params: { parent_user_id: "parent_clerk_id", term: current }

ZSMS executes: Fetches exam results, attendance, and fee status for all linked children

Claude narrates: "Chanda is performing well this term with an average of 74% across
all subjects. Her strongest subject is Biology (88%) and she has room to improve in
Mathematics (58%). She has attended 18 of 20 school days this month — a good attendance
rate. There is one outstanding fee: Tuition Fee Term 2 of K2,500."
```

---

### Principal / Admin Assistant

**Data access:** School-wide aggregated data. Never individual student details unless drilling down.

**Supported intents:**
- School-wide performance ("How is the school performing this term?")
- At-risk students ("Which students are at risk of failing?")
- Fee collection ("What is our fee collection rate this term?")
- Attendance overview ("Which classes have the worst attendance?")
- Staff workload ("Which teachers have the most unmarked results?")

**Example interaction:**
```
Principal: "Which students are at risk of failing exams this term?"

Intent: at_risk_students_school_wide
Query params: { school_id: "school_uuid", term: current, threshold: 50 }

ZSMS executes: SELECT students with average below 50% in 3+ subjects, joined with
attendance where absences > 5 this month

Claude narrates: "12 students across the school are currently at risk based on marks
and attendance data. Grade 10A has the highest concentration with 4 at-risk students.
I recommend scheduling parent meetings for the 3 students with both poor marks AND
attendance issues — Chanda Bwalya (Grade 9A), Peter Banda (Grade 10A), and
Mary Phiri (Grade 10B). Full list available in the Analytics dashboard."
```

---

### School Owner Assistant

**Data access:** All school data plus subscription and financial overview.

**Additional supported intents:**
- Revenue overview ("What is our subscription cost vs student count?")
- School health summary ("How is the school overall?")
- Staff completeness ("Are all teachers entering marks consistently?")

---

## Intent Catalogue

The assistant recognises these intent categories. New intents are added here when new assistant capabilities are built.

| Intent | Required Data | Roles |
|---|---|---|
| `student_performance_summary` | exam_results for student | Teacher, Parent, Admin |
| `student_performance_at_risk` | exam_results below threshold | Teacher, Admin |
| `class_attendance_summary` | attendance_records for class/period | Teacher, Admin |
| `student_attendance_summary` | attendance_records for student | Parent, Teacher, Admin |
| `fee_balance_summary` | fee_records for student/school | Parent, Admin, Owner |
| `fee_collection_rate` | fee_records aggregated | Admin, Owner |
| `marks_entry_status` | exam_results completeness | Teacher, Admin |
| `school_performance_overview` | aggregated exam_results | Admin, Owner |
| `at_risk_students_school_wide` | exam_results + attendance | Admin |
| `staff_data_completeness` | audit_logs + results completeness | Admin, Owner |
| `announcement_reach` | announcement_reads | Admin |
| `loan_application_status` | loan_applications | Parent |

---

## System Prompt Structure

The system prompt sent to Claude for each assistant call is constructed dynamically:

```typescript
function buildAssistantSystemPrompt(context: AssistantContext): string {
  return `
You are the ZSMS AI Assistant for ${context.schoolName}.

USER ROLE: ${context.role}
USER NAME: ${context.userName}
CURRENT PAGE: ${context.currentPage}
ACADEMIC YEAR: ${context.academicYear}
CURRENT TERM: ${context.termNumber}

DATA ACCESS BOUNDARIES:
${getRoleBoundaryDescription(context.role, context.assignedClasses)}

RESPONSE GUIDELINES:
- Be specific and use actual numbers from the data provided
- Always cite which data period your insights cover
- Flag if data appears incomplete (e.g. marks not yet entered)
- Suggest concrete next actions where appropriate
- Keep responses under 200 words unless more detail is clearly needed
- Never reveal data about students, staff, or finances outside the user's access boundary
- If you cannot answer because data is missing, say so clearly

AVAILABLE DATA FOR THIS QUERY:
${JSON.stringify(context.queryResults, null, 2)}

The user asked: "${context.userMessage}"

Answer their question using only the data provided above.
`
}
```

---

## Conversation History Management

Conversations are stored in `public.ai_conversations` and loaded for context continuity within a session:

```typescript
// Max 10 previous messages included in context (cost management)
const conversationHistory = await getRecentMessages(conversationId, 10)

const messages = [
  ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
  { role: 'user', content: userMessage }
]
```

Conversations older than 30 days are archived. The assistant does not have memory of conversations from previous sessions — each new session starts fresh unless the user explicitly references a past conversation.

---

## Cost Management

Claude API calls have a per-token cost. The assistant is designed to minimise unnecessary calls:

```typescript
// Two-call pipeline cost estimate per interaction:
// Call 1 (intent + query extraction): ~500 input + 200 output = ~700 tokens
// Call 2 (narration): ~1,500 input (data) + 300 output = ~1,800 tokens
// Total per interaction: ~2,500 tokens ≈ $0.003 USD per interaction

// Monthly cost estimate for a school with 50 assistant interactions/month:
// 50 × $0.003 = $0.15/month — well within the K200/month add-on price
```

Rate limiting: Maximum 100 assistant interactions per school per day. Maximum 20 per individual user per day. Prevents runaway cost from looping or automated queries.

---

## Context-Aware Navigational Assistant

Confirmed in **ADR-034**. This extends the assistant from a question-answering interface into a navigational and operational one, available to **every** user role — parent, student, teacher, accountant, principal, owner, custom-role staff, standalone teacher, and alumni.

The assistant handles three classes of operation, with a hard boundary between the first two and the third:

| Class | What it does | Confirmation |
|---|---|---|
| **Navigate** | Takes the user to a page or section, pre-filtered | None — navigation is free |
| **Read** | Answers a question using RLS-enforced data | None — reads are free |
| **Write / CRUD** | Creates, updates, or deletes a record | **Always. Without exception.** |

### Page and section awareness

Every assistant call carries the user's current location, so instructions can be relative rather than absolute.

```typescript
interface AssistantPageContext {
  route: string              // '/school/[id]/results/entry'
  section: string            // 'marks_entry'
  entityType?: string        // 'class' | 'student' | 'fee_record' | ...
  entityId?: string          // the record currently open
  filters?: Record<string, unknown>   // active filters on the current view
  visibleColumns?: string[]  // what the user can actually see right now
}
```

This is what makes ordinary phrasing work:

```
[Teacher on Grade 9A marks entry, Mathematics]
Teacher: "Who's missing marks here?"
→ Resolves "here" to class_id=grade_9a, subject=mathematics, current term.

[Parent on Chanda's fee page]
Parent: "How much is left?"
→ Resolves to outstanding balance for that fee record, not all children.

[Accountant on the payment verification queue]
Accountant: "Approve this one"
→ Resolves "this one" to the open payment — then requires confirmation,
   because it is a write.
```

Without page context the assistant must ask a disambiguating question, which is correct but slower. **Ambiguity is always resolved by asking, never by guessing** — particularly for writes.

### Navigation intents

Navigation returns a route alongside the text response. The assistant only ever offers routes the user's role and permissions actually allow; an unreachable route is never surfaced, even as a suggestion.

| Intent | Example utterance | Result |
|---|---|---|
| `navigate_to_module` | "take me to fees" | Fees dashboard |
| `navigate_to_filtered_view` | "show unpaid fees for Grade 10" | Fees → Outstanding, filtered |
| `navigate_to_entity` | "open Chanda Bwalya's profile" | Student profile |
| `navigate_to_action` | "I want to enter marks" | Marks entry, class pre-selected |
| `navigate_to_report` | "show me last term's results" | Results archive, term selected |
| `navigate_to_settings` | "where do I change our grading scale?" | School settings → Grading |

```
Teacher: "I need to enter marks for 9A maths"

→ Intent: navigate_to_action
→ Permission check: teacher assigned to 9A Mathematics? ✓
→ Response: "Opening marks entry for Grade 9A Mathematics, Term 2.
             You have 12 of 40 students entered."
   [Route: /school/{id}/results/entry?class=9a&subject=mathematics]
```

### Write and CRUD operations — always approval-gated

The assistant can prepare create, update, and delete operations. **It never executes one without explicit user confirmation of a rendered preview.** This holds regardless of role, operation, model confidence, or user preference. There is no configuration that disables it.

```
User utterance
     ↓
1. Intent classification → write intent detected
     ↓
2. Permission pre-check (fails closed — user is told what they lack)
     ↓
3. Parameter extraction from utterance + page context
     ↓
4. Validation against the same Zod schema the API route uses
     ↓
5. PREVIEW rendered — exact records, exact field-level changes
     ↓
6. ⛔ HARD STOP — awaiting explicit user confirmation
     ↓
7. User confirms → the normal RLS-enforced API route executes
   User edits    → return to step 5 with amended parameters
   User cancels  → discarded, nothing written
     ↓
8. audit_logs row written, including the originating utterance
```

Preview example:

```
Teacher: "Mark Chanda and Peter absent today"

Assistant: I'll record these attendance entries — please confirm:

  ┌─────────────────────────────────────────────────┐
  │ Grade 9A · Attendance · 13 August 2026          │
  ├─────────────────────────────────────────────────┤
  │ Chanda Bwalya    Present  →  Absent             │
  │ Peter Banda      Present  →  Absent             │
  ├─────────────────────────────────────────────────┤
  │ 2 records · parent notification not triggered   │
  │ (monthly summary is your school's default)      │
  └─────────────────────────────────────────────────┘

           [ Confirm ]   [ Edit ]   [ Cancel ]

Nothing has been saved yet.
```

**Supported write intents** — each subject to the same gate:

| Intent | Roles | Notes |
|---|---|---|
| `record_attendance` | Teacher, Admin | Bulk within an assigned class |
| `enter_marks` | Teacher | Assigned subjects only; blocked once marks are locked |
| `record_payment` | Accountant, Admin | Full verification flow still applies |
| `create_announcement` | Admin, Owner | Preview shows audience size before sending |
| `update_student_record` | Admin | Non-financial fields only |
| `create_fee_record` | Accountant, Admin | Preview shows resulting balance |
| `invite_staff` | Admin, Owner | Preview shows role and permissions granted |
| `update_school_settings` | Owner | Preview shows old → new for each field |
| `generate_report_cards` | Admin | Preview shows student count and estimated duration |

**Operations the assistant may never perform, even with confirmation:**

- Publishing results (`PUBLISHING.md` requires the explicit pre-publication checklist)
- Deleting any student, fee record, payment, or exam result — soft delete only, and only through the dedicated flow (ADR-010)
- Any write to the `private` schema, including anything loan-related
- Any write to `afritech` configuration tables — pricing and platform config change through the admin panel with its mandatory-reason flow (`DYNAMIC_CONFIG.md`)
- Granting or modifying permissions beyond its own role
- Anything during an active impersonation session (`IMPERSONATION.md`)

These exclusions are not about capability. They are operations where the deliberate friction of the dedicated UI is itself the control.

### Permission inheritance

The assistant executes **as the user**, through the same RLS-enforced API routes as the interface. It holds no elevated capability and no service-role access of any kind.

```
User's Clerk JWT
   → assistant request (same JWT)
      → intent + parameters
         → the same API route the UI calls
            → RLS enforced at the database
```

The consequence is that the assistant adds **no new authorisation surface**. A user cannot reach data or perform an action through the assistant that they could not reach through the UI. Prompt injection cannot escalate privilege, because the boundary is enforced in PostgreSQL rather than in the prompt.

Permission checks run **before** parameter extraction, so a user attempting an action they lack rights for is told plainly rather than being walked through a preview that would fail on submit.

### Availability by role

| Role | Navigate | Read | Write |
|---|---|---|---|
| `org:owner` | ✓ | School-wide | ✓ |
| `org:principal` | ✓ | School-wide | ✓ |
| `org:accountant` | ✓ | Financial | ✓ financial only |
| `org:teacher` | ✓ | Assigned classes | ✓ attendance, marks |
| `org:staff` (custom role) | ✓ | Per grants | Per grants |
| `org:parent` | ✓ | Own children | Payment submission only |
| `org:student` | ✓ | Own records | — |
| `platform:teacher` | ✓ | Own Teacher Hub | ✓ lesson plans |
| `platform:alumni` | ✓ | Own historical records | — |

### Country customisation

Availability is controlled per country through feature flags resolved by `schoolHasFeature()`, so a country can launch with navigation and read before enabling writes.

| Flag | Controls |
|---|---|
| `ai_assistant` | The assistant at all |
| `ai_assistant_navigation` | Navigation intents |
| `ai_assistant_write` | Write intents (independently disableable per country) |

Per `DYNAMIC_CONFIG.md`, flag values are database-driven — a country can be enabled or disabled without a deployment. Intent catalogues are country-scoped so that Zambia-specific vocabulary ("Form 3", "ECZ", "Term 2") resolves correctly, and a future country's vocabulary is added as configuration rather than code.

### Data completeness gate

Navigation and write intents are **not** gated on data completeness — navigating to fee settings or recording attendance does not depend on the quality of historical data. Only read intents that produce analytical insight carry the ADR-029 gate. A school at 30% completeness can still use the assistant to move around and record data; it simply cannot use it to draw conclusions. This is deliberate: the assistant is one of the more effective ways for such a school to improve its completeness score.

---

## Error Handling

When the assistant cannot answer:

```typescript
// Data not available
"I don't have marks data for this term yet — it looks like results haven't been
entered for Grade 9A. Once marks are entered, I can give you a full performance summary."

// Insufficient data completeness
"Your school's data completeness score is currently 45%, which is below the 70%
needed for reliable AI insights. The main gap is attendance — Grade 8B and Grade 10A
have missing records for the last 3 weeks."

// Outside access boundary
"I can only provide information about students in your assigned classes.
For school-wide data, please speak with your principal."

// Ambiguous query
"I want to make sure I give you the right information — are you asking about
attendance this week, this month, or this term?"
```

---

## Business Rules

1. The assistant never has direct database access. It generates query parameters and ZSMS executes through the RLS-enforced API layer.
2. All assistant interactions are logged in `public.ai_conversations` for audit purposes.
3. Rate limiting: 100 interactions per school per day, 20 per user per day. Values are configurable per `DYNAMIC_CONFIG.md`.
4. Conversation history is limited to 10 previous messages to manage token costs.
5. The assistant is available only to schools with the `ai_assistant` feature flag active.
6. The data completeness gate applies to analytical read intents only. Navigation and write intents are not gated on completeness.
7. **Every write, create, update, or delete operation requires explicit user confirmation of a rendered preview. There is no exception, no confidence threshold that bypasses it, and no configuration that disables it.**
8. The assistant executes as the current user with that user's RLS boundaries and permission grants. It never uses a service role and never holds elevated capability.
9. Permission checks run before parameter extraction. A user lacking rights is told plainly rather than shown a preview that would fail.
10. The assistant may never publish results, hard delete protected records, write to the `private` schema, write to `afritech` configuration tables, modify permissions, or perform any write during an impersonation session.
11. Write intents are logged to `public.audit_logs` including the originating natural-language utterance.
12. Ambiguity is resolved by asking a clarifying question, never by guessing — especially for writes.
13. The assistant never surfaces a navigation route the user's role and permissions do not allow, even as a suggestion.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | AI module — Phase 2 feature |
| 2026-04-26 | Two-call pipeline defined | Cost management — intent extraction separate from narration |
| 2026-04-26 | Role-specific intent catalogues | RLS boundary enforcement through intent scoping |
| 2026-08-13 | **Expanded into a context-aware navigational assistant (ADR-034)** | Replaces the Phase 2 navigation stub with the full model |
| 2026-08-13 | Added page and section awareness | Relative phrasing ("here", "this one") requires current-location context |
| 2026-08-13 | Added navigation intent catalogue | Navigation is now a first-class operation class |
| 2026-08-13 | Added write/CRUD operations with mandatory approval gate | An LLM misreading a write intent touches money and academic records |
| 2026-08-13 | Documented operations the assistant may never perform | Some flows are controlled by their own deliberate friction |
| 2026-08-13 | Extended availability to every user role with per-role capability matrix | Users least able to navigate benefit most |
| 2026-08-13 | Added country customisation via three feature flags | Countries can enable navigation and read before writes |
