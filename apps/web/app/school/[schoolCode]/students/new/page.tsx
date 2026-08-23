'use client'

/**
 * Enrol a pupil.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       `Official Documentation/01 Foundation Layer/CONVENTIONS.md` — identifiers
 *
 * ## The ceiling is checked twice, and the second check is the real one
 *
 * This form refuses to submit when the roll is full, using the number the API
 * returned. That is a courtesy — it saves someone typing a full record before
 * being told. The **enforcement** is a trigger on `students` (migration 0101),
 * which fires whichever writer arrives: this form, the CSV import, or a support
 * operator with the service role.
 *
 * The distinction matters for the case this screen must handle correctly: two
 * registrars enrolling the last place at once. One of them submits a form that
 * passed the client check and is refused by the trigger. That returns `CONFLICT`
 * carrying the resolved ceiling in its message, and the form renders it without
 * clearing what was typed.
 *
 * ## No identifier is chosen here
 *
 * `student_id` — `STU-ZM-LSK-0001-00042` — is built server-side from the school
 * code in the caller's JWT. Neither the school nor the sequence is accepted from
 * this form: a client that can nominate its own `school_id` can write into
 * another tenant, and the WITH CHECK would be the only thing in the way.
 */

import type { FormEvent, JSX } from 'react'
import { use, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react'

import { apiSend, useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Button } from '../../../../../components/ui/button'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../../components/ui/field'
import { CheckboxField, FormActions, FormGrid, FormSection } from '../../../../../components/ui/form'
import { formatCount } from '../../school-shared'

interface Structure {
  gradeLevels: Array<{ level_id: string; display_name: string; level_order: number }>
  classesByGrade: Record<string, string[]>
}

interface CapacityMeta {
  student_limit: number | null
  is_unlimited: boolean
  current_count: number
  at_capacity: boolean
}

/** Today as YYYY-MM-DD, for the enrolment-date default and the DOB maximum. */
function todayIso(): string {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

export default function NewStudentPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`
  const router = useRouter()

  const { data: structure, loading, error, code, reload } = useApi<Structure>('/api/school/structure')
  // One row is enough to carry `meta.capacity`, and it is the cheapest way to
  // ask the same question the list asks — no second endpoint to keep in step.
  const { meta } = useApi<unknown[]>('/api/students?perPage=1')
  const capacity = (meta?.capacity ?? null) as CapacityMeta | null
  const atCapacity = capacity?.at_capacity === true

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [classId, setClassId] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState('')
  const [enrolmentDate, setEnrolmentDate] = useState(todayIso())
  const [isBoarding, setIsBoarding] = useState(false)

  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitCode, setSubmitCode] = useState<string | null>(null)

  // Classes are the distinct set already in use for the chosen grade. A grade
  // with no pupils yet offers none, which is why the control also accepts a
  // typed value — see /api/school/structure for why there is no classes table.
  const classOptions = useMemo(
    () => (gradeId ? (structure?.classesByGrade?.[gradeId] ?? []) : []),
    [gradeId, structure],
  )

  const complete = firstName.trim() && lastName.trim() && gradeId && classId.trim()

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setSubmitError(null)
      setSubmitCode(null)

      const result = await apiSend<{ id: string; student_id: string }>('/api/students', 'POST', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gradeId,
        classId: classId.trim(),
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        enrolmentDate: enrolmentDate || undefined,
        isBoarding,
      })

      setSaving(false)

      if (result.error) {
        // Nothing is cleared. A form that empties itself on failure is the one
        // behaviour DESIGN_SYSTEM.md names outright, and it is worst exactly
        // here — a full pupil record retyped because the roll filled up while
        // someone was typing it.
        setSubmitError(result.error)
        setSubmitCode(result.code)
        return
      }

      router.push(`${base}/students/${result.data?.id ?? ''}`)
    },
    [firstName, lastName, gradeId, classId, dateOfBirth, gender, enrolmentDate, isBoarding, router, base],
  )

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3">
        <Link href={`${base}/students`}>
          <ArrowLeft aria-hidden="true" />
          All pupils
        </Link>
      </Button>

      <PageHeader
        title="Enrol a pupil"
        description="The pupil number is generated from the school code — it is not entered here."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !structure && !error && <TableSkeleton rows={4} columns={2} />}

      {!error && structure && (
        <>
          {atCapacity && capacity && (
            <Alert variant="danger" title="The roll is full" className="mb-cards">
              This school has {formatCount(capacity.current_count)} pupils on the roll and its plan
              allows {formatCount(capacity.student_limit ?? 0)}. Enrolment will be refused until a
              place is freed, the subscription is upgraded, or AfriTech sets a limit for this school
              alone.
            </Alert>
          )}

          {structure.gradeLevels.length === 0 && (
            <Alert variant="warning" title="No grades configured" className="mb-cards">
              This school has no grade levels set up yet, so there is nothing to enrol a pupil into.
              Set the academic structure first.
            </Alert>
          )}

          <form onSubmit={submit} noValidate>
            <FormSection title="Pupil" description="Name and grade are required; the rest can be added later.">
              <FormGrid columns={2}>
                <Field id="first-name" label="First name" required>
                  {(props) => (
                    <Input
                      {...props}
                      value={firstName}
                      maxLength={100}
                      required
                      autoComplete="off"
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  )}
                </Field>

                <Field id="last-name" label="Surname" required>
                  {(props) => (
                    <Input
                      {...props}
                      value={lastName}
                      maxLength={100}
                      required
                      autoComplete="off"
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  )}
                </Field>

                <Field
                  id="grade"
                  label="Grade"
                  required
                  hint="This school's own levels, not a standard list."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={gradeId}
                      required
                      onChange={(e) => {
                        setGradeId(e.target.value)
                        // The class list depends on the grade, so a stale class
                        // from the previous grade must not survive the change.
                        setClassId('')
                      }}
                    >
                      <option value="">Choose a grade</option>
                      {structure.gradeLevels.map((g) => (
                        <option key={g.level_id} value={g.level_id}>
                          {g.display_name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field
                  id="class"
                  label="Class"
                  required
                  hint={
                    gradeId
                      ? classOptions.length > 0
                        ? 'Choose an existing class, or type a new one.'
                        : 'No classes in this grade yet — type the first.'
                      : 'Choose a grade first.'
                  }
                >
                  {(props) => (
                    <>
                      <Input
                        {...props}
                        value={classId}
                        list={classOptions.length > 0 ? 'class-options' : undefined}
                        maxLength={50}
                        required
                        disabled={!gradeId}
                        placeholder={gradeId ? `${gradeId}a` : ''}
                        onChange={(e) => setClassId(e.target.value)}
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
                      value={dateOfBirth}
                      max={todayIso()}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                    />
                  )}
                </Field>

                <Field id="gender" label="Gender" hint="Optional">
                  {(props) => (
                    <Select {...props} value={gender} onChange={(e) => setGender(e.target.value)}>
                      <option value="">Not stated</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="not_stated">Prefer not to say</option>
                    </Select>
                  )}
                </Field>

                <Field
                  id="enrolment-date"
                  label="Enrolment date"
                  hint="Defaults to today."
                  footer={
                    <CheckboxField
                      id="boarding"
                      label="Boarding pupil"
                      checked={isBoarding}
                      onChange={setIsBoarding}
                    />
                  }
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      value={enrolmentDate}
                      onChange={(e) => setEnrolmentDate(e.target.value)}
                    />
                  )}
                </Field>
              </FormGrid>

              {submitError && (
                <Alert
                  variant={submitCode === 'CONFLICT' ? 'warning' : 'danger'}
                  title={submitCode === 'CONFLICT' ? 'Could not enrol this pupil' : 'Not saved'}
                  className="mt-stack"
                >
                  {/* CONFLICT from the ceiling trigger carries the resolved
                      limit in its own message, so it is rendered as written
                      rather than replaced with a generic line. */}
                  {submitError}
                </Alert>
              )}

              <FormActions>
                <Button
                  type="submit"
                  disabled={saving || !complete || atCapacity || structure.gradeLevels.length === 0}
                >
                  {saving ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <UserPlus aria-hidden="true" />
                  )}
                  Enrol pupil
                </Button>
                <Button type="button" variant="ghost" asChild>
                  <Link href={`${base}/students`}>Cancel</Link>
                </Button>
              </FormActions>
            </FormSection>
          </form>
        </>
      )}
    </>
  )
}
