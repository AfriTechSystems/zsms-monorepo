'use client'

/**
 * The student portal — and the alumni portal, which is the same portal.
 *
 * Spec: `02 Authentication and Identity/AUTH.md`, `ROLES.md`, ADR-015
 *
 * ## Why one screen serves both
 *
 * AUTH.md describes two login flows and two portals. The data is the same question in
 * both — *my own records* — and `0239` keys every policy on `students.clerk_user_id`
 * without mentioning the organisation, so a graduated pupil keeps reading their history
 * after their org membership is gone.
 *
 * What changes is the framing, not the permissions: an alumnus is told plainly that this
 * is a historical record and that it stays available.
 *
 * Two near-identical portals would have to be kept in step forever to express one idea.
 *
 * ## Phone first
 *
 * Most pupils reach this on a shared or older handset, so it is a single scrolling page
 * with no sidebar — the same reasoning as the parent portal's bottom tabs.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, GraduationCap, ClipboardList, Clock } from 'lucide-react'

import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'

interface Overview {
  linked: boolean
  message?: string
  student?: {
    displayId: string
    firstName: string
    lastName: string
    schoolName: string
    gradeId: string
    classId: string
    status: string
    isAlumnus: boolean
  }
  results?: {
    id: string
    academic_year: string
    term_number: number
    subject_name: string
    marks_obtained: number | null
    marks_total: number
    grade_letter: string | null
    class_position: number | null
    class_size: number | null
  }[]
  attendance?: {
    recorded: number
    present: number
    percentage: number | null
    recent: { id: string; attendance_date: string; status: string }[]
  }
  timetable?: {
    id: string
    day_of_week: number
    room: string | null
    school_subjects: { subject_code: string; subject_name: string } | null
  }[]
  timetableLoaded?: boolean
  resultsLoaded?: boolean
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function StudentPortalPage(): JSX.Element {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/student/overview')
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not load your records.')
        return
      }
      setError(null)
      setData(body.data)
    } catch {
      setError('Could not reach ZSMS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <div className="p-card text-muted-foreground">Loading your records…</div>
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-card">
        <Card className="p-card">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" className="mt-stack" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </main>
    )
  }

  if (!data?.linked) {
    return (
      <main className="mx-auto max-w-2xl p-card">
        <Card className="p-card">
          <GraduationCap className="h-8 w-8 text-muted-foreground" />
          <p className="mt-stack font-medium">No pupil record linked</p>
          <p className="mt-1 text-sm text-muted-foreground">{data?.message}</p>
        </Card>
      </main>
    )
  }

  const s = data.student!
  const att = data.attendance!

  return (
    <main className="mx-auto max-w-2xl space-y-stack p-card pb-24">
      <header>
        <h1 className="text-xl font-semibold">
          {s.firstName} {s.lastName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s.schoolName} · <span data-numeric>{s.displayId}</span>
        </p>

        {s.isAlumnus ? (
          <Card className="mt-stack border-primary/40 bg-primary/5 p-card text-sm">
            {/*
              Said plainly, because the alternative is a former pupil assuming the
              account will be closed and losing a report card they need for a
              university application years later. ADR-015 exists for exactly that.
            */}
            You have left {s.schoolName}. These are your records from while you were
            here — report cards, attendance, and results. They stay available to you,
            so you can come back for them whenever you need them.
          </Card>
        ) : (
          <Badge variant="neutral" className="mt-2">
            {s.gradeId.replace(/_/g, ' ')}
          </Badge>
        )}
      </header>

      <Card className="p-card">
        <h2 className="flex items-center gap-2 font-medium">
          <CalendarDays className="h-4 w-4" />
          Attendance
        </h2>
        {att.recorded === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No attendance has been recorded for you yet.
          </p>
        ) : (
          <>
            <p className="mt-2 text-3xl font-semibold" data-numeric>
              {att.percentage}%
            </p>
            <p className="text-sm text-muted-foreground">
              present on <span data-numeric>{att.present}</span> of{' '}
              <span data-numeric>{att.recorded}</span> recorded days
            </p>
          </>
        )}
      </Card>

      <Card className="p-card">
        <h2 className="flex items-center gap-2 font-medium">
          <ClipboardList className="h-4 w-4" />
          Results
        </h2>
        {!data.resultsLoaded ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Your results could not be loaded just now.
          </p>
        ) : (data.results ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {/*
              The honest reason. A pupil seeing an empty results page in week three
              should not think the system has lost their marks.
            */}
            Nothing published yet. Results appear here once your school releases them.
          </p>
        ) : (
          <ul className="mt-stack divide-y divide-border">
            {(data.results ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-stack py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{r.subject_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.academic_year} · term <span data-numeric>{r.term_number}</span>
                    {r.class_position ? (
                      <>
                        {' '}
                        · position <span data-numeric>{r.class_position}</span>
                        {r.class_size ? <> of <span data-numeric>{r.class_size}</span></> : null}
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold" data-numeric>
                    {r.marks_obtained ?? '—'}/{r.marks_total}
                  </span>
                  {r.grade_letter ? (
                    <Badge variant="neutral">{r.grade_letter}</Badge>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!s.isAlumnus ? (
        <Card className="p-card">
          <h2 className="flex items-center gap-2 font-medium">
            <Clock className="h-4 w-4" />
            Timetable
          </h2>
          {!data.timetableLoaded || (data.timetable ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Your class timetable has not been published yet.
            </p>
          ) : (
            <div className="mt-stack space-y-3">
              {[1, 2, 3, 4, 5].map((day) => {
                const lessons = (data.timetable ?? []).filter((t) => t.day_of_week === day)
                if (lessons.length === 0) return null
                return (
                  <div key={day}>
                    <p className="text-xs font-medium text-muted-foreground">
                      {DAYS[day]}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {lessons.map((l) => (
                        <li key={l.id} className="flex justify-between gap-stack text-sm">
                          <span>{l.school_subjects?.subject_name ?? 'Lesson'}</span>
                          {l.room ? (
                            <span className="text-muted-foreground">{l.room}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      ) : null}
    </main>
  )
}
