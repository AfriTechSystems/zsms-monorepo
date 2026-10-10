'use client'

/**
 * The Teacher Hub home, and the profile step that precedes it.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Registration is rendered here rather than at `/teacher/signup`
 *
 * The documented flow has a separate signup screen. One screen instead, gated on
 * `needsRegistration`, because the alternative is a redirect that has to be undone: every
 * Hub page would need to detect the missing account and bounce, and a teacher who lands on
 * `/teacher/library` from a bookmark would be sent somewhere they did not ask for. Asking
 * for the profile in place is fewer moving parts and no redirect loop to get wrong.
 *
 * The email is not asked for — Clerk already has it and owns it, so a second copy the
 * teacher could edit here would drift from the one they actually sign in with.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, ClipboardList, FileQuestion, Sparkles } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Field, Input, Select } from '../../components/ui/field'
import { PageHeader, ErrorState, StatSkeleton } from '../../components/ui/data-states'
import { DraftNotice } from '../../components/ui/draft-notice'
import { draftAge, useFormDraft } from '../../lib/use-form-draft'
import { SignedIn, useAuth } from '@zsms/auth-provider/react'
import { useToast } from '../../components/ui/toast'
import { SchoolLinkCard } from './school-link-card'
import { CreditBalances } from './credit-balances'
import {
  CURRICULUM_LABELS,
  EntitlementNotice,
  GeneratorNotice,
  KIND_LABELS,
  PlanBadge,
  hubFetch,
  shortDate,
  type HubPayload,
  type ResourceRow,
} from './hub-shared'

const CURRICULA = ['ecz', 'cambridge_igcse', 'cambridge_alevel', 'custom'] as const

/**
 * Zambia runs two systems at once — traditional ECZ Grades 1–12 and the 2023 reform's
 * Grades 1–6 then Forms 1–6 — and most schools are mid-transition. Both are offered
 * because a teacher may genuinely work across both, and neither is the "old" one.
 */
const GRADES = [
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `Form ${i + 1}`),
]

const COMMON_SUBJECTS = [
  'Mathematics',
  'English',
  'Science',
  'Biology',
  'Chemistry',
  'Physics',
  'Civic Education',
  'Geography',
  'History',
  'Computer Studies',
  'Religious Education',
  'Business Studies',
]

export default function TeacherHubPage(): JSX.Element {
  /**
   * The signed-out branch, which this page did not have.
   *
   * Without it the page mounted, called `/api/teacher/hub`, received 401 and rendered
   * "Authentication required." — a fault report at the Hub's front door, shown to every first-time
   * visitor the homepage and the directory send here.
   *
   * `SignedOut` and `SignedIn` rather than a redirect, for the reason this file's header already
   * gives about `needsRegistration`: a redirect that has to be undone is more moving parts than a
   * branch, and one of the two states is always correct.
   */
  return (
    <>
      {/* The signed-out branch moved to `layout.tsx`, so every Hub page is covered rather
          than this one alone. Nothing is rendered here for a signed-out visitor — the layout
          has already replaced the whole shell. */}
      <SignedIn>
        <TeacherHubDashboard />
      </SignedIn>
    </>
  )
}

