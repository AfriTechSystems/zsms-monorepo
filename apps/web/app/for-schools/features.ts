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
}

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
    status: 'live',
    audience: 'Office',
    body:
      'Build a fee structure once and issue it to a whole grade. Record payments, verify bank ' +
      'deposits, and see exactly who owes what and for how long. Receipts carry your logo.',
  },
  {
    icon: 'CalendarCheck',
    title: 'Attendance register',
    status: 'live',
    audience: 'Teachers',
    body:
      'A register a teacher marks in under a minute, per class and per day, with the term’s record ' +
      'kept for every pupil.',
  },
  {
    icon: 'ClipboardList',
    title: 'Marks and results',
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
    status: 'live',
    audience: 'Office',
    body: 'Generated as PDFs with your school’s branding, in batches, a whole class at a time.',
  },
  {
    icon: 'Smartphone',
    title: 'Parent portal',
    status: 'live',
    audience: 'Parents',
    body:
      'Parents sign in on a phone and see their child’s attendance, results, fee statement and your ' +
      'notices. Nothing to install.',
  },
  {
    icon: 'Megaphone',
    title: 'Announcements',
    status: 'live',
    audience: 'Office',
    body:
      'Write once and send to a grade, a class, all parents or all staff — with a record of who has ' +
      'read it.',
  },
  {
    icon: 'Sparkles',
    title: 'Teacher Hub',
    status: 'live',
    audience: 'Teachers',
    body:
      'Your teachers get lesson plans, quizzes and homework structured for the Zambian curriculum, ' +
      'exported to PDF or Word. It works whether or not your school is on ZSMS.',
  },
  {
    icon: 'Building2',
    title: 'Several schools, one account',
    status: 'live',
    audience: 'Office',
    body:
      'If you run more than one school, a network view shows enrolment, fee collection and staffing ' +
      'across all of them without signing in and out.',
  },
  {
    icon: 'Globe',
    title: 'A page parents can find',
    status: 'live',
    body:
      'Every school on ZSMS gets a public page with its grades, facilities and sign-in code, findable ' +
      'by search. You choose what else to show — pupils per teacher, average class size, a fee range ' +
      '— and where we can calculate a figure from your own records, we calculate it rather than ' +
      'asking you to claim it. We do not rank or score schools.',
  },

  // ---------------------------------------------------------------------------
  // Being built now.
  // ---------------------------------------------------------------------------
  {
    icon: 'MessageCircle',
    title: 'WhatsApp, SMS and email to parents',
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
    status: 'building',
    audience: 'Parents',
    body:
      'The parent portal as an app on the home screen, with a notification when fees fall due, a ' +
      'child is absent, or results are published. Parents should not have to remember a web address ' +
      'to see how their child is doing.',
  },
  {
    icon: 'CalendarRange',
    title: 'Timetabling',
    status: 'building',
    audience: 'Office',
    body:
      'Build the week once, see clashes before they happen, and give every teacher and every class ' +
      'their own view of it.',
  },
  {
    icon: 'CreditCard',
    title: 'Pay fees online',
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
    status: 'planned',
    audience: 'Parents',
    body:
      'Let a parent spread a term’s fees over instalments they can actually meet, tracked ' +
      'automatically, so your arrears list shrinks without anybody chasing it.',
  },
  {
    icon: 'Bot',
    title: 'Ask your own data a question',
    status: 'planned',
    audience: 'Office',
    body:
      '“Which Grade 8 pupils have missed more than five days this term?” answered in plain language, ' +
      'and only ever over the records you are allowed to see.',
  },
  {
    icon: 'TrendingUp',
    title: 'Early warning on pupils at risk',
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
    status: 'planned',
    audience: 'Office',
    body: 'Push verified fee income to QuickBooks or Xero instead of re-entering it.',
  },
  {
    icon: 'GraduationCap',
    title: 'The whole school journey',
    status: 'planned',
    body:
      'A pupil’s record following them from Grade 1 to Form 6 and into a university or scholarship ' +
      'application — so the work a school puts into its records keeps paying off after the child has ' +
      'left.',
  },
] as const
