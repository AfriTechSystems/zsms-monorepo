/**
 * What each assistant intent actually fetches, and where navigation sends people.
 *
 * Spec: `Official Documentation/18 AI Module/AI_ASSISTANT.md`
 *
 * ## Every executor runs as the user
 *
 * They take the caller's own Supabase client and query through RLS exactly as a screen
 * does. The assistant therefore **adds no new authorisation surface**: a user cannot
 * reach data through it that they could not reach through the interface, and a model
 * asking for `at_risk_students` as a parent gets their own children or nothing.
 *
 * No service-role client appears in this file, and none should. If one ever does, the
 * assistant stops being a view of ZSMS and becomes a way around it.
 *
 * ## Citations are returned, not optional
 *
 * Each executor says what it read. `AI_ASSISTANT.md` requires "Response with citations —
 * not just text", and a narrated figure a user cannot trace is a figure they cannot act
 * on, especially when it concerns their child or their money.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ExecutorContext {
  client: SupabaseClient
  role: string
  /** What the model pulled out of the utterance. Never trusted for scoping. */
  params: {
    subject: string | null
    class_id: string | null
    student_name: string | null
    term: number | null
    period: string | null
    target: string | null
    status: string | null
  }
  /** `/school/ZM-LSK-0001/fees`, for building a route that keeps them in context. */
  basePath: string | null
}

export interface ExecutorResult {
  /** Rows handed to the narrator. */
  data: unknown
  rowCount: number
  /** What was read, so an answer can be traced. */
  citations: Array<{ source: string; detail: string }>
  /** Navigation answers carry somewhere to go. */
  route?: string
  /** A prepared write, awaiting confirmation. Never performed here. */
  pendingAction?: Record<string, unknown>
}

/** Turns a period word into a date, or null for "everything". */
function since(period: string | null): string | null {
  const now = new Date()
  switch (period) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    case 'this_week': {
      const d = new Date(now)
      // Monday, because a Zambian school week starts there and a parent asking about
      // "this week" on a Sunday means the week that just ended.
      const day = (d.getDay() + 6) % 7
      d.setDate(d.getDate() - day)
      d.setHours(0, 0, 0, 0)
      return d.toISOString()
    }
    case 'this_month':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    default:
      return null
  }
}

type Executor = (ctx: ExecutorContext) => Promise<ExecutorResult>

/**
 * Where each module lives, per audience.
 *
 * Navigation only ever offers a route the role can actually open — `AI_ASSISTANT.md`:
 * "an unreachable route is never surfaced, even as a suggestion". Sending a parent to
 * `/school/.../staff` would produce a refusal they would read as the assistant being
 * broken.
 */
const ROUTES: Record<string, Record<string, string>> = {
  school: {
    fees: '/fees',
    attendance: '/attendance',
    results: '/results',
    pupils: '/pupils',
    staff: '/staff',
    timetable: '/timetable',
    settings: '/settings',
    announcements: '/announcements',
    marks_entry: '/results',
    register: '/attendance',
    record_payment: '/fees/verify',
  },
  parent: {
    fees: '/parent/fees',
    attendance: '/parent/attendance',
    results: '/parent/results',
    timetable: '/parent/timetable',
    announcements: '/parent/notices',
    record_payment: '/parent/fees',
  },
  teacher: {
    // The standalone Hub, which has no school at all.
    results: '/teacher/library',
    announcements: '/teacher',
    timetable: '/teacher',
  },
}