function TeacherHubDashboard(): JSX.Element {
  const [hub, setHub] = useState<HubPayload | null>(null)
  const [recent, setRecent] = useState<ResourceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: hubError } = await hubFetch<HubPayload>('/api/teacher/hub')
    if (hubError) {
      setError(hubError)
      setLoading(false)
      return
    }
    setError(null)
    setHub(data)

    // Only worth asking once there is an account to own anything.
    if (data && !data.needsRegistration) {
      const { data: library } = await hubFetch<{ resources: ResourceRow[] }>(
        '/api/teacher/hub/resources?limit=5',
      )
      setRecent(library?.resources ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <>
        <PageHeader title="Teacher Hub" description="Your planning tools." />
        <StatSkeleton count={4} />
      </>
    )
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  if (hub?.needsRegistration) {
    return <ProfileSetup onDone={() => void load()} />
  }

  const account = hub?.account
  const firstName = account?.full_name.split(' ')[0] ?? 'there'

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName}`}
        description={
          account
            ? [
                account.grade_levels.length > 0 ? account.grade_levels.join(', ') : null,
                account.subjects.length > 0 ? account.subjects.join(', ') : null,
                account.curriculum_types.map((c) => CURRICULUM_LABELS[c] ?? c).join(' · '),
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        actions={<PlanBadge entitlement={hub?.entitlement ?? null} />}
      />

      <div className="space-y-cards">
        <EntitlementNotice
          entitlement={hub?.entitlement ?? null}
          message={hub?.entitlementMessage ?? null}
          action={
            <p className="mt-3">
              <Button asChild size="sm">
                <Link href="/teacher/account">See plans</Link>
              </Button>
            </p>
          }
        />

        {/* Renders nothing unless a school has actually given this teacher credits —
            see the component. Placed above the tools because which wallet is paying
            is a thing to know before generating, not after. */}
        <CreditBalances />

        <GeneratorNotice modelBacked={hub?.modelBacked ?? false} />

        <div className="grid gap-4 sm:grid-cols-2">
          <ToolCard
            href="/teacher/create?kind=lesson_plan"
            icon={Sparkles}
            title="Lesson planner"
            description="A timed plan with objectives, phases and assessment."
          />
          <ToolCard
            href="/teacher/create?kind=quiz"
            icon={FileQuestion}
            title="Quiz builder"
            description="Questions, marks and a marking guide."
          />
          <ToolCard
            href="/teacher/create?kind=homework"
            icon={ClipboardList}
            title="Homework"
            description="Sized to the minutes you want it to take."
          />
          <ToolCard
            href="/teacher/library"
            icon={BookOpen}
            title="My library"
            description={
              account
                ? `${account.resources_created} ${account.resources_created === 1 ? 'resource' : 'resources'} saved`
                : 'Everything you have made'
            }
          />
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent work</CardTitle>
              <CardDescription>The last five things you made.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/teacher/library">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-text">
                Nothing yet. Start with a lesson plan — it takes about a minute.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/teacher/library/${r.id}`}
                        className="block truncate font-medium text-text hover:underline"
                      >
                        {r.title}
                      </Link>
                      <p className="text-xs text-muted-text">
                        {KIND_LABELS[r.resource_kind] ?? r.resource_kind} · {shortDate(r.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/*
          This card used to be informational only, and said so: there was no code for a
          teacher to type in, because ZSMS invites staff server-side and nothing existed on
          the other side to receive a request. `0160` built that, so the box works now —
          approval issues the same Backend API invitation the staff screen uses, rather than
          a second way of becoming a member.

          Name and email come from the Hub account rather than being asked again. Clerk owns
          the email and the profile step already has the name; a third copy is a third thing
          to keep in step.
        */}
        <SchoolLinkCard
          defaultName={account?.full_name ?? ''}
          defaultEmail={account?.email ?? ''}
        />
      </div>
    </>
  )
}

function ToolCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string
  icon: typeof Sparkles
  title: string
  description: string
}): JSX.Element {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary hover:bg-primary-tint/30"
    >
      <Icon className="size-6 text-primary" aria-hidden />
      <h2 className="mt-3 font-semibold text-text">{title}</h2>
      <p className="mt-1 text-sm text-muted-text">{description}</p>
    </Link>
  )
}

/**
 * The one-screen profile step.
 *
 * Subjects and grades are multi-select lists rather than free text: they drive the prefill
 * on every generator form afterwards, and free text would make "Maths" and "Mathematics"
 * two different subjects in the same library.
 */
