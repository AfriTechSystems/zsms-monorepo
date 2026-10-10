'use client'

/**
 * Teaching — who reaches which class, and for which subject.
 *
 * Spec: `Official Documentation/08 Staff Management/TEACHING_ASSIGNMENTS.md`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-037
 *
 * ## This screen grants access to children's records
 *
 * It does not look like a permissions screen, and it is one. `teacher_reaches_class()`
 * reads exactly this table, and it decides which pupils a teacher can see, whose
 * register they may mark, and whose marks they may enter. Adding a row here
 * widens somebody's reach into pupil data.
 *
 * So the screen says so, in the page note and beside the scope field, and the
 * confirmation before removing an assignment names what stops working. A person
 * doing this at half past seven in the morning should not have to infer the
 * consequence.
 */

import type { FormEvent, JSX } from 'react'
import { use, useCallback, useMemo, useState } from 'react'
import { GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react'

import { apiSend, useApi } from '../../../../lib/use-api'
import { Alert } from '../../../../components/ui/alert'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card'
import { DataTable } from '../../../../components/ui/data-table'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Field, Select } from '../../../../components/ui/field'
import { FormActions, FormGrid, FormSection } from '../../../../components/ui/form'
import { InfoHint } from '../../../../components/ui/info-hint'
import { formatLevel } from '../school-shared'
import { ClassReadiness } from './class-readiness'

interface Assignment {
  id: string
  teacher_user_id: string
  scope: 'class' | 'subject'
  class_id: string
  subject_id: string | null
  academic_year: string
}

interface Subject {
  id: string
  subject_code: string
  subject_name: string
  level_type: string | null
}

interface Teacher {
  clerk_user_id: string
  first_name: string | null
  last_name: string | null
}

interface Payload {
  assignments: Assignment[]
  subjects: Subject[]
  teachers: Teacher[]
  classes: Array<{ classId: string; gradeId: string }>
  canManage: boolean
  currentYear: string
}

const teacherName = (t: Teacher | undefined): string =>
  t ? [t.first_name, t.last_name].filter(Boolean).join(' ').trim() || t.clerk_user_id : 'Unknown'

