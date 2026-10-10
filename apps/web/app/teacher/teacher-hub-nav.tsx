'use client'

/**
 * Teacher Hub navigation.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Why this is a separate nav from the school portal's
 *
 * A linked teacher belongs to both products at once, and the documented design keeps the
 * two navigation trees **completely separate** — personal lesson plans never mixed into a
 * menu that also lists a school's pupils. Sharing one nav would blur exactly the boundary
 * the database enforces: these resources are the teacher's, not the school's.
 *
 * The school link below is therefore a way OUT of the Hub rather than a section of it, and
 * it appears only for a teacher who actually has a school.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, LayoutDashboard, School, Sparkles, UserCog } from 'lucide-react'

import { cn } from '../../lib/utils'
import { AccountMenu } from '../../components/ui/account-menu'

const SECTIONS = [
  { href: '/teacher', label: 'Hub', icon: LayoutDashboard },
  { href: '/teacher/create', label: 'Create', icon: Sparkles },
  { href: '/teacher/library', label: 'My library', icon: BookOpen },
  { href: '/teacher/account', label: 'Account', icon: UserCog },
] as const

interface SchoolOption {
  out_school_uuid: string
  out_school_code: string
  out_school_name: string
}

export function TeacherHubNav(): JSX.Element {
  const pathname = usePathname()
  const [schools, setSchools] = useState<SchoolOption[]>([])

  useEffect(() => {
    let cancelled = false
    /**
     * A standalone teacher has no schools and this returns an empty list, which is the
     * normal case rather than an error — so a failure here is swallowed. A nav that
     * rendered an error because an optional link could not be resolved would be worse than
     * one missing the link.
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

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-gutter py-3">
        <Link href="/teacher" className="flex items-center gap-2 font-semibold text-text">
          <Sparkles className="size-5 text-primary" aria-hidden />
          <span>
            ZSMS <span className="text-muted-text">Teacher Hub</span>
          </span>
        </Link>

        <nav aria-label="Teacher Hub sections" className="ml-auto flex items-center gap-1">
          {SECTIONS.map(({ href, label, icon: Icon }) => {
            // `/teacher` must match only itself, or it would light up on every page.
            const active = href === '/teacher' ? pathname === href : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-tint text-primary-text'
                    : 'text-muted-text hover:bg-neutral-tint hover:text-text',
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            )
          })}

          {schools.length > 0 && (
            <Link
              href={`/school/${schools[0]?.out_school_code}`}
              className="ml-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-text transition-colors hover:bg-neutral-tint hover:text-text"
            >
              <School className="size-4" aria-hidden />
              <span className="hidden sm:inline">
                {schools.length === 1 ? schools[0]?.out_school_name : 'My schools'}
              </span>
            </Link>
          )}

          <div className="ml-2">
            <AccountMenu />
          </div>
        </nav>
      </div>
    </header>
  )
}
