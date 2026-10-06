/**
 * The role-based assistant: intents, classification, narration.
 *
 * Spec: `Official Documentation/18 AI Module/AI_ASSISTANT.md`, ADR-034
 *
 * ## Two model calls, not one
 *
 * The document is specific: Claude is called once to understand intent and extract
 * parameters (cheap, fast) and once to narrate a result it is handed. The data in between
 * is fetched by ZSMS through the ordinary RLS-enforced path.
 *
 * That shape is the whole security model. The model never queries anything; it names an
 * intent and some parameters, ZSMS decides whether this caller may have that, and the
 * model then writes prose about rows it was given. **Prompt injection cannot escalate
 * privilege, because the boundary is PostgreSQL rather than the prompt.**
 *
 * ## Why the intent list is a closed set
 *
 * The classifier chooses from an enum. It cannot invent `delete_all_students`, because
 * the schema will not let it emit one — and an unknown intent is a question the assistant
 * says it cannot answer rather than an action nobody designed.
 */

/** What a classified request is for. */
export type IntentClass = 'read' | 'navigate' | 'write' | 'chat' | 'unknown'

export interface IntentSpec {
  intent: string
  kind: IntentClass
  /** Plain words, for the classifier to match an utterance against. */
  description: string
  /**
   * Roles that may use it at all.
   *
   * Advisory — the executor still runs as the user and RLS still decides. This exists so
   * the classifier is not offered an intent the caller could never complete, which would
   * produce a confident answer followed by a refusal.
   */
  roles: string[]
}

/** Every role ZSMS has, for intents available to all of them. */
const EVERYONE = [
  'org:owner',
  'org:admin',
  'org:principal',
  'org:head_teacher',
  'org:deputy_head',
  'org:accountant',
  'org:teacher',
  'org:parent',
  'org:student',
  'platform:teacher',
]

const MANAGEMENT = ['org:owner', 'org:admin', 'org:principal', 'org:head_teacher', 'org:deputy_head']
const FINANCE = [...MANAGEMENT, 'org:accountant']
const TEACHING = [...MANAGEMENT, 'org:teacher']

/**
 * The catalogue.
 *
 * `AI_ASSISTANT.md`'s intent table, plus the navigation intents from its
 * *Context-Aware Navigational Assistant* section. Each one maps to an executor in
 * `apps/web/lib/assistant-intents.ts`; an intent here with no executor there is a
 * question the assistant promises and cannot answer, so the two are checked against each
 * other at startup.
 */
export const INTENTS: IntentSpec[] = [
  // ---- read ----
  {
    intent: 'fee_balance_summary',
    kind: 'read',
    description: 'What fees are outstanding, for a child or for the school.',
    roles: [...FINANCE, 'org:parent'],
  },
  {
    intent: 'fee_collection_rate',
    kind: 'read',
    description: 'How much of what was billed has actually been collected this term.',
    roles: FINANCE,
  },
  {
    intent: 'student_attendance_summary',
    kind: 'read',
    description: "How often a pupil has attended — a parent asking about their own child.",
    roles: [...TEACHING, 'org:parent'],
  },
  {
    intent: 'class_attendance_summary',
    kind: 'read',
    description: 'Attendance across a class or the school over a period.',
    roles: TEACHING,
  },
  {
    intent: 'student_performance_summary',
    kind: 'read',
    description: 'How a pupil is doing — marks, averages, strongest and weakest subjects.',
    roles: [...TEACHING, 'org:parent'],
  },
  {
    intent: 'at_risk_students',
    kind: 'read',
    description: 'Which pupils are struggling, failing, or at risk.',
    roles: TEACHING,
  },
  {
    intent: 'marks_entry_status',
    kind: 'read',
    description: 'Whether marks have been entered yet, and what is missing.',
    roles: TEACHING,
  },
  {
    intent: 'school_performance_overview',
    kind: 'read',
    description: 'How the school is performing overall this term.',
    roles: MANAGEMENT,
  },
  {
    intent: 'my_timetable',
    kind: 'read',
    description: 'What is on my timetable, or my child’s, this week or today.',
    roles: EVERYONE,
  },
  {
    intent: 'my_notices',
    kind: 'read',
    description: 'Recent announcements or notices addressed to me.',
    roles: EVERYONE,
  },

  // ---- navigate ----
  {
    intent: 'navigate_to_module',
    kind: 'navigate',
    description: 'Take me to a part of ZSMS — fees, attendance, results, pupils, settings.',
    roles: EVERYONE,
  },
  {
    intent: 'navigate_to_action',
    kind: 'navigate',
    description: 'I want to DO something — enter marks, mark the register, record a payment.',
    roles: EVERYONE,
  },

  // ---- write ----
  {
    intent: 'record_attendance',
    kind: 'write',
    description: 'Mark a pupil present, absent or late.',
    roles: TEACHING,
  },
  {
    intent: 'create_announcement',
    kind: 'write',
    description: 'Send a notice to parents, staff or pupils.',
    roles: MANAGEMENT,
  },

  // ---- neither ----
  {
    intent: 'chat',
    kind: 'chat',
    description:
      'A greeting, a thank-you, or a question about what ZSMS can do rather than about data.',
    roles: EVERYONE,
  },
]