function ProfileSetup({ onDone }: { onDone: () => void }): JSX.Element {
  const { toast } = useToast()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [curriculum, setCurriculum] = useState<string>('ecz')
  const [subjects, setSubjects] = useState<string[]>([])
  const [grades, setGrades] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /**
   * Ticking through twelve subjects and eighteen grades is the longest part of joining the Hub,
   * and a teacher who loses it to a dropped connection is unlikely to start again.
   *
   * `phone` is deliberately absent from the allowlist. It is a personal contact number, this form
   * is completed once, and there is no version of "helpful" that justifies leaving it in a browser
   * on a machine that may not be theirs.
   */
  const { userId } = useAuth()
  const draft = useFormDraft({
    formId: 'hub-profile',
    userId,
    values: { fullName, email, curriculum, subjects, grades },
    fields: ['fullName', 'email', 'curriculum', 'subjects', 'grades'],
    enabled: !saving,
  })

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  const submit = async (): Promise<void> => {
    setSaving(true)
    setFormError(null)
    const { error } = await hubFetch('/api/teacher/hub', {
      method: 'POST',
      body: JSON.stringify({
        fullName,
        email,
        // An empty string is not a phone number. Omitted rather than sent blank, because the
        // schema validates the format of whatever it receives.
        ...(phone.trim() ? { phoneE164: phone.trim() } : {}),
        curriculumTypes: [curriculum],
        subjects,
        gradeLevels: grades,
      }),
    })
    setSaving(false)
    if (error) {
      setFormError(error)
      return
    }
    toast('Welcome to the Teacher Hub.', 'success')
    draft.clear()
    onDone()
  }

  return (
    <>
      <PageHeader
        title="Set up your Teacher Hub"
        description="Three questions, so the planner knows what you teach. You can change all of this later."
      />

      <Card>
        <CardContent className="space-y-5 pt-6">
          {draft.pending && (
            <DraftNotice
              savedAgo={draftAge(draft.savedAt)}
              onRestore={() => {
                const d = draft.restore()
                if (!d) return
                if (typeof d.fullName === 'string') setFullName(d.fullName)
                if (typeof d.email === 'string') setEmail(d.email)
                if (typeof d.curriculum === 'string') setCurriculum(d.curriculum)
                if (Array.isArray(d.subjects)) setSubjects(d.subjects as string[])
                if (Array.isArray(d.grades)) setGrades(d.grades as string[])
              }}
              onDiscard={draft.discard}
            />
          )}

          {formError && (
            <p role="alert" className="text-sm font-medium text-danger-text">
              {formError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="full-name" label="Your name" required>
              {(props) => (
                <Input
                  {...props}
                  value={fullName}
                  autoComplete="name"
                  onChange={(e) => setFullName(e.target.value)}
                />
              )}
            </Field>

            <Field
              id="email"
              label="Email"
              required
              hint="Where receipts and account emails go."
            >
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>

            <Field id="phone" label="Phone" hint="Optional. International format, e.g. +260971234567.">
              {(props) => (
                <Input
                  {...props}
                  type="tel"
                  value={phone}
                  autoComplete="tel"
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </Field>

            <Field id="curriculum" label="Curriculum" required>
              {(props) => (
                <Select {...props} value={curriculum} onChange={(e) => setCurriculum(e.target.value)}>
                  {CURRICULA.map((c) => (
                    <option key={c} value={c}>
                      {CURRICULUM_LABELS[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-text">Subjects you teach</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {COMMON_SUBJECTS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  selected={subjects.includes(s)}
                  onToggle={() => setSubjects((prev) => toggle(prev, s))}
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-text">Grades and forms you teach</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {GRADES.map((g) => (
                <Chip
                  key={g}
                  label={g}
                  selected={grades.includes(g)}
                  onToggle={() => setGrades((prev) => toggle(prev, g))}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex items-center gap-3 border-t border-border pt-5">
            <Button
              onClick={() => void submit()}
              // Name and email are the only genuinely required answers; a teacher who has not
              // yet decided which subjects to tick should not be blocked from starting.
              disabled={saving || fullName.trim().length < 2 || !email.includes('@')}
            >
              {saving ? 'Setting up…' : 'Start with 5 free resources'}
            </Button>
            <p className="text-sm text-muted-text">No card needed.</p>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function Chip({
  label,
  selected,
  onToggle,
}: {
  label: string
  selected: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      // `aria-pressed` rather than a checkbox role: these are toggle buttons, and a screen
      // reader should announce the state rather than the shape.
      aria-pressed={selected}
      className={
        selected
          ? 'rounded-full border border-primary bg-primary-tint px-3 py-1.5 text-sm font-medium text-primary-text'
          : 'rounded-full border border-border px-3 py-1.5 text-sm text-muted-text hover:border-primary hover:text-text'
      }
    >
      {label}
    </button>
  )
}