const EXECUTORS: Record<string, Executor> = {
  /* ------------------------------------------------------------------ fees */
  fee_balance_summary: async (ctx) => {
    /*
      `student_fee_balance` is a security_invoker view, so a parent sees their children
      and a bursar sees the school. One query, two correct answers, no branch here.
    */
    const { data, error } = await ctx.client
      .from('student_fee_balance')
      .select('student_id, first_name, last_name, outstanding, arrears_amount, is_overdue')
      .gt('outstanding', 0)
      .order('outstanding', { ascending: false })
      .limit(25)

    if (error) throw new Error(error.message)

    const rows = data ?? []
    return {
      data: rows,
      rowCount: rows.length,
      citations: [
        { source: 'Fee balances', detail: `${rows.length} pupil(s) with an outstanding balance` },
      ],
    }
  },

  fee_collection_rate: async (ctx) => {
    const { data, error } = await ctx.client
      .from('fee_record_status')
      .select('academic_year, term_number, amount_due, amount_paid, outstanding')
      .limit(2000)

    if (error) throw new Error(error.message)

    const rows = data ?? []
    const billed = rows.reduce((t, r) => t + Number(r.amount_due ?? 0), 0)
    const paid = rows.reduce((t, r) => t + Number(r.amount_paid ?? 0), 0)

    return {
      data: {
        totalBilled: billed,
        totalCollected: paid,
        outstanding: billed - paid,
        collectionRate: billed > 0 ? Math.round((paid / billed) * 1000) / 10 : null,
        feeRecords: rows.length,
      },
      rowCount: rows.length,
      citations: [{ source: 'Fee records', detail: `${rows.length} record(s) totalled` }],
    }
  },

  /* ------------------------------------------------------------ attendance */
  student_attendance_summary: async (ctx) => {
    let q = ctx.client
      .from('attendance_records')
      .select('student_id, attendance_date, status')
      .order('attendance_date', { ascending: false })
      .limit(500)

    const from = since(ctx.params.period)
    if (from) q = q.gte('attendance_date', from.slice(0, 10))

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows = data ?? []
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      const k = String(r.status ?? 'unknown')
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})

    return {
      data: { totalMarked: rows.length, byStatus: counts, period: ctx.params.period ?? 'all time' },
      rowCount: rows.length,
      citations: [{ source: 'Attendance records', detail: `${rows.length} mark(s)` }],
    }
  },

  class_attendance_summary: async (ctx) => {
    let q = ctx.client
      .from('attendance_records')
      .select('class_id, attendance_date, status')
      .order('attendance_date', { ascending: false })
      .limit(2000)

    const from = since(ctx.params.period)
    if (from) q = q.gte('attendance_date', from.slice(0, 10))
    // A class the user named. Matched loosely because "9A" and "grade_9a" are the same
    // class to a teacher and different strings to the database.
    if (ctx.params.class_id) q = q.ilike('class_id', `%${ctx.params.class_id.replace(/\s+/g, '')}%`)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows = data ?? []
    const byClass = rows.reduce<Record<string, Record<string, number>>>((acc, r) => {
      const c = String(r.class_id ?? 'unknown')
      acc[c] = acc[c] ?? {}
      const s = String(r.status ?? 'unknown')
      acc[c][s] = (acc[c][s] ?? 0) + 1
      return acc
    }, {})

    return {
      data: { byClass, period: ctx.params.period ?? 'all time' },
      rowCount: rows.length,
      citations: [
        { source: 'Attendance records', detail: `${rows.length} mark(s) across ${Object.keys(byClass).length} class(es)` },
      ],
    }
  },

  /* --------------------------------------------------------------- results */
  student_performance_summary: async (ctx) => {
    let q = ctx.client
      .from('exam_results')
      .select('student_id, subject_id, marks_obtained, total_marks, grade, academic_year, term_number')
      .order('created_at', { ascending: false })
      .limit(500)

    if (ctx.params.term) q = q.eq('term_number', ctx.params.term)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows = data ?? []
    const scored = rows.filter((r) => r.marks_obtained != null && Number(r.total_marks) > 0)
    const average =
      scored.length > 0
        ? Math.round(
            (scored.reduce(
              (t, r) => t + (Number(r.marks_obtained) / Number(r.total_marks)) * 100,
              0,
            ) /
              scored.length) *
              10,
          ) / 10
        : null

    return {
      data: { results: rows.slice(0, 40), resultCount: rows.length, averagePercent: average },
      rowCount: rows.length,
      citations: [{ source: 'Exam results', detail: `${rows.length} result(s)` }],
    }
  },

  at_risk_students: async (ctx) => {
    const { data, error } = await ctx.client
      .from('exam_results')
      .select('student_id, subject_id, marks_obtained, total_marks, grade, term_number')
      .limit(2000)

    if (error) throw new Error(error.message)

    const rows = data ?? []
    const byStudent = new Map<string, { total: number; count: number }>()
    for (const r of rows) {
      if (r.marks_obtained == null || !Number(r.total_marks)) continue
      const id = String(r.student_id)
      const cur = byStudent.get(id) ?? { total: 0, count: 0 }
      cur.total += (Number(r.marks_obtained) / Number(r.total_marks)) * 100
      cur.count += 1
      byStudent.set(id, cur)
    }

    /*
      Below 50%, which is the ECZ pass mark and the threshold `AI_ASSISTANT.md` uses in
      its own worked example.
    */
    const atRisk = [...byStudent.entries()]
      .map(([id, v]) => ({ studentId: id, average: Math.round((v.total / v.count) * 10) / 10 }))
      .filter((s) => s.average < 50)
      .sort((a, b) => a.average - b.average)
      .slice(0, 20)

    return {
      data: { atRisk, threshold: 50, assessed: byStudent.size },
      rowCount: atRisk.length,
      citations: [
        { source: 'Exam results', detail: `${byStudent.size} pupil(s) assessed, ${atRisk.length} below 50%` },
      ],
    }
  },

  marks_entry_status: async (ctx) => {
    const { data, error } = await ctx.client
      .from('exam_results')
      .select('subject_id, term_number, marks_obtained, is_published')
      .limit(2000)

    if (error) throw new Error(error.message)

    const rows = data ?? []
    const missing = rows.filter((r) => r.marks_obtained == null).length

    return {
      data: {
        totalRows: rows.length,
        entered: rows.length - missing,
        missing,
        published: rows.filter((r) => r.is_published).length,
      },
      rowCount: rows.length,
      citations: [{ source: 'Exam results', detail: `${rows.length} row(s)` }],
    }
  },

  school_performance_overview: async (ctx) => {
    const [results, attendance] = await Promise.all([
      ctx.client.from('exam_results').select('marks_obtained, total_marks').limit(2000),
      ctx.client.from('attendance_records').select('status').limit(2000),
    ])

    const scored = (results.data ?? []).filter(
      (r) => r.marks_obtained != null && Number(r.total_marks) > 0,
    )
    const average =
      scored.length > 0
        ? Math.round(
            (scored.reduce(
              (t, r) => t + (Number(r.marks_obtained) / Number(r.total_marks)) * 100,
              0,
            ) /
              scored.length) *
              10,
          ) / 10
        : null

    const marks = attendance.data ?? []
    const present = marks.filter((a) => a.status === 'present').length

    return {
      data: {
        averagePercent: average,
        resultsAssessed: scored.length,
        attendanceRate: marks.length > 0 ? Math.round((present / marks.length) * 1000) / 10 : null,
        attendanceMarks: marks.length,
      },
      rowCount: scored.length + marks.length,
      citations: [
        { source: 'Exam results', detail: `${scored.length} scored result(s)` },
        { source: 'Attendance records', detail: `${marks.length} mark(s)` },
      ],
    }
  },

  /* -------------------------------------------------------------- the week */
  my_timetable: async (ctx) => {
    const { data, error } = await ctx.client.rpc('my_timetable')
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown[]
    return {
      data: rows,
      rowCount: rows.length,
      citations: [{ source: 'Published timetable', detail: `${rows.length} lesson(s)` }],
    }
  },

  my_notices: async (ctx) => {
    const { data, error } = await ctx.client
      .from('announcements')
      .select('title, body, importance, created_at')
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) throw new Error(error.message)

    const rows = data ?? []
    return {
      data: rows,
      rowCount: rows.length,
      citations: [{ source: 'Announcements', detail: `${rows.length} notice(s)` }],
    }
  },

  /* ------------------------------------------------------------- navigate */
  navigate_to_module: async (ctx) => navigate(ctx),
  navigate_to_action: async (ctx) => navigate(ctx),

  /* ---------------------------------------------------------------- write */
  record_attendance: async (ctx) => ({
    data: null,
    rowCount: 0,
    citations: [],
    /*
      PREPARED, never performed.

      `AI_ASSISTANT.md`: the assistant "never executes one without explicit user
      confirmation of a rendered preview. This holds regardless of role, operation, model
      confidence, or user preference. There is no configuration that disables it."

      So the executor returns a description and the screen renders it with Confirm and
      Cancel. The confirmation goes through the ordinary attendance route, which applies
      the same RLS as the register screen.
    */
    pendingAction: {
      kind: 'record_attendance',
      classId: ctx.params.class_id,
      studentName: ctx.params.student_name,
      status: ctx.params.status,
      route: ctx.basePath ? `${ctx.basePath}/attendance` : '/',
    },
  }),

  create_announcement: async (ctx) => ({
    data: null,
    rowCount: 0,
    citations: [],
    pendingAction: {
      kind: 'create_announcement',
      route: ctx.basePath ? `${ctx.basePath}/announcements` : '/',
    },
  }),

  /* ----------------------------------------------------------------- chat */
  chat: async () => ({ data: null, rowCount: 0, citations: [] }),
}

