'use client'

/**
 * One pupil — record, edit, and withdrawal.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       `Official Documentation/01 Foundation Layer/CONVENTIONS.md` — prohibition 8
 *
 * ## There is no delete
 *
 * Hard deletes on pupils are forbidden, and not merely by convention: there is
 * no DELETE policy and no DELETE privilege on `students` for any role, the
 * school owner included. What this screen offers is **removal from the roll** —
 * a status change to transferred, graduated, or withdrawn — which frees a place
 * against the ceiling while keeping the record and everything that references
 * it: fee history, attendance, results.
 *
 * The button says what it does. "Remove from the roll" is the truth; "Delete"
 * would be a promise the database refuses to keep, and the person clicking it
 * would believe the record was gone.
 *
 * ## Returning a pupil to the roll can be refused
 *
 * Moving `withdrawn` back to `active` consumes a place, so the same trigger that
 * guards enrolment guards this. A full school cannot reinstate a pupil, and the
 * form says so with the resolved number rather than failing generically —
 * otherwise the ceiling would be trivially escapable by withdrawing and
 * reinstating.
 */

import type { FormEvent, JSX } from 'react'
import { use, useCallback, useEffect, useState } from 'react'
import { Loader2, Mail, Phone, Plus, Save, UserMinus, Users } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent } from '../../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { CustomFieldsPanel } from './custom-fields-panel'
import { useToast } from '../../../../../components/ui/toast'
import { Field, Input, Select } from '../../../../../components/ui/field'
import { CheckboxField, FormActions, FormGrid, FormSection } from '../../../../../components/ui/form'
import {
  STATUSES_ON_ROLL,
  STUDENT_STATUSES,
  STUDENT_STATUS_LABEL,
  StudentStatusBadge,
  formatDate,
  formatLevel,
} from '../../school-shared'

interface Guardian {
  id: string
  relationship: string
  is_primary: boolean
  parents: {
    id: string
    full_name: string
    phone_e164: string | null
    email: string | null
    preferred_contact: string
    /** Null until the parent signs up and their verified email matches (0170). */
    clerk_user_id: string | null
  } | null
}

interface Student {
  id: string
  student_id: string
  school_id: string
  first_name: string
  last_name: string
  grade_id: string
  class_id: string
  is_boarding: boolean
  status: string
  enrolment_date: string
  date_of_birth: string | null
  gender: string | null
  created_at: string
  updated_at: string
  guardians?: Guardian[]
  guardiansLoaded?: boolean
}

interface Structure {
  gradeLevels: Array<{ level_id: string; display_name: string }>
  classesByGrade: Record<string, string[]>
}

const onRoll = (status: string): boolean => (STATUSES_ON_ROLL as readonly string[]).includes(status)

