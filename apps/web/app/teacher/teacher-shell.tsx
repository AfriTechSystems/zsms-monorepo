'use client'

/**
 * The Teacher Hub sidebar.
 *
 * ## The school link is a way OUT, not a section
 *
 * `TEACHER_PORTAL.md` keeps the two navigation trees **completely separate** — personal lesson
 * plans never mixed into a menu that also lists a school's pupils. That boundary is the same one
 * the database enforces: these resources are the teacher's, and their school cannot read them.
 *
 * So a linked teacher's school appears in the sidebar footer, visually apart from the Hub's own
 * sections, rather than as one more item in the list.
 */

import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  School,
  Sparkles,
  Users,
} from 'lucide-react'

import { AskAi } from '../../components/assistant/ask-ai'
import { AppShell } from '../../components/layout/app-shell'
import type { NavGroup } from '../../components/layout/nav-config'

// Navigation destinations take their glyph from the canonical registry, so the
// sidebar and the phone's tab bar cannot drift apart on what Attendance looks like.
import { ICONS } from '../../components/ui/icon'

interface SchoolOption {
  out_school_code: string
  out_school_name: string
}

export function TeacherShell({
  children,
  headerActions,
}: {
  children: ReactNode
  headerActions?: ReactNode
}): JSX.Element {
  const [schools, setSchools] = useState<SchoolOption[]>([])

  useEffect(() => {
    let cancelled = false
    /**
     * A standalone teacher has no schools and this returns an empty list, which is the normal
     * case rather than an error — so a failure is swallowed. A sidebar that refused to render
     * because an optional link could not be resolved would be worse than one missing the link.
     */
    void fetch('/api/session/schools')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: { schools?: SchoolOption[] } } | null) => {
        if (!cancelled && body?.data?.schools) setSchools(body.data.schools)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const groups: NavGroup[] = [
    {
      label: null,
      items: [{ path: '', label: 'Hub', icon: ICONS.dashboard, exact: true }],
    },
    {
      label: 'Make',
      items: [
        { path: '/create', label: 'Create', icon: Sparkles },
        { path: '/library', label: 'My library', icon: ICONS.subjects },
        // Other teachers' shared work. Under "Make" rather than its own group,
        // because taking somebody's plan and editing it IS making one.
        { path: '/community', label: 'Community Library', icon: Users },
      ],
    },
    {
      label: 'Account',
      items: [{ path: '/account', label: 'Plan & profile', icon: ICONS.teacher }],
    },
  ]

  return (
    <AppShell
      base="/teacher"
      title="ZSMS Teacher Hub"
      subtitle="Your planning tools"
      groups={groups}
      headerActions={
        <>
          {/*
            Ask AI, in the shell rather than per screen.

            A control on every page belongs in the layout. The parent child-picker and
            the Hub signed-out branch were both bugs caused by copying a control per
            page; the fix each time was to move the single copy up a level.
          */}
          <AskAi audience="teacher" />
          {headerActions}
        </>
      }
      footer={
        schools.length > 0 ? (
          <Link
            href={`/school/${schools[0]?.out_school_code}`}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-text transition-colors hover:bg-neutral-tint hover:text-text"
          >
            <School className="size-4 shrink-0" aria-hidden />
            <span className="truncate">
              {schools.length === 1 ? schools[0]?.out_school_name : 'My schools'}
            </span>
          </Link>
        ) : null
      }
    >
      {children}
    </AppShell>
  )
}
