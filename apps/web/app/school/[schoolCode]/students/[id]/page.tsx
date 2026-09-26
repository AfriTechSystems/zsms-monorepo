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
import Link from 'next/link'
import { Loader2, Save, UserMinus } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent } from '../../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { CustomFieldsPanel } from './custom-fields-panel'
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

  const { data, loading, error, code, reload } = useApi<Student>(`/api/students/${id}`)
  const { data: structure } = useApi<Structure>('/api/school/structure')

  const [form, setForm] = useState<Partial<Student>>({})
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