/** Resolves a navigation target to a route the caller's role can actually open. */
function navigate(ctx: ExecutorContext): ExecutorResult {
  const audience =
    ctx.role === 'org:parent' || ctx.role === 'org:student'
      ? 'parent'
      : ctx.role === 'platform:teacher'
        ? 'teacher'
        : 'school'

  const table = ROUTES[audience] ?? {}
  const target = ctx.params.target ?? ''
  const path = table[target]

  if (!path) {
    return {
      data: { known: Object.keys(table) },
      rowCount: 0,
      citations: [],
    }
  }

  // A school route is relative to the school; a parent or Hub route is absolute.
  const route = audience === 'school' && ctx.basePath ? `${ctx.basePath}${path}` : path

  return {
    data: { target, route },
    rowCount: 0,
    citations: [],
    route,
  }
}

export function hasExecutor(intent: string): boolean {
  return intent in EXECUTORS
}

/**
 * Runs one intent.
 *
 * Throws only when the query itself failed. An EMPTY result is a valid answer the
 * narrator is told to report honestly — "no marks have been entered yet" is useful, and
 * inventing an average is not.
 */
export async function runIntent(intent: string, ctx: ExecutorContext): Promise<ExecutorResult> {
  const fn = EXECUTORS[intent]
  if (!fn) {
    throw new Error(`No executor for intent "${intent}"`)
  }
  return fn(ctx)
}
