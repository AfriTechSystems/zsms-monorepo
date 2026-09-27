'use client'

/**
 * The generator — all three tools on one screen.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       `Official Documentation/18 AI Module/LESSON_PLANNER.md`
 *
 * ## One screen, not three
 *
 * The documented Hub has a lesson planner, a quiz generator and a homework creator. They
 * ask the same four questions — subject, grade, topic, curriculum — and differ in two or
 * three fields each. Three screens would mean three copies of the same form, and a teacher
 * who decides halfway through that they want a quiz instead would have to start again.
 * `?kind=` chooses the tool and the extra fields swap.
 *
 * ## The disabled button is a courtesy, not a control
 *
 * The entitlement is read here so an exhausted trial does not let a teacher fill in a form
 * for nothing. The refusal that actually matters happens in the database, inside a row lock
 * — see `create_teaching_resource()`. If the two ever disagree, the database wins and the
 * message it raises is what the teacher sees.
 */

import type { JSX } from 'react'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Field, Input, Select, Textarea } from '../../../components/ui/field'
import { ErrorState, PageHeader, StatSkeleton } from '../../../components/ui/data-states'
import { useToast } from '../../../components/ui/toast'
import {
  CURRICULUM_LABELS,
  EntitlementNotice,
  GeneratorNotice,
  PlanBadge,
  hubFetch,
  type HubPayload,
} from '../hub-shared'

type Kind = 'lesson_plan' | 'quiz' | 'homework'

const KIND_COPY: Record<Kind, { title: string; description: string; verb: string }> = {
  lesson_plan: {
    title: 'New lesson plan',
    description: 'A timed plan whose phases add up to the length you set.',
    verb: 'Build the plan',
  },
  quiz: {
    title: 'New quiz',
    description: 'Questions with marks and a marking guide.',
    verb: 'Build the quiz',
  },
  homework: {
    title: 'New homework',
    description: 'Sized to the minutes you want it to take.',
    verb: 'Build the homework',
  },
}

const GRADES = [
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `Form ${i + 1}`),
]

export default function CreatePage(): JSX.Element {
  // `useSearchParams` needs a Suspense boundary or the whole route opts out of static
  // rendering with a build-time warning.
  return (
    <Suspense fallback={<StatSkeleton count={2} />}>
      <CreateForm />
    </Suspense>
  )
}