export default function StudentDetailPage({
  params,
}: {
  params: Promise<{ schoolCode: string; id: string }>
}): JSX.Element {
  const { schoolCode, id } = use(params)
  const base = `/school/${schoolCode}`

  const { toast } = useToast()
  const { data, loading, error, code, reload } = useApi<Student>(`/api/students/${id}`)
  const { data: structure } = useApi<Structure>('/api/school/structure')

  const [form, setForm] = useState<Partial<Student>>({})
  /**
   * Adding a guardian — `PARENT_LINKING.md` Method 2.
   *
   * The phone is required and is how a guardian is identified: matched on the last nine
   * digits, so one parent with four children at this school is one account rather than four,
   * and `0977 123 456` is the same person as `+260977123456`.
   */
  const [gName, setGName] = useState('')
  const [gPhone, setGPhone] = useState('')
  const [gEmail, setGEmail] = useState('')
  const [gRelationship, setGRelationship] = useState('mother')
  const [gPrimary, setGPrimary] = useState(false)
  const [gBusy, setGBusy] = useState(false)
  const [gOpen, setGOpen] = useState(false)

  const addGuardian = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setGBusy(true)
      try {
        const response = await fetch(`/api/students/${id}/guardians`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: gName,
            phone: gPhone,
            email: gEmail || undefined,
            relationship: gRelationship,
            isPrimary: gPrimary,
          }),
        })
        const body = await response.json()
        if (!response.ok) {
          toast(body?.error ?? 'That guardian could not be linked.', 'danger')
          return
        }
        toast(body?.data?.message ?? 'Guardian linked.', 'success')
        setGName('')
        setGPhone('')
        setGEmail('')
        setGPrimary(false)
        setGOpen(false)
        reload()
      } finally {
        setGBusy(false)
      }
    },
    [id, gName, gPhone, gEmail, gRelationship, gPrimary, toast, reload],
  )

  const removeGuardian = useCallback(
    async (linkId: string) => {
      setGBusy(true)
      try {
        const response = await fetch(`/api/students/${id}/guardians`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkId }),
        })
        const body = await response.json()
        if (!response.ok) {
          toast(body?.error ?? 'That could not be removed.', 'danger')
          return
        }
        // Said plainly: removal is not instant, and a school expecting it to be would
        // otherwise think it had failed.
        toast('Removed. They keep access to past receipts and results for 30 days.', 'success')
        reload()
      } finally {
        setGBusy(false)
      }
    },
    [id, toast, reload],
  )

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitCode, setSubmitCode] = useState<string | null>(null)

  // Seeded from the record, then owned by the form. Keyed on `updated_at` so a
  // successful save re-seeds and a background reload does not silently discard
  // edits in progress.
  useEffect(() => {
    if (data) setForm({ ...data })
  }, [data?.updated_at, data?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Student>(key: K, value: Student[K]): void => {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  const dirty =
    data !== null &&
    (['first_name', 'last_name', 'grade_id', 'class_id', 'status', 'is_boarding', 'date_of_birth', 'gender', 'enrolment_date'] as const).some(
      (k) => form[k] !== undefined && form[k] !== data[k],
    )

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (!data) return

      // Naming the consequence before the click, not after. Removing a pupil
      // from the roll frees a place and changes what parents and teachers see.
      if (form.status && form.status !== data.status && onRoll(data.status) && !onRoll(form.status)) {
        const ok = window.confirm(
          `Remove ${data.first_name} ${data.last_name} from the roll?\n\n` +
            'The record and all its history are kept. The pupil stops appearing in registers and ' +
            'mark sheets, and their place becomes available to another pupil.',
        )
        if (!ok) return
      }

      setSaving(true)
      setSubmitError(null)
      setSubmitCode(null)
      setSaved(false)

      const patch: Record<string, unknown> = {}
      if (form.first_name !== data.first_name) patch['firstName'] = form.first_name
      if (form.last_name !== data.last_name) patch['lastName'] = form.last_name
      if (form.grade_id !== data.grade_id) patch['gradeId'] = form.grade_id
      if (form.class_id !== data.class_id) patch['classId'] = form.class_id
      if (form.status !== data.status) patch['status'] = form.status
      if (form.is_boarding !== data.is_boarding) patch['isBoarding'] = form.is_boarding
      if (form.gender !== data.gender) patch['gender'] = form.gender || undefined
      if (form.date_of_birth !== data.date_of_birth) patch['dateOfBirth'] = form.date_of_birth || undefined
      if (form.enrolment_date !== data.enrolment_date) patch['enrolmentDate'] = form.enrolment_date

      const result = await apiSend(`/api/students/${id}`, 'PATCH', patch)

      setSaving(false)
      if (result.error) {
        setSubmitError(result.error)
        setSubmitCode(result.code)
        return
      }

      setSaved(true)
      reload()
    },
    [data, form, id, reload],
  )

  const classOptions = form.grade_id ? (structure?.classesByGrade?.[form.grade_id] ?? []) : []

  return (
    <>
      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={6} columns={2} />}

      {!error && data && (
        <>
          <PageHeader
            backTo={`${base}/students`}
            backLabel="All pupils"
            title={`${data.first_name} ${data.last_name}`}
            description={data.student_id}
            note="Changes here take effect immediately for every teacher and parent who can see this pupil. Moving a pupil off the roll frees a place against the school's limit; it never deletes anything."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <StudentStatusBadge status={data.status} />
                {data.is_boarding && <Badge variant="info">Boarding</Badge>}
              </div>
            }
          />

          <div className="space-y-cards">
            <Card>
              <CardContent className="pt-card">
                <dl className="grid grid-cols-2 gap-stack lg:grid-cols-4">
                  <div>
                    <dt className="text-sm text-muted-foreground">Pupil number</dt>
                    <dd className="font-mono text-sm">{data.student_id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Grade and class</dt>
                    <dd className="text-sm">
                      {formatLevel(data.grade_id)} · {formatLevel(data.class_id)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Enrolled</dt>
                    <dd className="text-sm">{formatDate(data.enrolment_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Counts against the limit</dt>
                    <dd className="text-sm">{onRoll(data.status) ? 'Yes' : 'No'}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/*
              Who to ring.

              The pupil record showed no way to reach anybody responsible for them, so a
              bursar chasing fees or an office ringing about an absence had to leave ZSMS to
              find a number. The data has always existed; nothing asked for it.

              `clerk_user_id` drives the "has an account" badge, which answers the question
              staff actually ask when a parent says they cannot see anything: whether this
              guardian has ever linked. A parent links by signing up with the email recorded
              HERE (0170), so an address that is blank or wrong is the usual cause — and that
              is visible on this card rather than needing a support call.
            */}
            <Card>
              <CardContent className="pt-card">
                <div className="mb-stack flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <Users aria-hidden="true" className="size-4 text-muted-foreground" />
                    Parents and guardians
                  </h2>
                  {(data.guardians?.length ?? 0) > 0 && (
                    <span data-numeric className="text-sm text-muted-foreground">
                      {data.guardians?.length}
                    </span>
                  )}
                </div>

                {data.guardiansLoaded === false ? (
                  <p className="text-sm text-danger">
                    Contact details could not be loaded. The rest of this record is correct.
                  </p>
                ) : (data.guardians?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No parent or guardian is recorded for this pupil. Without one, nobody can be
                    contacted about them — and no parent can link an account to see attendance,
                    results or fees.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-stack">
                    {data.guardians?.map((g, i) => (
                      <li
                        key={g.parents?.id ?? i}
                        className="flex flex-wrap items-start gap-x-cards gap-y-1 rounded-md border border-border bg-surface p-3"
                      >
                        <div className="min-w-[10rem] flex-1">
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            {g.parents?.full_name ?? 'Unnamed guardian'}
                            {g.is_primary && <Badge variant="info">Primary</Badge>}
                            {g.parents?.clerk_user_id ? (
                              <Badge variant="success">Has an account</Badge>
                            ) : (
                              <Badge variant="neutral">No account yet</Badge>
                            )}
                          </p>
                          <p className="text-sm capitalize text-muted-foreground">
                            {g.relationship}
                          </p>
                        </div>

                        <dl className="flex flex-1 flex-col gap-0.5 text-sm">
                          <div className="flex items-center gap-2">
                            <dt className="sr-only">Phone</dt>
                            <Phone aria-hidden="true" className="size-3.5 text-muted-foreground" />
                            <dd>
                              {g.parents?.phone_e164 ? (
                                // `tel:` so a phone dials it and a desktop hands it to the
                                // softphone, rather than making somebody copy digits by eye.
                                <a href={`tel:${g.parents.phone_e164}`} className="hover:underline">
                                  {g.parents.phone_e164}
                                </a>
                              ) : (
                                <span className="text-muted-foreground">No phone recorded</span>
                              )}
                            </dd>
                          </div>
                          <div className="flex items-center gap-2">
                            <dt className="sr-only">Email</dt>
                            <Mail aria-hidden="true" className="size-3.5 text-muted-foreground" />
                            <dd className="min-w-0">
                              {g.parents?.email ? (
                                <a
                                  href={`mailto:${g.parents.email}`}
                                  className="block truncate hover:underline"
                                >
                                  {g.parents.email}
                                </a>
                              ) : (
                                <span className="text-muted-foreground">No email recorded</span>
                              )}
                            </dd>
                          </div>
                        </dl>

                        {/*
                          Removal is not instant, and the button says so rather than letting a
                          school think it failed: `PARENT_LINKING.md` grants 30 days of access
                          after unlinking so a parent can still download a receipt for fees
                          they already paid.
                        */}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={gBusy}
                          onClick={() => void removeGuardian(g.id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* ---- add a guardian ---- */}
                {!gOpen ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-stack"
                    onClick={() => setGOpen(true)}
                  >
                    <Plus aria-hidden="true" />
                    Add a parent or guardian
                  </Button>
                ) : (
                  <form
                    onSubmit={addGuardian}
                    className="mt-stack flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
                  >
                    <div className="flex flex-wrap gap-3">
                      <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
                        <label htmlFor="g-name" className="text-sm font-medium">
                          Full name
                        </label>
                        <input
                          id="g-name"
                          value={gName}
                          onChange={(e) => setGName(e.target.value)}
                          required
                          className="min-h-tap rounded-md border border-border bg-background px-3"
                        />
                      </div>

                      <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
                        <label htmlFor="g-phone" className="text-sm font-medium">
                          Phone
                        </label>
                        <input
                          id="g-phone"
                          value={gPhone}
                          onChange={(e) => setGPhone(e.target.value)}
                          placeholder="+260977123456"
                          required
                          className="min-h-tap rounded-md border border-border bg-background px-3"
                        />
                        <p className="text-xs text-muted-foreground">
                          If this number is already on another pupil, the same guardian is
                          linked rather than a second one created.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
                        <label htmlFor="g-email" className="text-sm font-medium">
                          Email <span className="text-subtle">(optional)</span>
                        </label>
                        <input
                          id="g-email"
                          type="email"
                          value={gEmail}
                          onChange={(e) => setGEmail(e.target.value)}
                          className="min-h-tap rounded-md border border-border bg-background px-3"
                        />
                        <p className="text-xs text-muted-foreground">
                          {/* The single most useful thing on this form, and the least obvious. */}
                          This is what they sign up with to see their child.
                        </p>
                      </div>

                      <div className="flex w-40 flex-col gap-1.5">
                        <label htmlFor="g-rel" className="text-sm font-medium">
                          Relationship
                        </label>
                        <select
                          id="g-rel"
                          value={gRelationship}
                          onChange={(e) => setGRelationship(e.target.value)}
                          className="min-h-tap rounded-md border border-border bg-background px-3"
                        >
                          {['mother', 'father', 'guardian', 'grandparent', 'sibling', 'uncle', 'aunt', 'other'].map(
                            (r) => (
                              <option key={r} value={r} className="capitalize">
                                {r.charAt(0).toUpperCase() + r.slice(1)}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    </div>

                    <label className="flex min-h-tap cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={gPrimary}
                        onChange={(e) => setGPrimary(e.target.checked)}
                        className="size-4"
                      />
                      {/* One per pupil, enforced by `idx_spl_primary`. Ticking it moves the
                          flag rather than failing. */}
                      Main contact — receives fee reminders, absence alerts and results
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="submit" disabled={gBusy}>
                        {gBusy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                        Link guardian
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setGOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            <form onSubmit={save} noValidate>
              <FormSection
                title="Record"
                description="Changes take effect immediately for every teacher and parent who can see this pupil."
              >
                <FormGrid columns={2}>
                  <Field id="first-name" label="First name" required>
                    {(props) => (
                      <Input
                        {...props}
                        value={form.first_name ?? ''}
                        maxLength={100}
                        required
                        onChange={(e) => set('first_name', e.target.value)}
                      />
                    )}
                  </Field>

                  <Field id="last-name" label="Surname" required>
                    {(props) => (
                      <Input
                        {...props}
                        value={form.last_name ?? ''}
                        maxLength={100}
                        required
                        onChange={(e) => set('last_name', e.target.value)}
                      />
                    )}
                  </Field>

                  <Field id="grade" label="Grade" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={form.grade_id ?? ''}
                        required
                        onChange={(e) => {
                          set('grade_id', e.target.value)
                          set('class_id', '')
                        }}
                      >
                        <option value="">Choose a grade</option>
                        {(structure?.gradeLevels ?? []).map((g) => (
                          <option key={g.level_id} value={g.level_id}>
                            {g.display_name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field id="class" label="Class" required hint="Choose an existing class, or type a new one.">
                    {(props) => (
                      <>
                        <Input
                          {...props}
                          value={form.class_id ?? ''}
                          list={classOptions.length > 0 ? 'class-options' : undefined}
                          maxLength={50}
                          required
                          onChange={(e) => set('class_id', e.target.value)}
                        />
                        {classOptions.length > 0 && (
                          <datalist id="class-options">
                            {classOptions.map((c) => (
                              <option key={c} value={c} />
                            ))}
                          </datalist>
                        )}
                      </>
                    )}
                  </Field>

                  <Field id="dob" label="Date of birth" hint="Optional">
                    {(props) => (
                      <Input
                        {...props}
                        type="date"
                        value={form.date_of_birth ?? ''}
                        onChange={(e) => set('date_of_birth', e.target.value)}
                      />
                    )}
                  </Field>

                  <Field id="gender" label="Gender" hint="Optional">
                    {(props) => (
                      <Select
                        {...props}
                        value={form.gender ?? ''}
                        onChange={(e) => set('gender', e.target.value)}
                      >
                        <option value="">Not stated</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="not_stated">Prefer not to say</option>
                      </Select>
                    )}
                  </Field>

                  <Field
                    id="status"
                    label="Status"
                    required
                    hint="Active and on-leave pupils occupy a place against the school's limit."
                    footer={
                      <CheckboxField
                        id="boarding"
                        label="Boarding pupil"
                        checked={form.is_boarding ?? false}
                        onChange={(v) => set('is_boarding', v)}
                      />
                    }
                  >
                    {(props) => (
                      <Select
                        {...props}
                        value={form.status ?? ''}
                        required
                        onChange={(e) => set('status', e.target.value)}
                      >
                        {STUDENT_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STUDENT_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field id="enrolment-date" label="Enrolment date">
                    {(props) => (
                      <Input
                        {...props}
                        type="date"
                        value={form.enrolment_date ?? ''}
                        onChange={(e) => set('enrolment_date', e.target.value)}
                      />
                    )}
                  </Field>
                </FormGrid>

                {submitError && (
                  <Alert
                    variant={submitCode === 'CONFLICT' ? 'warning' : 'danger'}
                    title={submitCode === 'CONFLICT' ? 'Could not save this change' : 'Not saved'}
                    className="mt-stack"
                  >
                    {/* Returning a pupil to the roll at a full school lands here,
                        carrying the resolved ceiling in the message. */}
                    {submitError}
                  </Alert>
                )}

                <FormActions>
                  <Button type="submit" disabled={saving || !dirty}>
                    {saving ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : form.status && data.status !== form.status && !onRoll(form.status) ? (
                      <UserMinus aria-hidden="true" />
                    ) : (
                      <Save aria-hidden="true" />
                    )}
                    Save changes
                  </Button>
                  <p role="status" aria-live="polite" className="text-sm text-success-text">
                    {saved && !dirty ? 'Saved.' : ''}
                  </p>
                </FormActions>
              </FormSection>
            </form>

            {/* Renders nothing when the school has defined no extra fields — an
                empty "Additional details" heading reads as a broken section. */}
            <CustomFieldsPanel studentId={id} />

            <Alert variant="info" title="Pupil records are never deleted">
              A pupil who leaves is given a status of transferred, graduated, or withdrawn. The
              record, the fee history, the attendance, and the results all stay; the place is
              released. There is no way to delete a pupil, for anyone, including the school owner.
            </Alert>
          </div>
        </>
      )}
    </>
  )
}
