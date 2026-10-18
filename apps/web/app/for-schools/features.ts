/**
 * The complete ZSMS feature set, with the status of each.
 *
 * Spec: every module document under `Official Documentation/06`–`18`.
 *
 * ## Why this is a data file and not prose in the page
 *
 * Asked for on 2026-09-30: the public pages should carry the whole picture — what works and what is
 * being built — so that shipping a feature does not mean rewriting a marketing page.
 *
 * Structured so that it does not. Promoting a feature is changing one word:
 *
 *     status: 'building'  →  status: 'live'
 *
 * The page renders whichever buckets are non-empty, in a fixed order, so the copy reorganises itself
 * and there is nothing to remember. When `building` and `planned` are both empty the page simply stops
 * showing those sections.
 *
 * ## The rule for what may say `live`
 *
 * **A feature is `live` only if a school could use it today, end to end.** Not "the code exists", not
 * "the tests pass" — usable. Two examples of the distinction, both currently `building`:
 *
 *   * Parent messaging: the handlers, the template resolver and the three-channel fallback chain are
 *     written and tested, and no message has ever left the building because there are no provider
 *     credentials. A school reading `live` would send nothing and blame ZSMS for the rest.
 *   * Lesson generation: the Teacher Hub, the credit ledger and the provider failover chain all work,
 *     and `AI_GENERATOR` is still `template` — so it returns a scaffold rather than a written plan.
 *
 * Marking either of those `live` would be the single easiest way to lose a school's trust in
 * everything else on the list.
 */

export type FeatureStatus = 'live' | 'building' | 'planned'

export interface Feature {
  /** Icon name from lucide-react. Resolved in the page, so this file stays free of JSX. */
  icon: string
  title: string
  body: string
  status: FeatureStatus
  /** Who it is for, when that is not obvious. Shown as a small label. */
  audience?: 'Parents' | 'Teachers' | 'Office'
  /** Which part of the product this belongs to. Drives the grouping on `/features`. */
  suite: SuiteKey
}

export type SuiteKey = 'records' | 'money' | 'classroom' | 'families' | 'insight' | 'reach'

/**
 * The suites, in the order a school meets them.
 *
 * Ordered by the sequence a school actually encounters the product rather than by how much is built:
 * you enrol pupils before you bill them, bill them before you teach them, and reach families
 * throughout. Sorting by readiness would put the roadmap first on a page whose job is to say what
 * ZSMS does.
 */
export const SUITES: readonly { key: SuiteKey; title: string; blurb: string; icon: string }[] = [
  {
    key: 'records',
    title: 'Records and roll',
    blurb: 'One register of pupils and staff that every other part of ZSMS reads from.',
    icon: 'Users',
  },
  {
    key: 'money',
    title: 'Fees and finance',
    blurb: 'What each family owes, what has been paid, and what is still outstanding.',
    icon: 'Wallet',
  },
  {
    key: 'classroom',
    title: 'The classroom',
    blurb: 'Attendance, marks, reports and the tools a teacher uses day to day.',
    icon: 'GraduationCap',
  },
  {
    key: 'families',
    title: 'Reaching families',
    blurb: 'Getting the right information to the right parent, on the phone in their hand.',
    icon: 'MessageCircle',
  },
  {
    key: 'insight',
    title: 'Insight',
    blurb: 'Turning the records the school already keeps into decisions it can act on.',
    icon: 'TrendingUp',
  },
  {
    key: 'reach',
    title: 'Reach and growth',
    blurb: 'Being found by the families looking for a school, and what comes after.',
    icon: 'Compass',
  },
]

export const STATUS_COPY: Record<
  FeatureStatus,
  { heading: string; note: string; badge: string; tone: 'success' | 'primary' | 'neutral' }
> = {
  live: {
    heading: 'Working today',
    note: 'Available the moment your trial starts.',
    badge: 'Available',
    tone: 'success',
  },
  building: {
    heading: 'Being built now',
    note:
      'Under active development. We list these so you know what is coming — not to suggest you can ' +
      'use them yet.',
    badge: 'In development',
    tone: 'primary',
  },
  planned: {
    heading: 'Planned',
    note: 'Designed and specified, scheduled after the work above.',
    badge: 'Planned',
    tone: 'neutral',
  },
}