function CreateForm(): JSX.Element {
  const router = useRouter()
  const params = useSearchParams()
  const { toast } = useToast()

  const kindParam = params.get('kind')
  const kind: Kind =
    kindParam === 'quiz' || kindParam === 'homework' ? kindParam : 'lesson_plan'

  const [hub, setHub] = useState<HubPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [topic, setTopic] = useState('')
  const [curriculum, setCurriculum] = useState('ecz')
  const [duration, setDuration] = useState(kind === 'homework' ? 20 : 40)
  const [lessonType, setLessonType] = useState('core')
  const [questionCount, setQuestionCount] = useState(10)
  const [questionStyle, setQuestionStyle] = useState('mixed')
  const [difficulty, setDifficulty] = useState('standard')
  const [context, setContext] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await hubFetch<HubPayload>('/api/teacher/hub')
    if (error) {
      setLoadError(error)
      setLoading(false)
      return
    }
    setLoadError(null)
    setHub(data)
    // Prefill from the profile, so a teacher who does one subject and one grade types a
    // topic and presses the button.
    if (data?.account) {
      setSubject((prev) => prev || (data.account?.subjects[0] ?? ''))
      setGrade((prev) => prev || (data.account?.grade_levels[0] ?? ''))
      setCurriculum(data.account.curriculum_types[0] ?? 'ecz')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setFormError(null)

    const { data, error } = await hubFetch<{ resource: { id: string } }>(
      '/api/teacher/hub/resources',
      {
        method: 'POST',
        body: JSON.stringify({
          kind,
          subject,
          gradeLevel: grade,
          topic,
          curriculumType: curriculum,
          // Only the fields the chosen tool actually uses. Sending a question count with a
          // lesson plan would store a parameter that had no effect on the output.
          ...(kind !== 'quiz' ? { durationMinutes: duration } : {}),
          ...(kind === 'lesson_plan' ? { lessonType } : {}),
          ...(kind === 'quiz' ? { questionCount, questionStyle, difficulty } : {}),
          ...(context.trim() ? { context: context.trim() } : {}),
        }),
      },
    )

    setSubmitting(false)

    if (error) {
      setFormError(error)
      // An entitlement refusal changes what the screen should show, so the banner is
      // refreshed rather than left claiming the teacher still has resources left.
      void load()
      return
    }

    toast('Saved to your library.', 'success')
    if (data?.resource.id) router.push(`/teacher/library/${data.resource.id}`)
  }

  if (loading) return <StatSkeleton count={2} />
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />

  if (hub?.needsRegistration) {
    return (
      <>
        <PageHeader title={KIND_COPY[kind].title} />
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-text">
              Set up your Teacher Hub profile first — it takes a moment and the planner will
              know what you teach.
            </p>
            <Button asChild className="mt-4">
              <Link href="/teacher">Set up my profile</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    )
  }

  const blocked = hub?.entitlement ? !hub.entitlement.may_generate : false
  const ready = subject.trim() && grade.trim() && topic.trim().length >= 2

  return (
    <>
      <PageHeader
        title={KIND_COPY[kind].title}
        description={KIND_COPY[kind].description}
        backTo="/teacher"
        backLabel="Teacher Hub"
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

        <GeneratorNotice modelBacked={hub?.modelBacked ?? false} />

        <Card>
          <CardContent className="space-y-5 pt-6">
            {formError && (
              <p role="alert" className="text-sm font-medium text-danger-text">
                {formError}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="subject" label="Subject" required>
                {(props) =>
                  (hub?.account?.subjects.length ?? 0) > 0 ? (
                    <Select {...props} value={subject} onChange={(e) => setSubject(e.target.value)}>
                      <option value="">Choose a subject</option>
                      {hub?.account?.subjects.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    // A teacher who ticked no subjects at setup still needs to be able to
                    // create something. Free text rather than a dead select.
                    <Input {...props} value={subject} onChange={(e) => setSubject(e.target.value)} />
                  )
                }
              </Field>

              <Field id="grade" label="Grade or form" required>
                {(props) => (
                  <Select {...props} value={grade} onChange={(e) => setGrade(e.target.value)}>
                    <option value="">Choose a grade</option>
                    {[
                      ...new Set([...(hub?.account?.grade_levels ?? []), ...GRADES]),
                    ].map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                id="topic"
                label="Topic"
                required
                className="sm:col-span-2"
                hint="Be specific — “Simultaneous equations” beats “Algebra”."
              >
                {(props) => (
                  <Input {...props} value={topic} onChange={(e) => setTopic(e.target.value)} />
                )}
              </Field>

              <Field id="curriculum" label="Curriculum" required>
                {(props) => (
                  <Select
                    {...props}
                    value={curriculum}
                    onChange={(e) => setCurriculum(e.target.value)}
                  >
                    {Object.entries(CURRICULUM_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {kind !== 'quiz' && (
                <Field
                  id="duration"
                  label={kind === 'homework' ? 'Minutes it should take' : 'Lesson length (minutes)'}
                  required
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={5}
                      max={240}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    />
                  )}
                </Field>
              )}

              {kind === 'lesson_plan' && (
                <Field
                  id="lesson-type"
                  label="Lesson type"
                  hint="Changes how the time is split between phases."
                >
                  {(props) => (
                    <Select
                      {...props}
                      value={lessonType}
                      onChange={(e) => setLessonType(e.target.value)}
                    >
                      <option value="introduction">Introduction</option>
                      <option value="core">Core</option>
                      <option value="revision">Revision</option>
                      <option value="assessment_prep">Exam preparation</option>
                    </Select>
                  )}
                </Field>
              )}

              {kind === 'quiz' && (
                <>
                  <Field id="question-count" label="Questions" required>
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        min={1}
                        max={50}
                        value={questionCount}
                        onChange={(e) => setQuestionCount(Number(e.target.value))}
                      />
                    )}
                  </Field>

                  <Field id="question-style" label="Question types">
                    {(props) => (
                      <Select
                        {...props}
                        value={questionStyle}
                        onChange={(e) => setQuestionStyle(e.target.value)}
                      >
                        <option value="mixed">Mixed</option>
                        <option value="multiple_choice">Multiple choice</option>
                        <option value="short_answer">Short answer</option>
                        <option value="extended_response">Extended response</option>
                      </Select>
                    )}
                  </Field>

                  <Field id="difficulty" label="Difficulty">
                    {(props) => (
                      <Select
                        {...props}
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                      >
                        <option value="standard">Standard</option>
                        <option value="exam_style">Exam-style</option>
                      </Select>
                    )}
                  </Field>
                </>
              )}

              <Field
                id="context"
                label="Anything else worth knowing"
                className="sm:col-span-2"
                hint="What the class has covered, or what they struggle with. Optional."
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-5">
              <Button onClick={() => void submit()} disabled={submitting || blocked || !ready}>
                {submitting ? 'Building…' : KIND_COPY[kind].verb}
              </Button>
              {blocked && (
                <p className="text-sm text-muted-text">
                  Creating is paused — see the note above.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