/** The intents a given role may be offered. */
export function intentsForRole(role: string | null): IntentSpec[] {
  if (!role) return INTENTS.filter((i) => i.kind === 'chat')
  return INTENTS.filter((i) => i.roles.includes(role))
}

/**
 * What the classifier must return.
 *
 * `intent` is a plain string rather than an enum in the schema because the enum varies by
 * role — a parent is never offered `at_risk_students`. The route checks the returned
 * value against the list it supplied, so a model inventing one is caught there.
 */
export const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'parameters', 'confidence', 'clarification'],
  properties: {
    intent: {
      type: 'string',
      description:
        'EXACTLY one intent name from the list supplied. Never a name that is not on it.',
    },
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'class_id', 'student_name', 'term', 'period', 'target', 'status'],
      properties: {
        subject: { type: ['string', 'null'] },
        class_id: {
          type: ['string', 'null'],
          description: 'A class the user named, such as "9A" or "Grade 9A". Null if none.',
        },
        student_name: {
          type: ['string', 'null'],
          description: 'A pupil the user named. Null if they did not name one.',
        },
        term: { type: ['integer', 'null'] },
        period: {
          type: ['string', 'null'],
          enum: ['today', 'this_week', 'this_month', 'this_term', 'last_term', null],
        },
        target: {
          type: ['string', 'null'],
          description:
            'For navigation: which module or action — fees, attendance, results, pupils, '
            + 'staff, timetable, settings, announcements, marks_entry, register, record_payment.',
        },
        status: {
          type: ['string', 'null'],
          enum: ['present', 'absent', 'late', 'excused', null],
        },
      },
    },
    confidence: {
      type: 'number',
      description: '0 to 1. Below 0.5 the assistant asks rather than guesses.',
    },
    clarification: {
      type: ['string', 'null'],
      description:
        'When the request is ambiguous, the ONE question that would resolve it. Null when '
        + 'the intent is clear. Ambiguity is always resolved by asking, never by guessing.',
    },
  },
} as const

export interface ClassifiedIntent {
  intent: string
  parameters: {
    subject: string | null
    class_id: string | null
    student_name: string | null
    term: number | null
    period: string | null
    target: string | null
    status: string | null
  }
  confidence: number
  clarification: string | null
}

export const INTENT_SYSTEM_PROMPT = `You classify a question asked inside ZSMS, a school management system used in Zambia.

You do NOT answer the question and you do NOT have the data. You name the intent and pull
out the parameters, and ZSMS fetches the data itself under the user's own permissions.

Rules:
- Choose EXACTLY one intent from the list given. Never invent one.
- If no intent fits, choose "chat".
- Ambiguity is resolved by ASKING, never by guessing. If you cannot tell which class,
  which child or which term is meant, set a clarification question and a low confidence.
- Zambian school vocabulary: "Form 3" and "Grade 9" are both grade levels, "Term 2" is a
  term, "ECZ" is the national curriculum.
- A question about what ZSMS can do, a greeting, or a thank-you is "chat".`

export function intentPrompt(params: {
  message: string
  role: string
  currentPage: string | null
  availableIntents: IntentSpec[]
  history: Array<{ role: string; content: string }>
}): string {
  const list = params.availableIntents
    .map((i) => `- ${i.intent} (${i.kind}): ${i.description}`)
    .join('\n')

  const history = params.history.length
    ? params.history.map((m) => `${m.role}: ${m.content}`).join('\n')
    : '(none)'

  return `USER ROLE: ${params.role}
CURRENT PAGE: ${params.currentPage ?? '(unknown)'}

INTENTS AVAILABLE TO THIS ROLE:
${list}

RECENT CONVERSATION:
${history}

THE USER SAID: "${params.message}"

Classify it.`
}

export const NARRATION_SYSTEM_PROMPT = `You are the ZSMS assistant, answering a question about a school in Zambia.

You are given REAL data that ZSMS fetched under this user's own permissions. Everything
you say must come from it.

Rules:
- Use the actual numbers. Never round them into vagueness, never invent one.
- Say which period the data covers.
- If the data is empty or incomplete, say so plainly. "No marks have been entered for
  Term 2 yet" is a useful answer; inventing an average is not.
- Suggest one concrete next action when there is an obvious one.
- Under 150 words unless the question clearly needs more.
- Never mention data about anybody outside what you were given. You were given exactly
  what this user is allowed to see.
- Zambian English. Currency is the kwacha, written K2,500.
- Do not mention intents, parameters, queries, or that you were given data. Just answer.`

export function narrationPrompt(params: {
  message: string
  role: string
  schoolName: string | null
  data: unknown
  rowCount: number
}): string {
  return `USER ROLE: ${params.role}
SCHOOL: ${params.schoolName ?? '(none)'}

THE USER ASKED: "${params.message}"

DATA ZSMS FETCHED (${params.rowCount} row${params.rowCount === 1 ? '' : 's'}):
${JSON.stringify(params.data, null, 2)}

Answer using only that data.`
}