export const FEATURES: readonly Feature[] = [
  // ---------------------------------------------------------------------------
  // Working today.
  // ---------------------------------------------------------------------------
  {
    icon: 'Users',
    title: 'Pupils and staff records',
    suite: 'records',
    status: 'live',
    audience: 'Office',
    body:
      'Enrol pupils one at a time or import a whole roll from the spreadsheet you already keep — ZSMS ' +
      'maps your columns, so you do not reformat anything. Add your own fields for whatever your ' +
      'school tracks, with medical notes visible only to the people who should see them.',
  },
  {
    icon: 'Wallet',
    title: 'Fees that reconcile',
    suite: 'money',
    status: 'live',
    audience: 'Office',
    body:
      'Build a fee structure once and issue it to a whole grade. Record payments, verify bank ' +
      'deposits, and see exactly who owes what and for how long. Receipts carry your logo.',
  },
  {
    icon: 'CalendarCheck',
    title: 'Attendance register',
    suite: 'classroom',
    status: 'live',
    audience: 'Teachers',
    body:
      'A register a teacher marks in under a minute, per class and per day, with the term’s record ' +
      'kept for every pupil.',
  },
  {
    icon: 'ClipboardList',
    title: 'Marks and results',
    suite: 'classroom',
    status: 'live',
    audience: 'Teachers',
    body:
      'Enter marks against your own grading scale — ECZ, Cambridge, or one you define. Move a grade ' +
      'boundary next year and last year’s grades still mean what they meant, because ZSMS records ' +
      'which scale produced each one.',
  },
  {
    icon: 'FileText',
    title: 'Report cards and receipts',
    suite: 'classroom',
    status: 'live',
    audience: 'Office',
    body: 'Generated as PDFs with your school’s branding, in batches, a whole class at a time.',
  },
  {
    icon: 'Smartphone',
    title: 'Parent portal',
    suite: 'families',
    status: 'live',
    audience: 'Parents',
    body:
      'Parents sign in on a phone and see their child’s attendance, results, fee statement and your ' +
      'notices. Nothing to install.',
  },
  {
    icon: 'Megaphone',
    title: 'Announcements',
    suite: 'families',
    status: 'live',
    audience: 'Office',
    body:
      'Write once and send to a grade, a class, all parents or all staff — with a record of who has ' +
      'read it.',
  },
  {
    icon: 'Sparkles',
    title: 'Teacher Hub',
    suite: 'classroom',
    status: 'live',
    audience: 'Teachers',
    body:
      'Your teachers get lesson plans, quizzes and homework structured for the Zambian curriculum, ' +
      'exported to PDF or Word. It works whether or not your school is on ZSMS.',
  },
  {
    icon: 'Building2',
    title: 'Several schools, one account',
    suite: 'records',
    status: 'live',
    audience: 'Office',
    body:
      'If you run more than one school, a network view shows enrolment, fee collection and staffing ' +
      'across all of them without signing in and out.',
  },
  {
    icon: 'Globe',
    title: 'A page parents can find',
    suite: 'reach',
    status: 'live',
    body:
      'Every school on ZSMS gets a public page with its grades, facilities and sign-in code, findable ' +
      'by search. You choose what else to show — pupils per teacher, average class size, a fee range ' +
      '— and where we can calculate a figure from your own records, we calculate it rather than ' +
      'asking you to claim it. We do not rank or score schools.',
  },
  {
    /*
      Moved from `building` to `live` on 2026-10-18. It was marked `building` while the
      whole chain existed: three tables with clash detection in the database (0197's
      indexes do the enforcing), a builder with drag-and-drop and guided setup,
      `/school/[code]/my-timetable` for a teacher's own week, `/parent/timetable` for a
      child's, and GET/POST/PATCH on `/api/school/timetable`. A clash is surfaced as a
      question with a Cancel button via `timetable_move_conflicts()` before the drop,
      which is exactly the promise this entry makes.
    */
    icon: 'CalendarRange',
    title: 'Timetabling',
    suite: 'classroom',
    status: 'live',
    audience: 'Office',
    body:
      'Build the week once, see clashes before they happen, and give every teacher and every class ' +
      'their own view of it.',
  },
  {
    /*
      Added 2026-10-18. The export existed and this page did not mention it, which is the
      opposite error from the rest of this file and still a loss: a school evaluating ZSMS
      could not see a capability it already has. Kept separate from the `planned`
      "Accounting integrations" entry below, because that one promises two-way QuickBooks
      and Xero connectors which genuinely do not exist, and `status` is binary.
    */
    icon: 'FileSpreadsheet',
    title: 'Export for your accountant',
    suite: 'money',
    status: 'live',
    audience: 'Office',
    body:
      'Verified fee income as a file your accountant can import into Sage 50, for any date range ' +
      'you choose. Only money that has actually been verified leaves the system, so the books ' +
      'cannot be made to disagree with the receipts.',
  },

  // ---------------------------------------------------------------------------
  // Being built now.
  // ---------------------------------------------------------------------------
  {
    icon: 'MessageCircle',
    title: 'WhatsApp, SMS and email to parents',
    suite: 'families',
    status: 'building',
    audience: 'Parents',
    body:
      'Fee reminders, absence alerts and announcements delivered to the phone a parent actually uses, ' +
      'falling back from WhatsApp to SMS to email. Everything behind it is built and tested; it waits ' +
      'on WhatsApp Business verification, which is a matter of paperwork rather than code.',
  },
  {
    icon: 'Smartphone',
    title: 'Teacher app that works without signal',
    suite: 'classroom',
    status: 'building',
    audience: 'Teachers',
    body:
      'Mark the register and enter marks on a phone with no internet, syncing when there is. The ' +
      'reason this is an app and not a web page: a teacher in a classroom with one bar cannot wait ' +
      'for a page to load.',
  },
  {
    icon: 'Smartphone',
    title: 'Parent app',
    suite: 'families',
    status: 'building',
    audience: 'Parents',
    body:
      'The parent portal as an app on the home screen, with a notification when fees fall due, a ' +
      'child is absent, or results are published. Parents should not have to remember a web address ' +
      'to see how their child is doing.',
  },
  {
    icon: 'CreditCard',
    title: 'Pay fees online',
    suite: 'money',
    status: 'building',
    audience: 'Parents',
    body:
      'Mobile money and card payments that reconcile themselves against the right pupil, so your ' +
      'office stops matching deposit slips by hand.',
  },

  // ---------------------------------------------------------------------------
  // Planned.
  // ---------------------------------------------------------------------------
  {
    icon: 'Landmark',
    title: 'School financing',
    suite: 'money',
    status: 'planned',
    audience: 'Office',
    body:
      'Working capital against your fee collection history, so a term does not start with an empty ' +
      'account. Because your collection record already lives in ZSMS, a lender can see it without you ' +
      'assembling three years of paperwork.',
  },
  {
    icon: 'HandCoins',
    title: 'Payment plans for parents',
    suite: 'money',
    status: 'planned',
    audience: 'Parents',
    body:
      'Let a parent spread a term’s fees over instalments they can actually meet, tracked ' +
      'automatically, so your arrears list shrinks without anybody chasing it.',
  },
  {
    icon: 'Bot',
    title: 'Ask your own data a question',
    suite: 'insight',
    status: 'planned',
    audience: 'Office',
    body:
      '“Which Grade 8 pupils have missed more than five days this term?” answered in plain language, ' +
      'and only ever over the records you are allowed to see.',
  },
  {
    icon: 'TrendingUp',
    title: 'Early warning on pupils at risk',
    suite: 'insight',
    status: 'planned',
    audience: 'Teachers',
    body:
      'Attendance and marks read together to flag a child slipping before the end-of-term report says ' +
      'so. This one genuinely needs time — it is only honest once there are years of real results ' +
      'behind it, and we would rather say that than ship a guess.',
  },
  {
    icon: 'Plug',
    title: 'Accounting integrations',
    suite: 'money',
    status: 'planned',
    audience: 'Office',
    body:
      'Push verified fee income straight into QuickBooks or Xero, with no file in the middle. The ' +
      'Sage 50 export above already saves the re-typing; this removes the step entirely.',
  },
  {
    icon: 'GraduationCap',
    title: 'The whole school journey',
    suite: 'reach',
    status: 'planned',
    body:
      'A pupil’s record following them from Grade 1 to Form 6 and into a university or scholarship ' +
      'application — so the work a school puts into its records keeps paying off after the child has ' +
      'left.',
  },
] as const