export default function TeachingPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`

  // Declared before the memos below read it.
  const [gradeId, setGradeId] = useState('')

  const { data, loading, error, code, reload } = useApi<Payload>('/api/school/teaching')

  /*
    `/api/school/structure` for the grade ORDER.

    The assignment payload carries each class and its grade, but sorted by class id —
    which puts `grade_10a` before `grade_1a`, because that is alphabetical and nothing
    else. `school_grade_levels.level_order` is the school's own ladder and the only
    correct sequence; Zambia runs two systems at once, so Form 1 follows Grade 6 at one
    school and Grade 7 at another.
  */
  const { data: structure } = useApi<{
    gradeLevels: Array<{ level_id: string; display_name: string | null }>
  }>('/api/school/structure')

  /** Grades that actually have a class, in the school's order. */
  const grades = useMemo(() => {
    const present = new Set((data?.classes ?? []).map((c) => c.gradeId))
    const ordered = (structure?.gradeLevels ?? [])
      .filter((g) => present.has(g.level_id))
      .map((g) => ({ id: g.level_id, label: g.display_name ?? formatLevel(g.level_id) }))

    // A class whose grade is missing from the structure would otherwise be
    // unreachable — it still needs assigning, so it goes at the end rather than
    // disappearing.
    for (const id of present) {
      if (!ordered.some((g) => g.id === id)) ordered.push({ id, label: formatLevel(id) })
    }
    return ordered
  }, [data, structure])

  /** Classes inside the chosen grade. Nothing until one is chosen. */
  const classesInGrade = useMemo(
    () =>
      (data?.classes ?? [])
        .filter((c) => c.gradeId === gradeId)
        .sort((a, b) => a.classId.localeCompare(b.classId)),
    [data, gradeId],
  )

  const [teacherUserId, setTeacher] = useState('')
  const [scope, setScope] = useState<'class' | 'subject'>('class')
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const teachersById = useMemo(
    () => new Map((data?.teachers ?? []).map((t) => [t.clerk_user_id, t])),
    [data],
  )
  const subjectsById = useMemo(
    () => new Map((data?.subjects ?? []).map((s) => [s.id, s])),
    [data],
  )

  const complete = teacherUserId && classId && (scope === 'class' || subjectId)

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setFormError(null)

      const result = await apiSend('/api/school/teaching', 'POST', {
        teacherUserId,
        scope,
        classId,
        // Sent only for a subject assignment. The database CHECK refuses the
        // other pairing, and sending it anyway would turn a clear 400 into a
        // constraint violation.
        subjectId: scope === 'subject' ? subjectId : undefined,
        academicYear: data?.currentYear,
      })

      setSaving(false)
      if (result.error) {
        setFormError(result.error)
        return
      }
      setSubjectId('')
      reload()
    },
    [teacherUserId, scope, classId, subjectId, data?.currentYear, reload],
  )

  const remove = useCallback(
    async (a: Assignment) => {
      const who = teacherName(teachersById.get(a.teacher_user_id))
      const what =
        a.scope === 'class'
          ? `${formatLevel(a.class_id)} (whole class)`
          : `${subjectsById.get(a.subject_id ?? '')?.subject_name ?? 'that subject'} in ${formatLevel(a.class_id)}`

      const confirmed = window.confirm(
        `Remove ${who} from ${what}?\n\n` +
          'They immediately stop seeing those pupils, and can no longer mark that ' +
          'register or enter those marks. Registers and marks they already ' +
          'entered are kept.',
      )
      if (!confirmed) return

      setBusy(a.id)
      setFormError(null)
      const result = await apiSend('/api/school/teaching', 'DELETE', { id: a.id })
      setBusy(null)
      if (result.error) {
        setFormError(result.error)
        return
      }
      reload()
    },
    [teachersById, subjectsById, reload],
  )

  return (
    <>
      <PageHeader
        backTo={`${base}/staff`}
        backLabel="Staff"
        title="Teaching"
        description="Which classes and subjects each teacher is responsible for."
        note="This screen controls access, not just record-keeping. A teacher can see the pupils, mark the registers and enter the marks for exactly the classes listed here — and nothing else. Removing an assignment takes that access away immediately; it never deletes work already entered."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={5} columns={4} />}

      {/*
        The top of the drill-down, above the assignment table.

        The table below answers "who teaches what", which is a decision already taken. This
        answers "what is behind", which is the thing somebody opens the portal to find out —
        and it had no screen at all until now.
      */}
      <ClassReadiness base={base} />

      {!error && data && (
        <div className="space-y-cards">
          {formError && (
            <Alert variant="danger" title="That did not work">
              {formError}
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Current assignments</CardTitle>
              <p className="text-sm text-muted-foreground">
                A class assignment reaches every subject in that class. A subject assignment
                reaches one subject only.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                caption="Teaching assignments at this school"
                rows={data.assignments}
                rowKey={(a) => a.id}
                columns={[
                  {
                    key: 'teacher',
                    header: 'Teacher',
                    primary: true,
                    cell: (a) => teacherName(teachersById.get(a.teacher_user_id)),
                  },
                  { key: 'class', header: 'Class', cell: (a) => formatLevel(a.class_id) },
                  {
                    key: 'scope',
                    header: 'Reaches',
                    cell: (a) =>
                      a.scope === 'class' ? (
                        <Badge variant="primary">Whole class</Badge>
                      ) : (
                        <Badge variant="neutral">
                          {subjectsById.get(a.subject_id ?? '')?.subject_name ?? 'Subject'}
                        </Badge>
                      ),
                  },
                  {
                    key: 'year',
                    header: 'Year',
                    hideOnMobile: true,
                    cell: (a) => a.academic_year,
                  },
                  ...(data.canManage
                    ? [
                        {
                          key: 'remove',
                          header: 'Remove',
                          cell: (a: Assignment) => (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === a.id}
                              onClick={() => void remove(a)}
                            >
                              {busy === a.id ? (
                                <Loader2 aria-hidden="true" className="animate-spin" />
                              ) : (
                                <Trash2 aria-hidden="true" />
                              )}
                              Remove
                            </Button>
                          ),
                        },
                      ]
                    : []),
                ]}
                empty={
                  <EmptyState
                    icon={GraduationCap}
                    title="Nobody is assigned yet"
                    description={
                      data.canManage
                        ? 'Until a teacher is assigned to a class, they cannot see its pupils, mark its register, or enter its marks.'
                        : 'The school owner or principal sets these.'
                    }
                  />
                }
              />
            </CardContent>
          </Card>

          {data.canManage ? (
            <FormSection
              title="Assign a teacher"
              description="Takes effect immediately for the teacher named."
            >
              {data.teachers.length === 0 && (
                <Alert variant="warning" title="No staff records yet" className="mb-stack">
                  An assignment is made against a staff record. Add staff first — an invitation
                  alone creates a sign-in, not a record to assign.
                </Alert>
              )}

              {data.classes.length === 0 && (
                <Alert variant="warning" title="No classes yet" className="mb-stack">
                  Classes come from the pupils enrolled in them, so there is nothing to assign
                  until the first pupil is on the roll.
                </Alert>
              )}

              <form onSubmit={submit} noValidate>
                <FormGrid columns={2}>
                  <Field id="ta-teacher" label="Teacher" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={teacherUserId}
                        required
                        onChange={(e) => setTeacher(e.target.value)}
                      >
                        <option value="">Choose a teacher</option>
                        {data.teachers.map((t) => (
                          <option key={t.clerk_user_id} value={t.clerk_user_id}>
                            {teacherName(t)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  {/*
                    Grade first, then the classes inside it.

                    This was every class in the school in one dropdown, sorted
                    alphabetically — so a secondary school with twelve grades put dozens of
                    options in front of an administrator with `grade_10a` above `grade_1a`
                    and no indication which grade any of them belonged to.
                  */}
                  <Field id="ta-grade" label="Grade" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={gradeId}
                        required
                        // Changing grade clears the class: a class from the previous grade
                        // is not in the new one, and leaving it set would assign a teacher
                        // to something the administrator is no longer looking at.
                        onChange={(e) => {
                          setGradeId(e.target.value)
                          setClassId('')
                        }}
                      >
                        <option value="">Choose a grade</option>
                        {grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field id="ta-class" label="Class" required>
                    {(props) => (
                      <Select
                        {...props}
                        value={classId}
                        required
                        disabled={!gradeId}
                        onChange={(e) => setClassId(e.target.value)}
                      >
                        <option value="">
                          {gradeId ? 'Choose a class' : 'Choose a grade first'}
                        </option>
                        {classesInGrade.map((c) => (
                          <option key={c.classId} value={c.classId}>
                            {formatLevel(c.classId)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field
                    id="ta-scope"
                    label="Reaches"
                    required
                    hint="A class teacher sees the whole class. A subject teacher sees it for one subject."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        value={scope}
                        onChange={(e) => {
                          const next = e.target.value as 'class' | 'subject'
                          setScope(next)
                          // A class assignment must carry no subject — the
                          // database CHECK refuses the pair, so the stale value
                          // is cleared rather than sent and rejected.
                          if (next === 'class') setSubjectId('')
                        }}
                      >
                        <option value="class">The whole class, every subject</option>
                        <option value="subject">One subject in that class</option>
                      </Select>
                    )}
                  </Field>

                  {scope === 'subject' && (
                    <Field id="ta-subject" label="Subject" required>
                      {(props) => (
                        <Select
                          {...props}
                          value={subjectId}
                          required
                          onChange={(e) => setSubjectId(e.target.value)}
                        >
                          <option value="">Choose a subject</option>
                          {data.subjects.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.subject_name} ({s.subject_code})
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )}
                </FormGrid>

                <FormActions>
                  <Button type="submit" disabled={saving || !complete}>
                    {saving ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Plus aria-hidden="true" />
                    )}
                    Assign
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Grants access to those pupils
                    <InfoHint label="what an assignment grants" className="ml-1">
                      The teacher will be able to see these pupils, mark their register, and enter
                      their marks. They will not be able to see fees, staff, or any class they are
                      not assigned to.
                    </InfoHint>
                  </span>
                </FormActions>
              </form>
            </FormSection>
          ) : (
            <Alert variant="info" title="Assignments are the owner's to set">
              Only the school owner and the principal can change who teaches what. You can see the
              current assignments above.
            </Alert>
          )}
        </div>
      )}
    </>
  )
}
